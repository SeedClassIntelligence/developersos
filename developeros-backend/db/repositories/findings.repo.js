// ══════════════════════════════════════════════════════════════
// db/repositories/findings.repo.js — persisted deterministic findings
// Findings are produced only by the engine; clients can read them and move
// them through OPEN → ACKNOWLEDGED → RESOLVED. History is never rewritten.
// ══════════════════════════════════════════════════════════════

const { query, transaction } = require('../pool');
const engine = require('../../intelligence/engine');

const STATE_FILTERS = {
  OPEN: "state = 'OPEN'",
  ACKNOWLEDGED: "state = 'ACKNOWLEDGED'",
  RESOLVED: "state = 'RESOLVED'",
  ACTIVE: "state <> 'RESOLVED'",
};

async function list(org, state) {
  const filter = state ? STATE_FILTERS[state] : 'TRUE';
  if (!filter) return null;
  const { rows } = await query(`SELECT * FROM intelligence_findings WHERE organization_id = $1 AND ${filter}
    ORDER BY condition_key, first_detected_at, id`, [org]);
  return rows.map(engine.toFinding);
}

async function get(org, id) {
  const { rows } = await query('SELECT * FROM intelligence_findings WHERE organization_id = $1 AND id = $2', [org, id]);
  return rows[0] ? engine.toFinding(rows[0]) : null;
}

async function history(org, id) {
  const { rows } = await query(`SELECT * FROM intelligence_finding_events WHERE organization_id = $1 AND finding_id = $2
    ORDER BY occurred_at, id`, [org, id]);
  return rows.map(r => ({
    fromState: r.from_state, toState: r.to_state, actorUserId: r.actor_user_id, note: r.note,
    occurredAt: new Date(r.occurred_at).toISOString(),
  }));
}

// Manual lifecycle. `allowedFrom` is the set of states the move may start from.
async function move(org, id, to, allowedFrom, actor, note) {
  return transaction(async client => {
    const { rows: [row] } = await client.query('SELECT * FROM intelligence_findings WHERE organization_id = $1 AND id = $2 FOR UPDATE', [org, id]);
    if (!row) return { notFound: true };
    if (!allowedFrom.includes(row.state)) return { conflict: `Finding is ${row.state}; cannot move to ${to}` };
    if (to === 'RESOLVED') {
      await client.query(`UPDATE intelligence_findings SET state = 'RESOLVED', resolution = 'MANUAL', resolved_at = clock_timestamp() WHERE id = $1`, [id]);
    } else {
      await client.query('UPDATE intelligence_findings SET state = $2 WHERE id = $1', [id, to]);
    }
    await engine.recordEvent(client, org, id, row.state, to, actor, note || null);
    const { rows: [updated] } = await client.query('SELECT * FROM intelligence_findings WHERE id = $1', [id]);
    return { finding: engine.toFinding(updated) };
  });
}

async function evaluate(org, asOf, actor) {
  return transaction(client => engine.evaluate(client, org, asOf, actor));
}

async function dryRun(org, asOf) {
  return { asOf: asOf.toISOString(), findings: await engine.compute({ query }, org, asOf) };
}

module.exports = { list, get, history, move, evaluate, dryRun };
