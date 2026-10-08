// ══════════════════════════════════════════════════════════════
// DEVOS-DI-1 ACCEPTANCE — Development Intelligence Foundation
//
// Executable form of docs/DEVOS-DI1-ACCEPTANCE-CONTRACT.md.
// Fixtures:
//   fixtures/di1-expected-findings.json   behavioral oracle (tenants alpha, beta)
//   fixtures/di1-authorization-matrix.json endpoint × permission contract
//   fixtures/di1-rule-inventory.json       legacy six-rule inventory
//   fixtures/di1-red-baseline.json         expected RED/GREEN state per test
//
// Rules of construction:
//   - Every negative assertion has a positive precondition, so a test cannot
//     pass merely because an endpoint or table does not exist.
//   - Database-integrity probes require the exact SQLSTATE and run a
//     same-tenant control insert in the same transaction.
//   - Mutating behavioral tests run in the workbench tenant (dix-gamma); the
//     oracle tenants (dix-alpha, dix-beta) are never mutated before their
//     oracle checks run.
// ══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const { startTestServer, apiRequest, loginAs } = require('./helpers');
const { query, getPool } = require('../db/pool');

const ORACLE = require('./fixtures/di1-expected-findings.json');
const MATRIX = require('./fixtures/di1-authorization-matrix.json');
const INVENTORY = require('./fixtures/di1-rule-inventory.json');
const REGISTRY_PATH = path.join(__dirname, '..', 'intelligence', 'rule-registry.json');

const DI_TABLES = ['di_relationships', 'di_properties', 'di_opportunities', 'di_opportunity_status_history',
  'di_site_facts', 'intelligence_findings', 'intelligence_finding_events'];
const HISTORY_TABLES = ['di_opportunity_status_history', 'di_site_facts', 'intelligence_findings', 'intelligence_finding_events'];
const DECISION_WORDS = ['GO', 'NO-GO', 'NO_GO', 'HOLD', 'WATCH', 'CONDITIONAL_GO', 'CONDITIONAL GO'];
const READINESS_KEYS = ['opportunity.property', 'opportunity.concept', 'site.apn', 'site.ownership',
  'site.lot_area_sqft', 'site.zoning', 'site.current_use', 'site.acquisition_basis'];
const REQUIRED_RULES = {
  'EXEC-TASK-NO-CONTRACT': { legacy: 'R1', findingType: 'missing-contract' },
  'EXEC-CONTRACT-MISSING': { legacy: 'R2', findingType: 'missing-contract' },
  'EXEC-BLOCKED-TASKS': { legacy: 'R3', findingType: 'blocked-tasks' },
  'EXEC-PERMIT-CORRECTIONS': { legacy: 'R4', findingType: 'permit-corrections' },
  'EXEC-CAPITAL-DEADLINE': { legacy: 'R5', findingType: 'capital-deadline' },
  'EXEC-GC-CONTRACT-PENDING': { legacy: 'R6', findingType: 'gc-contract' },
  'DI-OPPORTUNITY-INFORMATION-REQUIRED': { legacy: null, findingType: 'information-required' },
};
// EF-3 was accepted and frozen at ca69d64; these are its file digests.
const EF3_FROZEN = {
  'db/migrations/004_audit_ledger.sql': 'add7854d05f997c6620bf413a3f0041bae7e54f4f55d8c3b1d7d45d12495c7a0',
  'db/migrations/005_audit_ledger_v2.sql': 'd3d0745c87c65afbb293728f5879ee40583a8c2d280a8c2a68a034494bcda489',
  'db/audit-signing.js': '368f7398e1cc43d26b07a66d2d824f3d531994ef540842166be817e785b84d4c',
  'db/repositories/audit.repo.js': '31fa20baa2b0fdabad541e38230ee63dfaccaf144af80b7afe06e309b21a9320',
  'routes/audit.js': 'e9067af076008db6cc7778049d048ddb2cc9743df1ce681e115b04a45b78865a',
  'db/audit-context.js': 'c65cc06b0e41a59ea97c019ff3be11014d6f62db47ac821bf28678388fd53b2f',
};
const WORKBENCH = {
  organizationId: 'dix-gamma',
  users: [
    { id: 'dix-u-gamma-admin', email: 'gamma.admin@di1.test', roleId: 'org-admin' },
    { id: 'dix-u-gamma-dev', email: 'gamma.dev@di1.test', roleId: 'developer' },
    { id: 'dix-u-gamma-viewer', email: 'gamma.viewer@di1.test', roleId: 'viewer' },
  ],
  project: { id: 'dix-g-p1', name: 'Gamma Workbench Project' },
};

// ── infrastructure ───────────────────────────────────────────────────────────

async function withOwner(fn) {
  const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

async function withRuntime(fn) {
  const client = await (await getPool()).connect();
  try { return await fn(client); } finally { client.release(); }
}

async function tableExists(name) {
  const { rows: [r] } = await query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${name}`]);
  return r.ok;
}

// Runs statements in a rolled-back transaction; returns the SQLSTATE of the
// first failing statement, the index that failed, and whether controls passed.
async function probe(client, statements) {
  await client.query('BEGIN');
  try {
    for (let i = 0; i < statements.length; i++) {
      const [sql, params] = statements[i];
      await client.query('SAVEPOINT s');
      try {
        await client.query(sql, params);
        await client.query('RELEASE SAVEPOINT s');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT s');
        return { failedAt: i, code: err.code, message: err.message };
      }
    }
    return { failedAt: -1 };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }
}

function sourceKey(sources) {
  return (sources || []).map(s => (Array.isArray(s) ? `${s[0]}:${s[1]}` : `${s.type}:${s.id}`)).sort().join(',');
}
function findingKey(f) { return `${f.ruleId}|${sourceKey(f.sources)}`; }

function compareToOracle(findings, evaluation) {
  const actual = new Map((findings || []).map(f => [findingKey(f), f]));
  const missing = [];
  const wrong = [];
  for (const e of evaluation.expected) {
    const f = actual.get(findingKey(e));
    if (!f) { missing.push(findingKey(e)); continue; }
    if (f.severity !== e.severity || f.findingType !== e.findingType) wrong.push({ key: findingKey(e), expected: [e.severity, e.findingType], actual: [f.severity, f.findingType] });
  }
  const expectedKeys = new Set(evaluation.expected.map(findingKey));
  const unexpected = [...actual.keys()].filter(k => !expectedKeys.has(k));
  const forbiddenHit = (evaluation.forbidden || []).map(findingKey).filter(k => actual.has(k));
  const leaked = JSON.stringify(findings || []).includes(evaluation.forbiddenSourcePrefix);
  return { ok: !missing.length && !wrong.length && !unexpected.length && !forbiddenHit.length && !leaked, missing, wrong, unexpected, forbiddenHit, leaked };
}

function oracle(id) { return ORACLE.evaluations.find(e => e.id === id); }

// ── fixture loading (owner role; bypasses the API by design) ────────────────

async function loadFixture() {
  const r = ORACLE.records;
  const status = { legacy: false, di: false, diError: null };
  await withOwner(async c => {
    const { rows: [admin] } = await c.query(`SELECT password_hash FROM users WHERE email = 'admin@developeros.com'`);
    await c.query('BEGIN');
    for (const t of [...ORACLE.tenants, { id: WORKBENCH.organizationId, name: 'DI Workbench Gamma' }]) {
      await c.query(`INSERT INTO organizations (id, name, type, plan) VALUES ($1, $2, 'developer', 'enterprise')`, [t.id, t.name]);
    }
    const users = [...ORACLE.users, ...WORKBENCH.users.map(u => ({ ...u, organizationId: WORKBENCH.organizationId }))];
    for (const u of users) {
      await c.query(`INSERT INTO users (id, org_id, name, email, password_hash, role, active) VALUES ($1, $2, $3, $4, $5, 'developer', TRUE)`,
        [u.id, u.organizationId, u.email, u.email, admin.password_hash]);
      await c.query(`INSERT INTO memberships (id, user_id, organization_id, role_id, status) VALUES ($1, $2, $3, $4, 'ACTIVE')`,
        [`m-${u.id}`, u.id, u.organizationId, u.roleId]);
    }
    for (const p of r.partners) await c.query(`INSERT INTO partners (id, org_id, name, role, initials) VALUES ($1,$2,$3,$4,$5)`, [p.id, p.orgId, p.name, p.role, p.initials]);
    for (const p of [...r.projects, { ...WORKBENCH.project, organizationId: WORKBENCH.organizationId, phase: 1 }]) {
      await c.query(`INSERT INTO projects (id, organization_id, name, phase) VALUES ($1,$2,$3,$4)`, [p.id, p.organizationId, p.name, p.phase]);
    }
    for (const k of r.contracts) await c.query(`INSERT INTO contracts (id, project_id, partner_id, type, status, linked_task_count) VALUES ($1,$2,$3,$4,$5,$6)`, [k.id, k.projectId, k.partnerId, k.type, k.status, k.linkedTaskCount]);
    for (const t of r.tasks) await c.query(`INSERT INTO tasks (id, project_id, title, partner_id, contract_id, status) VALUES ($1,$2,$3,$4,$5,$6)`, [t.id, t.projectId, t.title, t.partnerId, t.contractId, t.status]);
    for (const p of r.permits) await c.query(`INSERT INTO permits (id, project_id, name, status) VALUES ($1,$2,$3,$4)`, [p.id, p.projectId, p.name, p.status]);
    for (const x of r.permitCorrections) await c.query(`INSERT INTO permit_corrections (id, permit_id, text, status) VALUES ($1,$2,$3,$4)`, [x.id, x.permitId, x.text, x.status]);
    for (const s of r.capitalStacks) await c.query(`INSERT INTO capital_stacks (id, project_id, total_cost) VALUES ($1,$2,$3)`, [s.id, s.projectId, s.totalCost]);
    for (const s of r.capitalSources) await c.query(`INSERT INTO capital_sources (id, capital_stack_id, name, type, amount, status, deadline) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [s.id, s.stackId, s.name, s.type, s.amount, s.status, s.deadline]);
    await c.query('COMMIT');
    status.legacy = true;

    // DI records use the contract's column names; absent before implementation.
    try {
      await c.query('BEGIN');
      for (const x of r.diRelationships) {
        await c.query(`INSERT INTO di_relationships (id, organization_id, name, relationship_type, status, source_type, source_reference, recorded_by, created_at, updated_at)
          VALUES ($1,$2,$3,$4,'ACTIVE','USER_ENTRY','di1 fixture','dix-fixture',now(),now())`, [x.id, x.organizationId, x.name, x.relationshipType]);
      }
      for (const x of r.diProperties) {
        await c.query(`INSERT INTO di_properties (id, organization_id, name, city, source_type, source_reference, recorded_by, created_at, updated_at)
          VALUES ($1,$2,$3,$4,'USER_ENTRY','di1 fixture','dix-fixture',now(),now())`, [x.id, x.organizationId, x.name, x.city]);
      }
      for (const x of r.diSiteFacts) {
        const prop = r.diProperties.find(p => p.id === x.propertyId);
        await c.query(`INSERT INTO di_site_facts (id, organization_id, property_id, fact_key, value, value_status, version, source_type, source_reference, recorded_by, recorded_at)
          VALUES ($1,$2,$3,$4,$5::jsonb,$6,1,'USER_ENTRY','di1 fixture','dix-fixture',now())`,
          [`${x.propertyId}-${x.key}`, prop.organizationId, x.propertyId, x.key, x.value === null ? null : JSON.stringify(x.value), x.status]);
      }
      for (const x of r.diOpportunities) {
        await c.query(`INSERT INTO di_opportunities (id, organization_id, property_id, relationship_id, name, status, concept_description, source_type, source_reference, recorded_by, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'USER_ENTRY','di1 fixture','dix-fixture',now(),now())`,
          [x.id, x.organizationId, x.propertyId, x.relationshipId, x.name, x.status, x.concept]);
      }
      await c.query('COMMIT');
      status.di = true;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      status.diError = `${err.code || ''} ${err.message}`;
    }
  });
  return status;
}

