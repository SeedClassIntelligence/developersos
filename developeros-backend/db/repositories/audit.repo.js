const { query, getPool } = require('../pool');
const signing = require('../audit-signing');

const MAX_RECEIPTS = 100;

async function list(organizationId, limit = 100, before = null, beforeSeq = null) {
  const capped = Math.max(1, Math.min(Number(limit) || 100, 500));
  const params = [organizationId, capped];
  let predicate = 'organization_id = $1';
  if (beforeSeq) {
    params.push(Number(beforeSeq));
    predicate += ` AND chain_seq < $${params.length}`;
  } else if (before) {
    params.push(before);
    predicate += ` AND occurred_at < $${params.length}`;
  }
  const { rows } = await query(`
    SELECT id, occurred_at, organization_id, actor_user_id, request_id, action,
           entity_type, entity_id, before_state, after_state, previous_hash, event_hash,
           hash_version, chain_seq
    FROM audit_events WHERE ${predicate}
    ORDER BY chain_seq DESC NULLS LAST, occurred_at DESC, id DESC LIMIT $2
  `, params);
  return rows;
}

function fail(reason, event, detail) {
  return {
    reason,
    chainSeq: event && event.chain_seq != null ? Number(event.chain_seq) : null,
    eventId: event ? event.id : null,
    detail,
  };
}

// hash_version 1 segment (pre-remediation evidence). Its digests depend on the
// session TimeZone/DateStyle in force when they were written; the GENESIS event
// attests those settings and the verifier pins them for the recomputation.
async function verifyLegacySegment(client, organizationId, genesis) {
  const { rows: [{ n }] } = await client.query(
    `SELECT count(*)::int AS n FROM audit_events WHERE organization_id IS NOT DISTINCT FROM $1 AND hash_version = 1`, [organizationId]);
  if (n === 0) {
    const ok = !genesis;
    return { count: 0, hashesVerified: 0, headHash: null, failure: ok ? null : fail('LEGACY_COUNT_MISMATCH', genesis, 'genesis attests legacy events that are missing') };
  }
  if (!genesis) {
    return { count: n, hashesVerified: 0, headHash: null, failure: fail('LEGACY_UNATTESTED', null, 'hash_version 1 events exist without a hash_version 2 genesis attestation') };
  }
  const attest = genesis.after_state || {};
  await client.query(`SELECT set_config('TimeZone', $1, true), set_config('DateStyle', $2, true)`,
    [attest.legacy_timezone || 'UTC', attest.legacy_datestyle || 'ISO, MDY']);
  const { rows } = await client.query(`
    SELECT e.id, e.chain_seq, e.previous_hash, e.event_hash, devos_audit_event_hash(e) AS recomputed_hash
    FROM audit_events e WHERE e.organization_id IS NOT DISTINCT FROM $1 AND e.hash_version = 1
    ORDER BY e.occurred_at ASC, e.id ASC`, [organizationId]);

  let previous = null;
  let hashesVerified = 0;
  for (const event of rows) {
    if (event.recomputed_hash !== event.event_hash) {
      return { count: n, hashesVerified, headHash: previous, failure: fail('LEGACY_HASH_MISMATCH', event, 'stored hash does not match the recomputed hash_version 1 digest') };
    }
    hashesVerified++;
    if (event.previous_hash !== previous) {
      return { count: n, hashesVerified, headHash: previous, failure: fail('LEGACY_PREDECESSOR_MISMATCH', event, 'previous_hash does not link to the preceding legacy event') };
    }
    previous = event.event_hash;
  }
  if (Number(attest.legacy_event_count) !== n || attest.legacy_head_hash !== previous || genesis.previous_hash !== previous) {
    return { count: n, hashesVerified, headHash: previous, failure: fail('LEGACY_COUNT_MISMATCH', genesis, 'legacy segment does not match the genesis attestation') };
  }
  return { count: n, hashesVerified, headHash: previous, failure: null };
}

