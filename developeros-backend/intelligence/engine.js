// ══════════════════════════════════════════════════════════════
// intelligence/engine.js — DI-1 deterministic findings engine
//
// Pure, tenant-scoped rule evaluation over PostgreSQL state:
//   - every input query is filtered by the evaluating organization;
//   - time enters only through the explicit asOf (no system clock);
//   - the same state and asOf produce deep-equal output (stable ordering,
//     no generated ids or timestamps in computed findings).
// No machine learning, no LLM calls, no scoring, no policy decisions.
// ══════════════════════════════════════════════════════════════

const crypto = require('crypto');
const registry = require('./rule-registry.json');
const readiness = require('./readiness');

const DAY_MS = 86400000;
const INFORMATION_RULE_STATES = new Set(['NEW', 'SCREENING', 'INFORMATION_REQUIRED']);

function sourceKey(sources) {
  return sources.map(s => `${s.type}:${s.id}`).sort().join(',');
}

// Strict ISO-8601 instant: date, time and zone are all required.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;
function parseAsOf(value) {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function daysUntil(dateText, asOf) {
  const [y, m, d] = dateText.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - asOf.getTime()) / DAY_MS);
}

// ── tenant-scoped inputs ────────────────────────────────────────────────────
async function loadInputs(db, organizationId) {
  const q = (sql, params = [organizationId]) => db.query(sql, params).then(r => r.rows);
  const [projects, tasks, contracts, permits, corrections, capital, partners, opportunities] = await Promise.all([
    q('SELECT id, name, phase FROM projects WHERE organization_id = $1 ORDER BY id'),
    q(`SELECT t.id, t.project_id, t.title, t.partner_id, t.contract_id, t.status
       FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.organization_id = $1 ORDER BY t.id`),
    q(`SELECT c.id, c.project_id, c.partner_id, c.type, c.status, c.linked_task_count
       FROM contracts c JOIN projects p ON p.id = c.project_id WHERE p.organization_id = $1 ORDER BY c.id`),
    q(`SELECT x.id, x.project_id, x.name, x.status
       FROM permits x JOIN projects p ON p.id = x.project_id WHERE p.organization_id = $1 ORDER BY x.id`),
    q(`SELECT c.id, c.permit_id, c.status
       FROM permit_corrections c JOIN permits x ON x.id = c.permit_id JOIN projects p ON p.id = x.project_id
       WHERE p.organization_id = $1 ORDER BY c.id`),
    q(`SELECT s.id, s.capital_stack_id, k.project_id, s.name, s.status, s.deadline::text AS deadline
       FROM capital_sources s JOIN capital_stacks k ON k.id = s.capital_stack_id JOIN projects p ON p.id = k.project_id
       WHERE p.organization_id = $1 ORDER BY s.id`),
    // Partner names are resolved only within the evaluating organization.
    q('SELECT id, name FROM partners WHERE org_id = $1'),
    q(`SELECT id, name, status, property_id, concept_description FROM di_opportunities WHERE organization_id = $1 ORDER BY id`),
  ]);
  const facts = await readiness.currentFactsByProperty(db, organizationId,
    [...new Set(opportunities.map(o => o.property_id).filter(Boolean))]);
  return { projects, tasks, contracts, permits, corrections, capital, partners: new Map(partners.map(p => [p.id, p.name])), opportunities, facts };
}

