// ══════════════════════════════════════════════════════════════
// DEVOS-CLEAN-DB GATE — empty database → migrations → seed → gate
//
// Runs first in the master gate. Proves the harness bootstraps from an empty
// PostgreSQL database with no manual preparation, and that the bootstrap
// produces the role separation the ledger depends on.
// ══════════════════════════════════════════════════════════════

const { ensureTestDatabase, bootstrap } = require('./test-env');
const { getCanonicalFixture } = require('./helpers');

async function runCleanDatabaseGate() {
  console.log('\n===============================================================');
  console.log('RUNNING SUITE: DEVOS-CLEAN-DB GATE (empty database bootstrap)');
  console.log('===============================================================\n');
  const results = [];
  const record = (id, description, passed, detail = '') => {
    results.push({ id, description, passed });
    console.log(`  ${passed ? '[PASS]' : '[FAIL]'} ${id} - ${description}${!passed && detail ? ` : ${detail}` : ''}`);
  };

  await ensureTestDatabase();
  record('DEVOS-CLEANDB-001', 'Test database was dropped and recreated empty by this gate run',
    bootstrap.recreated === true && bootstrap.tablesAtCreation === 0,
    JSON.stringify(bootstrap));

  const { seedDatabase } = require('../db/seed');
  const { migrationFiles } = require('../db/migrate');
  let seedError = null;
  try { await seedDatabase(); } catch (err) { seedError = err.message; }
  record('DEVOS-CLEANDB-002', 'Migrations and canonical seed complete on the empty database without manual steps', !seedError, seedError);

  const { query } = require('../db/pool');
  const { rows: applied } = await query('SELECT version FROM schema_migrations ORDER BY version');
  const files = migrationFiles();
  record('DEVOS-CLEANDB-003', `All ${files.length} migrations are recorded as applied`,
    applied.length === files.length && applied.every((r, i) => r.version === files[i]), JSON.stringify(applied.map(r => r.version)));

  const { rows: [role] } = await query(`SELECT current_user AS role, rolsuper FROM pg_roles WHERE rolname = current_user`);
  const migrationUser = decodeURIComponent(new URL(process.env.MIGRATION_DATABASE_URL).username);
  record('DEVOS-CLEANDB-004', 'Runtime connections use the provisioned non-superuser runtime role, distinct from the migration role',
    !role.rolsuper && role.role !== migrationUser, JSON.stringify({ runtime: role.role, migration: migrationUser }));

  const fixture = getCanonicalFixture();
  const { rows: [counts] } = await query(`SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM projects) AS projects`);
  record('DEVOS-CLEANDB-005', 'Canonical fixture is fully present after bootstrap',
    counts.users === fixture.users.length && counts.projects === fixture.projects.length, JSON.stringify(counts));

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;
  console.log(`\nDEVOS-CLEAN-DB GATE SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (Total: ${results.length})`);
  return { passedCount, failedCount, total: results.length, results };
}

module.exports = { runCleanDatabaseGate };
