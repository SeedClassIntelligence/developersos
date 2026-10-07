// ══════════════════════════════════════════════════════════════
// DEVOS-DI-2 ACCEPTANCE — Policy & Gate Engine (RED gate)
//
// Executable form of docs/DEVOS-DI2-ACCEPTANCE-CONTRACT.md.
// Fixtures:
//   fixtures/di2-qualification-oracle.json  hand-derived outcome oracle
//   fixtures/di2-authorization-matrix.json  endpoint × permission contract
//   fixtures/di2-red-baseline.json          expected state per test
//
// Construction rules (same as DI-1): every negative assertion has a positive
// precondition; database probes require the exact SQLSTATE with a same-tenant
// control; mutating behavioral tests use the workbench tenant (dq-gamma) so
// the oracle tenants (dq-alpha, dq-beta) stay exact.
// ══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const { startTestServer, apiRequest, loginAs } = require('./helpers');
const { query, getPool } = require('../db/pool');

const ORACLE = require('./fixtures/di2-qualification-oracle.json');
const MATRIX = require('./fixtures/di2-authorization-matrix.json');
const ROOT = path.join(__dirname, '..');

const DI2_TABLES = ['di_policy_profiles', 'di_policy_versions', 'di_policy_criteria', 'di_candidate_attributes', 'di_qualifications'];
const OUTCOMES = ['GO', 'CONDITIONAL_GO', 'WATCH', 'HOLD', 'NO_GO', 'INFORMATION_REQUIRED'];
// DI-1 accepted and frozen at 8bc4e3a/7e46306.
const DI1_FROZEN = {
  'db/migrations/006_development_intelligence.sql': 'bbcc165fda61a376d0daac1aa72913ebc8abc2bf88baa178c1e9b8908a70a69f',
  'db/migrations/007_execution_partner_tenant_integrity.sql': 'f4ee04daa3e842bec0aa9a969bd0ba3d37032dca318ba06b0d599c0f96aff1ed',
  'intelligence/engine.js': 'c37e33644ecf400fde716b586d796269c5ae2076618fe123e7e0cbda08ae1d48',
  'intelligence/readiness.js': '16777de34b5fc864b316ac1d00ee6dca2ae7085297505aef6c3809aadf0dd399',
  'intelligence/rule-registry.json': '3b34f0f06a597c0e9264138db940009d6122dcacc1d4be33c5357c40caa0d29d',
  'db/repositories/di.repo.js': '9f1f74634796b1f99ce2ed20755fd4137fd8aa024b2126d629dc06efe8ea05b1',
  'db/repositories/findings.repo.js': '93962a193da41bced3e0310ba1acc1e3779578087f8920f0ad99a369897573cc',
  'middleware/references.js': 'a14d92e3e3c85de1baee374cf45b8ea4899b4146eaf82e26ed3467f96daf7ff4',
};
const EF3_FROZEN = {
  'db/migrations/004_audit_ledger.sql': 'add7854d05f997c6620bf413a3f0041bae7e54f4f55d8c3b1d7d45d12495c7a0',
  'db/migrations/005_audit_ledger_v2.sql': 'd3d0745c87c65afbb293728f5879ee40583a8c2d280a8c2a68a034494bcda489',
  'db/audit-signing.js': '368f7398e1cc43d26b07a66d2d824f3d531994ef540842166be817e785b84d4c',
  'db/repositories/audit.repo.js': '31fa20baa2b0fdabad541e38230ee63dfaccaf144af80b7afe06e309b21a9320',
  'routes/audit.js': 'e9067af076008db6cc7778049d048ddb2cc9743df1ce681e115b04a45b78865a',
  'db/audit-context.js': 'c65cc06b0e41a59ea97c019ff3be11014d6f62db47ac821bf28678388fd53b2f',
};
const digest = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');

