// ══════════════════════════════════════════════════════════════
// DEVOS-EF-3 ADVERSARIAL REGRESSION — permanent ledger attack tests
//
// Every test here attacks a guarantee the audit ledger claims. Attacks run
// through the real application runtime pool (the role DeveloperOS serves
// traffic with) or, where a test models a privileged attacker, through an
// owner/privileged connection. Verification is always the product's own
// verification service/API — tests never substitute their own verifier.
// ══════════════════════════════════════════════════════════════

const { Client } = require('pg');
const crypto = require('crypto');
const { apiRequest, loginAs } = require('./helpers');
const { query, getPool } = require('../db/pool');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function privilegedUrl() {
  if (process.env.MIGRATION_DATABASE_URL) return process.env.MIGRATION_DATABASE_URL;
  const u = new URL(process.env.ADMIN_DATABASE_URL);
  u.pathname = new URL(process.env.DATABASE_URL).pathname;
  return u.toString();
}

async function withPrivileged(fn) {
  const client = new Client({ connectionString: privilegedUrl() });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

async function withRuntime(fn) {
  const client = await (await getPool()).connect();
  try { return await fn(client); } finally { client.release(); }
}

// Runs an attack as the runtime role inside a transaction that is always
// rolled back, so a successful attack never damages the shared test ledger.
async function runtimeAttack(statements) {
  return withRuntime(async client => {
    await client.query('BEGIN');
    try {
      for (const [sql, params] of statements) await client.query(sql, params);
      return { rejected: false };
    } catch (err) {
      return { rejected: true, message: err.message };
    } finally {
      await client.query('ROLLBACK').catch(() => {});
    }
  });
}

// Privileged tamper: disables the append-only trigger, mutates, re-enables.
async function privilegedTamper(sql, params) {
  return withPrivileged(async client => {
    await client.query('BEGIN');
    try {
      await client.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
      const result = await client.query(sql, params);
      await client.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  });
}

let hasChainSeq = null;
async function chainOrder() {
  if (hasChainSeq === null) {
    const { rowCount } = await query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_events' AND column_name = 'chain_seq'`);
    hasChainSeq = rowCount === 1;
  }
  return hasChainSeq ? 'chain_seq' : 'occurred_at, id';
}

async function chainEvents(organizationId) {
  const order = await chainOrder();
  const { rows } = await query(`SELECT * FROM audit_events WHERE organization_id = $1 ORDER BY ${order}`, [organizationId]);
  return rows;
}

// Isolated tenant with its own chain, so destructive tamper tests never touch
// another tenant's evidence. Built through the runtime role and the real API.
async function createSandboxTenant(label, projectCount = 4) {
  const suffix = `${label}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`.toLowerCase();
  const organizationId = `sbx-${suffix}`.slice(0, 60);
  const userId = `u-${suffix}`.slice(0, 60);
  const email = `${suffix}@ef3.test`;
  const { rows: [admin] } = await query(`SELECT password_hash FROM users WHERE email = 'admin@developeros.com'`);
  await query(`INSERT INTO organizations (id, name, type, plan) VALUES ($1, $2, 'developer', 'enterprise')`, [organizationId, `Sandbox ${label}`]);
  await query(`INSERT INTO users (id, org_id, name, email, password_hash, role, active) VALUES ($1, $2, $3, $4, $5, 'developer', TRUE)`,
    [userId, organizationId, `Sandbox ${label}`, email, admin.password_hash]);
  await query(`INSERT INTO memberships (id, user_id, organization_id, role_id, status) VALUES ($1, $2, $3, 'org-admin', 'ACTIVE')`,
    [`m-${suffix}`.slice(0, 60), userId, organizationId]);
  const session = await loginAs(email);
  const headers = { Authorization: `Bearer ${session.token}`, 'X-Organization-Id': organizationId };
  const projectIds = [];
  for (let i = 0; i < projectCount; i++) {
    const id = `${organizationId}-p${i}`;
    const res = await apiRequest('POST', '/api/projects', { headers, body: { id, name: `Sandbox Project ${i}`, type: 'audit-test', units: 1, budget: 100 + i } });
    if (res.status !== 201) throw new Error(`sandbox project create failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
    projectIds.push(id);
  }
  return { organizationId, userId, headers, projectIds };
}

async function projectInsertEvent(organizationId, projectId) {
  const { rows } = await query(`SELECT * FROM audit_events WHERE organization_id = $1 AND entity_type = 'projects' AND entity_id = $2 AND action = 'INSERT'`, [organizationId, projectId]);
  return rows[0];
}

async function apiVerify(tenant, body) {
  return body
    ? apiRequest('POST', '/api/audit/verify', { headers: tenant.headers, body })
    : apiRequest('GET', '/api/audit/verify', { headers: tenant.headers });
}

// Recomputes stored digests with the ledger's own hashing for each stored
// hash version. Before remediation the only algorithm is the v1 formula.
async function ledgerRecomputeInvalid(client, organizationId) {
  const { rowCount: hasFn } = await client.query(`SELECT 1 FROM pg_proc WHERE proname = 'devos_audit_event_hash'`);
  const sql = hasFn
    ? `SELECT COUNT(*)::int AS invalid FROM audit_events e WHERE e.organization_id = $1 AND e.hash_version >= 2 AND e.event_hash <> devos_audit_event_hash(e)`
    : `SELECT COUNT(*)::int AS invalid FROM audit_events e WHERE e.organization_id = $1 AND e.event_hash <> encode(digest(concat_ws('|',
        e.id::text, e.occurred_at::text, COALESCE(e.organization_id,''), COALESCE(e.actor_user_id,''),
        COALESCE(e.request_id,''), e.action, e.entity_type, e.entity_id,
        COALESCE(e.before_state::text,''), COALESCE(e.after_state::text,''), COALESCE(e.previous_hash,'')), 'sha256'), 'hex')`;
  return (await client.query(sql, [organizationId])).rows[0].invalid;
}

async function runEF3AdversarialTests(record) {
  console.log('\n--- EF-3 ADVERSARIAL REGRESSION (EF3-D1 … EF3-D5) ---');
  const newest = async () => (await query(`SELECT id FROM audit_events ORDER BY occurred_at DESC LIMIT 1`)).rows[0].id;

  // ── EF3-D1: ledger privilege / append-only bypass ─────────────────────────
  const role = await withRuntime(async client => (await client.query(`
    SELECT current_user AS role, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
           pg_has_role(current_user, c.relowner, 'USAGE') AS owns_ledger
    FROM pg_roles r, pg_class c WHERE r.rolname = current_user AND c.oid = 'public.audit_events'::regclass`)).rows[0]);
  record('DEVOS-EF3-D1-ROLE-001', 'Runtime database role is not superuser, not ledger owner, and holds no role-admin/replication/RLS-bypass attributes',
    !role.rolsuper && !role.owns_ledger && !role.rolcreaterole && !role.rolcreatedb && !role.rolreplication && !role.rolbypassrls,
    JSON.stringify(role));

  const target = await newest();
  const upd = await runtimeAttack([[`UPDATE audit_events SET action = 'FORGED' WHERE id = $1`, [target]]]);
  record('DEVOS-EF3-D1-UPDATE-001', 'Runtime role cannot UPDATE audit_events', upd.rejected, upd.message || 'UPDATE succeeded');

  const del = await runtimeAttack([[`DELETE FROM audit_events WHERE id = $1`, [target]]]);
  record('DEVOS-EF3-D1-DELETE-001', 'Runtime role cannot DELETE from audit_events', del.rejected, del.message || 'DELETE succeeded');

  const trunc = await runtimeAttack([[`TRUNCATE audit_events`]]);
  record('DEVOS-EF3-D1-TRUNCATE-001', 'Runtime role cannot TRUNCATE audit_events', trunc.rejected, trunc.message || 'TRUNCATE succeeded (rolled back)');

  const disable = await runtimeAttack([
    ['ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only'],
    [`UPDATE audit_events SET action = 'FORGED' WHERE id = $1`, [target]],
  ]);
  const drop = await runtimeAttack([['DROP TRIGGER audit_events_append_only ON audit_events']]);
  const replace = await runtimeAttack([[`CREATE OR REPLACE FUNCTION devos_block_audit_mutation() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql`]]);
  record('DEVOS-EF3-D1-TRIGGER-001', 'Runtime role cannot disable, drop, or replace the ledger protection trigger',
    disable.rejected && drop.rejected && replace.rejected,
    `disable: ${disable.message || 'ALLOWED'}; drop: ${drop.message || 'ALLOWED'}; replace: ${replace.message || 'ALLOWED'}`);

  const replica = await runtimeAttack([
    [`SET LOCAL session_replication_role = replica`],
    [`UPDATE audit_events SET action = 'FORGED' WHERE id = $1`, [target]],
  ]);
  record('DEVOS-EF3-D1-REPLICA-001', 'Runtime role cannot suppress triggers via session_replication_role', replica.rejected, replica.message || 'replica-mode UPDATE succeeded');

  const forge = await runtimeAttack([[`INSERT INTO audit_events (organization_id, action, entity_type, entity_id, event_hash) VALUES ('org1', 'INSERT', 'projects', 'forged', $1)`, [crypto.randomBytes(32).toString('hex')]]]);
  record('DEVOS-EF3-D1-FORGE-001', 'Runtime role cannot insert forged audit events directly', forge.rejected, forge.message || 'forged INSERT succeeded');

  // ── EF3-D2: product verification must cryptographically verify ──────────
  {
    const tenant = await createSandboxTenant('d2');
    const victim = await projectInsertEvent(tenant.organizationId, tenant.projectIds[1]);
    await privilegedTamper(`UPDATE audit_events SET after_state = jsonb_set(after_state, '{budget}', '"999999999"') WHERE id = $1`, [victim.id]);
    const res = await apiVerify(tenant);
    const body = JSON.stringify(res.body);
    record('DEVOS-EF3-D2-TAMPER-001', 'Product /api/audit/verify detects content tampering when the stored hash is left unchanged',
      res.status === 200 && res.body.valid === false && res.body.failure?.reason === 'HASH_MISMATCH' && res.body.failure?.eventId === victim.id && !body.includes('999999999'),
      body);
  }
  {
    const tenant = await createSandboxTenant('d2m');
    const victim = await projectInsertEvent(tenant.organizationId, tenant.projectIds[2]);
    await privilegedTamper(`UPDATE audit_events SET actor_user_id = 'someone-else' WHERE id = $1`, [victim.id]);
    const res = await apiVerify(tenant);
    record('DEVOS-EF3-D2-TAMPER-002', 'Product verification detects tampering of attribution metadata (actor)',
      res.status === 200 && res.body.valid === false && res.body.failure?.reason === 'HASH_MISMATCH' && res.body.failure?.eventId === victim.id,
      JSON.stringify(res.body));
  }

  // ── EF3-D3: deletion detection (middle + tail) ────────────────────────────
  {
    const tenant = await createSandboxTenant('d3m');
    const victim = await projectInsertEvent(tenant.organizationId, tenant.projectIds[1]);
    await privilegedTamper('DELETE FROM audit_events WHERE id = $1', [victim.id]);
    const res = await apiVerify(tenant);
    record('DEVOS-EF3-D3-MIDDLE-001', 'Product verification detects deletion of a middle event as a sequence gap',
      res.status === 200 && res.body.valid === false && res.body.failure?.reason === 'SEQUENCE_GAP',
      JSON.stringify(res.body));
  }
  {
    const tenant = await createSandboxTenant('d3t');
    const events = await chainEvents(tenant.organizationId);
    const tail = events[events.length - 1];
    await privilegedTamper('DELETE FROM audit_events WHERE id = $1', [tail.id]);
    const res = await apiVerify(tenant);
    record('DEVOS-EF3-D3-TAIL-001', 'Product verification detects deletion of the newest event (tail truncation)',
      res.status === 200 && res.body.valid === false && res.body.failure?.reason === 'TAIL_TRUNCATED',
      JSON.stringify(res.body));
  }

  // ── EF3-D4: timezone-independent hashing ──────────────────────────────────
  {
    const tenant = await createSandboxTenant('d4', 2);
    // An event committed by a session in a non-UTC timezone.
    await withRuntime(async client => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL TimeZone = 'Asia/Tokyo'`);
      await client.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, 'Tokyo session evidence')`, [`${tenant.organizationId}-tokyo`, tenant.organizationId]);
      await client.query('COMMIT');
    });
    const { verify } = require('../db/repositories/audit.repo');
    const zones = ['UTC', 'America/Chicago', 'Asia/Kolkata', 'Pacific/Chatham'];
    const outcomes = [];
    for (const zone of zones) {
      outcomes.push(await withRuntime(async client => {
        await client.query(`SET TimeZone = '${zone}'`);
        await client.query(`SET DateStyle = '${zone === 'UTC' ? 'ISO, MDY' : 'SQL, DMY'}'`);
        try {
          const result = await verify(tenant.organizationId, { client });
          const invalid = await ledgerRecomputeInvalid(client, tenant.organizationId);
          return { zone, valid: result.valid, hashesVerified: result.hashesVerified, count: result.count, head: result.headHash, invalid };
        } finally {
          await client.query('RESET TimeZone');
          await client.query('RESET DateStyle');
        }
      }));
    }
    const consistent = outcomes.every(o => o.valid === true && o.invalid === 0 && o.count > 0 && o.hashesVerified === o.count && o.head === outcomes[0].head);
    record('DEVOS-EF3-D4-TIMEZONE-001', 'Ledger hashes recompute and verify identically from UTC, America/Chicago, Asia/Kolkata and Pacific/Chatham sessions',
      consistent, JSON.stringify(outcomes));
  }

  // ── EF3-D5: untrusted X-Request-Id ───────────────────────────────────────
  {
    const admin = await loginAs('admin@developeros.com');
    const cases = [
      { label: 'oversized', header: 'A'.repeat(500), preserved: false },
      { label: 'malformed', header: 'bad id; DROP TABLE audit_events', preserved: false },
      { label: 'valid', header: 'ef3-corr.ID_01', preserved: true },
    ];
    const outcomes = [];
    for (const c of cases) {
      const id = `ef3-reqid-${c.label}-${Date.now()}`;
      const res = await apiRequest('POST', '/api/projects', {
        headers: { Authorization: `Bearer ${admin.token}`, 'X-Request-Id': c.header },
        body: { id, name: `Request ID ${c.label}`, type: 'audit-test' },
      });
      const event = res.status === 201 ? await projectInsertEvent('org1', id) : null;
      const echoed = res.headers['x-request-id'];
      const ok = res.status === 201 && !!event && REQUEST_ID_PATTERN.test(event.request_id || '') &&
        echoed === event.request_id && (c.preserved ? event.request_id === c.header : event.request_id !== c.header);
      outcomes.push({ label: c.label, status: res.status, recorded: event?.request_id, echoed, ok });
    }
    record('DEVOS-EF3-D5-REQUESTID-001', 'Oversized/malformed X-Request-Id is replaced server-side and never breaks an audited write; valid IDs are preserved',
      outcomes.every(o => o.ok), JSON.stringify(outcomes));
  }
}

// ── Ledger hardening coverage (sequence, heads, checkpoints, receipts, versions) ──

// Independent reconstruction of the documented receipt payload (see
// docs/DEVOS-EF3-REMEDIATION-EVIDENCE-REPORT.md) — deliberately not imported
// from the product, so a third-party verifier is modelled faithfully.
function receiptPayload(r) {
  return JSON.stringify({
    type: r.type, version: r.version, organizationId: r.organizationId, chainSeq: r.chainSeq,
    eventHash: r.eventHash, hashVersion: r.hashVersion, issuedAt: r.issuedAt, keyId: r.keyId,
  });
}

async function privilegedSql(statements) {
  return withPrivileged(async client => {
    await client.query('BEGIN');
    try {
      const out = [];
      for (const [sql, params] of statements) out.push(await client.query(sql, params));
      await client.query('COMMIT');
      return { rejected: false, out };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return { rejected: true, message: err.message };
    }
  });
}

async function runEF3HardeningTests(record) {
  console.log('\n--- EF-3 LEDGER HARDENING (sequence, heads, checkpoints, receipts, hash versions) ---');
  const { assertUnprivilegedRuntimeRole } = require('../db/pool');
  const { Pool } = require('pg');

  // Runtime guard: the product refuses to serve on a privileged role.
  {
    const ownerPool = new Pool({ connectionString: privilegedUrl(), max: 1 });
    let refused = null;
    try { await assertUnprivilegedRuntimeRole(ownerPool); } catch (err) { refused = err.message; }
    await ownerPool.end();
    let runtimeOk = true;
    try { await withRuntime(async () => {}); } catch (err) { runtimeOk = false; }
    record('DEVOS-EF3-GUARD-001', 'Runtime guard refuses a privileged (owner/superuser) database role and accepts the provisioned runtime role',
      !!refused && /Refusing to run with privileged database role/.test(refused) && runtimeOk, refused || 'owner role was accepted');
  }

  // Defense in depth: even the owner cannot TRUNCATE or rewrite evidence while protections are enabled.
  {
    const results = {};
    for (const table of ['audit_events', 'audit_chain_heads', 'audit_checkpoints']) {
      results[table] = await privilegedSql([[`TRUNCATE ${table}`]]);
    }
    const upd = await privilegedSql([[`UPDATE audit_events SET action = 'FORGED' WHERE id = (SELECT id FROM audit_events LIMIT 1)`]]);
    const rollbackHead = await privilegedSql([[`UPDATE audit_chain_heads SET last_seq = last_seq - 1 WHERE chain_key = 'org:org1'`]]);
    const deleteHead = await privilegedSql([[`DELETE FROM audit_chain_heads WHERE chain_key = 'org:org1'`]]);
    const ok = Object.values(results).every(r => r.rejected && /cannot be truncated/.test(r.message)) &&
      upd.rejected && /append-only/.test(upd.message) && rollbackHead.rejected && deleteHead.rejected;
    record('DEVOS-EF3-OWNER-001', 'Owner role cannot TRUNCATE ledger tables, UPDATE events, or roll back/delete chain heads without disabling protections',
      ok, JSON.stringify({ truncate: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.message || 'ALLOWED'])), update: upd.message || 'ALLOWED', rollbackHead: rollbackHead.message || 'ALLOWED', deleteHead: deleteHead.message || 'ALLOWED' }));
  }

  // Downgrade: no new evidence may be written in the timezone-dependent v1 format.
  {
    const r = await privilegedSql([[`INSERT INTO audit_events (organization_id, action, entity_type, entity_id, event_hash, hash_version) VALUES ('org1', 'INSERT', 'projects', 'downgrade', $1, 1)`, [crypto.randomBytes(32).toString('hex')]]]);
    record('DEVOS-EF3-HASHVER-001', 'Appending a hash_version 1 (legacy-format) event is rejected even for the owner role',
      r.rejected && /hash_version 2/.test(r.message), r.message || 'downgrade INSERT accepted');
  }

  // Sequence uniqueness enforced by the database.
  {
    const tenant = await createSandboxTenant('seq', 2);
    const [event] = await chainEvents(tenant.organizationId);
    const r = await privilegedSql([[`INSERT INTO audit_events (organization_id, action, entity_type, entity_id, event_hash, hash_version, chain_seq)
      VALUES ($1, 'INSERT', 'projects', 'duplicate-position', $2, 2, $3)`, [tenant.organizationId, crypto.randomBytes(32).toString('hex'), event.chain_seq]]]);
    record('DEVOS-EF3-SEQ-001', 'Database rejects a second event at an existing (organization_id, chain_seq) position',
      r.rejected && /audit_events_chain_position/.test(r.message), r.message || 'duplicate position accepted');
  }

  // Attacker who knows the algorithm re-hashes a relinked event: linkage still fails.
  {
    const tenant = await createSandboxTenant('pred');
    const events = await chainEvents(tenant.organizationId);
    const victim = events[3];
    const forgedPrev = crypto.randomBytes(32).toString('hex');
    await privilegedTamper(`UPDATE audit_events SET previous_hash = $2 WHERE id = $1`, [victim.id, forgedPrev]);
    await privilegedTamper(`UPDATE audit_events e SET event_hash = devos_audit_event_hash(e) WHERE id = $1`, [victim.id]);
    const res = await apiVerify(tenant);
    record('DEVOS-EF3-SEQ-002', 'Relinking an event and recomputing its hash is detected as a predecessor mismatch',
      res.body.valid === false && res.body.failure?.reason === 'PREDECESSOR_MISMATCH' && res.body.failure?.chainSeq === Number(victim.chain_seq),
      JSON.stringify(res.body));
  }

  // Concurrency: many simultaneous writers to one tenant get distinct, contiguous positions.
  {
    const tenant = await createSandboxTenant('conc', 1);
    const ids = Array.from({ length: 20 }, (_, i) => `${tenant.organizationId}-c${i}`);
    const responses = await Promise.all(ids.map((id, i) => apiRequest('POST', '/api/projects', {
      headers: tenant.headers, body: { id, name: `Concurrent ${i}`, type: 'audit-test' } })));
    const events = await chainEvents(tenant.organizationId);
    const seqs = events.map(e => Number(e.chain_seq));
    const contiguous = seqs.every((s, i) => s === i + 1);
    const { rows: [head] } = await query(`SELECT last_seq FROM audit_chain_heads WHERE chain_key = devos_audit_chain_key($1)`, [tenant.organizationId]);
    const res = await apiVerify(tenant);
    record('DEVOS-EF3-CONCURRENCY-002', '20 concurrent writers to one tenant produce contiguous unique positions 1..N, a matching head, and a valid chain',
      responses.every(r => r.status === 201) && contiguous && new Set(seqs).size === seqs.length && Number(head.last_seq) === seqs.length && res.body.valid === true,
      JSON.stringify({ statuses: [...new Set(responses.map(r => r.status))], positions: seqs.length, head: head && head.last_seq, contiguous, valid: res.body.valid }));
  }

  // Signed receipts are verifiable offline by a third party with only the public key.
  let receiptTenant = null;
  let receipt = null;
  {
    receiptTenant = await createSandboxTenant('rcpt', 4);
    const issued = await apiRequest('POST', '/api/audit/checkpoints', { headers: receiptTenant.headers });
    const keyInfo = await apiRequest('GET', '/api/audit/signing-key', { headers: receiptTenant.headers });
    receipt = issued.body;
    const publicKey = crypto.createPublicKey({ key: Buffer.from(keyInfo.body.publicKey || '', 'base64'), format: 'der', type: 'spki' });
    const offline = issued.status === 201 && crypto.verify(null, Buffer.from(receiptPayload(receipt)), publicKey, Buffer.from(receipt.signature, 'hex'));
    const events = await chainEvents(receiptTenant.organizationId);
    const tail = events[events.length - 1];
    record('DEVOS-EF3-CHECKPOINT-001', 'Issued checkpoint receipt names the current head and verifies offline with the published Ed25519 public key',
      offline && receipt.chainSeq === Number(tail.chain_seq) && receipt.eventHash === tail.event_hash && keyInfo.body.keyId === receipt.keyId,
      JSON.stringify({ status: issued.status, offline, chainSeq: receipt.chainSeq }));
  }

  // Privileged attacker deletes the checkpointed tail and rolls the head back:
  // the stored signed checkpoint still exposes the truncation.
  {
    const events = await chainEvents(receiptTenant.organizationId);
    const tail = events[events.length - 1];
    const prior = events[events.length - 2];
    await withPrivileged(async client => {
      await client.query('BEGIN');
      await client.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
      await client.query('ALTER TABLE audit_chain_heads DISABLE TRIGGER audit_chain_heads_guard');
      await client.query('DELETE FROM audit_events WHERE id = $1', [tail.id]);
      await client.query(`UPDATE audit_chain_heads SET last_seq = $2, last_hash = $3 WHERE chain_key = devos_audit_chain_key($1)`,
        [receiptTenant.organizationId, prior.chain_seq, prior.event_hash]);
      await client.query('ALTER TABLE audit_chain_heads ENABLE TRIGGER audit_chain_heads_guard');
      await client.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
      await client.query('COMMIT');
    });
    const res = await apiVerify(receiptTenant);
    record('DEVOS-EF3-CHECKPOINT-002', 'Tail deletion plus head rollback is detected by the stored signed checkpoint',
      res.body.valid === false && res.body.failure?.reason === 'TAIL_TRUNCATED' && res.body.failure?.source === 'checkpoint',
      JSON.stringify(res.body));
  }

  // Full database compromise: the attacker also deletes the stored checkpoints.
  // Internal evidence is now self-consistent; the externally held receipt is not fooled.
  {
    await withPrivileged(async client => {
      await client.query('BEGIN');
      await client.query('ALTER TABLE audit_checkpoints DISABLE TRIGGER audit_checkpoints_append_only');
      await client.query('DELETE FROM audit_checkpoints WHERE organization_id = $1', [receiptTenant.organizationId]);
      await client.query('ALTER TABLE audit_checkpoints ENABLE TRIGGER audit_checkpoints_append_only');
      await client.query('COMMIT');
    });
    const internal = await apiVerify(receiptTenant);
    const withReceipt = await apiVerify(receiptTenant, { receipts: [receipt] });
    record('DEVOS-EF3-RECEIPT-001', 'After a full-privilege rewrite (events, head, checkpoints), an externally held signed receipt still detects the truncation',
      withReceipt.body.valid === false && withReceipt.body.failure?.reason === 'TAIL_TRUNCATED' && withReceipt.body.failure?.source === 'receipt',
      JSON.stringify({ internalOnly: { valid: internal.body.valid, reason: internal.body.failure?.reason || null }, withReceipt: withReceipt.body.failure }));
  }

  // Forged, foreign-key, and cross-tenant receipts are rejected.
  {
    const tenant = await createSandboxTenant('forge', 3);
    const issued = (await apiRequest('POST', '/api/audit/checkpoints', { headers: tenant.headers })).body;
    const tampered = { ...issued, chainSeq: issued.chainSeq + 5 };
    const attacker = crypto.generateKeyPairSync('ed25519');
    const attackerKeyId = crypto.createHash('sha256').update(attacker.publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32);
    const selfSigned = { ...issued, chainSeq: issued.chainSeq + 5, keyId: attackerKeyId };
    selfSigned.signature = crypto.sign(null, Buffer.from(receiptPayload(selfSigned)), attacker.privateKey).toString('hex');
    const org1Admin = await loginAs('admin@developeros.com');
    const foreign = (await apiRequest('POST', '/api/audit/checkpoints', { headers: { Authorization: `Bearer ${org1Admin.token}` } })).body;
    const r1 = await apiVerify(tenant, { receipts: [tampered] });
    const r2 = await apiVerify(tenant, { receipts: [selfSigned] });
    const r3 = await apiVerify(tenant, { receipts: [foreign] });
    const r4 = await apiVerify(tenant, { receipts: [issued] });
    record('DEVOS-EF3-RECEIPT-002', 'Altered receipts, receipts signed with an untrusted key, and another tenant\'s receipts are rejected; a genuine receipt verifies',
      r1.body.failure?.reason === 'CHECKPOINT_SIGNATURE_INVALID' && r2.body.failure?.reason === 'CHECKPOINT_UNTRUSTED_KEY' &&
      r3.body.failure?.reason === 'RECEIPT_ORGANIZATION_MISMATCH' && r4.body.valid === true && r4.body.checkpoints.verified === 2,
      JSON.stringify([r1.body.failure, r2.body.failure, r3.body.failure, { valid: r4.body.valid, checkpoints: r4.body.checkpoints }]));
  }

  // The runtime role cannot record a checkpoint for a position that does not exist or that moves backwards.
  {
    const tenant = await createSandboxTenant('cpf', 3);
    await apiRequest('POST', '/api/audit/checkpoints', { headers: tenant.headers });
    const events = await chainEvents(tenant.organizationId);
    const fabricated = await runtimeAttack([[`SELECT devos_audit_record_checkpoint($1, $2, $3, now(), 'k', 's')`,
      [tenant.organizationId, events.length + 50, crypto.randomBytes(32).toString('hex')]]]);
    const backwards = await runtimeAttack([[`SELECT devos_audit_record_checkpoint($1, 1, $2, now(), 'k', 's')`,
      [tenant.organizationId, events[0].event_hash]]]);
    const rewrite = await runtimeAttack([[`UPDATE audit_checkpoints SET chain_seq = 1 WHERE organization_id = $1`, [tenant.organizationId]]]);
    record('DEVOS-EF3-CHECKPOINT-003', 'Runtime role cannot fabricate a checkpoint, move checkpoints backwards, or rewrite recorded checkpoints',
      fabricated.rejected && backwards.rejected && rewrite.rejected,
      JSON.stringify({ fabricated: fabricated.message, backwards: backwards.message, rewrite: rewrite.message }));
  }

  // New audit endpoints enforce audit:read.
  {
    const developer = await loginAs('maria@kgdevelopment.com');
    const headers = { Authorization: `Bearer ${developer.token}` };
    const statuses = [
      (await apiRequest('POST', '/api/audit/verify', { headers, body: { receipts: [] } })).status,
      (await apiRequest('POST', '/api/audit/checkpoints', { headers })).status,
      (await apiRequest('GET', '/api/audit/checkpoints', { headers })).status,
      (await apiRequest('GET', '/api/audit/signing-key', { headers })).status,
    ];
    record('DEVOS-EF3-AUTHZ-002', 'Callers without audit:read cannot verify with receipts, issue or list checkpoints, or read the signing key',
      statuses.every(s => s === 403), JSON.stringify(statuses));
  }

  await runHashVersionUpgradeTest(record);
}

// Builds a database at the pre-remediation schema (001–004), writes v1
// evidence, upgrades to v2, and verifies the boundary with the product verifier.
async function runHashVersionUpgradeTest(record) {
  const { runMigrations } = require('../db/migrate');
  const { verify } = require('../db/repositories/audit.repo');
  const base = new URL(process.env.MIGRATION_DATABASE_URL);
  const dbName = `${decodeURIComponent(base.pathname.slice(1))}_hv`;
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const ownerUrl = new URL(base); ownerUrl.pathname = `/${dbName}`;
  const runtimeUrl = new URL(process.env.DATABASE_URL); runtimeUrl.pathname = `/${dbName}`;
  const savedMigrationUrl = process.env.MIGRATION_DATABASE_URL;
  const outcome = {};
  try {
    process.env.MIGRATION_DATABASE_URL = ownerUrl.toString();
    await runMigrations({ until: '004_audit_ledger.sql', skipProvision: true, quiet: true });
    const owner = new Client({ connectionString: ownerUrl.toString() });
    await owner.connect();
    let legacyBefore;
    try {
      await owner.query(`INSERT INTO organizations (id, name) VALUES ('hv-org', 'Hash Version Org')`);
      for (let i = 0; i < 3; i++) await owner.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, 'hv-org', $2)`, [`hv-p${i}`, `Legacy ${i}`]);
      legacyBefore = (await owner.query(`SELECT id, event_hash FROM audit_events WHERE organization_id = 'hv-org' ORDER BY occurred_at, id`)).rows;
    } finally { await owner.end(); }

    await runMigrations({ quiet: true });
    const runtime = new Client({ connectionString: runtimeUrl.toString() });
    await runtime.connect();
    try {
      await runtime.query('BEGIN');
      await runtime.query(`INSERT INTO projects (id, organization_id, name) VALUES ('hv-p-new', 'hv-org', 'Post-upgrade')`);
      await runtime.query('COMMIT');
      const legacyAfter = (await runtime.query(`SELECT id, event_hash, hash_version FROM audit_events WHERE organization_id = 'hv-org' AND hash_version = 1 ORDER BY occurred_at, id`)).rows;
      const v2 = (await runtime.query(`SELECT chain_seq, action, previous_hash, hash_version FROM audit_events WHERE organization_id = 'hv-org' AND hash_version = 2 ORDER BY chain_seq`)).rows;
      await runtime.query(`SET TimeZone = 'Asia/Kathmandu'`);
      const verified = await verify('hv-org', { client: runtime });
      outcome.untouched = legacyAfter.length === legacyBefore.length && legacyAfter.every((r, i) => r.id === legacyBefore[i].id && r.event_hash === legacyBefore[i].event_hash);
      outcome.genesis = v2[0] && v2[0].action === 'GENESIS' && v2[0].previous_hash === legacyBefore[legacyBefore.length - 1].event_hash;
      outcome.continued = v2.length === 2 && Number(v2[1].chain_seq) === 2;
      outcome.verified = { valid: verified.valid, hashVersions: verified.hashVersions, hashesVerified: verified.hashesVerified, count: verified.count };
    } finally { await runtime.end(); }

    const tamper = new Client({ connectionString: ownerUrl.toString() });
    await tamper.connect();
    try {
      await tamper.query('BEGIN');
      await tamper.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
      await tamper.query(`UPDATE audit_events SET after_state = jsonb_set(after_state, '{name}', '"forged legacy"') WHERE id = $1`, [legacyBefore[1].id]);
      outcome.tamperedId = legacyBefore[1].id;
      await tamper.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
      await tamper.query('COMMIT');
    } finally { await tamper.end(); }
    const runtime2 = new Client({ connectionString: runtimeUrl.toString() });
    await runtime2.connect();
    try { outcome.tampered = (await verify('hv-org', { client: runtime2 })).failure; } finally { await runtime2.end(); }
  } catch (err) {
    outcome.error = err.message;
  } finally {
    process.env.MIGRATION_DATABASE_URL = savedMigrationUrl;
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
  record('DEVOS-EF3-HASHVER-002', 'Upgrade from hash_version 1: legacy evidence is untouched, a v2 genesis links to the legacy head, the chain continues, and the mixed ledger verifies',
    !outcome.error && outcome.untouched && outcome.genesis && outcome.continued && outcome.verified.valid === true &&
    outcome.verified.hashVersions[1] === 4 && outcome.verified.hashVersions[2] === 2 && outcome.verified.hashesVerified === outcome.verified.count,
    JSON.stringify(outcome));
  record('DEVOS-EF3-HASHVER-003', 'Tampering with a legacy hash_version 1 event is detected after the upgrade',
    !outcome.error && outcome.tampered?.reason === 'LEGACY_HASH_MISMATCH' && outcome.tampered?.eventId === outcome.tamperedId,
    JSON.stringify(outcome.tampered || outcome.error));
}

module.exports = {
  runEF3AdversarialTests,
  runEF3HardeningTests,
  // shared with later adversarial sections
  withPrivileged, withRuntime, runtimeAttack, privilegedTamper, createSandboxTenant, projectInsertEvent, chainEvents, apiVerify,
};