// ── rule implementations (one per registry rule) ───────────────────────────
const RULES = {
  'EXEC-TASK-NO-CONTRACT': (d) => d.tasks
    .filter(t => t.status !== 'complete' && !t.contract_id)
    .map(t => {
      const partner = t.partner_id ? d.partners.get(t.partner_id) : null;
      return {
        severity: 'critical', title: `${t.title} — no contract`,
        explanation: `Task ${partner ? `assigned to ${partner}` : 'has no assigned partner'} and no executed contract exists. Work cannot legally proceed.`,
        sources: [{ type: 'task', id: t.id }],
      };
    }),

  'EXEC-CONTRACT-MISSING': (d) => d.contracts
    .filter(c => c.status === 'missing' && c.linked_task_count > 0)
    .map(c => {
      const partner = c.partner_id ? d.partners.get(c.partner_id) : null;
      return {
        severity: 'critical', title: `${partner || 'Partner'} contract missing`,
        explanation: `${c.type} contract not executed. ${c.linked_task_count} task${c.linked_task_count !== 1 ? 's' : ''} blocked.`,
        sources: [{ type: 'contract', id: c.id }],
      };
    }),

  'EXEC-BLOCKED-TASKS': (d) => d.projects
    .map(p => ({ project: p, blocked: d.tasks.filter(t => t.project_id === p.id && t.status === 'blocked') }))
    .filter(x => x.blocked.length > 0)
    .map(({ project, blocked }) => ({
      severity: 'warning', title: `${blocked.length} task${blocked.length !== 1 ? 's' : ''} blocked on ${project.name}`,
      explanation: `${blocked.map(t => t.title).join(', ')} — resolve dependencies to unblock.`,
      sources: [{ type: 'project', id: project.id }, ...blocked.map(t => ({ type: 'task', id: t.id }))],
    })),

  'EXEC-PERMIT-CORRECTIONS': (d) => d.permits
    .filter(pm => pm.status === 'corrections')
    .map(pm => {
      const open = d.corrections.filter(c => c.permit_id === pm.id && c.status !== 'complete');
      return {
        severity: 'warning', title: `${pm.name} — ${open.length} correction${open.length !== 1 ? 's' : ''} open`,
        explanation: `City corrections received. ${open.length} item${open.length !== 1 ? 's' : ''} outstanding. Risk of losing review slot.`,
        sources: [{ type: 'permit', id: pm.id }, ...open.map(c => ({ type: 'permit_correction', id: c.id }))],
      };
    }),

  'EXEC-CAPITAL-DEADLINE': (d, asOf) => d.capital
    .filter(s => s.status === 'pending' && s.deadline)
    .map(s => ({ s, days: daysUntil(s.deadline, asOf) }))
    .filter(x => x.days < 60)
    .map(({ s, days }) => ({
      severity: days < 30 ? 'critical' : 'warning',
      title: days < 0 ? `${s.name} deadline passed ${-days} days ago` : `${s.name} expires in ${days} days`,
      explanation: `Pending capital commitment deadline ${s.deadline}; ${days} days from ${asOf.toISOString().slice(0, 10)}. Requires immediate action.`,
      sources: [{ type: 'capital_stack', id: s.capital_stack_id }, { type: 'capital_source', id: s.id }],
    })),

  'EXEC-GC-CONTRACT-PENDING': (d) => d.projects
    .filter(p => p.phase >= 3)
    .map(p => ({ p, gc: d.contracts.find(c => c.project_id === p.id && (c.type || '').toLowerCase().includes('general contractor') && c.status !== 'executed') }))
    .filter(x => x.gc)
    .map(({ p, gc }) => ({
      severity: 'warning', title: 'GC contract not executed — construction approaching',
      explanation: `${gc.linked_task_count} construction tasks on ${p.name} cannot begin without an executed GC contract.`,
      sources: [{ type: 'project', id: p.id }, { type: 'contract', id: gc.id }],
    })),

  'DI-OPPORTUNITY-INFORMATION-REQUIRED': (d) => d.opportunities
    .filter(o => INFORMATION_RULE_STATES.has(o.status))
    .map(o => ({ o, r: readiness.assess(o, d.facts.get(o.property_id)) }))
    .filter(x => x.r.status === 'INFORMATION_REQUIRED')
    .map(({ o, r }) => ({
      severity: 'info', title: `${o.name} — information required before qualification`,
      explanation: `Missing: ${r.missing.join(', ')}. Missing information is not a negative determination about the opportunity.`,
      sources: [{ type: 'opportunity', id: o.id }],
    })),
};

const ACTIVE_RULES = registry.rules.filter(r => r.status === 'ACTIVE');
const RULE_VERSIONS = new Map(registry.rules.map(r => [r.ruleId, r.version]));

// Registry and implementations must agree exactly; refuse to load otherwise.
(function assertRegistryConsistency() {
  const implemented = Object.keys(RULES).sort();
  const declared = ACTIVE_RULES.map(r => r.ruleId).sort();
  if (JSON.stringify(implemented) !== JSON.stringify(declared)) {
    throw new Error(`Rule registry and implementations disagree: registry=${declared} implemented=${implemented}`);
  }
}());

// Computes findings without persisting. Deterministic in (state, asOf).
async function compute(db, organizationId, asOf) {
  const data = await loadInputs(db, organizationId);
  const asOfIso = asOf.toISOString();
  const findings = [];
  for (const rule of ACTIVE_RULES) {
    for (const f of RULES[rule.ruleId](data, asOf)) {
      findings.push({
        ruleId: rule.ruleId,
        ruleVersion: rule.version,
        organizationId,
        findingType: rule.findingType,
        severity: f.severity,
        title: f.title,
        explanation: f.explanation,
        sources: f.sources,
        asOf: asOfIso,
        conditionKey: `${rule.ruleId}|${sourceKey(f.sources)}`,
      });
    }
  }
  return findings.sort((a, b) => (a.conditionKey < b.conditionKey ? -1 : a.conditionKey > b.conditionKey ? 1 : 0));
}