function checkCheckpoint(cp, source, organizationId, bySeq, lastSeq) {
  if (source === 'receipt' && String(cp.organizationId) !== String(organizationId)) {
    return { reason: 'RECEIPT_ORGANIZATION_MISMATCH', chainSeq: null, eventId: null, detail: 'receipt was issued for a different organization' };
  }
  const signature = signing.verifyCheckpointSignature(cp);
  if (!signature.ok) {
    return { reason: signature.reason, chainSeq: Number(cp.chainSeq) || null, eventId: null, detail: `${source} signature could not be verified` };
  }
  const seq = Number(cp.chainSeq);
  if (seq > lastSeq) {
    return { reason: 'TAIL_TRUNCATED', chainSeq: seq, eventId: null, detail: `${source} proves the chain reached position ${seq}; it now ends at ${lastSeq}` };
  }
  const event = bySeq.get(seq);
  if (!event || event.event_hash !== cp.eventHash) {
    return { reason: 'CHECKPOINT_MISMATCH', chainSeq: seq, eventId: event ? event.id : null, detail: `${source} hash does not match the ledger at this position` };
  }
  return null;
}

// Full cryptographic verification of one organization's chain. Runs on a
// single REPEATABLE READ snapshot so concurrent appends cannot produce a false
// head mismatch. `options.client` lets callers choose the session (tests use
// it to verify from sessions with different TimeZone/DateStyle settings).
async function verify(organizationId, options = {}) {
  const receipts = Array.isArray(options.receipts) ? options.receipts.slice(0, MAX_RECEIPTS) : [];
  const ownClient = !options.client;
  const client = options.client || await (await getPool()).connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: events } = await client.query(`
      SELECT e.id, e.chain_seq, e.hash_version, e.action, e.entity_type, e.previous_hash, e.event_hash,
             e.after_state, devos_audit_event_hash(e) AS recomputed_hash
      FROM audit_events e
      WHERE e.organization_id IS NOT DISTINCT FROM $1 AND e.hash_version >= 2
      ORDER BY e.chain_seq ASC`, [organizationId]);
    const { rows: [head] } = await client.query(
      `SELECT last_seq, last_hash FROM audit_chain_heads WHERE chain_key = devos_audit_chain_key($1)`, [organizationId]);
    const { rows: stored } = await client.query(`
      SELECT organization_id, chain_seq, event_hash, hash_version, issued_at, key_id, signature
      FROM audit_checkpoints WHERE chain_key = devos_audit_chain_key($1) ORDER BY chain_seq`, [organizationId]);

    const first = events[0];
    const genesis = first && first.action === 'GENESIS' && first.entity_type === 'audit_ledger' ? first : null;
    const legacy = await verifyLegacySegment(client, organizationId, genesis);
    await client.query('COMMIT');

    let failure = legacy.failure;
    let hashesVerified = legacy.hashesVerified;
    let expected = 1;
    let previous = null;
    const bySeq = new Map();

    for (const event of events) {
      if (failure) break;
      const seq = Number(event.chain_seq);
      if (event.hash_version !== 2) { failure = fail('UNSUPPORTED_HASH_VERSION', event, `hash_version ${event.hash_version} is not supported`); break; }
      if (seq < expected) { failure = fail('SEQUENCE_DUPLICATE', event, `position ${seq} appears more than once`); break; }
      if (seq > expected) { failure = fail('SEQUENCE_GAP', event, `positions ${expected}..${seq - 1} are missing`); break; }
      if (event.recomputed_hash !== event.event_hash) { failure = fail('HASH_MISMATCH', event, 'stored hash does not match the recomputed canonical hash'); break; }
      hashesVerified++;
      const expectedPrevious = seq === 1 ? legacy.headHash : previous;
      if (event.previous_hash !== expectedPrevious) {
        failure = fail(seq === 1 ? 'GENESIS_MISMATCH' : 'PREDECESSOR_MISMATCH', event, 'previous_hash does not link to the preceding event');
        break;
      }
      bySeq.set(seq, event);
      previous = event.event_hash;
      expected = seq + 1;
    }

    const lastSeq = events.length ? Number(events[events.length - 1].chain_seq) : 0;
    const lastHash = events.length ? events[events.length - 1].event_hash : null;
    if (!failure) {
      const headSeq = head ? Number(head.last_seq) : 0;
      if (!head && events.length) failure = { reason: 'HEAD_MISSING', chainSeq: null, eventId: null, detail: 'chain has events but no recorded head' };
      else if (headSeq > lastSeq) failure = { reason: 'TAIL_TRUNCATED', chainSeq: headSeq, eventId: null, detail: `head records position ${headSeq}; chain ends at ${lastSeq}` };
      else if (headSeq < lastSeq) failure = { reason: 'HEAD_BEHIND_CHAIN', chainSeq: lastSeq, eventId: null, detail: 'events exist beyond the recorded head' };
      else if (head && headSeq > 0 && head.last_hash !== lastHash) failure = { reason: 'HEAD_MISMATCH', chainSeq: headSeq, eventId: null, detail: 'head hash does not match the last event' };
    }

    const checkpoints = { stored: stored.length, receipts: receipts.length, verified: 0 };
    const candidates = [
      ...stored.map(cp => ({ source: 'checkpoint', cp: {
        type: signing.RECEIPT_TYPE, version: signing.RECEIPT_VERSION, organizationId: cp.organization_id,
        chainSeq: Number(cp.chain_seq), eventHash: cp.event_hash, hashVersion: cp.hash_version,
        issuedAt: new Date(cp.issued_at).toISOString(), keyId: cp.key_id, signature: cp.signature } })),
      ...receipts.map(cp => ({ source: 'receipt', cp })),
    ];
    for (const { source, cp } of candidates) {
      if (failure) break;
      const problem = checkCheckpoint(cp, source, organizationId, bySeq, lastSeq);
      if (problem) failure = { ...problem, source };
      else checkpoints.verified++;
    }

    return {
      valid: !failure,
      organizationId,
      count: legacy.count + events.length,
      hashesVerified,
      hashVersions: { 1: legacy.count, 2: events.length },
      headSeq: lastSeq,
      headHash: lastHash,
      legacy: legacy.count ? { count: legacy.count, hashVersion: 1, headHash: legacy.headHash } : null,
      checkpoints,
      failure: failure || null,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (ownClient) client.release();
  }
}

