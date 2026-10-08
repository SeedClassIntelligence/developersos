// ══════════════════════════════════════════════════════════════
// DEVOS-DI1-D1 — execution Partner tenant integrity (database boundary)
//
// DI1-D1 (P1): tasks.partner_id and contracts.partner_id accepted another
// organization's partner inside PostgreSQL; only the API refused it. These
// permanent tests attack the relational boundary directly, as the actual
// runtime role, and require PostgreSQL's foreign-key integrity error
// (SQLSTATE 23503). Each probe runs a same-tenant control first in the same
// transaction and is always rolled back. The API-level 404 for the same
// attack remains covered by DEVOS-DI1-ADV-EXECREF-001 and
// DEVOS-DI1-TENANT-PARTNER-001.
// ══════════════════════════════════════════════════════════════

const { startTestServer } = require('./helpers');
const { getPool } = require('../db/pool');
const EF2_FIXTURE = require('./fixtures/ef2-security-fixture.json');

// Rolled-back probe as the runtime role: setup statements must succeed, the
// control must succeed, then the attack must fail with `expectCode`.
async function probe(setup, control, attack) {
  const client = await (await getPool()).connect();
  try {
    await client.query('BEGIN');
    for (const [sql, params] of setup) await client.query(sql, params);
    for (const [sql, params] of control) await client.query(sql, params);
    await client.query('SAVEPOINT attack');
    try {
      await client.query(attack[0], attack[1]);
      return { controlOk: true, rejected: false };
    } catch (err) {
      return { controlOk: true, rejected: true, code: err.code, constraint: err.constraint || null, message: err.message };
    }
  } catch (err) {
    return { controlOk: false, setupError: `${err.code} ${err.message}` };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

// Two tenants with one project and one partner each, created inside the probe.
const TENANTS = [
  [`INSERT INTO organizations (id, name) VALUES ('d1-org-a', 'D1 Tenant A'), ('d1-org-b', 'D1 Tenant B')`],
  [`INSERT INTO projects (id, organization_id, name) VALUES ('d1-proj-a', 'd1-org-a', 'D1 A project'), ('d1-proj-b', 'd1-org-b', 'D1 B project')`],
  [`INSERT INTO partners (id, org_id, name, role) VALUES ('d1-partner-a', 'd1-org-a', 'D1 A partner', 'civil'), ('d1-partner-b', 'd1-org-b', 'D1 B partner', 'civil')`],
];

async function runDI1D1Suite() {
  console.log('\n===============================================================');
  console.log('RUNNING SUITE: DEVOS-DI1-D1 (execution Partner tenant integrity)');
  console.log('===============================================================\n');
  await startTestServer(3005, true);
  const results = [];
  const record = (id, title, passed, detail) => {
    results.push({ id, title, passed });
    console.log(`  ${passed ? '[PASS]' : '[FAIL]'} ${id} — ${title}${passed ? '' : ` :: ${JSON.stringify(detail).slice(0, 400)}`}`);
  };
  const fk = r => r.controlOk && r.rejected && r.code === '23503';

  {
    const r = await probe(TENANTS,
      [[`INSERT INTO tasks (id, project_id, title, partner_id) VALUES ('d1-t-ok', 'd1-proj-a', 'own partner', 'd1-partner-a')`]],
      [`INSERT INTO tasks (id, project_id, title, partner_id) VALUES ('d1-t-x', 'd1-proj-a', 'foreign partner', 'd1-partner-b')`]);
    record('DEVOS-DI1-D1-DB-TASK-001', 'Direct SQL: a task cannot reference another organization\'s partner (23503); same-tenant partner accepted', fk(r), r);
  }
  {
    const r = await probe(TENANTS,
      [[`INSERT INTO contracts (id, project_id, partner_id, type) VALUES ('d1-c-ok', 'd1-proj-a', 'd1-partner-a', 'Survey')`]],
      [`INSERT INTO contracts (id, project_id, partner_id, type) VALUES ('d1-c-x', 'd1-proj-a', 'd1-partner-b', 'Survey')`]);
    record('DEVOS-DI1-D1-DB-CONTRACT-001', 'Direct SQL: a contract cannot reference another organization\'s partner (23503); same-tenant partner accepted', fk(r), r);
  }
  {
    const r = await probe([...TENANTS,
      [`INSERT INTO tasks (id, project_id, title, partner_id) VALUES ('d1-t-u', 'd1-proj-a', 'retarget me', 'd1-partner-a')`],
      [`INSERT INTO contracts (id, project_id, partner_id, type) VALUES ('d1-c-u', 'd1-proj-a', 'd1-partner-a', 'Survey')`]],
      [[`UPDATE tasks SET partner_id = NULL WHERE id = 'd1-t-u'`], [`UPDATE tasks SET partner_id = 'd1-partner-a' WHERE id = 'd1-t-u'`]],
      [`UPDATE tasks SET partner_id = 'd1-partner-b' WHERE id = 'd1-t-u'`]);
    const r2 = await probe([...TENANTS,
      [`INSERT INTO contracts (id, project_id, partner_id, type) VALUES ('d1-c-u', 'd1-proj-a', 'd1-partner-a', 'Survey')`]],
      [[`UPDATE contracts SET partner_id = 'd1-partner-a' WHERE id = 'd1-c-u'`]],
      [`UPDATE contracts SET partner_id = 'd1-partner-b' WHERE id = 'd1-c-u'`]);
    record('DEVOS-DI1-D1-DB-UPDATE-001', 'Direct SQL: re-pointing an existing task or contract at a foreign partner is rejected (23503)', fk(r) && fk(r2), { task: r, contract: r2 });
  }
  {
    // Forging the derived tenant column to match the foreign partner must fail on the project side.
    const r = await probe(TENANTS,
      [[`INSERT INTO tasks (id, project_id, title, partner_id) VALUES ('d1-t-ok2', 'd1-proj-a', 'own partner', 'd1-partner-a')`]],
      [`INSERT INTO tasks (id, project_id, title, partner_id, organization_id) VALUES ('d1-t-f', 'd1-proj-a', 'forged tenant', 'd1-partner-b', 'd1-org-b')`]);
    const r2 = await probe(TENANTS,
      [[`INSERT INTO contracts (id, project_id, partner_id, type) VALUES ('d1-c-ok2', 'd1-proj-a', 'd1-partner-a', 'Survey')`]],
      [`INSERT INTO contracts (id, project_id, partner_id, type, organization_id) VALUES ('d1-c-f', 'd1-proj-a', 'd1-partner-b', 'Survey', 'd1-org-b')`]);
    record('DEVOS-DI1-D1-DB-FORGE-001', 'Direct SQL: forging the row\'s tenant to match a foreign partner is rejected by the project ownership key (23503)', fk(r) && fk(r2), { task: r, contract: r2 });
  }
  {
    // Moving a project to another organization must not strand its rows on the old tenant's partner.
    const r = await probe([...TENANTS,
      [`INSERT INTO tasks (id, project_id, title, partner_id) VALUES ('d1-t-m', 'd1-proj-a', 'anchored', 'd1-partner-a')`]],
      [[`UPDATE projects SET name = 'D1 A project renamed' WHERE id = 'd1-proj-a'`]],
      [`UPDATE projects SET organization_id = 'd1-org-b' WHERE id = 'd1-proj-a'`]);
    record('DEVOS-DI1-D1-DB-MOVE-001', 'Direct SQL: moving a project to another organization while its tasks use the old tenant\'s partner is rejected (23503)', fk(r), r);
  }
  {
    const resB = EF2_FIXTURE.tenantBResources;
    const partner = resB.partner;
    const ok = !!partner && partner.organizationId === resB.project.organizationId && resB.contract.partnerId === partner.id;
    record('DEVOS-DI1-D1-EF2-FIXTURE-001', 'EF-2 Tenant B contract references a Tenant B partner (corrected fixture)', ok,
      { contractPartner: resB.contract.partnerId, fixturePartner: partner || null, projectOrg: resB.project.organizationId });
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;
  console.log(`\nDEVOS-DI1-D1 SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (Total: ${results.length})`);
  return { passedCount, failedCount, total: results.length, results };
}

module.exports = { runDI1D1Suite };