// ── suite ───────────────────────────────────────────────────────────────────

async function runDI1AcceptanceSuite() {
  console.log('\n===============================================================');
  console.log('RUNNING SUITE: DEVOS-DI-1 ACCEPTANCE (RED GATE)');
  console.log('===============================================================\n');
  await startTestServer(3005, true);
  const fixture = await loadFixture();
  console.log(`  [DI1] fixture: legacy=${fixture.legacy} di=${fixture.di}${fixture.diError ? ` (${fixture.diError})` : ''}`);

  const results = [];
  async function t(id, cls, title, fn) {
    let passed = false;
    let detail = '';
    try {
      const out = await fn();
      passed = out === true || (out && out.pass === true);
      detail = out && out.detail !== undefined ? (typeof out.detail === 'string' ? out.detail : JSON.stringify(out.detail)) : '';
    } catch (err) {
      detail = `error: ${err.message}`;
    }
    results.push({ id, cls, title, passed, detail: detail.slice(0, 600) });
    console.log(`  ${passed ? '[GREEN]' : '[RED]  '} ${id} — ${title}${passed ? '' : ` :: ${detail.slice(0, 300)}`}`);
  }

  const S = {};
  for (const u of ORACLE.users) S[u.id] = await loginAs(u.email);
  for (const u of WORKBENCH.users) S[u.id] = await loginAs(u.email);
  S.org1Admin = await loginAs('admin@developeros.com');
  const H = id => ({ Authorization: `Bearer ${S[id].token}` });
  const api = (who, method, p, body, extra = {}) => apiRequest(method, p, { headers: { ...H(who), ...extra }, body });
  const aDev = 'dix-u-alpha-dev'; const aAdmin = 'dix-u-alpha-admin'; const aViewer = 'dix-u-alpha-viewer';
  const bAdmin = 'dix-u-beta-admin'; const bDev = 'dix-u-beta-dev';
  const gAdmin = 'dix-u-gamma-admin'; const gDev = 'dix-u-gamma-dev'; const gViewer = 'dix-u-gamma-viewer';
  const G = WORKBENCH.organizationId;
  const prov = (sourceType = 'USER_ENTRY', sourceReference = 'di1 test') => ({ sourceType, sourceReference });

  // ════════════════ A. STRUCTURAL ════════════════
  console.log('\n  --- A. Structural ---');

  await t('DEVOS-DI1-SCHEMA-001', 'A', 'All seven DI-1 tables exist (migration-driven)', async () => {
    const missing = [];
    for (const tb of DI_TABLES) if (!(await tableExists(tb))) missing.push(tb);
    const { rows } = await query(`SELECT version FROM schema_migrations WHERE version >= '006' ORDER BY version`);
    return { pass: !missing.length && rows.length > 0, detail: { missing, migrationsAfter005: rows.map(r => r.version) } };
  });

  await t('DEVOS-DI1-SCHEMA-002', 'A', 'Every DI table has organization_id NOT NULL with a foreign key to organizations', async () => {
    const bad = [];
    for (const tb of DI_TABLES) {
      const { rows: [c] } = await query(`SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = 'organization_id'`, [tb]);
      const { rows: [fk] } = await query(`
        SELECT 1 AS ok FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
        WHERE k.contype = 'f' AND k.conrelid = to_regclass($1) AND k.confrelid = 'public.organizations'::regclass AND a.attname = 'organization_id'`, [`public.${tb}`]);
      if (!c || c.is_nullable !== 'NO' || !fk) bad.push({ table: tb, column: c ? c.is_nullable : 'absent', fk: !!fk });
    }
    return { pass: !bad.length, detail: bad };
  });

  const relIntegrity = (id, title, build) => t(id, 'A', title, () => withOwner(async c => {
    if (!(await tableExists('di_opportunities'))) return { pass: false, detail: 'DI tables absent' };
    const { control, attack } = build();
    const out = await probe(c, [...control, attack]);
    const controlOk = out.failedAt === -1 || out.failedAt === control.length;
    return { pass: controlOk && out.failedAt === control.length && out.code === '23503', detail: out };
  }));

  const gOpp = (idSuffix, propertyId, relationshipId) => [`INSERT INTO di_opportunities (id, organization_id, property_id, relationship_id, name, status, concept_description, source_type, source_reference, recorded_by, created_at, updated_at)
    VALUES ($1,'dix-gamma',$2,$3,'probe','NEW','probe','USER_ENTRY','probe','probe',now(),now())`, [`dix-g-probe-${idSuffix}`, propertyId, relationshipId]];
  const gProp = id => [`INSERT INTO di_properties (id, organization_id, name, source_type, source_reference, recorded_by, created_at, updated_at) VALUES ($1,'dix-gamma','probe','USER_ENTRY','probe','probe',now(),now())`, [id]];
  const gRel = id => [`INSERT INTO di_relationships (id, organization_id, name, relationship_type, status, source_type, source_reference, recorded_by, created_at, updated_at) VALUES ($1,'dix-gamma','probe','broker','ACTIVE','USER_ENTRY','probe','probe',now(),now())`, [id]];

  await relIntegrity('DEVOS-DI1-SCHEMA-003', 'Database rejects an opportunity referencing another organization\'s property (control: same-tenant property accepted)',
    () => ({ control: [gProp('dix-g-probe-prop'), gOpp('ok', 'dix-g-probe-prop', null)], attack: gOpp('x', 'dix-b-prop1', null) }));
  await relIntegrity('DEVOS-DI1-SCHEMA-004', 'Database rejects an opportunity referencing another organization\'s relationship',
    () => ({ control: [gRel('dix-g-probe-rel'), gOpp('ok', null, 'dix-g-probe-rel')], attack: gOpp('x', null, 'dix-b-rel1') }));
  await relIntegrity('DEVOS-DI1-SCHEMA-005', 'Database rejects a site fact attached to another organization\'s property',
    () => {
      const fact = (id, prop) => [`INSERT INTO di_site_facts (id, organization_id, property_id, fact_key, value, value_status, version, source_type, source_reference, recorded_by, recorded_at)
        VALUES ($1,'dix-gamma',$2,'zoning','"R1"'::jsonb,'KNOWN',1,'USER_ENTRY','probe','probe',now())`, [id, prop]];
      return { control: [gProp('dix-g-probe-prop'), fact('dix-g-probe-f1', 'dix-g-probe-prop')], attack: fact('dix-g-probe-f2', 'dix-b-prop1') };
    });
  await relIntegrity('DEVOS-DI1-SCHEMA-006', 'Database rejects status history pointing at another organization\'s opportunity',
    () => {
      const hist = (id, opp) => [`INSERT INTO di_opportunity_status_history (id, organization_id, opportunity_id, from_status, to_status, reason, changed_by, changed_at)
        VALUES ($1,'dix-gamma',$2,NULL,'NEW','probe','probe',now())`, [id, opp]];
      return { control: [gOpp('h', null, null), hist('dix-g-probe-h1', 'dix-g-probe-h')], attack: hist('dix-g-probe-h2', 'dix-b-opp1') };
    });

  const findingRow = (id, org, ruleId, key, state) => [`INSERT INTO intelligence_findings (id, organization_id, rule_id, rule_version, condition_key, finding_type, severity, title, explanation, sources, state, as_of, first_detected_at)
    VALUES ($1,$2,$3,1,$4,'probe','info','probe','probe','[]'::jsonb,$5,now(),now())`, [id, org, ruleId, key, state]];

  await t('DEVOS-DI1-SCHEMA-007', 'A', 'Database restricts opportunity status to the DI-1 lifecycle (GO/NO-GO rejected; NEW accepted)', () => withOwner(async c => {
    if (!(await tableExists('di_opportunities'))) return { pass: false, detail: 'DI tables absent' };
    const outcomes = {};
    for (const s of ['NEW', 'GO', 'NO-GO', 'HOLD']) {
      const out = await probe(c, [[`INSERT INTO di_opportunities (id, organization_id, name, status, concept_description, source_type, source_reference, recorded_by, created_at, updated_at)
        VALUES ('dix-g-probe-s','dix-gamma','probe',$1,'probe','USER_ENTRY','probe','probe',now(),now())`, [s]]]);
      outcomes[s] = out.failedAt === -1 ? 'accepted' : out.code;
    }
    return { pass: outcomes.NEW === 'accepted' && ['GO', 'NO-GO', 'HOLD'].every(s => outcomes[s] === '23514'), detail: outcomes };
  }));

  await t('DEVOS-DI1-SCHEMA-008', 'A', 'Database allows at most one active finding per (organization, rule, condition); a RESOLVED predecessor does not block', () => withOwner(async c => {
    if (!(await tableExists('intelligence_findings'))) return { pass: false, detail: 'DI tables absent' };
    const k = 'EXEC-TASK-NO-CONTRACT|task:probe';
    const control = await probe(c, [findingRow('dix-g-f-old', 'dix-gamma', 'EXEC-TASK-NO-CONTRACT', k, 'RESOLVED'), findingRow('dix-g-f-new', 'dix-gamma', 'EXEC-TASK-NO-CONTRACT', k, 'OPEN')]);
    const dup = await probe(c, [findingRow('dix-g-f-1', 'dix-gamma', 'EXEC-TASK-NO-CONTRACT', k, 'OPEN'), findingRow('dix-g-f-2', 'dix-gamma', 'EXEC-TASK-NO-CONTRACT', k, 'ACKNOWLEDGED')]);
    return { pass: control.failedAt === -1 && dup.failedAt === 1 && dup.code === '23505', detail: { control, dup } };
  }));

  await t('DEVOS-DI1-SCHEMA-009', 'A', 'Database rejects a finding event pointing at another organization\'s finding', () => withOwner(async c => {
    if (!(await tableExists('intelligence_finding_events'))) return { pass: false, detail: 'DI tables absent' };
    const ev = (id, org, finding) => [`INSERT INTO intelligence_finding_events (id, organization_id, finding_id, from_state, to_state, actor_user_id, note, occurred_at)
      VALUES ($1,$2,$3,NULL,'OPEN',NULL,'probe',now())`, [id, org, finding]];
    const out = await probe(c, [findingRow('dix-g-fe', 'dix-gamma', 'R', 'k1', 'OPEN'), findingRow('dix-b-fe', 'dix-beta', 'R', 'k1', 'OPEN'),
      ev('dix-g-ev1', 'dix-gamma', 'dix-g-fe'), ev('dix-g-ev2', 'dix-gamma', 'dix-b-fe')]);
    return { pass: out.failedAt === 3 && out.code === '23503', detail: out };
  }));

  await t('DEVOS-DI1-SCHEMA-010', 'A', 'Every DI table has an index led by organization_id and carries the EF-3 capture trigger', async () => {
    const bad = [];
    for (const tb of DI_TABLES) {
      if (!(await tableExists(tb))) { bad.push({ table: tb, absent: true }); continue; }
      const { rows: [ix] } = await query(`
        SELECT count(*)::int AS n FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
        WHERE i.indrelid = to_regclass($1) AND a.attname = 'organization_id'`, [`public.${tb}`]);
      const { rows: [tg] } = await query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = to_regclass($1) AND tgname = 'devos_audit_capture' AND NOT tgisinternal`, [`public.${tb}`]);
      if (!ix.n || !tg.n) bad.push({ table: tb, orgIndex: ix.n, auditTrigger: tg.n });
    }
    return { pass: !bad.length, detail: bad };
  });

  await t('DEVOS-DI1-SCHEMA-011', 'A', 'History is durable: the runtime role cannot DELETE status history, site facts, findings or finding events', async () => {
    if (!(await tableExists('intelligence_finding_events'))) return { pass: false, detail: 'DI tables absent' };
    // Seed one committed row per table in the workbench tenant (owner), then attack as runtime.
    await withOwner(async c => {
      await c.query('BEGIN');
      await c.query(gOpp('durable', null, null)[0], gOpp('durable', null, null)[1]);
      await c.query(`INSERT INTO di_opportunity_status_history (id, organization_id, opportunity_id, from_status, to_status, reason, changed_by, changed_at) VALUES ('dix-g-durable-h','dix-gamma','dix-g-probe-durable',NULL,'NEW','seed','seed',now())`);
      await c.query(gProp('dix-g-durable-prop')[0], gProp('dix-g-durable-prop')[1]);
      await c.query(`INSERT INTO di_site_facts (id, organization_id, property_id, fact_key, value, value_status, version, source_type, source_reference, recorded_by, recorded_at) VALUES ('dix-g-durable-f','dix-gamma','dix-g-durable-prop','zoning',NULL,'UNKNOWN',1,'USER_ENTRY','seed','seed',now())`);
      await c.query(findingRow('dix-g-durable-fd', 'dix-gamma', 'DURABILITY-PROBE', 'durable', 'RESOLVED')[0], findingRow('dix-g-durable-fd', 'dix-gamma', 'DURABILITY-PROBE', 'durable', 'RESOLVED')[1]);
      await c.query(`INSERT INTO intelligence_finding_events (id, organization_id, finding_id, from_state, to_state, actor_user_id, note, occurred_at) VALUES ('dix-g-durable-ev','dix-gamma','dix-g-durable-fd',NULL,'OPEN',NULL,'seed',now())`);
      await c.query('COMMIT');
    });
    const ids = { di_opportunity_status_history: 'dix-g-durable-h', di_site_facts: 'dix-g-durable-f', intelligence_findings: 'dix-g-durable-fd', intelligence_finding_events: 'dix-g-durable-ev' };
    const out = {};
    for (const tb of HISTORY_TABLES) {
      out[tb] = await withRuntime(async c => {
        await c.query('BEGIN');
        try {
          const r = await c.query(`DELETE FROM ${tb} WHERE id = $1`, [ids[tb]]);
          return r.rowCount === 0 ? 'no row deleted' : 'DELETED';
        } catch (err) { return `rejected: ${err.message}`; } finally { await c.query('ROLLBACK').catch(() => {}); }
      });
    }
    return { pass: Object.values(out).every(v => v.startsWith('rejected')), detail: out };
  });

  await t('DEVOS-DI1-SCHEMA-012', 'A', 'All sixteen DI permissions exist in the EF-2 permission catalog', async () => {
    const wanted = MATRIX.rolePermissions['org-admin'];
    const { rows } = await query('SELECT id FROM permissions WHERE id = ANY($1)', [wanted]);
    const have = new Set(rows.map(r => r.id));
    return { pass: wanted.every(p => have.has(p)), detail: { missing: wanted.filter(p => !have.has(p)) } };
  });

  await t('DEVOS-DI1-REGISTRY-001', 'A', 'Machine-readable rule registry exists with a complete, well-typed entry per rule', async () => {
    if (!fs.existsSync(REGISTRY_PATH)) return { pass: false, detail: `missing ${path.relative(process.cwd(), REGISTRY_PATH)}` };
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    const bad = (reg.rules || []).filter(r => !r.ruleId || !Number.isInteger(r.version) || r.version < 1 || !r.title ||
      !['ACTIVE', 'DEPRECATED'].includes(r.status) || !Array.isArray(r.inputDomains) || !r.inputDomains.length ||
      !r.severityPolicy || typeof r.timeDependent !== 'boolean' || !Array.isArray(r.sourceTypes) || !r.findingType).map(r => r.ruleId || '?');
    const ids = (reg.rules || []).map(r => r.ruleId);
    return { pass: Number.isInteger(reg.registryVersion) && ids.length > 0 && !bad.length && new Set(ids).size === ids.length, detail: { bad, count: ids.length } };
  });

  await t('DEVOS-DI1-REGISTRY-002', 'A', 'Registry inventories all six legacy rules plus the DI information rule, and GET /api/di/rules serves the same registry', async () => {
    if (!fs.existsSync(REGISTRY_PATH)) return { pass: false, detail: 'registry file missing' };
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    const byId = new Map(reg.rules.map(r => [r.ruleId, r]));
    const problems = [];
    for (const [ruleId, want] of Object.entries(REQUIRED_RULES)) {
      const r = byId.get(ruleId);
      if (!r) { problems.push(`${ruleId} missing`); continue; }
      if (r.status !== 'ACTIVE') problems.push(`${ruleId} not ACTIVE`);
      if ((r.legacyAlertRule || null) !== want.legacy) problems.push(`${ruleId} legacyAlertRule ${r.legacyAlertRule}`);
      if (r.findingType !== want.findingType) problems.push(`${ruleId} findingType ${r.findingType}`);
    }
    for (const inv of INVENTORY.rules) if (!reg.rules.some(r => r.legacyAlertRule === inv.legacyRule)) problems.push(`legacy ${inv.legacyRule} disappeared`);
    const capital = byId.get('EXEC-CAPITAL-DEADLINE');
    if (capital && capital.timeDependent !== true) problems.push('EXEC-CAPITAL-DEADLINE must declare timeDependent');
    const res = await api(aDev, 'GET', '/api/di/rules');
    const served = Array.isArray(res.body) ? res.body : res.body?.rules;
    const same = Array.isArray(served) && JSON.stringify(served.map(r => `${r.ruleId}@${r.version}`).sort()) === JSON.stringify(reg.rules.map(r => `${r.ruleId}@${r.version}`).sort());
    if (res.status !== 200 || !same) problems.push(`GET /api/di/rules → ${res.status}${res.status === 200 ? ' (differs from file)' : ''}`);
    return { pass: !problems.length, detail: problems };
  });

  // ════════════════ B. BEHAVIORAL (workbench tenant dix-gamma) ════════════════
  console.log('\n  --- B. Behavioral ---');
  const W = {};

  await t('DEVOS-DI1-REL-001', 'B', 'Create relationship: free-text type, provenance recorded with server-assigned recorder and time', async () => {
    const res = await api(gDev, 'POST', '/api/di/relationships', { name: 'St. Mark Church', relationshipType: 'faith-based landowner', provenance: prov() });
    W.rel = res.body;
    const b = res.body || {};
    return { pass: res.status === 201 && !!b.id && b.organizationId === G && b.relationshipType === 'faith-based landowner' &&
      b.provenance?.sourceType === 'USER_ENTRY' && b.provenance?.recordedBy === 'dix-u-gamma-dev' && !!b.provenance?.recordedAt, detail: { status: res.status, body: b } };
  });

  await t('DEVOS-DI1-REL-002', 'B', 'Update relationship; list and direct read return the persisted change', async () => {
    if (!W.rel?.id) return { pass: false, detail: 'precondition: relationship create failed' };
    const upd = await api(gDev, 'PATCH', `/api/di/relationships/${W.rel.id}`, { name: 'St. Mark Church Trust', status: 'INACTIVE' });
    const get = await api(gDev, 'GET', `/api/di/relationships/${W.rel.id}`);
    const list = await api(gDev, 'GET', '/api/di/relationships');
    return { pass: upd.status === 200 && get.body?.name === 'St. Mark Church Trust' && get.body?.status === 'INACTIVE' &&
      Array.isArray(list.body) && list.body.some(r => r.id === W.rel.id), detail: { upd: upd.status, get: get.body } };
  });

  await t('DEVOS-DI1-PROP-001', 'B', 'Create property with address and provenance; it does not create a Project', async () => {
    const before = (await query('SELECT count(*)::int AS n FROM projects')).rows[0].n;
    const res = await api(gDev, 'POST', '/api/di/properties', { name: 'Church Parking Lot', address: { street: '100 Main St', city: 'Fresno', region: 'CA', postalCode: '93721', country: 'US' }, provenance: prov('PUBLIC_RECORD', 'County assessor') });
    const after = (await query('SELECT count(*)::int AS n FROM projects')).rows[0].n;
    W.prop = res.body;
    return { pass: res.status === 201 && res.body?.organizationId === G && res.body?.address?.city === 'Fresno' && res.body?.provenance?.sourceType === 'PUBLIC_RECORD' && before === after,
      detail: { status: res.status, projectsBefore: before, projectsAfter: after } };
  });

  await t('DEVOS-DI1-PROP-002', 'B', 'Update property; direct read returns the change', async () => {
    if (!W.prop?.id) return { pass: false, detail: 'precondition: property create failed' };
    const upd = await api(gDev, 'PATCH', `/api/di/properties/${W.prop.id}`, { name: 'Church North Lot', apn: '461-020-11' });
    const get = await api(gDev, 'GET', `/api/di/properties/${W.prop.id}`);
    return { pass: upd.status === 200 && get.body?.name === 'Church North Lot' && get.body?.apn === '461-020-11', detail: get.body };
  });

  await t('DEVOS-DI1-OPP-001', 'B', 'Create opportunity: always starts NEW, links property/relationship/responsible member, server-owned fields cannot be supplied', async () => {
    if (!W.prop?.id || !W.rel?.id) return { pass: false, detail: 'precondition: property/relationship missing' };
    const res = await api(gDev, 'POST', '/api/di/opportunities', {
      name: 'Church Lot Senior Housing', propertyId: W.prop.id, relationshipId: W.rel.id, responsibleUserId: 'dix-u-gamma-admin',
      concept: { description: 'Senior affordable housing on surplus parking' }, provenance: prov(),
      id: 'client-chosen-id', organizationId: 'dix-beta', status: 'READY_FOR_QUALIFICATION', createdAt: '2000-01-01T00:00:00Z', decision: 'GO' });
    W.opp = res.body;
    const b = res.body || {};
    return { pass: res.status === 201 && b.status === 'NEW' && b.id !== 'client-chosen-id' && b.organizationId === G &&
      b.propertyId === W.prop.id && b.relationshipId === W.rel.id && b.responsibleUserId === 'dix-u-gamma-admin' &&
      !String(b.createdAt || '').startsWith('2000') && !('decision' in b), detail: { status: res.status, body: b } };
  });

  await t('DEVOS-DI1-OPP-002', 'B', 'Valid lifecycle path NEW → SCREENING → INFORMATION_REQUIRED → SCREENING is recorded in history with actor and reason', async () => {
    if (!W.opp?.id) return { pass: false, detail: 'precondition: opportunity create failed' };
    const steps = [];
    for (const to of ['SCREENING', 'INFORMATION_REQUIRED', 'SCREENING']) {
      const r = await api(gDev, 'POST', `/api/di/opportunities/${W.opp.id}/transition`, { to, reason: `move to ${to}` });
      steps.push([to, r.status, r.body?.status]);
    }
    const hist = await api(gDev, 'GET', `/api/di/opportunities/${W.opp.id}/history`);
    const h = Array.isArray(hist.body) ? hist.body : [];
    const seq = h.map(x => x.toStatus);
    return { pass: steps.every(([to, s, st]) => s === 200 && st === to) && JSON.stringify(seq.slice(-3)) === JSON.stringify(['SCREENING', 'INFORMATION_REQUIRED', 'SCREENING']) &&
      h.slice(-3).every(x => x.changedBy === 'dix-u-gamma-dev' && x.reason), detail: { steps, history: h } };
  });

  await t('DEVOS-DI1-OPP-003', 'B', 'Disallowed transitions return 409 and leave status unchanged (NEW → READY_FOR_QUALIFICATION; READY with missing information)', async () => {
    const fresh = await api(gDev, 'POST', '/api/di/opportunities', { name: 'Transition probe', concept: { description: 'probe' }, provenance: prov() });
    if (fresh.status !== 201) return { pass: false, detail: `precondition: create → ${fresh.status}` };
    const direct = await api(gDev, 'POST', `/api/di/opportunities/${fresh.body.id}/transition`, { to: 'READY_FOR_QUALIFICATION', reason: 'skip' });
    await api(gDev, 'POST', `/api/di/opportunities/${fresh.body.id}/transition`, { to: 'SCREENING', reason: 'start' });
    const incomplete = await api(gDev, 'POST', `/api/di/opportunities/${fresh.body.id}/transition`, { to: 'READY_FOR_QUALIFICATION', reason: 'premature' });
    const now = await api(gDev, 'GET', `/api/di/opportunities/${fresh.body.id}`);
    return { pass: direct.status === 409 && incomplete.status === 409 && Array.isArray(incomplete.body?.missing) && incomplete.body.missing.length > 0 && now.body?.status === 'SCREENING',
      detail: { direct: direct.status, incomplete: [incomplete.status, incomplete.body], now: now.body?.status } };
  });

  await t('DEVOS-DI1-OPP-004', 'B', 'Decision vocabulary (GO, NO-GO, HOLD, WATCH, CONDITIONAL GO) is rejected with 400 as a lifecycle target', async () => {
    if (!W.opp?.id) return { pass: false, detail: 'precondition: opportunity create failed' };
    const statuses = {};
    for (const w of DECISION_WORDS) statuses[w] = (await api(gDev, 'POST', `/api/di/opportunities/${W.opp.id}/transition`, { to: w, reason: 'decision attempt' })).status;
    const now = await api(gDev, 'GET', `/api/di/opportunities/${W.opp.id}`);
    return { pass: Object.values(statuses).every(s => s === 400) && now.status === 200 && now.body?.status === 'SCREENING', detail: { statuses, status: now.body?.status } };
  });

  await t('DEVOS-DI1-OPP-005', 'B', 'Terminal states DECLINED, WITHDRAWN and EXPIRED are reachable and immutable', async () => {
    const out = {};
    for (const [term, via] of [['DECLINED', []], ['WITHDRAWN', []], ['EXPIRED', ['SCREENING']]]) {
      const o = await api(gDev, 'POST', '/api/di/opportunities', { name: `Terminal ${term}`, concept: { description: 'x' }, provenance: prov() });
      if (o.status !== 201) { out[term] = `create ${o.status}`; continue; }
      for (const v of via) await api(gDev, 'POST', `/api/di/opportunities/${o.body.id}/transition`, { to: v, reason: 'setup' });
      const end = await api(gDev, 'POST', `/api/di/opportunities/${o.body.id}/transition`, { to: term, reason: 'close' });
      const reopen = await api(gDev, 'POST', `/api/di/opportunities/${o.body.id}/transition`, { to: 'SCREENING', reason: 'reopen' });
      const patch = await api(gDev, 'PATCH', `/api/di/opportunities/${o.body.id}`, { status: 'NEW' });
      const now = await api(gDev, 'GET', `/api/di/opportunities/${o.body.id}`);
      out[term] = { end: end.status, reopen: reopen.status, patchStatusIgnored: now.body?.status === term, final: now.body?.status, patch: patch.status };
    }
    return { pass: Object.values(out).every(o => typeof o === 'object' && o.end === 200 && o.reopen === 409 && o.patchStatusIgnored), detail: out };
  });

  await t('DEVOS-DI1-SITE-001', 'B', 'Site intelligence persists KNOWN, UNKNOWN and NOT_APPLICABLE distinctly; absent facts stay absent', async () => {
    if (!W.prop?.id) return { pass: false, detail: 'precondition: property create failed' };
    const put = await api(gDev, 'PUT', `/api/di/properties/${W.prop.id}/site-intelligence`, { facts: {
      zoning: { value: 'RS-5', status: 'KNOWN', provenance: prov('PUBLIC_RECORD', 'City zoning map') },
      ownership: { value: null, status: 'UNKNOWN', provenance: prov() },
      demolition: { value: null, status: 'NOT_APPLICABLE', provenance: prov() } } });
    const get = await api(gDev, 'GET', `/api/di/properties/${W.prop.id}/site-intelligence`);
    const f = get.body?.facts || {};
    return { pass: put.status === 200 && f.zoning?.value === 'RS-5' && f.zoning?.status === 'KNOWN' && f.zoning?.provenance?.sourceType === 'PUBLIC_RECORD' &&
      f.ownership?.status === 'UNKNOWN' && f.ownership?.value === null && f.demolition?.status === 'NOT_APPLICABLE' && !('flood_zone' in f),
      detail: { put: put.status, facts: f } };
  });

  await t('DEVOS-DI1-SITE-002', 'B', 'Changing a fact creates a new version; the prior version is preserved in history', async () => {
    if (!W.prop?.id) return { pass: false, detail: 'precondition: property create failed' };
    const put = await api(gDev, 'PUT', `/api/di/properties/${W.prop.id}/site-intelligence`, { facts: { zoning: { value: 'RM-2', status: 'KNOWN', provenance: prov('DOCUMENT', 'Zoning letter 2025-14') } } });
    const get = await api(gDev, 'GET', `/api/di/properties/${W.prop.id}/site-intelligence`);
    const hist = await api(gDev, 'GET', `/api/di/properties/${W.prop.id}/site-intelligence/history`);
    const z = (Array.isArray(hist.body) ? hist.body : []).filter(h => (h.key || h.factKey) === 'zoning');
    return { pass: put.status === 200 && get.body?.facts?.zoning?.value === 'RM-2' && get.body?.facts?.zoning?.version === 2 &&
      z.length === 2 && z.some(v => v.value === 'RS-5' && v.version === 1) && z.some(v => v.value === 'RM-2' && v.version === 2), detail: { current: get.body?.facts?.zoning, history: z } };
  });

  await t('DEVOS-DI1-SITE-003', 'B', 'Invalid facts are rejected: unknown key, KNOWN without value, UNKNOWN with a manufactured value', async () => {
    if (!W.prop?.id) return { pass: false, detail: 'precondition: property create failed' };
    const sends = {
      unknownKey: { facts: { favourite_color: { value: 'blue', status: 'KNOWN', provenance: prov() } } },
      knownNull: { facts: { apn: { value: null, status: 'KNOWN', provenance: prov() } } },
      unknownWithValue: { facts: { apn: { value: '000-000', status: 'UNKNOWN', provenance: prov() } } },
    };
    const statuses = {};
    for (const [k, body] of Object.entries(sends)) statuses[k] = (await api(gDev, 'PUT', `/api/di/properties/${W.prop.id}/site-intelligence`, body)).status;
    const get = await api(gDev, 'GET', `/api/di/properties/${W.prop.id}/site-intelligence`);
    return { pass: get.status === 200 && Object.values(statuses).every(s => s === 400) && !('apn' in (get.body?.facts || {})), detail: { statuses, getStatus: get.status } };
  });

  await t('DEVOS-DI1-PROV-001', 'B', 'Provenance is required and typed; SYSTEM_DERIVED cannot be claimed by a user; recorder cannot be spoofed', async () => {
    const missing = await api(gDev, 'POST', '/api/di/relationships', { name: 'No provenance', relationshipType: 'broker' });
    const badType = await api(gDev, 'POST', '/api/di/relationships', { name: 'Bad type', relationshipType: 'broker', provenance: { sourceType: 'RUMOR' } });
    const system = await api(gDev, 'POST', '/api/di/relationships', { name: 'Spoof system', relationshipType: 'broker', provenance: { sourceType: 'SYSTEM_DERIVED' } });
    const spoof = await api(gDev, 'POST', '/api/di/relationships', { name: 'Spoof recorder', relationshipType: 'broker', provenance: { sourceType: 'USER_ENTRY', recordedBy: 'dix-u-beta-admin', recordedAt: '1999-01-01T00:00:00Z' } });
    const ok = await api(gDev, 'GET', '/api/di/relationships');
    return { pass: ok.status === 200 && missing.status === 400 && badType.status === 400 && system.status === 400 && spoof.status === 201 &&
      spoof.body?.provenance?.recordedBy === 'dix-u-gamma-dev' && !String(spoof.body?.provenance?.recordedAt).startsWith('1999'),
      detail: { missing: missing.status, badType: badType.status, system: system.status, spoof: [spoof.status, spoof.body?.provenance] } };
  });

  await t('DEVOS-DI1-READY-001', 'B', 'Readiness reports INFORMATION_REQUIRED with the exact missing requirement keys', async () => {
    if (!W.opp?.id) return { pass: false, detail: 'precondition: opportunity create failed' };
    const res = await api(gDev, 'GET', `/api/di/opportunities/${W.opp.id}/readiness`);
    const expectedMissing = ['site.acquisition_basis', 'site.apn', 'site.current_use', 'site.lot_area_sqft', 'site.ownership'];
    const missing = (res.body?.missing || []).slice().sort();
    const keys = (res.body?.requirements || []).map(r => r.key).sort();
    return { pass: res.status === 200 && res.body?.status === 'INFORMATION_REQUIRED' && JSON.stringify(missing) === JSON.stringify(expectedMissing) &&
      JSON.stringify(keys) === JSON.stringify(READINESS_KEYS.slice().sort()), detail: res.body };
  });

  await t('DEVOS-DI1-READY-002', 'B', 'UNKNOWN does not satisfy a requirement; NOT_APPLICABLE does; completing information yields READY_FOR_QUALIFICATION and permits the transition', async () => {
    if (!W.opp?.id || !W.prop?.id) return { pass: false, detail: 'precondition missing' };
    const put = await api(gDev, 'PUT', `/api/di/properties/${W.prop.id}/site-intelligence`, { facts: {
      apn: { value: '461-020-11', status: 'KNOWN', provenance: prov('PUBLIC_RECORD', 'Assessor') },
      lot_area_sqft: { value: 43560, status: 'KNOWN', provenance: prov() },
      current_use: { value: 'Church parking', status: 'KNOWN', provenance: prov() },
      acquisition_basis: { value: null, status: 'NOT_APPLICABLE', provenance: prov() } } });
    const stillMissing = await api(gDev, 'GET', `/api/di/opportunities/${W.opp.id}/readiness`);
    await api(gDev, 'PUT', `/api/di/properties/${W.prop.id}/site-intelligence`, { facts: { ownership: { value: 'St. Mark Church', status: 'KNOWN', provenance: prov('DOCUMENT', 'Title report') } } });
    const ready = await api(gDev, 'GET', `/api/di/opportunities/${W.opp.id}/readiness`);
    const tr = await api(gDev, 'POST', `/api/di/opportunities/${W.opp.id}/transition`, { to: 'READY_FOR_QUALIFICATION', reason: 'information complete' });
    return { pass: put.status === 200 && JSON.stringify(stillMissing.body?.missing) === JSON.stringify(['site.ownership']) && stillMissing.body?.status === 'INFORMATION_REQUIRED' &&
      ready.body?.status === 'READY_FOR_QUALIFICATION' && (ready.body?.missing || []).length === 0 && tr.status === 200 && tr.body?.status === 'READY_FOR_QUALIFICATION',
      detail: { stillMissing: stillMissing.body, ready: ready.body, transition: tr.status } };
  });

  await t('DEVOS-DI1-INFORMATION-001', 'SENTINEL', 'Incomplete information produces INFORMATION_REQUIRED — never NO-GO, a decision field, or a terminal state', async () => {
    const o = await api(gDev, 'POST', '/api/di/opportunities', { name: 'Sparse lead', concept: { description: 'Unknown' }, provenance: prov() });
    if (o.status !== 201) return { pass: false, detail: `precondition: create → ${o.status}` };
    await api(gDev, 'POST', `/api/di/opportunities/${o.body.id}/transition`, { to: 'SCREENING', reason: 'review' });
    const ready = await api(gDev, 'GET', `/api/di/opportunities/${o.body.id}/readiness`);
    const ev = await api(gDev, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z', dryRun: true });
    const mine = (ev.body?.findings || []).filter(f => sourceKey(f.sources).includes(o.body.id));
    const now = await api(gDev, 'GET', `/api/di/opportunities/${o.body.id}`);
    const text = JSON.stringify([ready.body, mine, now.body]);
    const decisionLeak = /NO[-_ ]?GO|"decision"|CONDITIONAL/i.test(text);
    return { pass: ready.status === 200 && ready.body?.status === 'INFORMATION_REQUIRED' && ready.body.missing.includes('opportunity.property') &&
      ev.status === 200 && mine.length === 1 && mine[0].ruleId === 'DI-OPPORTUNITY-INFORMATION-REQUIRED' && mine[0].severity === 'info' &&
      now.body?.status === 'SCREENING' && !decisionLeak, detail: { readiness: ready.body, findings: mine, status: now.body?.status, decisionLeak } };
  });

  await t('DEVOS-DI1-OPPORTUNITY-NOT-PROJECT-001', 'SENTINEL', 'Creating, enriching, transitioning and evaluating an Opportunity never creates or changes a Project', async () => {
    const snapshot = async () => (await query(`SELECT count(*)::int AS n, md5(string_agg(id || ':' || name || ':' || coalesce(phase, 0), ',' ORDER BY id)) AS h FROM projects`)).rows[0];
    const before = await snapshot();
    const prop = await api(gDev, 'POST', '/api/di/properties', { name: 'Not-a-project parcel', address: { city: 'Fresno' }, provenance: prov() });
    const opp = await api(gDev, 'POST', '/api/di/opportunities', { name: 'Not-a-project pursuit', propertyId: prop.body?.id, concept: { description: 'x' }, provenance: prov() });
    const steps = [prop.status, opp.status];
    if (opp.status === 201) {
      steps.push((await api(gDev, 'PUT', `/api/di/properties/${prop.body.id}/site-intelligence`, { facts: { zoning: { value: 'R1', status: 'KNOWN', provenance: prov() } } })).status);
      steps.push((await api(gDev, 'POST', `/api/di/opportunities/${opp.body.id}/transition`, { to: 'SCREENING', reason: 'x' })).status);
      steps.push((await api(gDev, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z' })).status);
    }
    const after = await snapshot();
    const named = (await query(`SELECT count(*)::int AS n FROM projects WHERE name = 'Not-a-project pursuit'`)).rows[0].n;
    return { pass: steps.length === 5 && steps.every(s => s === 200 || s === 201) && before.n === after.n && before.h === after.h && named === 0,
      detail: { steps, before, after } };
  });

  // Findings: oracle tenants (alpha/beta) are evaluated before they are mutated.
  console.log('\n  --- B. Findings (oracle) ---');

  await t('DEVOS-DI1-EVAL-001', 'B', 'asOf is required and validated (missing or malformed → 400); a valid asOf succeeds', async () => {
    const none = await api(aDev, 'POST', '/api/di/evaluate', { dryRun: true });
    const junk = await api(aDev, 'POST', '/api/di/evaluate', { asOf: 'next tuesday', dryRun: true });
    const ok = await api(aDev, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z', dryRun: true });
    return { pass: none.status === 400 && junk.status === 400 && ok.status === 200, detail: { none: none.status, junk: junk.status, ok: ok.status } };
  });

  const dry = async (who, asOf) => api(who, 'POST', '/api/di/evaluate', { asOf, dryRun: true });

  await t('DEVOS-DI1-EVAL-002', 'B', 'Alpha @ 2025-02-01: every expected finding appears with the correct rule, severity, type and exact source records', async () => {
    const ev = oracle('ALPHA-2025-02-01');
    const res = await dry(aDev, ev.asOf);
    const cmp = compareToOracle(res.body?.findings, ev);
    return { pass: res.status === 200 && !cmp.missing.length && !cmp.wrong.length, detail: { status: res.status, ...cmp } };
  });

  await t('DEVOS-DI1-EVAL-003', 'B', 'Alpha @ 2025-02-01: no unexpected or explicitly forbidden finding appears (negative oracle)', async () => {
    const ev = oracle('ALPHA-2025-02-01');
    const res = await dry(aDev, ev.asOf);
    const cmp = compareToOracle(res.body?.findings, ev);
    return { pass: res.status === 200 && Array.isArray(res.body?.findings) && !cmp.unexpected.length && !cmp.forbiddenHit.length, detail: { status: res.status, unexpected: cmp.unexpected, forbiddenHit: cmp.forbiddenHit } };
  });

  await t('DEVOS-DI1-EVAL-004', 'B', 'Time comes only from asOf: alpha @ 2025-02-20 and @ 2025-01-01 match their oracles (the real clock would make both capital sources overdue)', async () => {
    const out = {};
    for (const id of ['ALPHA-2025-02-20', 'ALPHA-2025-01-01']) {
      const ev = oracle(id);
      const res = await dry(aDev, ev.asOf);
      out[id] = { status: res.status, ...compareToOracle(res.body?.findings, ev) };
    }
    return { pass: Object.values(out).every(o => o.status === 200 && o.ok), detail: out };
  });

  await t('DEVOS-DI1-EVAL-005', 'B', 'Every finding carries ruleId, ruleVersion (= registry), organization, severity, type, explanation, sources, asOf and conditionKey', async () => {
    const res = await dry(aDev, '2025-02-01T00:00:00.000Z');
    const reg = fs.existsSync(REGISTRY_PATH) ? JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) : { rules: [] };
    const ver = new Map(reg.rules.map(r => [r.ruleId, r.version]));
    const bad = (res.body?.findings || []).filter(f => !f.ruleId || f.ruleVersion !== ver.get(f.ruleId) || f.organizationId !== 'dix-alpha' ||
      !f.severity || !f.findingType || !f.title || !f.explanation || !Array.isArray(f.sources) || !f.sources.length ||
      new Date(f.asOf).toISOString() !== '2025-02-01T00:00:00.000Z' || f.conditionKey !== `${f.ruleId}|${sourceKey(f.sources)}`);
    return { pass: res.status === 200 && (res.body?.findings || []).length > 0 && !bad.length, detail: { status: res.status, bad: bad.slice(0, 3) } };
  });

  await t('DEVOS-DI1-DETERMINISM-001', 'SENTINEL', 'Same state + same asOf = same findings (deep-equal across repeated evaluations and across sessions)', async () => {
    const asOf = '2025-02-20T00:00:00.000Z';
    const a = await dry(aDev, asOf);
    const b = await dry(aAdmin, asOf);
    const c = await dry(aDev, asOf);
    const norm = r => JSON.stringify((r.body?.findings || []).slice().sort((x, y) => x.conditionKey < y.conditionKey ? -1 : 1));
    return { pass: a.status === 200 && (a.body?.findings || []).length > 0 && norm(a) === norm(b) && norm(a) === norm(c) && compareToOracle(a.body.findings, oracle('ALPHA-2025-02-20')).ok,
      detail: { statuses: [a.status, b.status, c.status], equal: norm(a) === norm(b) && norm(a) === norm(c) } };
  });

  await t('DEVOS-DI1-TENANT-CAPITAL-001', 'SENTINEL', 'Capital intelligence is tenant scoped: the tenant\'s own pending capital deadlines are surfaced (legacy /api/alerts and findings), foreign capital is not', async () => {
    const { rows: own } = await query(`SELECT s.id FROM capital_sources s JOIN capital_stacks k ON k.id = s.capital_stack_id JOIN projects p ON p.id = k.project_id
      WHERE p.organization_id = 'org1' AND s.status = 'pending' AND s.deadline IS NOT NULL`);
    const org1 = await apiRequest('GET', '/api/alerts', { headers: { Authorization: `Bearer ${S.org1Admin.token}` } });
    const org1Capital = (org1.body || []).filter(a => a.type === 'capital-deadline');
    const alpha = await api(aAdmin, 'GET', '/api/alerts');
    const alphaCapital = (alpha.body || []).filter(a => a.type === 'capital-deadline');
    const ev = await dry(aDev, '2025-02-01T00:00:00.000Z');
    const capFindings = (ev.body?.findings || []).filter(f => f.ruleId === 'EXEC-CAPITAL-DEADLINE').map(f => sourceKey(f.sources));
    const pass = own.length > 0 && org1.status === 200 && org1Capital.length === own.length &&
      alpha.status === 200 && alphaCapital.length === 2 && alphaCapital.every(a => a.projectId === 'dix-a-p1') &&
      !JSON.stringify(alpha.body).includes('dix-b-') && ev.status === 200 &&
      JSON.stringify(capFindings.sort()) === JSON.stringify(['capital_source:dix-a-src1,capital_stack:dix-a-cs1', 'capital_source:dix-a-src4,capital_stack:dix-a-cs1'].sort());
    return { pass, detail: { org1PendingWithDeadline: own.map(r => r.id), org1CapitalAlerts: org1Capital.length, alphaCapitalAlerts: alphaCapital.map(a => a.id), alertsTypes: (org1.body || []).map(a => a.type), findingsStatus: ev.status, capFindings } };
  });

  // Persisted lifecycle in alpha (after all alpha oracle checks above).
  console.log('\n  --- B. Findings (persistence & lifecycle) ---');
  const P = {};
  const active = async who => {
    const r = await api(who, 'GET', '/api/di/findings?state=ACTIVE');
    return Array.isArray(r.body) ? r.body : [];
  };
  const capSrc1 = f => f.ruleId === 'EXEC-CAPITAL-DEADLINE' && sourceKey(f.sources).includes('dix-a-src1');

  await t('DEVOS-DI1-FIND-001', 'B', 'Persisted evaluation stores the oracle findings as OPEN with ids, first-detection time and full fields', async () => {
    const res = await api(aDev, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z' });
    const list = await active(aDev);
    P.first = list;
    const cmp = compareToOracle(list, oracle('ALPHA-2025-02-01'));
    return { pass: res.status === 200 && cmp.ok && list.every(f => f.id && f.state === 'OPEN' && f.firstDetectedAt && f.organizationId === 'dix-alpha') &&
      (res.body?.created || []).length === list.length, detail: { status: res.status, created: (res.body?.created || []).length, ...cmp } };
  });

  await t('DEVOS-DI1-FIND-002', 'B', 'Re-evaluating unchanged state creates no duplicates and keeps the same finding ids', async () => {
    const res = await api(aDev, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z' });
    const list = await active(aDev);
    const ids = l => l.map(f => f.id).sort().join(',');
    return { pass: res.status === 200 && P.first?.length > 0 && ids(list) === ids(P.first) && (res.body?.created || []).length === 0, detail: { status: res.status, before: P.first?.length, after: list.length } };
  });

  await t('DEVOS-DI1-FIND-003', 'B', 'A condition that persists keeps its finding while severity follows asOf (src1 warning → critical, same id)', async () => {
    const before = (P.first || []).find(capSrc1);
    const res = await api(aDev, 'POST', '/api/di/evaluate', { asOf: '2025-02-20T00:00:00.000Z' });
    const after = (await active(aDev)).filter(capSrc1);
    return { pass: res.status === 200 && !!before && before.severity === 'warning' && after.length === 1 && after[0].id === before.id && after[0].severity === 'critical',
      detail: { before: before && [before.id, before.severity], after: after.map(f => [f.id, f.severity]) } };
  });

  await t('DEVOS-DI1-FIND-004', 'B', 'A condition that disappears resolves its finding (CONDITION_CLEARED) without deleting it', async () => {
    const before = (P.first || []).find(capSrc1);
    const res = await api(aDev, 'POST', '/api/di/evaluate', { asOf: '2025-01-01T00:00:00.000Z' });
    const stillActive = (await active(aDev)).filter(capSrc1);
    const old = before ? await api(aDev, 'GET', `/api/di/findings/${before.id}`) : { status: 0 };
    P.resolvedSrc1 = before?.id;
    return { pass: res.status === 200 && !!before && stillActive.length === 0 && old.status === 200 && old.body?.state === 'RESOLVED' && old.body?.resolution === 'CONDITION_CLEARED' &&
      (res.body?.resolved || []).includes(before.id), detail: { status: res.status, old: old.body } };
  });

  await t('DEVOS-DI1-FIND-005', 'B', 'A resolved condition that reappears opens a NEW finding linked to its predecessor; the predecessor stays RESOLVED', async () => {
    const res = await api(aDev, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z' });
    const now = (await active(aDev)).filter(capSrc1);
    const old = P.resolvedSrc1 ? await api(aDev, 'GET', `/api/di/findings/${P.resolvedSrc1}`) : { body: null };
    return { pass: res.status === 200 && now.length === 1 && now[0].id !== P.resolvedSrc1 && now[0].recurrenceOf === P.resolvedSrc1 && now[0].state === 'OPEN' && old.body?.state === 'RESOLVED',
      detail: { now: now.map(f => [f.id, f.recurrenceOf, f.state]), old: old.body?.state } };
  });

  await t('DEVOS-DI1-FIND-006', 'B', 'A finding from an older rule version is superseded (SUPERSEDED_BY_RULE_VERSION) and replaced at the registry version', async () => {
    if (!(await tableExists('intelligence_findings'))) return { pass: false, detail: 'DI tables absent' };
    const key = 'EXEC-TASK-NO-CONTRACT|task:dix-b-t2';
    await withOwner(c => c.query(`INSERT INTO intelligence_findings (id, organization_id, rule_id, rule_version, condition_key, finding_type, severity, title, explanation, sources, state, as_of, first_detected_at)
      VALUES ('dix-b-legacy-version', 'dix-beta', 'EXEC-TASK-NO-CONTRACT', 0, $1, 'missing-contract', 'critical', 'older rule version', 'produced by rule version 0', $2::jsonb, 'OPEN', '2025-01-01', '2025-01-01')`,
      [key, JSON.stringify([{ type: 'task', id: 'dix-b-t2' }])]));
    const res = await api(bDev, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z' });
    const old = await api(bDev, 'GET', '/api/di/findings/dix-b-legacy-version');
    const cur = (await active(bDev)).filter(f => f.conditionKey === key);
    return { pass: res.status === 200 && old.body?.state === 'RESOLVED' && old.body?.resolution === 'SUPERSEDED_BY_RULE_VERSION' && cur.length === 1 && cur[0].ruleVersion >= 1 && cur[0].id !== 'dix-b-legacy-version',
      detail: { status: res.status, old: old.body, current: cur.map(f => [f.id, f.ruleVersion]) } };
  });

  await t('DEVOS-DI1-FINDING-LIFECYCLE-001', 'SENTINEL', 'Acknowledge → resolve is durable, history-preserving, attributed and EF-3 audited', async () => {
    const target = (await active(aDev)).find(f => f.ruleId === 'EXEC-TASK-NO-CONTRACT');
    if (!target) return { pass: false, detail: 'precondition: no active alpha finding' };
    const ack = await api(aDev, 'POST', `/api/di/findings/${target.id}/acknowledge`, { note: 'Contract in negotiation' });
    const res = await api(aAdmin, 'POST', `/api/di/findings/${target.id}/resolve`, { note: 'Executed contract uploaded' });
    const get = await api(aViewer, 'GET', `/api/di/findings/${target.id}`);
    const hist = await api(aViewer, 'GET', `/api/di/findings/${target.id}/history`);
    const h = Array.isArray(hist.body) ? hist.body : [];
    const { rows: audit } = await query(`SELECT entity_type, action, actor_user_id FROM audit_events WHERE organization_id = 'dix-alpha' AND entity_type IN ('intelligence_findings','intelligence_finding_events') AND actor_user_id IN ('dix-u-alpha-dev','dix-u-alpha-admin')`);
    const states = h.map(e => e.toState);
    return { pass: ack.status === 200 && res.status === 200 && get.body?.state === 'RESOLVED' &&
      JSON.stringify(states.slice(-2)) === JSON.stringify(['ACKNOWLEDGED', 'RESOLVED']) && states[0] === 'OPEN' &&
      h.slice(-2)[0]?.actorUserId === 'dix-u-alpha-dev' && h.slice(-1)[0]?.actorUserId === 'dix-u-alpha-admin' &&
      audit.some(a => a.entity_type === 'intelligence_findings' && a.action === 'UPDATE' && a.actor_user_id === 'dix-u-alpha-dev') &&
      audit.some(a => a.entity_type === 'intelligence_findings' && a.action === 'UPDATE' && a.actor_user_id === 'dix-u-alpha-admin'),
      detail: { ack: ack.status, resolve: res.status, state: get.body?.state, history: states, auditRows: audit.length } };
  });

  await t('DEVOS-DI1-FIND-007', 'B', 'Invalid lifecycle moves are refused: acknowledging/resolving a RESOLVED finding → 409; body cannot rewrite sources, severity or rule', async () => {
    const resolved = (await api(aDev, 'GET', '/api/di/findings?state=RESOLVED')).body;
    const r = Array.isArray(resolved) ? resolved[0] : null;
    if (!r) return { pass: false, detail: 'precondition: no resolved finding' };
    const ack = await api(aDev, 'POST', `/api/di/findings/${r.id}/acknowledge`, {});
    const again = await api(aDev, 'POST', `/api/di/findings/${r.id}/resolve`, { note: 'again' });
    const open = (await active(aDev)).find(f => f.state === 'OPEN');
    const tamper = open ? await api(aDev, 'POST', `/api/di/findings/${open.id}/acknowledge`, { note: 'x', sources: [{ type: 'task', id: 'dix-b-t1' }], severity: 'info', ruleId: 'FORGED', ruleVersion: 99, organizationId: 'dix-beta' }) : { status: 0 };
    const after = open ? await api(aDev, 'GET', `/api/di/findings/${open.id}`) : { body: null };
    return { pass: ack.status === 409 && again.status === 409 && tamper.status === 200 && sourceKey(after.body?.sources) === sourceKey(open.sources) &&
      after.body?.severity === open.severity && after.body?.ruleId === open.ruleId && after.body?.organizationId === 'dix-alpha',
      detail: { ack: ack.status, again: again.status, tamper: tamper.status } };
  });

  await t('DEVOS-DI1-TRACE-001', 'SENTINEL', 'Every finding traces to existing records of the same organization', async () => {
    const owners = {
      project: 'SELECT organization_id AS org FROM projects WHERE id = $1',
      task: 'SELECT p.organization_id AS org FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = $1',
      contract: 'SELECT p.organization_id AS org FROM contracts c JOIN projects p ON p.id = c.project_id WHERE c.id = $1',
      permit: 'SELECT p.organization_id AS org FROM permits x JOIN projects p ON p.id = x.project_id WHERE x.id = $1',
      permit_correction: 'SELECT p.organization_id AS org FROM permit_corrections c JOIN permits x ON x.id = c.permit_id JOIN projects p ON p.id = x.project_id WHERE c.id = $1',
      capital_stack: 'SELECT p.organization_id AS org FROM capital_stacks k JOIN projects p ON p.id = k.project_id WHERE k.id = $1',
      capital_source: 'SELECT p.organization_id AS org FROM capital_sources s JOIN capital_stacks k ON k.id = s.capital_stack_id JOIN projects p ON p.id = k.project_id WHERE s.id = $1',
      partner: 'SELECT org_id AS org FROM partners WHERE id = $1',
      opportunity: 'SELECT organization_id AS org FROM di_opportunities WHERE id = $1',
      property: 'SELECT organization_id AS org FROM di_properties WHERE id = $1',
      relationship: 'SELECT organization_id AS org FROM di_relationships WHERE id = $1',
    };
    const problems = [];
    let checked = 0;
    for (const [who, org] of [[aDev, 'dix-alpha'], [bDev, 'dix-beta'], [gDev, G]]) {
      const res = await api(who, 'GET', '/api/di/findings');
      if (res.status !== 200 || !Array.isArray(res.body)) { problems.push(`${org}: list → ${res.status}`); continue; }
      for (const f of res.body) {
        if (f.organizationId !== org) problems.push(`${f.id}: organization ${f.organizationId}`);
        for (const s of f.sources || []) {
          checked++;
          const sql = owners[s.type];
          if (!sql) { problems.push(`${f.id}: unknown source type ${s.type}`); continue; }
          const { rows } = await withOwner(c => c.query(sql, [s.id]));
          if (!rows[0]) problems.push(`${f.id}: ${s.type}:${s.id} does not exist`);
          else if (rows[0].org !== org) problems.push(`${f.id}: ${s.type}:${s.id} belongs to ${rows[0].org}`);
        }
      }
    }
    return { pass: checked > 0 && !problems.length, detail: { checked, problems: problems.slice(0, 10) } };
  });

  // ════════════════ C. ADVERSARIAL ════════════════
  console.log('\n  --- C. Adversarial ---');

  await t('DEVOS-DI1-CROSS-TENANT-001', 'SENTINEL', 'Foreign tenant information cannot affect another tenant\'s findings (dry-run oracle, persisted state, lists, direct reads, alerts)', async () => {
    const aBefore = (await active(aDev)).map(f => `${f.id}:${f.state}:${f.severity}`).sort();
    const betaEval = await api(bDev, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z' });
    const betaDry = await dry(bDev, '2025-02-01T00:00:00.000Z');
    const aAfter = (await active(aDev)).map(f => `${f.id}:${f.state}:${f.severity}`).sort();
    const alphaDry = await dry(aDev, '2025-02-01T00:00:00.000Z');
    const betaFinding = (await active(bDev))[0];
    const peek = betaFinding ? await api(aDev, 'GET', `/api/di/findings/${betaFinding.id}`) : { status: 0 };
    const alphaAll = await api(aDev, 'GET', '/api/di/findings');
    const alerts = await api(aAdmin, 'GET', '/api/alerts');
    const leaks = [JSON.stringify(alphaDry.body), JSON.stringify(alphaAll.body), JSON.stringify(alerts.body)].some(s => s.includes('dix-b-') || s.includes('Beta Foreign Partner'));
    return { pass: betaEval.status === 200 && compareToOracle(betaDry.body?.findings, oracle('BETA-2025-02-01')).ok && compareToOracle(alphaDry.body?.findings, oracle('ALPHA-2025-02-01')).ok &&
      aBefore.length > 0 && JSON.stringify(aBefore) === JSON.stringify(aAfter) && !!betaFinding && peek.status === 404 && alphaAll.status === 200 && !leaks,
      detail: { betaEval: betaEval.status, alphaUnchanged: JSON.stringify(aBefore) === JSON.stringify(aAfter), peek: peek.status, leaks } };
  });

  await t('DEVOS-DI1-ADV-LIST-001', 'C', 'Lists never include another tenant\'s relationships, properties, opportunities or findings', async () => {
    const out = {};
    for (const p of ['relationships', 'properties', 'opportunities', 'findings']) {
      const own = await api(bDev, 'GET', `/api/di/${p}`);
      const other = await api(aDev, 'GET', `/api/di/${p}`);
      out[p] = { betaSeesOwn: own.status === 200 && Array.isArray(own.body) && own.body.length > 0, alphaStatus: other.status,
        leak: JSON.stringify(other.body || '').includes('dix-b-') || (Array.isArray(other.body) && other.body.some(x => x.organizationId === 'dix-beta')) };
    }
    return { pass: Object.values(out).every(o => o.betaSeesOwn && o.alphaStatus === 200 && !o.leak), detail: out };
  });

  await t('DEVOS-DI1-ADV-DIRECT-001', 'C', 'Direct reads of another tenant\'s records return 404 (relationship, property, site intelligence, opportunity, readiness, history, finding)', async () => {
    const betaFinding = (await active(bDev))[0];
    const paths = ['/api/di/relationships/dix-b-rel1', '/api/di/properties/dix-b-prop1', '/api/di/properties/dix-b-prop1/site-intelligence',
      '/api/di/opportunities/dix-b-opp1', '/api/di/opportunities/dix-b-opp1/readiness', '/api/di/opportunities/dix-b-opp1/history',
      betaFinding ? `/api/di/findings/${betaFinding.id}` : null].filter(Boolean);
    const own = await api(bDev, 'GET', '/api/di/opportunities/dix-b-opp1');
    const out = {};
    for (const p of paths) out[p] = (await api(aDev, 'GET', p)).status;
    return { pass: own.status === 200 && !!betaFinding && Object.values(out).every(s => s === 404), detail: { ownerCanRead: own.status, out } };
  });

  await t('DEVOS-DI1-ADV-MUTATE-001', 'C', 'Mutations against another tenant\'s records return 404 and leave them unchanged', async () => {
    const betaFinding = (await active(bDev))[0];
    const before = await api(bDev, 'GET', '/api/di/opportunities/dix-b-opp1');
    const attempts = {
      relPatch: (await api(aDev, 'PATCH', '/api/di/relationships/dix-b-rel1', { name: 'hijacked' })).status,
      propPatch: (await api(aDev, 'PATCH', '/api/di/properties/dix-b-prop1', { name: 'hijacked' })).status,
      sitePut: (await api(aDev, 'PUT', '/api/di/properties/dix-b-prop1/site-intelligence', { facts: { zoning: { value: 'X', status: 'KNOWN', provenance: prov() } } })).status,
      oppPatch: (await api(aDev, 'PATCH', '/api/di/opportunities/dix-b-opp1', { name: 'hijacked' })).status,
      oppTransition: (await api(aDev, 'POST', '/api/di/opportunities/dix-b-opp1/transition', { to: 'DECLINED', reason: 'sabotage' })).status,
      findingAck: betaFinding ? (await api(aDev, 'POST', `/api/di/findings/${betaFinding.id}/acknowledge`, {})).status : 'no beta finding',
      findingResolve: betaFinding ? (await api(aDev, 'POST', `/api/di/findings/${betaFinding.id}/resolve`, { note: 'x' })).status : 'no beta finding',
    };
    const after = await api(bDev, 'GET', '/api/di/opportunities/dix-b-opp1');
    const rel = await api(bDev, 'GET', '/api/di/relationships/dix-b-rel1');
    const site = await api(bDev, 'GET', '/api/di/properties/dix-b-prop1/site-intelligence');
    return { pass: before.status === 200 && Object.values(attempts).every(s => s === 404) && after.body?.status === before.body?.status && after.body?.name === before.body?.name &&
      rel.body?.name === 'Beta Land Trust' && !('zoning' in (site.body?.facts || {})), detail: attempts };
  });

  await t('DEVOS-DI1-ADV-REF-001', 'C', 'Foreign references in request bodies are refused with 404: property, relationship, responsible user', async () => {
    const control = await api(aDev, 'POST', '/api/di/opportunities', { name: 'Ref control', propertyId: 'dix-a-prop1', relationshipId: 'dix-a-rel1', responsibleUserId: 'dix-u-alpha-admin', concept: { description: 'x' }, provenance: prov() });
    const attempts = {
      foreignProperty: (await api(aDev, 'POST', '/api/di/opportunities', { name: 'Ref A', propertyId: 'dix-b-prop1', concept: { description: 'x' }, provenance: prov() })).status,
      foreignRelationship: (await api(aDev, 'POST', '/api/di/opportunities', { name: 'Ref B', relationshipId: 'dix-b-rel1', concept: { description: 'x' }, provenance: prov() })).status,
      foreignUser: (await api(aDev, 'POST', '/api/di/opportunities', { name: 'Ref C', responsibleUserId: 'dix-u-beta-admin', concept: { description: 'x' }, provenance: prov() })).status,
      patchToForeignProperty: control.body?.id ? (await api(aDev, 'PATCH', `/api/di/opportunities/${control.body.id}`, { propertyId: 'dix-b-prop1' })).status : 'no control',
    };
    // The control opportunity is in alpha: retire it so it cannot alter later alpha evaluations.
    if (control.body?.id) await api(aDev, 'POST', `/api/di/opportunities/${control.body.id}/transition`, { to: 'WITHDRAWN', reason: 'test control' });
    return { pass: control.status === 201 && Object.values(attempts).every(s => s === 404), detail: { control: control.status, attempts } };
  });

  await t('DEVOS-DI1-ADV-FORGE-ORG-001', 'C', 'Forged organization context is refused: foreign X-Organization-Id → 403; organizationId in the body is ignored', async () => {
    const forged = await api(aDev, 'GET', '/api/di/opportunities', undefined, { 'X-Organization-Id': 'dix-beta' });
    const forgedEval = await api(aDev, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z', dryRun: true }, { 'X-Organization-Id': 'dix-beta' });
    const own = await api(gDev, 'GET', '/api/di/opportunities');
    const bodyOrg = await api(gDev, 'POST', '/api/di/relationships', { name: 'Body org probe', relationshipType: 'broker', organizationId: 'dix-beta', provenance: prov() });
    const evalBodyOrg = await api(gDev, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z', dryRun: true, organizationId: 'dix-beta' });
    return { pass: own.status === 200 && forged.status === 403 && forgedEval.status === 403 && bodyOrg.status === 201 && bodyOrg.body?.organizationId === G &&
      evalBodyOrg.status === 200 && !JSON.stringify(evalBodyOrg.body).includes('dix-b-'), detail: { own: own.status, forged: forged.status, forgedEval: forgedEval.status, bodyOrg: [bodyOrg.status, bodyOrg.body?.organizationId] } };
  });

  await t('DEVOS-DI1-ADV-MASS-001', 'C', 'Mass assignment on update cannot change id, organization, status, provenance recorder or timestamps', async () => {
    const created = await api(gDev, 'POST', '/api/di/properties', { name: 'Mass probe', address: { city: 'Fresno' }, provenance: prov() });
    if (created.status !== 201) return { pass: false, detail: `precondition: create → ${created.status}` };
    const p = created.body;
    const upd = await api(gDev, 'PATCH', `/api/di/properties/${p.id}`, { id: 'stolen', organizationId: 'dix-beta', createdAt: '2000-01-01T00:00:00Z', provenance: { recordedBy: 'dix-u-beta-admin' }, name: 'Mass probe 2' });
    const get = await api(gDev, 'GET', `/api/di/properties/${p.id}`);
    const opp = await api(gDev, 'POST', '/api/di/opportunities', { name: 'Mass opp', concept: { description: 'x' }, provenance: prov() });
    const oppPatch = opp.body?.id ? await api(gDev, 'PATCH', `/api/di/opportunities/${opp.body.id}`, { status: 'READY_FOR_QUALIFICATION', organizationId: 'dix-beta' }) : { status: 0 };
    const oppNow = opp.body?.id ? await api(gDev, 'GET', `/api/di/opportunities/${opp.body.id}`) : { body: null };
    return { pass: upd.status === 200 && get.body?.id === p.id && get.body?.organizationId === G && get.body?.createdAt === p.createdAt && get.body?.name === 'Mass probe 2' &&
      get.body?.provenance?.recordedBy === 'dix-u-gamma-dev' && oppNow.body?.status === 'NEW' && oppNow.body?.organizationId === G,
      detail: { upd: upd.status, get: get.body, oppPatch: oppPatch.status, oppStatus: oppNow.body?.status } };
  });

  await t('DEVOS-DI1-ADV-LIFECYCLE-001', 'C', 'Unauthorized lifecycle actions are refused: viewer cannot transition, acknowledge, resolve or evaluate', async () => {
    const o = await api(gDev, 'POST', '/api/di/opportunities', { name: 'Viewer probe', concept: { description: 'x' }, provenance: prov() });
    await api(gDev, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z' });
    const f = (await active(gDev))[0];
    const statuses = {
      read: (await api(gViewer, 'GET', '/api/di/opportunities')).status,
      transition: o.body?.id ? (await api(gViewer, 'POST', `/api/di/opportunities/${o.body.id}/transition`, { to: 'SCREENING', reason: 'x' })).status : 'no opp',
      acknowledge: f ? (await api(gViewer, 'POST', `/api/di/findings/${f.id}/acknowledge`, {})).status : 'no finding',
      resolve: f ? (await api(gViewer, 'POST', `/api/di/findings/${f.id}/resolve`, { note: 'x' })).status : 'no finding',
      evaluate: (await api(gViewer, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z' })).status,
    };
    const now = o.body?.id ? await api(gDev, 'GET', `/api/di/opportunities/${o.body.id}`) : { body: null };
    return { pass: statuses.read === 200 && ['transition', 'acknowledge', 'resolve', 'evaluate'].every(k => statuses[k] === 403) && now.body?.status === 'NEW', detail: statuses };
  });

  await t('DEVOS-DI1-ADV-SPOOF-001', 'C', 'Findings cannot be created or forged by clients: POST /api/di/findings is not allowed and creates nothing', async () => {
    const list = await api(gDev, 'GET', '/api/di/findings');
    const before = (await query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'intelligence_findings'`)).rows[0].n
      ? (await withOwner(c => c.query(`SELECT count(*)::int AS n FROM intelligence_findings WHERE organization_id = $1`, [G]))).rows[0].n : null;
    const forged = await api(gDev, 'POST', '/api/di/findings', { ruleId: 'EXEC-CAPITAL-DEADLINE', severity: 'critical', sources: [{ type: 'capital_source', id: 'dix-b-src1' }], explanation: 'forged' });
    const after = before === null ? null : (await withOwner(c => c.query(`SELECT count(*)::int AS n FROM intelligence_findings WHERE organization_id = $1`, [G]))).rows[0].n;
    return { pass: list.status === 200 && [404, 405].includes(forged.status) && before !== null && before === after, detail: { list: list.status, forged: forged.status, before, after } };
  });

  // The workbench project is used for execution-domain reference probes so
  // that the oracle tenants are never perturbed.
  await t('DEVOS-DI1-TENANT-PARTNER-001', 'SENTINEL', 'Partner intelligence is tenant scoped: no foreign partner identity ever reaches a tenant\'s alerts or findings', async () => {
    const planted = { api: null, db: null };
    const res = await api(gDev, 'POST', '/api/tasks', { projectId: WORKBENCH.project.id, title: 'Partner probe', partnerId: 'dix-b-partner1', status: 'not-started' });
    planted.api = res.status;
    if (res.status !== 201) {
      // API refused; try to plant at the database layer to prove integrity is enforced there too.
      const out = await withOwner(c => probe(c, [[`INSERT INTO tasks (id, project_id, title, partner_id, status) VALUES ('dix-g-partner-probe', $1, 'Partner probe (db)', 'dix-b-partner1', 'not-started')`, [WORKBENCH.project.id]]]));
      planted.db = out.failedAt === -1 ? 'insertable' : out.code;
    }
    const alerts = await api(gAdmin, 'GET', '/api/alerts');
    const ev = await dry(gDev, '2025-02-01T00:00:00.000Z');
    const leakAlerts = JSON.stringify(alerts.body || '').match(/Beta Foreign Partner ZQX|dix-b-partner1/g);
    const leakFindings = JSON.stringify(ev.body || '').match(/Beta Foreign Partner ZQX|dix-b-partner1/g);
    if (res.status === 201 && res.body?.id) await withOwner(c => c.query('DELETE FROM tasks WHERE id = $1', [res.body.id]));
    return { pass: alerts.status === 200 && ev.status === 200 && !leakAlerts && !leakFindings,
      detail: { plantedViaApi: planted.api, plantedViaDb: planted.db, alertsStatus: alerts.status, leakInAlerts: leakAlerts, findingsStatus: ev.status, leakInFindings: leakFindings } };
  });

  await t('DEVOS-DI1-ADV-EXECREF-001', 'C', 'Intelligence inputs cannot be spoofed with foreign execution records: tasks and contracts cannot reference another tenant\'s partner or contract (404, not 201/500)', async () => {
    const own = await api(gDev, 'POST', '/api/tasks', { projectId: WORKBENCH.project.id, title: 'Exec ref control', status: 'not-started' });
    const attempts = {
      createForeignPartner: (await api(gDev, 'POST', '/api/tasks', { projectId: WORKBENCH.project.id, title: 'Foreign partner', partnerId: 'dix-b-partner1' })),
      createForeignContract: (await api(gDev, 'POST', '/api/tasks', { projectId: WORKBENCH.project.id, title: 'Foreign contract', contractId: 'dix-b-c1' })),
      updateForeignContract: own.body?.id ? (await api(gDev, 'PUT', `/api/tasks/${own.body.id}`, { contractId: 'dix-b-c1' })) : { status: 'no control' },
      contractForeignPartner: (await api(gDev, 'POST', '/api/contracts', { projectId: WORKBENCH.project.id, partnerId: 'dix-b-partner1', type: 'Survey', status: 'pending' })),
    };
    const statuses = Object.fromEntries(Object.entries(attempts).map(([k, v]) => [k, v.status]));
    // Demonstrate the consequence: a foreign contract id suppresses this tenant's "no contract" alert.
    const alerts = await api(gAdmin, 'GET', '/api/alerts');
    const suppressed = attempts.createForeignContract.status === 201 && !(alerts.body || []).some(a => a.taskId === attempts.createForeignContract.body?.id);
    for (const [k, a] of Object.entries(attempts)) if (a.status === 201 && a.body?.id) await withOwner(c => c.query(`DELETE FROM ${k === 'contractForeignPartner' ? 'contracts' : 'tasks'} WHERE id = $1`, [a.body.id]));
    if (own.body?.id) await withOwner(c => c.query('DELETE FROM tasks WHERE id = $1', [own.body.id]));
    return { pass: own.status === 201 && Object.values(statuses).every(s => s === 404), detail: { control: own.status, statuses, foreignContractSuppressesAlert: suppressed } };
  });

  // ════════════════ D. INTEGRATION ════════════════
  console.log('\n  --- D. Integration ---');

  await t('DEVOS-DI1-AUTHZ-001', 'D', 'Authorization matrix: each role gets exactly its permitted DI operations (viewer: reads 2xx, writes 403); developer: all 2xx', async () => {
    const rel = await api(gDev, 'POST', '/api/di/relationships', { name: 'Matrix rel', relationshipType: 'broker', provenance: prov() });
    const prop = await api(gDev, 'POST', '/api/di/properties', { name: 'Matrix prop', address: { city: 'Fresno' }, provenance: prov() });
    const opp = await api(gDev, 'POST', '/api/di/opportunities', { name: 'Matrix opp', propertyId: prop.body?.id, concept: { description: 'x' }, provenance: prov() });
    await api(gDev, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z' });
    const f = (await active(gDev))[0];
    const ids = { relationshipId: rel.body?.id, propertyId: prop.body?.id, opportunityId: opp.body?.id, findingId: f?.id };
    if (Object.values(ids).some(v => !v)) return { pass: false, detail: { precondition: 'workbench resources missing', ids } };
    const fill = p => p.replace(/:(\w+)/g, (_, k) => ids[k]);
    const problems = [];
    for (const [who, role] of [[gViewer, 'viewer'], [gDev, 'developer']]) {
      const perms = new Set(MATRIX.rolePermissions[role]);
      for (const e of MATRIX.endpoints) {
        const r = await api(who, e.method, fill(e.path), e.body);
        const allowed = perms.has(e.permission);
        const ok = allowed ? r.status >= 200 && r.status < 300 : r.status === MATRIX.statusPolicy.missingPermission;
        if (!ok) problems.push(`${role} ${e.method} ${e.path} → ${r.status} (expected ${allowed ? '2xx' : 403})`);
      }
    }
    return { pass: !problems.length, detail: problems.slice(0, 12) };
  });

  await t('DEVOS-DI1-AUTHZ-002', 'D', 'Unauthenticated requests to DI endpoints return 401', async () => {
    const out = {};
    for (const e of MATRIX.endpoints) out[`${e.method} ${e.path}`] = (await apiRequest(e.method, e.path.replace(/:(\w+)/g, 'x'), { body: e.body })).status;
    return { pass: Object.values(out).every(s => s === MATRIX.statusPolicy.unauthenticated), detail: Object.entries(out).filter(([, s]) => s !== 401).slice(0, 8) };
  });

  await t('DEVOS-DI1-AUTHZ-003', 'D', 'Role → DI permission mapping matches the matrix exactly; platform-admin holds no DI permission', async () => {
    const di = MATRIX.rolePermissions['org-admin'];
    const { rows } = await query(`SELECT role_id, permission_id FROM role_permissions WHERE permission_id = ANY($1)`, [di]);
    const problems = [];
    for (const [role, want] of Object.entries(MATRIX.rolePermissions)) {
      const have = rows.filter(r => r.role_id === role).map(r => r.permission_id).sort();
      if (JSON.stringify(have) !== JSON.stringify(want.slice().sort())) problems.push({ role, have, want });
    }
    return { pass: !problems.length, detail: problems };
  });

  await t('DEVOS-DI1-AUDIT-001', 'SENTINEL', 'Representative DI-1 mutations are captured by the EF-3 ledger with actor and organization', async () => {
    const r = await api(gAdmin, 'POST', '/api/di/relationships', { name: 'Audit rel', relationshipType: 'municipality', provenance: prov() });
    if (r.status === 201) await api(gAdmin, 'PATCH', `/api/di/relationships/${r.body.id}`, { name: 'Audit rel 2' });
    const p = await api(gAdmin, 'POST', '/api/di/properties', { name: 'Audit prop', address: { city: 'Fresno' }, provenance: prov() });
    if (p.status === 201) {
      await api(gAdmin, 'PATCH', `/api/di/properties/${p.body.id}`, { name: 'Audit prop 2' });
      await api(gAdmin, 'PUT', `/api/di/properties/${p.body.id}/site-intelligence`, { facts: { zoning: { value: 'R2', status: 'KNOWN', provenance: prov() } } });
    }
    const o = await api(gAdmin, 'POST', '/api/di/opportunities', { name: 'Audit opp', concept: { description: 'x' }, provenance: prov() });
    if (o.status === 201) await api(gAdmin, 'POST', `/api/di/opportunities/${o.body.id}/transition`, { to: 'SCREENING', reason: 'audit' });
    await api(gAdmin, 'POST', '/api/di/evaluate', { asOf: '2025-02-01T00:00:00.000Z' });
    const f = (await active(gAdmin))[0];
    if (f) { await api(gAdmin, 'POST', `/api/di/findings/${f.id}/acknowledge`, {}); await api(gAdmin, 'POST', `/api/di/findings/${f.id}/resolve`, { note: 'audit' }); }
    const { rows } = await query(`SELECT entity_type, action FROM audit_events WHERE organization_id = $1 AND actor_user_id = 'dix-u-gamma-admin'`, [G]);
    const has = (e, a) => rows.some(x => x.entity_type === e && x.action === a);
    const required = {
      'relationship create': has('di_relationships', 'INSERT'), 'relationship change': has('di_relationships', 'UPDATE'),
      'property create': has('di_properties', 'INSERT'), 'property change': has('di_properties', 'UPDATE'),
      'opportunity lifecycle': has('di_opportunity_status_history', 'INSERT') && has('di_opportunities', 'UPDATE'),
      'site intelligence change': has('di_site_facts', 'INSERT'),
      'finding acknowledge/resolve': has('intelligence_findings', 'UPDATE') && has('intelligence_finding_events', 'INSERT'),
    };
    return { pass: Object.values(required).every(Boolean), detail: required };
  });

  await t('DEVOS-DI1-AUDIT-002', 'D', 'EF-3 chains of every DI tenant still verify cryptographically after all DI-1 activity', async () => {
    const out = {};
    for (const [who, org] of [[aAdmin, 'dix-alpha'], [bAdmin, 'dix-beta'], [gAdmin, G]]) {
      const r = await api(who, 'GET', '/api/audit/verify');
      out[org] = { status: r.status, valid: r.body?.valid, count: r.body?.count, failure: r.body?.failure?.reason || null };
    }
    return { pass: Object.values(out).every(o => o.status === 200 && o.valid === true && o.count > 0), detail: out };
  });

  await t('DEVOS-DI1-EF3-FROZEN-001', 'D', 'Frozen EF-3 artifacts are byte-identical to the accepted EF-3 release', async () => {
    const changed = Object.entries(EF3_FROZEN).filter(([f, h]) => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', f))).digest('hex') !== h).map(([f]) => f);
    return { pass: !changed.length, detail: { changed } };
  });

  await t('DEVOS-DI1-LEGACY-001', 'D', 'Legacy /api/alerts keeps producing the existing rule outputs for the canonical tenant (missing-contract, blocked-tasks, permit-corrections, gc-contract)', async () => {
    const res = await apiRequest('GET', '/api/alerts', { headers: { Authorization: `Bearer ${S.org1Admin.token}` } });
    const types = new Set((res.body || []).map(a => a.type));
    const shapeOk = (res.body || []).every(a => a.id && a.severity && a.type && a.title && a.projectId);
    return { pass: res.status === 200 && ['missing-contract', 'blocked-tasks', 'permit-corrections', 'gc-contract'].every(x => types.has(x)) && shapeOk, detail: { status: res.status, types: [...types] } };
  });

  await t('DEVOS-DI1-LEGACY-002', 'D', 'Rule parity: every legacy alert for the canonical tenant has a corresponding finding from its registry rule citing the same record', async () => {
    const alerts = await apiRequest('GET', '/api/alerts', { headers: { Authorization: `Bearer ${S.org1Admin.token}` } });
    const ev = await apiRequest('POST', '/api/di/evaluate', { headers: { Authorization: `Bearer ${S.org1Admin.token}` }, body: { asOf: new Date().toISOString(), dryRun: true } });
    if (alerts.status !== 200 || ev.status !== 200) return { pass: false, detail: { alerts: alerts.status, evaluate: ev.status } };
    const fs2 = ev.body.findings || [];
    const missing = [];
    for (const a of alerts.body) {
      const has = (rule, src) => fs2.some(f => f.ruleId === rule && (!src || sourceKey(f.sources).includes(src)));
      const ok = a.taskId ? has('EXEC-TASK-NO-CONTRACT', `task:${a.taskId}`)
        : a.contractId ? has('EXEC-CONTRACT-MISSING', `contract:${a.contractId}`)
        : a.permitId ? has('EXEC-PERMIT-CORRECTIONS', `permit:${a.permitId}`)
        : a.type === 'blocked-tasks' ? has('EXEC-BLOCKED-TASKS', `project:${a.projectId}`)
        : a.type === 'gc-contract' ? has('EXEC-GC-CONTRACT-PENDING', `project:${a.projectId}`)
        : a.type === 'capital-deadline' ? has('EXEC-CAPITAL-DEADLINE', null) : false;
      if (!ok) missing.push(a.id);
    }
    return { pass: alerts.body.length > 0 && !missing.length, detail: { alerts: alerts.body.length, findings: fs2.length, missing } };
  });

  // ── summary ────────────────────────────────────────────────────────────────
  const passedCount = results.filter(r => r.passed).length;
  const redCount = results.length - passedCount;
  console.log(`\nDEVOS-DI-1 ACCEPTANCE: ${passedCount} GREEN, ${redCount} RED (Total: ${results.length})`);
  return { passedCount, redCount, total: results.length, results, fixture };
}

if (require.main === module) {
  const { stopTestServer } = require('./helpers');
  runDI1AcceptanceSuite().then(r => stopTestServer().then(() => process.exit(r.redCount ? 1 : 0)));
}

module.exports = { runDI1AcceptanceSuite };