// ── persistence ─────────────────────────────────────────────────────────────
function toFinding(r) {
  return {
    id: r.id,
    organizationId: r.organization_id,
    ruleId: r.rule_id,
    ruleVersion: r.rule_version,
    conditionKey: r.condition_key,
    findingType: r.finding_type,
    severity: r.severity,
    title: r.title,
    explanation: r.explanation,
    sources: r.sources,
    state: r.state,
    asOf: new Date(r.as_of).toISOString(),
    firstDetectedAt: new Date(r.first_detected_at).toISOString(),
    resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
    resolution: r.resolution,
    recurrenceOf: r.recurrence_of,
  };
}

async function recordEvent(client, organizationId, findingId, fromState, toState, actorUserId, note) {
  await client.query(`INSERT INTO intelligence_finding_events (id, organization_id, finding_id, from_state, to_state, actor_user_id, note)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`, [crypto.randomUUID(), organizationId, findingId, fromState, toState, actorUserId, note]);
}

async function resolveFinding(client, row, resolution, actorUserId, note, resolvedAt) {
  await client.query(`UPDATE intelligence_findings SET state = 'RESOLVED', resolution = $2, resolved_at = $3 WHERE id = $1`,
    [row.id, resolution, resolvedAt]);
  await recordEvent(client, row.organization_id, row.id, row.state, 'RESOLVED', actorUserId, note);
}

// Persisted evaluation (contract §8 re-evaluation semantics). Serialized per
// organization so concurrent evaluations cannot race the one-active index.
async function evaluate(client, organizationId, asOf, actorUserId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`devos-di-evaluate:${organizationId}`]);
  const computed = await compute(client, organizationId, asOf);
  const byKey = new Map(computed.map(f => [`${f.ruleId}|${f.conditionKey}`, f]));
  const { rows: active } = await client.query(
    `SELECT * FROM intelligence_findings WHERE organization_id = $1 AND state <> 'RESOLVED' ORDER BY condition_key, id`, [organizationId]);

  const created = [];
  const resolved = [];
  const kept = new Set();
  for (const row of active) {
    const current = RULE_VERSIONS.get(row.rule_id);
    if (current === undefined) continue; // not a registry rule: never touched by evaluation
    const key = `${row.rule_id}|${row.condition_key}`;
    if (row.rule_version !== current) {
      await resolveFinding(client, row, 'SUPERSEDED_BY_RULE_VERSION', actorUserId,
        `Superseded by ${row.rule_id} version ${current}`, asOf);
      resolved.push(row.id);
      continue;
    }
    const f = byKey.get(key);
    if (!f) {
      await resolveFinding(client, row, 'CONDITION_CLEARED', actorUserId, 'Condition no longer present at evaluation time', asOf);
      resolved.push(row.id);
      continue;
    }
    kept.add(key);
    if (row.severity !== f.severity || row.title !== f.title || row.explanation !== f.explanation || sourceKey(row.sources) !== sourceKey(f.sources)) {
      await client.query(`UPDATE intelligence_findings SET severity = $2, title = $3, explanation = $4, sources = $5::jsonb, as_of = $6 WHERE id = $1`,
        [row.id, f.severity, f.title, f.explanation, JSON.stringify(f.sources), asOf]);
    }
  }

  for (const f of computed) {
    const key = `${f.ruleId}|${f.conditionKey}`;
    if (kept.has(key)) continue;
    // A condition that reappears after its finding was resolved opens a new
    // finding linked to the most recent prior resolution (never a reopen).
    const { rows: [prior] } = await client.query(`
      SELECT id FROM intelligence_findings
      WHERE organization_id = $1 AND rule_id = $2 AND condition_key = $3 AND state = 'RESOLVED'
        AND resolution <> 'SUPERSEDED_BY_RULE_VERSION'
      ORDER BY resolved_at DESC NULLS LAST, id DESC LIMIT 1`, [organizationId, f.ruleId, f.conditionKey]);
    const id = crypto.randomUUID();
    await client.query(`INSERT INTO intelligence_findings (id, organization_id, rule_id, rule_version, condition_key, finding_type, severity,
        title, explanation, sources, state, as_of, first_detected_at, recurrence_of)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'OPEN', $11, $11, $12)`,
      [id, organizationId, f.ruleId, f.ruleVersion, f.conditionKey, f.findingType, f.severity, f.title, f.explanation,
        JSON.stringify(f.sources), asOf, prior ? prior.id : null]);
    await recordEvent(client, organizationId, id, null, 'OPEN', actorUserId, prior ? `Recurrence of ${prior.id}` : 'Detected by evaluation');
    created.push(id);
  }

  const { rows: after } = await client.query(
    `SELECT * FROM intelligence_findings WHERE organization_id = $1 AND state <> 'RESOLVED' ORDER BY condition_key, id`, [organizationId]);
  return { asOf: asOf.toISOString(), findings: after.map(toFinding), created, resolved };
}

module.exports = { compute, evaluate, parseAsOf, toFinding, recordEvent, registry, sourceKey };