// Contract §6 content hash, computed independently of the product.
function contentHash(criteria) {
  const canonical = criteria.map(c => ({ key: c.key, kind: c.kind, label: c.label, operand: c.operand, operator: c.operator, rationale: c.rationale ?? null, subject: c.subject }));
  return crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

async function withOwner(fn) {
  const c = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
async function withRuntime(fn) {
  const c = await (await getPool()).connect();
  try { return await fn(c); } finally { c.release(); }
}
async function tableExists(t) {
  return (await query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${t}`])).rows[0].ok;
}
// Rolled-back probe: statements in order; returns index and SQLSTATE of the first failure.
async function probe(client, statements) {
  await client.query('BEGIN');
  try {
    for (let i = 0; i < statements.length; i++) {
      try { await client.query(statements[i][0], statements[i][1]); } catch (err) { return { failedAt: i, code: err.code, message: err.message }; }
    }
    return { failedAt: -1 };
  } finally { await client.query('ROLLBACK').catch(() => {}); }
}

// ── fixture: DI-1 records via SQL (frozen schema), DI-2 attributes via SQL ──
function oppSpec(o) {
  const facts = { ...ORACLE.base.facts, ...(o.facts || {}) };
  for (const k of o.omitFacts || []) delete facts[k];
  return { facts, attributes: { ...ORACLE.base.attributes, ...(o.attributes || {}) }, region: o.region || ORACLE.base.region };
}

async function loadFixture() {
  const status = { di1: false, attributes: false, attributesError: null };
  await withOwner(async c => {
    const { rows: [admin] } = await c.query(`SELECT password_hash FROM users WHERE email = 'admin@developeros.com'`);
    await c.query('BEGIN');
    for (const t of ORACLE.tenants) await c.query(`INSERT INTO organizations (id, name, type, plan) VALUES ($1, $2, 'developer', 'enterprise')`, [t.id, t.name]);
    for (const u of ORACLE.users) {
      await c.query(`INSERT INTO users (id, org_id, name, email, password_hash, role, active) VALUES ($1,$2,$3,$4,$5,'developer',TRUE)`, [u.id, u.organizationId, u.email, u.email, admin.password_hash]);
      await c.query(`INSERT INTO memberships (id, user_id, organization_id, role_id, status) VALUES ($1,$2,$3,$4,'ACTIVE')`, [`m-${u.id}`, u.id, u.organizationId, u.roleId]);
    }
    for (const o of ORACLE.opportunities) {
      const s = oppSpec(o);
      const prop = `${o.id}-prop`;
      await c.query(`INSERT INTO di_properties (id, organization_id, name, city, region, country, source_type, source_reference, recorded_by, created_at, updated_at)
        VALUES ($1,$2,$3,'Fixture City',$4,'US','USER_ENTRY','di2 fixture','dq-fixture',$5,$5)`, [prop, o.tenant, `Property ${o.id}`, s.region, ORACLE.recordedAt]);
      for (const [k, f] of Object.entries(s.facts)) {
        await c.query(`INSERT INTO di_site_facts (id, organization_id, property_id, fact_key, value, value_status, version, source_type, source_reference, recorded_by, recorded_at)
          VALUES ($1,$2,$3,$4,$5::jsonb,$6,1,'USER_ENTRY','di2 fixture','dq-fixture',$7)`, [`${prop}-${k}`, o.tenant, prop, k, f.value === null ? null : JSON.stringify(f.value), f.status, ORACLE.recordedAt]);
      }
      await c.query(`INSERT INTO di_opportunities (id, organization_id, property_id, name, status, concept_description, source_type, source_reference, recorded_by, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,'Fixture concept','USER_ENTRY','di2 fixture','dq-fixture',$6,$6)`, [o.id, o.tenant, prop, `Opportunity ${o.id}`, o.status, ORACLE.recordedAt]);
    }
    await c.query('COMMIT');
    status.di1 = true;
    try {
      await c.query('BEGIN');
      for (const o of ORACLE.opportunities) {
        const s = oppSpec(o);
        for (const [k, a] of Object.entries(s.attributes)) {
          await c.query(`INSERT INTO di_candidate_attributes (id, organization_id, opportunity_id, attribute_key, value, value_status, version, source_type, source_reference, recorded_by, recorded_at)
            VALUES ($1,$2,$3,$4,$5::jsonb,$6,1,'USER_ENTRY','di2 fixture','dq-fixture',$7)`, [`${o.id}-${k}-1`, o.tenant, o.id, k, a.value === null ? null : JSON.stringify(a.value), a.status, ORACLE.recordedAt]);
        }
        for (const [k, versions] of Object.entries(o.attributeHistory || {})) {
          let v = 2;
          for (const a of versions) {
            await c.query(`INSERT INTO di_candidate_attributes (id, organization_id, opportunity_id, attribute_key, value, value_status, version, source_type, source_reference, recorded_by, recorded_at)
              VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'USER_ENTRY','di2 fixture','dq-fixture',$8)`, [`${o.id}-${k}-${v}`, o.tenant, o.id, k, JSON.stringify(a.value), a.status, v, a.recordedAt]);
            v++;
          }
        }
      }
      await c.query('COMMIT');
      status.attributes = true;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      status.attributesError = `${err.code || ''} ${err.message}`;
    }
  });
  return status;
}

async function runDI2AcceptanceSuite() {
  console.log('\n===============================================================');
  console.log('RUNNING SUITE: DEVOS-DI-2 ACCEPTANCE (RED GATE)');
  console.log('===============================================================\n');
  await startTestServer(3005, true);
  const fixture = await loadFixture();
  console.log(`  [DI2] fixture: di1=${fixture.di1} attributes=${fixture.attributes}${fixture.attributesError ? ` (${fixture.attributesError})` : ''}`);

  const results = [];
  async function t(id, cls, title, fn) {
    let passed = false; let detail = '';
    try {
      const out = await fn();
      passed = out === true || (out && out.pass === true);
      detail = out && out.detail !== undefined ? (typeof out.detail === 'string' ? out.detail : JSON.stringify(out.detail)) : '';
    } catch (err) { detail = `error: ${err.message}`; }
    results.push({ id, cls, title, passed, detail: detail.slice(0, 600) });
    console.log(`  ${passed ? '[GREEN]' : '[RED]  '} ${id} — ${title}${passed ? '' : ` :: ${detail.slice(0, 300)}`}`);
  }

  const S = {};
  for (const u of ORACLE.users) S[u.id] = await loginAs(u.email);
  const api = (who, method, p, body, extra = {}) => apiRequest(method, p, { headers: { Authorization: `Bearer ${S[who].token}`, ...extra }, body });
  const prov = (sourceType = 'USER_ENTRY') => ({ sourceType, sourceReference: 'di2 test' });
  const asOf = ORACLE.defaultAsOf;

  // Publishes a policy through the API (profile → draft version → publish).
  async function publishPolicy(who, name, criteria, isDefault = true) {
    const prof = await api(who, 'POST', '/api/di/policies', { name, isDefault });
    if (prof.status !== 201) return { error: `create profile → ${prof.status}` };
    const ver = await api(who, 'POST', `/api/di/policies/${prof.body.id}/versions`, { criteria });
    if (ver.status !== 201) return { error: `create version → ${ver.status}`, profile: prof.body };
    const pub = await api(who, 'POST', `/api/di/policy-versions/${ver.body.id}/publish`);
    if (pub.status !== 200) return { error: `publish → ${pub.status}`, profile: prof.body };
    return { profile: prof.body, version: pub.body };
  }
  const P = {
    alpha: await publishPolicy('dq-u-alpha-admin', ORACLE.policies.alpha.name, ORACLE.policies.alpha.criteria),
    beta: await publishPolicy('dq-u-beta-admin', ORACLE.policies.beta.name, ORACLE.policies.beta.criteria),
  };
  console.log(`  [DI2] policies: alpha=${P.alpha.error || 'published'} beta=${P.beta.error || 'published'}`);
  const qualify = (who, oppId, body) => api(who, 'POST', `/api/di/opportunities/${oppId}/qualify`, body);
  const resultMap = q => Object.fromEntries((q?.criteria || []).map(c => [c.key, c.result]));

  // ════════════════ A. STRUCTURAL ════════════════
  console.log('\n  --- A. Structural ---');

  await t('DEVOS-DI2-SCHEMA-001', 'A', 'All five DI-2 tables exist via a migration after 007', async () => {
    const missing = [];
    for (const tb of DI2_TABLES) if (!(await tableExists(tb))) missing.push(tb);
    const { rows } = await query(`SELECT version FROM schema_migrations WHERE version >= '008' ORDER BY version`);
    return { pass: !missing.length && rows.length > 0, detail: { missing, migrations: rows.map(r => r.version) } };
  });

  await t('DEVOS-DI2-SCHEMA-002', 'A', 'Every DI-2 table: organization_id NOT NULL + FK to organizations, organization-led index, EF-3 capture trigger', async () => {
    const bad = [];
    for (const tb of DI2_TABLES) {
      if (!(await tableExists(tb))) { bad.push({ tb, absent: true }); continue; }
      const { rows: [c] } = await query(`SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = 'organization_id'`, [tb]);
      const { rows: [fk] } = await query(`SELECT count(*)::int AS n FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
        WHERE k.contype = 'f' AND k.conrelid = to_regclass($1) AND k.confrelid = 'public.organizations'::regclass AND a.attname = 'organization_id'`, [`public.${tb}`]);
      const { rows: [ix] } = await query(`SELECT count(*)::int AS n FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
        WHERE i.indrelid = to_regclass($1) AND a.attname = 'organization_id'`, [`public.${tb}`]);
      const { rows: [tg] } = await query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = to_regclass($1) AND tgname = 'devos_audit_capture'`, [`public.${tb}`]);
      if (!c || c.is_nullable !== 'NO' || !fk.n || !ix.n || !tg.n) bad.push({ tb, nullable: c && c.is_nullable, fk: fk.n, index: ix.n, audit: tg.n });
    }
    return { pass: !bad.length, detail: bad };
  });

  // DB probes run in dq-gamma with dq-beta as the foreign tenant.
  const gProfile = id => [`INSERT INTO di_policy_profiles (id, organization_id, name, is_default, created_by) VALUES ($1,'dq-gamma','probe',FALSE,'probe')`, [id]];
  const bProfile = id => [`INSERT INTO di_policy_profiles (id, organization_id, name, is_default, created_by) VALUES ($1,'dq-beta','probe',FALSE,'probe')`, [id]];
  const version = (id, org, profile, v = 1, state = 'DRAFT') => [`INSERT INTO di_policy_versions (id, organization_id, profile_id, version, state, created_by) VALUES ($1,$2,$3,$4,$5,'probe')`, [id, org, profile, v, state]];
  const criterion = (id, org, ver, key = 'k', kind = 'CONDITION', op = 'eq') => [`INSERT INTO di_policy_criteria (id, organization_id, policy_version_id, position, criterion_key, label, kind, subject, operator, operand)
    VALUES ($1,$2,$3,1,$4,'probe',$5,'site.zoning',$6,'"R1"'::jsonb)`, [id, org, ver, key, kind, op]];
  const fkProbe = (id, title, build) => t(id, 'A', title, () => withOwner(async c => {
    if (!(await tableExists('di_qualifications'))) return { pass: false, detail: 'DI-2 tables absent' };
    const { control, attack } = build();
    const out = await probe(c, [...control, attack]);
    return { pass: out.failedAt === control.length && out.code === '23503', detail: out };
  }));

  await fkProbe('DEVOS-DI2-SCHEMA-003', 'Database rejects a policy version under another tenant\'s profile (23503; same-tenant control accepted)',
    () => ({ control: [gProfile('dq-g-p1'), bProfile('dq-b-p1'), version('dq-g-v1', 'dq-gamma', 'dq-g-p1')], attack: version('dq-g-v2', 'dq-gamma', 'dq-b-p1') }));
  await fkProbe('DEVOS-DI2-SCHEMA-004', 'Database rejects a criterion attached to another tenant\'s policy version',
    () => ({ control: [gProfile('dq-g-p1'), bProfile('dq-b-p1'), version('dq-g-v1', 'dq-gamma', 'dq-g-p1'), version('dq-b-v1', 'dq-beta', 'dq-b-p1'), criterion('dq-g-c1', 'dq-gamma', 'dq-g-v1')],
      attack: criterion('dq-g-c2', 'dq-gamma', 'dq-b-v1') }));
  await fkProbe('DEVOS-DI2-SCHEMA-005', 'Database rejects a candidate attribute on another tenant\'s opportunity',
    () => {
      const attr = (id, opp) => [`INSERT INTO di_candidate_attributes (id, organization_id, opportunity_id, attribute_key, value, value_status, version, source_type, recorded_by)
        VALUES ($1,'dq-gamma',$2,'proposed_units','10'::jsonb,'KNOWN',1,'USER_ENTRY','probe')`, [id, opp]];
      return { control: [[`INSERT INTO di_opportunities (id, organization_id, name, status, source_type, recorded_by) VALUES ('dq-g-opp','dq-gamma','probe','NEW','USER_ENTRY','probe')`], attr('dq-g-a1', 'dq-g-opp')],
        attack: attr('dq-g-a2', 'dq-b-o1') };
    });
  await fkProbe('DEVOS-DI2-SCHEMA-006', 'Database rejects a qualification binding another tenant\'s policy version',
    () => {
      const qual = (id, ver) => [`INSERT INTO di_qualifications (id, organization_id, opportunity_id, policy_version_id, policy_content_hash, as_of, outcome, criteria_results, inputs, evaluated_by)
        VALUES ($1,'dq-gamma','dq-g-opp',$2,'h',now(),'GO','[]'::jsonb,'{}'::jsonb,'probe')`, [id, ver]];
      return { control: [[`INSERT INTO di_opportunities (id, organization_id, name, status, source_type, recorded_by) VALUES ('dq-g-opp','dq-gamma','probe','NEW','USER_ENTRY','probe')`],
        gProfile('dq-g-p1'), bProfile('dq-b-p1'), version('dq-g-v1', 'dq-gamma', 'dq-g-p1', 1, 'PUBLISHED'), version('dq-b-v1', 'dq-beta', 'dq-b-p1', 1, 'PUBLISHED'), qual('dq-g-q1', 'dq-g-v1')],
        attack: qual('dq-g-q2', 'dq-b-v1') };
    });

  await t('DEVOS-DI2-SCHEMA-007', 'A', 'Database allows at most one default profile per organization (23505); another organization\'s default is unaffected', () => withOwner(async c => {
    if (!(await tableExists('di_policy_profiles'))) return { pass: false, detail: 'DI-2 tables absent' };
    const def = (id, org) => [`INSERT INTO di_policy_profiles (id, organization_id, name, is_default, created_by) VALUES ($1,$2,'probe',TRUE,'probe')`, [id, org]];
    const out = await probe(c, [def('dq-g-d1', 'dq-gamma'), def('dq-g-d2', 'dq-gamma')]);
    const other = await probe(c, [def('dq-g-d1', 'dq-gamma'), [`INSERT INTO organizations (id, name) VALUES ('dq-delta','probe')`], def('dq-d-d1', 'dq-delta')]);
    return { pass: out.failedAt === 1 && out.code === '23505' && other.failedAt === -1, detail: { second: out, otherOrg: other } };
  }));

  await t('DEVOS-DI2-SCHEMA-008', 'A', 'Database vocabularies: version state, criterion kind/operator and qualification outcome reject unknown values (23514)', () => withOwner(async c => {
    if (!(await tableExists('di_qualifications'))) return { pass: false, detail: 'DI-2 tables absent' };
    const base = [gProfile('dq-g-p1'), version('dq-g-v1', 'dq-gamma', 'dq-g-p1'),
      [`INSERT INTO di_opportunities (id, organization_id, name, status, source_type, recorded_by) VALUES ('dq-g-opp','dq-gamma','probe','NEW','USER_ENTRY','probe')`]];
    const qual = outcome => [`INSERT INTO di_qualifications (id, organization_id, opportunity_id, policy_version_id, policy_content_hash, as_of, outcome, criteria_results, inputs, evaluated_by)
      VALUES ('dq-g-q','dq-gamma','dq-g-opp','dq-g-v1','h',now(),$1,'[]'::jsonb,'{}'::jsonb,'probe')`, [outcome]];
    const cases = {
      state: [...base.slice(0, 1), version('dq-g-vx', 'dq-gamma', 'dq-g-p1', 2, 'APPROVED')],
      kind: [...base, criterion('dq-g-c', 'dq-gamma', 'dq-g-v1', 'k', 'SOFT')],
      operator: [...base, criterion('dq-g-c', 'dq-gamma', 'dq-g-v1', 'k', 'CONDITION', 'like')],
      outcome: [...base, qual('APPROVED')],
      outcomeControl: [...base, qual('NO_GO')],
    };
    const out = {};
    for (const [k, st] of Object.entries(cases)) { const r = await probe(c, st); out[k] = r.failedAt === -1 ? 'accepted' : r.code; }
    return { pass: ['state', 'kind', 'operator', 'outcome'].every(k => out[k] === '23514') && out.outcomeControl === 'accepted', detail: out };
  }));

  await t('DEVOS-DI2-SCHEMA-009', 'A', 'Published policy content is immutable in the database (criteria insert/update/delete, hash, revert to DRAFT); PUBLISHED → RETIRED allowed', () => withOwner(async c => {
    if (!(await tableExists('di_policy_criteria'))) return { pass: false, detail: 'DI-2 tables absent' };
    const setup = [gProfile('dq-g-p1'), version('dq-g-v1', 'dq-gamma', 'dq-g-p1'), criterion('dq-g-c1', 'dq-gamma', 'dq-g-v1'),
      [`UPDATE di_policy_versions SET state = 'PUBLISHED', content_hash = 'abc', published_by = 'probe', published_at = now() WHERE id = 'dq-g-v1'`]];
    const attacks = {
      insertCriterion: criterion('dq-g-c2', 'dq-gamma', 'dq-g-v1', 'k2'),
      updateCriterion: [`UPDATE di_policy_criteria SET operand = '"R9"'::jsonb WHERE id = 'dq-g-c1'`],
      deleteCriterion: [`DELETE FROM di_policy_criteria WHERE id = 'dq-g-c1'`],
      changeHash: [`UPDATE di_policy_versions SET content_hash = 'forged' WHERE id = 'dq-g-v1'`],
      revertToDraft: [`UPDATE di_policy_versions SET state = 'DRAFT' WHERE id = 'dq-g-v1'`],
    };
    const out = {};
    for (const [k, a] of Object.entries(attacks)) { const r = await probe(c, [...setup, a]); out[k] = r.failedAt === setup.length ? 'rejected' : r.failedAt === -1 ? 'ALLOWED' : `setup failed: ${r.message}`; }
    const retire = await probe(c, [...setup, [`UPDATE di_policy_versions SET state = 'RETIRED', retired_at = now() WHERE id = 'dq-g-v1'`]]);
    return { pass: Object.values(out).every(v => v === 'rejected') && retire.failedAt === -1, detail: { ...out, retire: retire.failedAt === -1 ? 'allowed' : retire.message } };
  }));

  await t('DEVOS-DI2-SCHEMA-010', 'A', 'Qualifications and candidate-attribute versions are append-only for the runtime role (UPDATE/DELETE rejected)', async () => {
    if (!(await tableExists('di_qualifications'))) return { pass: false, detail: 'DI-2 tables absent' };
    await withOwner(async c => {
      await c.query('BEGIN');
      await c.query(`INSERT INTO di_opportunities (id, organization_id, name, status, source_type, recorded_by) VALUES ('dq-g-durable','dq-gamma','durable','NEW','USER_ENTRY','seed')`);
      await c.query(gProfile('dq-g-durable-p')[0], gProfile('dq-g-durable-p')[1]);
      await c.query(version('dq-g-durable-v', 'dq-gamma', 'dq-g-durable-p', 1, 'PUBLISHED')[0], version('dq-g-durable-v', 'dq-gamma', 'dq-g-durable-p', 1, 'PUBLISHED')[1]);
      await c.query(`INSERT INTO di_qualifications (id, organization_id, opportunity_id, policy_version_id, policy_content_hash, as_of, outcome, criteria_results, inputs, evaluated_by)
        VALUES ('dq-g-durable-q','dq-gamma','dq-g-durable','dq-g-durable-v','h',now(),'HOLD','[]'::jsonb,'{}'::jsonb,'seed')`);
      await c.query(`INSERT INTO di_candidate_attributes (id, organization_id, opportunity_id, attribute_key, value, value_status, version, source_type, recorded_by)
        VALUES ('dq-g-durable-a','dq-gamma','dq-g-durable','proposed_units','10'::jsonb,'KNOWN',1,'USER_ENTRY','seed')`);
      await c.query('COMMIT');
    });
    const attempt = sql => withRuntime(async c => { await c.query('BEGIN'); try { const r = await c.query(sql); return r.rowCount ? 'CHANGED' : 'no row'; } catch (e) { return 'rejected'; } finally { await c.query('ROLLBACK').catch(() => {}); } });
    const out = {
      updateQualification: await attempt(`UPDATE di_qualifications SET outcome = 'GO' WHERE id = 'dq-g-durable-q'`),
      deleteQualification: await attempt(`DELETE FROM di_qualifications WHERE id = 'dq-g-durable-q'`),
      updateAttribute: await attempt(`UPDATE di_candidate_attributes SET value = '999'::jsonb WHERE id = 'dq-g-durable-a'`),
      deleteAttribute: await attempt(`DELETE FROM di_candidate_attributes WHERE id = 'dq-g-durable-a'`),
    };
    return { pass: Object.values(out).every(v => v === 'rejected'), detail: out };
  });

  await t('DEVOS-DI2-SCHEMA-011', 'A', 'DI-2 permissions exist and the role mapping matches the matrix exactly (platform-admin none; policy authorship admin-only)', async () => {
    const all = [...new Set(Object.values(MATRIX.rolePermissions).flat())];
    const { rows: perms } = await query('SELECT id FROM permissions WHERE id = ANY($1)', [all]);
    const { rows } = await query('SELECT role_id, permission_id FROM role_permissions WHERE permission_id = ANY($1)', [all]);
    const problems = [];
    if (perms.length !== all.length) problems.push({ missing: all.filter(p => !perms.some(r => r.id === p)) });
    for (const [role, want] of Object.entries(MATRIX.rolePermissions)) {
      const have = rows.filter(r => r.role_id === role).map(r => r.permission_id).sort();
      if (JSON.stringify(have) !== JSON.stringify(want.slice().sort())) problems.push({ role, have, want });
    }
    return { pass: !problems.length, detail: problems };
  });

  await t('DEVOS-DI2-DI1-FROZEN-001', 'A', 'Frozen DI-1 artifacts are byte-identical to the accepted DI-1 release', async () => {
    const changed = Object.entries(DI1_FROZEN).filter(([f, h]) => digest(f) !== h).map(([f]) => f);
    return { pass: !changed.length, detail: { changed } };
  });

  await t('DEVOS-DI2-EF3-FROZEN-001', 'A', 'Frozen EF-3 artifacts are byte-identical to the accepted EF-3 release', async () => {
    const changed = Object.entries(EF3_FROZEN).filter(([f, h]) => digest(f) !== h).map(([f]) => f);
    return { pass: !changed.length, detail: { changed } };
  });

  // ════════════════ B. BEHAVIORAL ════════════════
  console.log('\n  --- B. Behavioral (policies, workbench tenant) ---');
  const W = {};
  const gAdmin = 'dq-u-gamma-admin'; const gDev = 'dq-u-gamma-dev'; const gViewer = 'dq-u-gamma-viewer';
  const C1 = [{ key: 'units_min', label: 'At least 50 units', kind: 'HARD_VETO', subject: 'candidate.proposed_units', operator: 'gte', operand: 50 },
    { key: 'zoning', label: 'Residential zoning', kind: 'CONDITION', subject: 'site.zoning', operator: 'in', operand: ['R3', 'R4'], rationale: 'rezoning otherwise' }];

  await t('DEVOS-DI2-POL-001', 'B', 'Organization admin creates a policy profile; list and direct read return it', async () => {
    const res = await api(gAdmin, 'POST', '/api/di/policies', { name: 'Gamma Policy', description: 'workbench', isDefault: true });
    W.profile = res.body;
    const list = await api(gAdmin, 'GET', '/api/di/policies');
    const get = res.body?.id ? await api(gAdmin, 'GET', `/api/di/policies/${res.body.id}`) : { status: 0 };
    return { pass: res.status === 201 && res.body.organizationId === 'dq-gamma' && res.body.isDefault === true && get.status === 200 &&
      Array.isArray(list.body) && list.body.some(p => p.id === res.body.id), detail: { status: res.status, body: res.body } };
  });

  await t('DEVOS-DI2-POL-002', 'B', 'At most one default profile: marking a second profile default clears the first', async () => {
    if (!W.profile?.id) return { pass: false, detail: 'precondition: profile create failed' };
    const second = await api(gAdmin, 'POST', '/api/di/policies', { name: 'Gamma Alternate', isDefault: false });
    const patch = second.body?.id ? await api(gAdmin, 'PATCH', `/api/di/policies/${second.body.id}`, { isDefault: true }) : { status: 0 };
    const first = await api(gAdmin, 'GET', `/api/di/policies/${W.profile.id}`);
    const back = second.body?.id ? await api(gAdmin, 'PATCH', `/api/di/policies/${W.profile.id}`, { isDefault: true }) : { status: 0 };
    return { pass: second.status === 201 && patch.status === 200 && patch.body?.isDefault === true && first.body?.isDefault === false && back.status === 200,
      detail: { second: second.status, patch: patch.status, firstDefault: first.body?.isDefault } };
  });

  await t('DEVOS-DI2-POL-003', 'B', 'Creating a version yields DRAFT v1 without a content hash; a second concurrent DRAFT is refused (409)', async () => {
    if (!W.profile?.id) return { pass: false, detail: 'precondition: profile create failed' };
    const v = await api(gAdmin, 'POST', `/api/di/policies/${W.profile.id}/versions`, { criteria: C1 });
    W.v1 = v.body;
    const again = await api(gAdmin, 'POST', `/api/di/policies/${W.profile.id}/versions`, { criteria: C1 });
    return { pass: v.status === 201 && v.body.state === 'DRAFT' && v.body.version === 1 && v.body.contentHash === null && v.body.criteria?.length === 2 && again.status === 409,
      detail: { status: v.status, body: v.body, again: again.status } };
  });

  await t('DEVOS-DI2-POL-004', 'B', 'Invalid criteria are rejected (400): kind, subject, operator, operand shape, duplicate key, empty set, missing label, numeric operator with text', async () => {
    if (!W.profile?.id) return { pass: false, detail: 'precondition: profile create failed' };
    const base = { key: 'x', label: 'x', kind: 'CONDITION', subject: 'site.zoning', operator: 'eq', operand: 'R1' };
    const bad = {
      kind: [{ ...base, kind: 'SOFT_VETO' }], subject: [{ ...base, subject: 'site.favourite_color' }], subjectRoot: [{ ...base, subject: 'project.budget' }],
      operator: [{ ...base, operator: 'like' }], betweenShape: [{ ...base, subject: 'site.far', operator: 'between', operand: [5, 1] }],
      inShape: [{ ...base, operator: 'in', operand: 'R1' }], duplicate: [base, { ...base }], empty: [], noLabel: [{ ...base, label: '' }],
      numericText: [{ ...base, subject: 'candidate.proposed_units', operator: 'gte', operand: 'many' }],
    };
    const statuses = {};
    for (const [k, criteria] of Object.entries(bad)) statuses[k] = (await api(gAdmin, 'PUT', `/api/di/policy-versions/${W.v1?.id}`, { criteria })).status;
    const still = W.v1?.id ? await api(gAdmin, 'GET', `/api/di/policy-versions/${W.v1.id}`) : { body: null };
    return { pass: !!W.v1?.id && Object.values(statuses).every(s => s === 400) && still.body?.criteria?.length === 2, detail: statuses };
  });

  await t('DEVOS-DI2-POL-005', 'B', 'Publishing fixes the content hash (contract formula) and author; a published version cannot be edited or re-published (409)', async () => {
    if (!W.v1?.id) return { pass: false, detail: 'precondition: draft missing' };
    const pub = await api(gAdmin, 'POST', `/api/di/policy-versions/${W.v1.id}/publish`);
    const edit = await api(gAdmin, 'PUT', `/api/di/policy-versions/${W.v1.id}`, { criteria: C1.slice(0, 1) });
    const again = await api(gAdmin, 'POST', `/api/di/policy-versions/${W.v1.id}/publish`);
    W.v1 = pub.body || W.v1;
    return { pass: pub.status === 200 && pub.body.state === 'PUBLISHED' && pub.body.contentHash === contentHash(C1) && pub.body.publishedBy === gAdmin && !!pub.body.publishedAt &&
      edit.status === 409 && again.status === 409, detail: { pub: pub.status, hash: pub.body?.contentHash, expected: contentHash(C1), edit: edit.status, again: again.status } };
  });

  await t('DEVOS-DI2-POL-006', 'B', 'Versioning: v2 is created and published alongside v1, v1 stays byte-identical; retiring v1 works once (then 409)', async () => {
    if (!W.profile?.id || W.v1?.state !== 'PUBLISHED') return { pass: false, detail: 'precondition: v1 not published' };
    const C2 = [...C1, { key: 'flood', label: 'No flood zone AE', kind: 'HARD_VETO', subject: 'site.flood_zone', operator: 'neq', operand: 'AE' }];
    const v2 = await api(gAdmin, 'POST', `/api/di/policies/${W.profile.id}/versions`, { criteria: C2 });
    const pub2 = v2.body?.id ? await api(gAdmin, 'POST', `/api/di/policy-versions/${v2.body.id}/publish`) : { status: 0 };
    const v1Now = await api(gAdmin, 'GET', `/api/di/policy-versions/${W.v1.id}`);
    const list = await api(gAdmin, 'GET', `/api/di/policies/${W.profile.id}/versions`);
    const retire = await api(gAdmin, 'POST', `/api/di/policy-versions/${W.v1.id}/retire`);
    const retireAgain = await api(gAdmin, 'POST', `/api/di/policy-versions/${W.v1.id}/retire`);
    W.v2 = pub2.body;
    return { pass: v2.status === 201 && v2.body.version === 2 && pub2.status === 200 && pub2.body.contentHash === contentHash(C2) &&
      v1Now.body?.contentHash === contentHash(C1) && JSON.stringify(v1Now.body?.criteria) === JSON.stringify(W.v1.criteria) &&
      Array.isArray(list.body) && list.body.map(v => v.version).join() === '1,2' && retire.status === 200 && retire.body?.state === 'RETIRED' && retireAgain.status === 409,
      detail: { v2: v2.status, pub2: pub2.status, list: Array.isArray(list.body) && list.body.map(v => [v.version, v.state]), retire: retire.status, retireAgain: retireAgain.status } };
  });

  console.log('\n  --- B. Behavioral (candidate attributes) ---');
  await t('DEVOS-DI2-CAND-001', 'B', 'Candidate attributes persist KNOWN/UNKNOWN/NOT_APPLICABLE with provenance recorded by the caller', async () => {
    const o = await api(gDev, 'POST', '/api/di/opportunities', { name: 'Gamma candidate', concept: { description: 'x' }, provenance: prov() });
    W.opp = o.body;
    if (o.status !== 201) return { pass: false, detail: `precondition: opportunity → ${o.status}` };
    const put = await api(gDev, 'PUT', `/api/di/opportunities/${o.body.id}/candidate-attributes`, { attributes: {
      proposed_units: { value: 80, status: 'KNOWN', provenance: prov('DOCUMENT') },
      product_type: { value: null, status: 'UNKNOWN', provenance: prov() },
      affordable_units: { value: null, status: 'NOT_APPLICABLE', provenance: prov() } } });
    const get = await api(gViewer, 'GET', `/api/di/opportunities/${o.body.id}/candidate-attributes`);
    const a = get.body?.attributes || {};
    return { pass: put.status === 200 && a.proposed_units?.value === 80 && a.proposed_units?.status === 'KNOWN' && a.proposed_units?.version === 1 &&
      a.proposed_units?.provenance?.recordedBy === gDev && a.proposed_units?.provenance?.sourceType === 'DOCUMENT' &&
      a.product_type?.status === 'UNKNOWN' && a.product_type?.value === null && a.affordable_units?.status === 'NOT_APPLICABLE' && !('proposed_stories' in a),
      detail: { put: put.status, attributes: a } };
  });

  await t('DEVOS-DI2-CAND-002', 'B', 'Changing an attribute writes a new version; prior versions remain in history', async () => {
    if (!W.opp?.id) return { pass: false, detail: 'precondition missing' };
    const put = await api(gDev, 'PUT', `/api/di/opportunities/${W.opp.id}/candidate-attributes`, { attributes: { proposed_units: { value: 96, status: 'KNOWN', provenance: prov() } } });
    const hist = await api(gDev, 'GET', `/api/di/opportunities/${W.opp.id}/candidate-attributes/history`);
    const u = (Array.isArray(hist.body) ? hist.body : []).filter(h => h.key === 'proposed_units');
    return { pass: put.status === 200 && put.body?.attributes?.proposed_units?.version === 2 && u.length === 2 && u.some(h => h.value === 80 && h.version === 1) && u.some(h => h.value === 96 && h.version === 2),
      detail: { put: put.status, history: u } };
  });

  await t('DEVOS-DI2-CAND-003', 'B', 'Invalid attributes are rejected (400): unknown key, non-integer or negative units, KNOWN without value, UNKNOWN with value, SYSTEM_DERIVED', async () => {
    if (!W.opp?.id) return { pass: false, detail: 'precondition missing' };
    const sends = {
      unknownKey: { irr_target: { value: 12, status: 'KNOWN', provenance: prov() } },
      nonInteger: { proposed_units: { value: 12.5, status: 'KNOWN', provenance: prov() } },
      text: { proposed_units: { value: 'many', status: 'KNOWN', provenance: prov() } },
      negative: { proposed_units: { value: -3, status: 'KNOWN', provenance: prov() } },
      knownNull: { proposed_stories: { value: null, status: 'KNOWN', provenance: prov() } },
      unknownValue: { proposed_stories: { value: 4, status: 'UNKNOWN', provenance: prov() } },
      system: { proposed_stories: { value: 4, status: 'KNOWN', provenance: prov('SYSTEM_DERIVED') } },
    };
    const statuses = {};
    for (const [k, attributes] of Object.entries(sends)) statuses[k] = (await api(gDev, 'PUT', `/api/di/opportunities/${W.opp.id}/candidate-attributes`, { attributes })).status;
    const get = await api(gDev, 'GET', `/api/di/opportunities/${W.opp.id}/candidate-attributes`);
    return { pass: get.status === 200 && Object.values(statuses).every(s => s === 400) && get.body?.attributes?.proposed_units?.value === 96 && !('proposed_stories' in (get.body?.attributes || {})),
      detail: statuses };
  });

  console.log('\n  --- B. Behavioral (qualification oracle) ---');
  const alphaOracle = ORACLE.opportunities.filter(o => o.tenant === 'dq-alpha' && o.expected && o.expected.outcome);

  await t('DEVOS-DI2-QUAL-001', 'B', 'asOf is required and validated (missing or malformed → 400); a valid asOf succeeds', async () => {
    const none = await qualify('dq-u-alpha-dev', 'dq-a-o1', { dryRun: true });
    const junk = await qualify('dq-u-alpha-dev', 'dq-a-o1', { asOf: 'soon', dryRun: true });
    const ok = await qualify('dq-u-alpha-dev', 'dq-a-o1', { asOf, dryRun: true });
    return { pass: none.status === 400 && junk.status === 400 && ok.status === 200, detail: { none: none.status, junk: junk.status, ok: ok.status } };
  });

  await t('DEVOS-DI2-QUAL-002', 'B', `Alpha oracle: ${alphaOracle.length} opportunities produce the exact expected outcome, per-criterion results, reasons, conditions and Gate 0 report`, async () => {
    const problems = [];
    for (const o of alphaOracle) {
      const r = await qualify('dq-u-alpha-dev', o.id, { asOf, dryRun: true });
      const q = r.body || {};
      const got = resultMap(q);
      if (r.status !== 200) { problems.push(`${o.id}: HTTP ${r.status}`); continue; }
      if (q.outcome !== o.expected.outcome) problems.push(`${o.id}: outcome ${q.outcome} ≠ ${o.expected.outcome}`);
      if (JSON.stringify(got) !== JSON.stringify(o.expected.results)) problems.push(`${o.id}: results ${JSON.stringify(got)}`);
      for (const [k, reason] of Object.entries(o.expected.reasons || {})) {
        const c = (q.criteria || []).find(x => x.key === k);
        if (!c || c.reason !== reason) problems.push(`${o.id}: ${k} reason ${c && c.reason} ≠ ${reason}`);
      }
      if (JSON.stringify((q.conditions || []).slice().sort()) !== JSON.stringify(o.expected.conditions.slice().sort())) problems.push(`${o.id}: conditions ${JSON.stringify(q.conditions)}`);
      if (o.expected.gate0Missing && JSON.stringify(q.gate0?.missing) !== JSON.stringify(o.expected.gate0Missing)) problems.push(`${o.id}: gate0 ${JSON.stringify(q.gate0)}`);
      if (q.authority !== 'POLICY_SCREEN') problems.push(`${o.id}: authority ${q.authority}`);
    }
    return { pass: !problems.length, detail: problems.slice(0, 8) };
  });

  await t('DEVOS-DI2-QUAL-003', 'B', 'Gate 0 lifecycle precondition: an opportunity not READY_FOR_QUALIFICATION cannot be qualified (409) and is unchanged', async () => {
    const own = await qualify('dq-u-alpha-dev', 'dq-a-o1', { asOf, dryRun: true });
    const r = await qualify('dq-u-alpha-dev', 'dq-a-o13', { asOf });
    const opp = await api('dq-u-alpha-dev', 'GET', '/api/di/opportunities/dq-a-o13');
    return { pass: own.status === 200 && r.status === 409 && opp.body?.status === 'SCREENING', detail: { control: own.status, status: r.status, body: r.body } };
  });

  await t('DEVOS-DI2-QUAL-004', 'B', 'asOf selects input versions: the same opportunity is GO at 2025-02-01 (150 units, v1) and NO_GO at 2025-04-01 (90 units, v2)', async () => {
    const o = ORACLE.opportunities.find(x => x.id === 'dq-a-o15');
    const out = [];
    for (const e of o.evaluations) {
      const r = await qualify('dq-u-alpha-dev', o.id, { asOf: e.asOf, dryRun: true });
      const c = (r.body?.criteria || []).find(x => x.key === 'units_min');
      out.push({ asOf: e.asOf, status: r.status, outcome: r.body?.outcome, observed: c?.observed, ok: r.status === 200 && r.body.outcome === e.outcome && c?.result === e.units_min.result &&
        c?.observed?.value === e.units_min.observedValue && c?.observed?.version === e.units_min.observedVersion });
    }
    return { pass: out.every(x => x.ok), detail: out };
  });

  await t('DEVOS-DI2-QUAL-005', 'B', 'Persisted qualification: 201 with id, POLICY_SCREEN authority, pinned version and content hash, evaluator; readable by id and listed', async () => {
    const r = await qualify('dq-u-alpha-dev', 'dq-a-o6', { asOf });
    const get = r.body?.id ? await api('dq-u-alpha-viewer', 'GET', `/api/di/qualifications/${r.body.id}`) : { status: 0 };
    const list = await api('dq-u-alpha-viewer', 'GET', '/api/di/opportunities/dq-a-o6/qualifications');
    W.q1 = r.body;
    return { pass: r.status === 201 && !!r.body.id && r.body.outcome === 'CONDITIONAL_GO' && r.body.authority === 'POLICY_SCREEN' &&
      r.body.policyVersionId === P.alpha.version?.id && r.body.policyContentHash === contentHash(ORACLE.policies.alpha.criteria) && r.body.evaluatedBy === 'dq-u-alpha-dev' &&
      get.status === 200 && JSON.stringify(get.body) === JSON.stringify(r.body) && Array.isArray(list.body) && list.body.some(q => q.id === r.body.id),
      detail: { status: r.status, body: r.body } };
  });

  await t('DEVOS-DI2-QUAL-006', 'B', 'Re-qualifying creates a new record that supersedes the previous one; the previous record is unchanged', async () => {
    if (!W.q1?.id) return { pass: false, detail: 'precondition: first qualification missing' };
    const r = await qualify('dq-u-alpha-admin', 'dq-a-o6', { asOf: '2025-07-01T00:00:00.000Z' });
    const old = await api('dq-u-alpha-viewer', 'GET', `/api/di/qualifications/${W.q1.id}`);
    return { pass: r.status === 201 && r.body.id !== W.q1.id && r.body.supersedes === W.q1.id && JSON.stringify(old.body) === JSON.stringify(W.q1),
      detail: { status: r.status, supersedes: r.body?.supersedes } };
  });

  await t('DEVOS-DI2-QUAL-007', 'B', 'Policy pinning: an explicit published version is honored; the default is the highest PUBLISHED version of the default profile (a newer DRAFT is ignored); a DRAFT version → 409', async () => {
    if (!P.alpha.version?.id) return { pass: false, detail: 'precondition: alpha policy missing' };
    const draft = await api('dq-u-alpha-admin', 'POST', `/api/di/policies/${P.alpha.profile?.id}/versions`, { criteria: ORACLE.policies.alpha.criteria });
    const viaDraft = draft.body?.id ? await qualify('dq-u-alpha-dev', 'dq-a-o1', { asOf, dryRun: true, policyVersionId: draft.body.id }) : { status: 0 };
    const explicit = await qualify('dq-u-alpha-dev', 'dq-a-o1', { asOf, dryRun: true, policyVersionId: P.alpha.version?.id });
    const byDefault = await qualify('dq-u-alpha-dev', 'dq-a-o1', { asOf, dryRun: true });
    return { pass: draft.status === 201 && viaDraft.status === 409 && explicit.status === 200 && explicit.body.policyVersionId === P.alpha.version.id &&
      byDefault.status === 200 && byDefault.body.policyVersionId === P.alpha.version.id,
      detail: { draft: draft.status, viaDraft: viaDraft.status, explicit: explicit.status, byDefault: [byDefault.status, byDefault.body?.policyVersionId] } };
  });

  await t('DEVOS-DI2-QUAL-008', 'B', 'A RETIRED version cannot be used for a new qualification (409)', async () => {
    // Alpha publishes a second profile version, retires its first, then tries to use the retired one.
    const prof = P.alpha.profile?.id;
    if (!prof) return { pass: false, detail: 'precondition: alpha policy missing' };
    const versions = await api('dq-u-alpha-admin', 'GET', `/api/di/policies/${prof}/versions`);
    const draft = (Array.isArray(versions.body) ? versions.body : []).find(v => v.state === 'DRAFT');
    const pub = draft ? await api('dq-u-alpha-admin', 'POST', `/api/di/policy-versions/${draft.id}/publish`) : { status: 0 };
    const retire = await api('dq-u-alpha-admin', 'POST', `/api/di/policy-versions/${P.alpha.version.id}/retire`);
    const viaRetired = await qualify('dq-u-alpha-dev', 'dq-a-o1', { asOf, dryRun: true, policyVersionId: P.alpha.version.id });
    const byDefault = await qualify('dq-u-alpha-dev', 'dq-a-o1', { asOf, dryRun: true });
    return { pass: pub.status === 200 && retire.status === 200 && viaRetired.status === 409 && byDefault.status === 200 && byDefault.body.policyVersionId === pub.body.id && byDefault.body.outcome === 'GO',
      detail: { pub: pub.status, retire: retire.status, viaRetired: viaRetired.status, byDefault: [byDefault.status, byDefault.body?.policyVersion] } };
  });

  await t('DEVOS-DI2-QUAL-009', 'B', 'Qualification never changes the opportunity\'s lifecycle, never creates a Project, and exposes no approval/investment field', async () => {
    const before = (await query('SELECT count(*)::int AS n FROM projects')).rows[0].n;
    const r = await qualify('dq-u-alpha-dev', 'dq-a-o2', { asOf });
    const after = (await query('SELECT count(*)::int AS n FROM projects')).rows[0].n;
    const opp = await api('dq-u-alpha-dev', 'GET', '/api/di/opportunities/dq-a-o2');
    const keys = JSON.stringify(Object.keys(r.body || {}));
    const forbidden = /approv|commit|invest|underwrit|funded|ic_|committee|project/i.test(keys);
    return { pass: r.status === 201 && r.body.outcome === 'NO_GO' && opp.body?.status === 'READY_FOR_QUALIFICATION' && before === after && !forbidden,
      detail: { status: r.status, outcome: r.body?.outcome, oppStatus: opp.body?.status, projects: [before, after], keys } };
  });

  await t('DEVOS-DI2-DETERMINISM-001', 'SENTINEL', 'Same opportunity + policy version + asOf = deep-equal qualification, across calls and users', async () => {
    const a = await qualify('dq-u-alpha-dev', 'dq-a-o7', { asOf, dryRun: true });
    const b = await qualify('dq-u-alpha-admin', 'dq-a-o7', { asOf, dryRun: true });
    const c = await qualify('dq-u-alpha-dev', 'dq-a-o7', { asOf, dryRun: true });
    const n = r => JSON.stringify(r.body);
    return { pass: a.status === 200 && a.body?.outcome === 'HOLD' && n(a) === n(b) && n(a) === n(c), detail: { statuses: [a.status, b.status, c.status], outcome: a.body?.outcome } };
  });

  await t('DEVOS-DI2-TENANT-POLICY-001', 'SENTINEL', 'Policy is tenant configuration, not platform law: identical facts are NO_GO under Alpha\'s policy and GO under Beta\'s', async () => {
    const [ia, ib] = ORACLE.tenantConfigurabilityProof.pair;
    const a = await qualify('dq-u-alpha-dev', ia, { asOf, dryRun: true });
    const b = await qualify('dq-u-beta-dev', ib, { asOf, dryRun: true });
    const bo = ORACLE.opportunities.find(o => o.id === ib);
    return { pass: a.status === 200 && b.status === 200 && a.body.outcome === 'NO_GO' && b.body.outcome === 'GO' && JSON.stringify(resultMap(b.body)) === JSON.stringify(bo.expected.results) &&
      (a.body.criteria || []).find(c => c.key === 'units_min')?.observed?.value === 90 && (b.body.criteria || []).find(c => c.key === 'units_min')?.observed?.value === 90,
      detail: { alpha: [a.status, a.body?.outcome], beta: [b.status, b.body?.outcome] } };
  });

  await t('DEVOS-DI2-INFORMATION-001', 'SENTINEL', 'Missing or unusable information yields INFORMATION_REQUIRED, never NO_GO; every NO_GO cites a failed HARD_VETO on a KNOWN value', async () => {
    const problems = [];
    for (const o of alphaOracle) {
      const r = await qualify('dq-u-alpha-dev', o.id, { asOf, dryRun: true });
      if (r.status !== 200) { problems.push(`${o.id}: HTTP ${r.status}`); continue; }
      const crit = r.body.criteria || [];
      const vetoFails = crit.filter(c => c.kind === 'HARD_VETO' && c.result === 'FAIL');
      if (r.body.outcome === 'NO_GO' && !vetoFails.some(c => c.observed?.status === 'KNOWN')) problems.push(`${o.id}: NO_GO without a known failed veto`);
      if (!vetoFails.length && crit.some(c => c.result === 'UNKNOWN') && r.body.outcome !== 'INFORMATION_REQUIRED') problems.push(`${o.id}: unknown input produced ${r.body.outcome}`);
    }
    const unknownCases = ['dq-a-o8', 'dq-a-o11', 'dq-a-o12'];
    for (const id of unknownCases) {
      const r = await qualify('dq-u-alpha-dev', id, { asOf, dryRun: true });
      if (r.body?.outcome !== 'INFORMATION_REQUIRED') problems.push(`${id}: ${r.body?.outcome}`);
    }
    return { pass: !problems.length, detail: problems };
  });

  await t('DEVOS-DI2-IMMUTABLE-POLICY-001', 'SENTINEL', 'A qualification stays bound to the exact policy content it used, after new versions are published and the old one retired', async () => {
    if (!W.q1?.id) return { pass: false, detail: 'precondition: persisted qualification missing' };
    const q = await api('dq-u-alpha-viewer', 'GET', `/api/di/qualifications/${W.q1.id}`);
    const v = await api('dq-u-alpha-viewer', 'GET', `/api/di/policy-versions/${W.q1.policyVersionId}`);
    return { pass: q.status === 200 && q.body.policyContentHash === contentHash(ORACLE.policies.alpha.criteria) && v.body?.contentHash === q.body.policyContentHash &&
      v.body?.state === 'RETIRED' && JSON.stringify(q.body) === JSON.stringify(W.q1), detail: { q: q.status, versionState: v.body?.state, hash: q.body?.policyContentHash } };
  });

  await t('DEVOS-DI2-NO-PLATFORM-POLICY-001', 'SENTINEL', 'No platform policy: a tenant without a published policy cannot be qualified (409); platform code embeds no tenant thresholds', async () => {
    // The canonical tenant org1 has never authored a policy.
    const org1 = await loginAs('admin@developeros.com');
    const h = { Authorization: `Bearer ${org1.token}` };
    const list = await apiRequest('GET', '/api/di/policies', { headers: h });
    const o = await apiRequest('POST', '/api/di/opportunities', { headers: h, body: { name: 'Policy-less', concept: { description: 'x' }, provenance: prov() } });
    // A READY opportunity, so the 409 can only come from the absent policy.
    await withOwner(c => c.query(`INSERT INTO di_opportunities (id, organization_id, name, status, concept_description, source_type, recorded_by) VALUES ('dq-org1-ready','org1','Ready org1','READY_FOR_QUALIFICATION','x','USER_ENTRY','seed')`));
    const r = await apiRequest('POST', '/api/di/opportunities/dq-org1-ready/qualify', { headers: h, body: { asOf, dryRun: true } });
    // Policy and intelligence code paths (seed data such as demo e-mail addresses is not platform policy).
    const files = ['intelligence', 'routes', 'db/migrations', 'db/repositories', 'middleware'].flatMap(d => {
      const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
      return walk(path.join(ROOT, d)).filter(f => /\.(js|sql|json)$/.test(f));
    });
    const hits = files.filter(f => /\b125\b|\bKG\b|kgdevelopment/i.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(ROOT, f));
    return { pass: list.status === 200 && Array.isArray(list.body) && list.body.length === 0 && o.status === 201 && r.status === 409 && /polic/i.test(JSON.stringify(r.body)) && !hits.length,
      detail: { profiles: list.status === 200 ? list.body.length : list.status, qualify: [r.status, r.body], platformHits: hits } };
  });

  // ════════════════ C. ADVERSARIAL ════════════════
  console.log('\n  --- C. Adversarial ---');

  await t('DEVOS-DI2-ADV-001', 'C', 'Cross-tenant reads are concealed: policies, versions, qualifications and candidate attributes of another tenant → 404 / absent from lists', async () => {
    if (!P.alpha.profile || !W.q1?.id) return { pass: false, detail: 'precondition: alpha policy/qualification missing' };
    const paths = [`/api/di/policies/${P.alpha.profile.id}`, `/api/di/policies/${P.alpha.profile.id}/versions`, `/api/di/policy-versions/${P.alpha.version.id}`,
      `/api/di/qualifications/${W.q1.id}`, '/api/di/opportunities/dq-a-o6/qualifications', '/api/di/opportunities/dq-a-o1/candidate-attributes',
      '/api/di/opportunities/dq-a-o1/candidate-attributes/history'];
    const out = {};
    for (const p of paths) out[p] = (await api('dq-u-beta-admin', 'GET', p)).status;
    const list = await api('dq-u-beta-admin', 'GET', '/api/di/policies');
    const leak = JSON.stringify(list.body || '').includes('dq-alpha') || JSON.stringify(list.body || '').includes(P.alpha.profile.id);
    return { pass: Object.values(out).every(s => s === 404) && list.status === 200 && list.body.length > 0 && !leak, detail: { out, leak } };
  });

  await t('DEVOS-DI2-ADV-002', 'C', 'Cross-tenant mutations → 404 and nothing changes: profile, version edit/publish/retire, candidate attributes', async () => {
    if (!P.alpha.profile) return { pass: false, detail: 'precondition: alpha policy missing' };
    const versions = await api('dq-u-alpha-admin', 'GET', `/api/di/policies/${P.alpha.profile.id}/versions`);
    const anyVersion = Array.isArray(versions.body) ? versions.body[versions.body.length - 1] : null;
    const attempts = {
      patchProfile: (await api('dq-u-beta-admin', 'PATCH', `/api/di/policies/${P.alpha.profile.id}`, { name: 'hijack', isDefault: false })).status,
      newVersion: (await api('dq-u-beta-admin', 'POST', `/api/di/policies/${P.alpha.profile.id}/versions`, { criteria: ORACLE.policies.beta.criteria })).status,
      editVersion: anyVersion ? (await api('dq-u-beta-admin', 'PUT', `/api/di/policy-versions/${anyVersion.id}`, { criteria: ORACLE.policies.beta.criteria })).status : 'none',
      publish: anyVersion ? (await api('dq-u-beta-admin', 'POST', `/api/di/policy-versions/${anyVersion.id}/publish`)).status : 'none',
      retire: anyVersion ? (await api('dq-u-beta-admin', 'POST', `/api/di/policy-versions/${anyVersion.id}/retire`)).status : 'none',
      attributes: (await api('dq-u-beta-dev', 'PUT', '/api/di/opportunities/dq-a-o1/candidate-attributes', { attributes: { proposed_units: { value: 1, status: 'KNOWN', provenance: prov() } } })).status,
    };
    const prof = await api('dq-u-alpha-admin', 'GET', `/api/di/policies/${P.alpha.profile.id}`);
    const attrs = await api('dq-u-alpha-dev', 'GET', '/api/di/opportunities/dq-a-o1/candidate-attributes');
    return { pass: versions.status === 200 && Object.values(attempts).every(s => s === 404) && prof.body?.name === ORACLE.policies.alpha.name && prof.body?.isDefault === true &&
      attrs.body?.attributes?.proposed_units?.value === 150, detail: attempts };
  });

  await t('DEVOS-DI2-ADV-003', 'C', 'Cross-tenant qualification is refused: another tenant\'s policy version or opportunity → 404', async () => {
    if (!P.beta.version) return { pass: false, detail: 'precondition: beta policy missing' };
    const foreignPolicy = await qualify('dq-u-alpha-dev', 'dq-a-o1', { asOf, dryRun: true, policyVersionId: P.beta.version.id });
    const foreignOpp = await qualify('dq-u-beta-dev', 'dq-a-o1', { asOf, dryRun: true });
    const own = await qualify('dq-u-beta-dev', 'dq-b-o1', { asOf, dryRun: true });
    return { pass: own.status === 200 && foreignPolicy.status === 404 && foreignOpp.status === 404, detail: { own: own.status, foreignPolicy: foreignPolicy.status, foreignOpp: foreignOpp.status } };
  });

  await t('DEVOS-DI2-ADV-004', 'C', 'Authority: developers cannot author/publish/retire policy; viewers cannot qualify or edit attributes; both can read', async () => {
    if (!P.alpha.profile) return { pass: false, detail: 'precondition: alpha policy missing' };
    const s = {
      devCreate: (await api('dq-u-alpha-dev', 'POST', '/api/di/policies', { name: 'dev policy' })).status,
      devVersion: (await api('dq-u-alpha-dev', 'POST', `/api/di/policies/${P.alpha.profile.id}/versions`, { criteria: ORACLE.policies.alpha.criteria })).status,
      devPublish: (await api('dq-u-alpha-dev', 'POST', `/api/di/policy-versions/${P.alpha.version.id}/publish`)).status,
      devRetire: (await api('dq-u-alpha-dev', 'POST', `/api/di/policy-versions/${P.alpha.version.id}/retire`)).status,
      viewerQualify: (await qualify('dq-u-alpha-viewer', 'dq-a-o1', { asOf, dryRun: true })).status,
      viewerAttributes: (await api('dq-u-alpha-viewer', 'PUT', '/api/di/opportunities/dq-a-o1/candidate-attributes', { attributes: { proposed_units: { value: 1, status: 'KNOWN', provenance: prov() } } })).status,
      viewerReadPolicies: (await api('dq-u-alpha-viewer', 'GET', '/api/di/policies')).status,
      devReadPolicies: (await api('dq-u-alpha-dev', 'GET', '/api/di/policies')).status,
    };
    return { pass: ['devCreate', 'devVersion', 'devPublish', 'devRetire', 'viewerQualify', 'viewerAttributes'].every(k => s[k] === 403) && s.viewerReadPolicies === 200 && s.devReadPolicies === 200, detail: s };
  });

  await t('DEVOS-DI2-ADV-005', 'C', 'Mass assignment is ignored: a client cannot set outcome, authority, organization or criteria results on qualify, nor state/hash on a version', async () => {
    const r = await qualify('dq-u-alpha-dev', 'dq-a-o2', { asOf, dryRun: true, outcome: 'GO', authority: 'INVESTMENT_COMMITTEE', organizationId: 'dq-beta', criteria: [{ key: 'units_min', result: 'PASS' }] });
    const prof = await api(gAdmin, 'POST', '/api/di/policies', { name: 'Mass probe', organizationId: 'dq-beta', isDefault: false });
    const v = prof.body?.id ? await api(gAdmin, 'POST', `/api/di/policies/${prof.body.id}/versions`, { criteria: C1, state: 'PUBLISHED', contentHash: 'forged', version: 99 }) : { status: 0 };
    return { pass: r.status === 200 && r.body.outcome === 'NO_GO' && r.body.authority === 'POLICY_SCREEN' && r.body.organizationId === 'dq-alpha' &&
      (r.body.criteria || []).find(c => c.key === 'units_min')?.result === 'FAIL' && prof.status === 201 && prof.body.organizationId === 'dq-gamma' &&
      v.status === 201 && v.body.state === 'DRAFT' && v.body.contentHash === null && v.body.version === 1,
      detail: { qualify: [r.status, r.body?.outcome, r.body?.authority], profile: prof.body?.organizationId, version: v.body && [v.body.state, v.body.contentHash, v.body.version] } };
  });

  await t('DEVOS-DI2-ADV-006', 'C', 'Forged organization context → 403; unauthenticated → 401 on every DI-2 endpoint', async () => {
    const own = await api('dq-u-alpha-dev', 'GET', '/api/di/policies');
    const forged = await api('dq-u-alpha-dev', 'GET', '/api/di/policies', undefined, { 'X-Organization-Id': 'dq-beta' });
    const unauth = {};
    for (const e of MATRIX.endpoints) unauth[`${e.method} ${e.path}`] = (await apiRequest(e.method, e.path.replace(/:(\w+)/g, 'x'), { body: e.body })).status;
    return { pass: own.status === 200 && forged.status === 403 && Object.values(unauth).every(s => s === 401), detail: { own: own.status, forged: forged.status, unauth: Object.entries(unauth).filter(([, s]) => s !== 401).slice(0, 6) } };
  });

  // ════════════════ D. INTEGRATION ════════════════
  console.log('\n  --- D. Integration ---');

  await t('DEVOS-DI2-AUTHZ-001', 'D', 'Authorization matrix: viewer and developer get exactly their permitted DI-2 operations (2xx) and 403 otherwise', async () => {
    const prof = await api(gAdmin, 'POST', '/api/di/policies', { name: 'Matrix profile', isDefault: false });
    const ver = prof.body?.id ? await api(gAdmin, 'POST', `/api/di/policies/${prof.body.id}/versions`, { criteria: C1 }) : { body: null };
    const ready = await withOwner(c => c.query(`INSERT INTO di_opportunities (id, organization_id, name, status, concept_description, source_type, recorded_by)
      VALUES ('dq-g-matrix','dq-gamma','Matrix','READY_FOR_QUALIFICATION','x','USER_ENTRY','seed') ON CONFLICT DO NOTHING`).then(() => true).catch(() => false));
    const qual = await qualify(gAdmin, 'dq-g-matrix', { asOf });
    const ids = { profileId: prof.body?.id, versionId: ver.body?.id, opportunityId: 'dq-g-matrix', qualificationId: qual.body?.id };
    if (Object.values(ids).some(v => !v) || !ready) return { pass: false, detail: { precondition: 'workbench resources missing', ids, qual: qual.status } };
    const problems = [];
    for (const [who, role] of [[gViewer, 'viewer'], [gDev, 'developer']]) {
      const di1 = role === 'viewer' ? ['opportunities:read'] : ['opportunities:read', 'opportunities:update'];
      const perms = new Set([...MATRIX.rolePermissions[role], ...di1]);
      for (const e of MATRIX.endpoints) {
        if (e.adminLifecycle) continue; // publish/retire mutate state; covered for admin elsewhere
        const r = await api(who, e.method, e.path.replace(/:(\w+)/g, (_, k) => ids[k]), e.body);
        const allowed = perms.has(e.permission);
        if (allowed ? !(r.status >= 200 && r.status < 300) : r.status !== 403) problems.push(`${role} ${e.method} ${e.path} → ${r.status} (expected ${allowed ? '2xx' : 403})`);
      }
    }
    return { pass: !problems.length, detail: problems.slice(0, 10) };
  });

  await t('DEVOS-DI2-AUDIT-001', 'SENTINEL', 'EF-3 captures policy authorship, publication, retirement, candidate attributes and qualifications with actor and organization', async () => {
    const { rows } = await query(`SELECT entity_type, action, actor_user_id FROM audit_events WHERE organization_id = 'dq-alpha'
      AND actor_user_id IN ('dq-u-alpha-admin','dq-u-alpha-dev')`);
    const has = (e, a, actor) => rows.some(r => r.entity_type === e && r.action === a && (!actor || r.actor_user_id === actor));
    const required = {
      'profile created': has('di_policy_profiles', 'INSERT', 'dq-u-alpha-admin'),
      'criteria written': has('di_policy_criteria', 'INSERT', 'dq-u-alpha-admin'),
      'version published/retired': has('di_policy_versions', 'UPDATE', 'dq-u-alpha-admin'),
      'qualification recorded': has('di_qualifications', 'INSERT', 'dq-u-alpha-dev'),
    };
    const { rows: g } = await query(`SELECT 1 FROM audit_events WHERE organization_id = 'dq-gamma' AND entity_type = 'di_candidate_attributes' AND action = 'INSERT' AND actor_user_id = 'dq-u-gamma-dev' LIMIT 1`);
    required['candidate attribute recorded'] = g.length === 1;
    return { pass: Object.values(required).every(Boolean), detail: required };
  });

  await t('DEVOS-DI2-AUDIT-002', 'D', 'EF-3 chains of every DI-2 tenant verify cryptographically after all DI-2 activity', async () => {
    const out = {};
    for (const [who, org] of [['dq-u-alpha-admin', 'dq-alpha'], ['dq-u-beta-admin', 'dq-beta'], [gAdmin, 'dq-gamma']]) {
      const r = await api(who, 'GET', '/api/audit/verify');
      out[org] = { status: r.status, valid: r.body?.valid, failure: r.body?.failure?.reason || null };
    }
    return { pass: Object.values(out).every(o => o.status === 200 && o.valid === true), detail: out };
  });

  await t('DEVOS-DI2-BOUNDARY-001', 'D', 'Phase boundary guard: no promotion, underwriting, investment-committee or auto-decline surface exists', async () => {
    const probes = {
      promote: (await api('dq-u-alpha-admin', 'POST', '/api/di/opportunities/dq-a-o1/promote', {})).status,
      underwriting: (await api('dq-u-alpha-admin', 'GET', '/api/di/underwriting')).status,
      committee: (await api('dq-u-alpha-admin', 'POST', '/api/di/qualifications/x/approve', {})).status,
      override: (await api('dq-u-alpha-admin', 'POST', '/api/di/qualifications/x/override', {})).status,
    };
    const opp = await api('dq-u-alpha-dev', 'GET', '/api/di/opportunities/dq-a-o2');
    return { pass: Object.values(probes).every(s => s === 404) && opp.status === 200 && opp.body.status === 'READY_FOR_QUALIFICATION', detail: { probes, oppStatus: opp.body?.status } };
  });

  const passedCount = results.filter(r => r.passed).length;
  const redCount = results.length - passedCount;
  console.log(`\nDEVOS-DI-2 ACCEPTANCE: ${passedCount} GREEN, ${redCount} RED (Total: ${results.length})`);
  return { passedCount, redCount, total: results.length, results, fixture };
}

module.exports = { runDI2AcceptanceSuite };
