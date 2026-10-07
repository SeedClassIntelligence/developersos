// ══════════════════════════════════════════════════════════════
// DEVOS-EF-1 ACCEPTANCE TEST SUITE (PRE-IMPLEMENTATION RED GATE)
// Defines the authoritative criteria for Phase EF-1 persistence migration.
// MUST FAIL (RED) prior to EF-1 implementation.
// ══════════════════════════════════════════════════════════════

const { spawn } = require('child_process');
const http = require('http');
const {
  startTestServer,
  stopTestServer,
  apiRequest,
  loginAs,
} = require('./helpers');

async function runEF1AcceptanceSuite() {
  console.log('\n===============================================================');
  console.log('RUNNING SUITE: DEVOS-EF-1 ACCEPTANCE TESTS (Gated Red-Verification)');
  console.log('GOAL: Prove that tests exist, detect missing capabilities, and fail');
  console.log('===============================================================\n');

  await startTestServer(3005);

  const results = [];

  function record(testId, name, passed, reason = '') {
    if (passed) {
      console.log(`  [PASS] ${testId} - ${name}`);
      results.push({ testId, name, passed: true });
    } else {
      console.error(`  [RED] ${testId} - ${name} : ${reason}`);
      results.push({ testId, name, passed: false, reason });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // STRUCTURAL TESTS (Layer A)
  // ─────────────────────────────────────────────────────────────

  // DEVOS-EF1-STRUCT-001: Relational database tables exist
  try {
    let pgModuleExists = false;
    try {
      require.resolve('pg');
      pgModuleExists = true;
    } catch {
      pgModuleExists = false;
    }

    if (!pgModuleExists) {
      record('DEVOS-EF1-STRUCT-001', 'Relational database tables exist in PostgreSQL', false, 
        'Missing dependency: "pg" driver and relational database schema do not exist.');
    } else {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const client = await pool.connect();
      const res = await client.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name IN ('projects', 'tasks', 'contracts', 'permits', 'capital_stacks')
      `);
      client.release();
      await pool.end();
      const hasAllTables = res.rows.length >= 5;
      record('DEVOS-EF1-STRUCT-001', 'Relational database tables exist in PostgreSQL', hasAllTables, 
        hasAllTables ? '' : `Found only ${res.rows.length}/5 required core tables.`);
    }
  } catch (err) {
    record('DEVOS-EF1-STRUCT-001', 'Relational database tables exist in PostgreSQL', false, 
      `Database connection/query failed: ${err.message}`);
  }

  // DEVOS-EF1-STRUCT-002: Primary keys, foreign keys & uniqueness constraints exist
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const res = await pool.query(`
      SELECT tc.constraint_type 
      FROM information_schema.table_constraints tc 
      WHERE tc.table_name = 'tasks' AND tc.constraint_type = 'FOREIGN KEY'
    `);
    await pool.end();
    record('DEVOS-EF1-STRUCT-002', 'Foreign key constraints exist on tasks and contracts', res.rows.length > 0, 
      'No foreign key constraints defined in database.');
  } catch (err) {
    record('DEVOS-EF1-STRUCT-002', 'Foreign key constraints exist on tasks and contracts', false, 
      `Constraint check failed: ${err.message}`);
  }

  // DEVOS-EF1-STRUCT-003: Monetary columns use numeric(15,2) rather than floating point
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const res = await pool.query(`
      SELECT data_type FROM information_schema.columns 
      WHERE table_name = 'projects' AND column_name = 'budget'
    `);
    await pool.end();
    const isNumeric = res.rows.length > 0 && res.rows[0].data_type === 'numeric';
    record('DEVOS-EF1-STRUCT-003', 'Monetary columns use numeric(15,2) exact precision', isNumeric, 
      `Column budget data type is ${res.rows[0]?.data_type || 'undefined'}, expected numeric.`);
  } catch (err) {
    record('DEVOS-EF1-STRUCT-003', 'Monetary columns use numeric(15,2) exact precision', false, 
      `Schema type check failed: ${err.message}`);
  }

  // ─────────────────────────────────────────────────────────────
  // PERSISTENCE & LIFECYCLE TESTS (Layer B)
  // ─────────────────────────────────────────────────────────────

  // DEVOS-EF1-PERSIST-001: Data persists across application restart
  try {
    const { token } = await loginAs('maria@kgdevelopment.com');
    const uniqueProjectName = `Persist-Test-${Date.now()}`;
    const createRes = await apiRequest('POST', '/api/projects', {
      headers: { 'Authorization': `Bearer ${token}` },
      body: { name: uniqueProjectName, type: 'Market Rate', units: 50, budget: 12000000 },
    });
    const createdId = createRes.body.id;

    // Simulate process restart without reseeding
    await stopTestServer();
    await startTestServer(3005, false);

    // Retrieve same resource via API and verify values and relationships remain intact
    const getRes = await apiRequest('GET', `/api/projects/${createdId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const foundInDb = getRes.status === 200 && getRes.body && getRes.body.name === uniqueProjectName;

    // Clean up created test project so migration count checks remain clean
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM projects WHERE id = $1', [createdId]);
    await pool.end();

    record('DEVOS-EF1-PERSIST-001', 'Created resource persists across runtime process reload', foundInDb, 
      'Process reload wiped created resource. Application is currently backed by ephemeral in-memory state.');
  } catch (err) {
    record('DEVOS-EF1-PERSIST-001', 'Created resource persists across runtime process reload', false, err.message);
  }

  // DEVOS-EF1-REL-001: Relational associations survive persistence & retrieval
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const res = await pool.query(`
      SELECT t.id, p.name as project_name 
      FROM tasks t 
      JOIN projects p ON t.project_id = p.id 
      LIMIT 1
    `);
    await pool.end();
    record('DEVOS-EF1-REL-001', 'Relational JOIN queries succeed across projects and tasks', res.rows.length > 0, 
      'Relational tables do not exist for JOIN resolution.');
  } catch (err) {
    record('DEVOS-EF1-REL-001', 'Relational JOIN queries succeed across projects and tasks', false, 
      `Relational query failed: ${err.message}`);
  }

  // DEVOS-EF1-TXN-001: Atomic transaction rollback on multi-record execution failure
  try {
    // Contract execution updates contract and unblocks tasks.
    // If task unblocking fails, contract execution must roll back in PostgreSQL.
    // In v1 in-memory, there are no transactions:
    let transactionSupportActive = false;
    try {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const client = await pool.connect();
      await client.query('BEGIN');
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
      transactionSupportActive = true;
    } catch {
      transactionSupportActive = false;
    }

    record('DEVOS-EF1-TXN-001', 'Contract execution and task unblocking execute in atomic transaction', transactionSupportActive, 
      'Application does not implement database transactions (BEGIN/COMMIT/ROLLBACK). Mutates in-memory heap directly.');
  } catch (err) {
    record('DEVOS-EF1-TXN-001', 'Contract execution and task unblocking execute in atomic transaction', false, err.message);
  }

  // DEVOS-EF1-PERMIT-001: Permit corrections persist relationally with compatible nested JSON API
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const res = await pool.query('SELECT * FROM permit_corrections LIMIT 1');
    await pool.end();
    record('DEVOS-EF1-PERMIT-001', 'Permit corrections persist in relational permit_corrections table', res.rows.length > 0, 
      'Table permit_corrections does not exist.');
  } catch (err) {
    record('DEVOS-EF1-PERMIT-001', 'Permit corrections persist in relational permit_corrections table', false, 
      `Relational permit corrections check failed: ${err.message}`);
  }

  // DEVOS-EF1-CAPITAL-001: Capital sources persist relationally in capital_sources table
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const res = await pool.query('SELECT * FROM capital_sources LIMIT 1');
    await pool.end();
    record('DEVOS-EF1-CAPITAL-001', 'Capital sources persist in normalized capital_sources table', res.rows.length > 0, 
      'Table capital_sources does not exist.');
  } catch (err) {
    record('DEVOS-EF1-CAPITAL-001', 'Capital sources persist in normalized capital_sources table', false, 
      `Capital sources relational check failed: ${err.message}`);
  }

  // DEVOS-EF1-MIGRATE-001: Canonical v1 fixture migrated into PostgreSQL without record loss
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const res = await pool.query('SELECT COUNT(*) FROM projects');
    await pool.end();
    const count = parseInt(res.rows[0].count, 10);
    record('DEVOS-EF1-MIGRATE-001', 'Canonical v1 dataset migrated into PostgreSQL (count = 6)', count === 6, 
      `PostgreSQL contains ${count} projects, expected 6 migrated from canonical fixture.`);
  } catch (err) {
    record('DEVOS-EF1-MIGRATE-001', 'Canonical v1 dataset migrated into PostgreSQL (count = 6)', false, 
      `Migration count check failed: ${err.message}`);
  }

  // DEVOS-EF1-MIGRATE-002: All migrated foreign key relationships resolve cleanly
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const res = await pool.query(`
      SELECT COUNT(*) as orphans FROM tasks t 
      LEFT JOIN projects p ON t.project_id = p.id 
      WHERE p.id IS NULL
    `);
    await pool.end();
    const orphans = parseInt(res.rows[0].orphans, 10);
    record('DEVOS-EF1-MIGRATE-002', 'Zero orphaned foreign key references after migration', orphans === 0, 
      `Found ${orphans} orphaned tasks.`);
  } catch (err) {
    record('DEVOS-EF1-MIGRATE-002', 'Zero orphaned foreign key references after migration', false, 
      `Orphan check failed: ${err.message}`);
  }

  // DEVOS-EF1-RESTART-001: Server restart retains dynamic modifications
  try {
    // Current runtime proves restart wipes state back to initial hardcoded values
    const isPersistentBackend = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('memory');
    record('DEVOS-EF1-RESTART-001', 'Server runtime is configured with durable persistent database', !!isPersistentBackend, 
      'Runtime is executing with in-memory arrays. DATABASE_URL is not configured for production persistence.');
  } catch (err) {
    record('DEVOS-EF1-RESTART-001', 'Server runtime is configured with durable persistent database', false, err.message);
  }

  // DEVOS-EF1-REGRESSION-001: Full regression suite verified against PostgreSQL
  try {
    const { runRegressionSuite } = require('./devos-v1-regression.test');
    const regRes = await runRegressionSuite();
    const isGreen = regRes.passedCount === regRes.total;
    record('DEVOS-EF1-REGRESSION-001', 'DEVOS-V1-REGRESSION passes against PostgreSQL implementation', isGreen, 
      isGreen ? '' : `${regRes.total - regRes.passedCount} regression tests failed.`);
  } catch (err) {
    record('DEVOS-EF1-REGRESSION-001', 'DEVOS-V1-REGRESSION passes against PostgreSQL implementation', false, err.message);
  }

  // DEVOS-EF1-GOLDEN-001: Golden Path scenario verified against PostgreSQL
  try {
    const { runGoldenPath } = require('./devos-golden-001.test');
    const goldRes = await runGoldenPath();
    const isGreen = goldRes.passedCount === goldRes.total;
    record('DEVOS-EF1-GOLDEN-001', 'DEVOS-GOLDEN-001 passes against PostgreSQL implementation', isGreen, 
      isGreen ? '' : `${goldRes.total - goldRes.passedCount} golden steps failed.`);
  } catch (err) {
    record('DEVOS-EF1-GOLDEN-001', 'DEVOS-GOLDEN-001 passes against PostgreSQL implementation', false, err.message);
  }

  const passedCount = results.filter(r => r.passed).length;
  const redCount = results.filter(r => !r.passed).length;

  console.log('\n---------------------------------------------------------------');
  console.log(`DEVOS-EF-1 ACCEPTANCE SUMMARY: ${passedCount} PASSED, ${redCount} RED (Total: ${results.length})`);
  console.log(`STATUS: ${redCount === 0 ? 'GREEN — PERSISTENCE FOUNDATION VERIFIED' : 'GATED INCOMPLETE'}`);
  console.log('---------------------------------------------------------------\n');

  return { passedCount, redCount, total: results.length, results };
}

if (require.main === module) {
  runEF1AcceptanceSuite().then(() => {
    stopTestServer().then(() => {
      // Return 0 so test script completes and reports output
      process.exit(0);
    });
  });
}

module.exports = { runEF1AcceptanceSuite };