async function issueCheckpoint(organizationId) {
  const { rows: [head] } = await query(
    `SELECT last_seq, last_hash FROM audit_chain_heads WHERE chain_key = devos_audit_chain_key($1)`, [organizationId]);
  if (!head || Number(head.last_seq) === 0) return null;
  const receipt = signing.signCheckpoint({ organizationId, chainSeq: Number(head.last_seq), eventHash: head.last_hash, hashVersion: 2 });
  await query('SELECT devos_audit_record_checkpoint($1, $2, $3, $4, $5, $6)',
    [organizationId, receipt.chainSeq, receipt.eventHash, receipt.issuedAt, receipt.keyId, receipt.signature]);
  return receipt;
}

async function listCheckpoints(organizationId) {
  const { rows } = await query(`
    SELECT chain_seq, event_hash, hash_version, issued_at, key_id, signature
    FROM audit_checkpoints WHERE chain_key = devos_audit_chain_key($1) ORDER BY chain_seq DESC LIMIT 100`, [organizationId]);
  return rows.map(r => ({
    type: signing.RECEIPT_TYPE, version: signing.RECEIPT_VERSION, organizationId,
    chainSeq: Number(r.chain_seq), eventHash: r.event_hash, hashVersion: r.hash_version,
    issuedAt: new Date(r.issued_at).toISOString(), keyId: r.key_id, signature: r.signature,
  }));
}

module.exports = { list, verify, issueCheckpoint, listCheckpoints };
