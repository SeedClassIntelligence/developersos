// ══════════════════════════════════════════════════════════════
// tests/test-env.js — Test database isolation & role separation
// MUST be required before db/pool, db/seed or server.
//
// From the configured owner URL (MIGRATION_DATABASE_URL, or a legacy
// DATABASE_URL that holds owner credentials) it derives:
//   ADMIN_DATABASE_URL      owner credentials on the "postgres" maintenance DB
//                           (creates/drops the test database only)
//   MIGRATION_DATABASE_URL  owner credentials on "<db>_test" (migrations, seed)
//   DATABASE_URL            dedicated runtime role on "<db>_test" (the API and
//                           all runtime-path tests), provisioned by migrations
//
// The test database is dropped and recreated once per process, so every gate
// run proves: empty database → migrations → seed → full gate.
// ══════════════════════════════════════════════════════════════

require('dotenv').config();
const crypto = require('crypto');

if (process.env.DEVOS_TEST_ENV !== 'ready') {
  const ownerSource = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!ownerSource) {
    throw new Error('MIGRATION_DATABASE_URL (or a legacy owner DATABASE_URL) must be set in .env to run tests.');
  }
  const owner = new URL(ownerSource);
  const base = decodeURIComponent(owner.pathname.replace(/^\//, '')) || 'postgres';
  const testName = base.endsWith('_test') ? base : `${base}_test`;

  // Admin connection targets the "postgres" maintenance DB, which exists on
  // every cluster — the application DB may not exist yet on a fresh one.
  const admin = new URL(owner);
  admin.pathname = '/postgres';
  owner.pathname = `/${testName}`;

  const runtime = new URL(owner);
  runtime.username = process.env.TEST_RUNTIME_DB_USER || 'devos_app_test';
  runtime.password = crypto.randomBytes(24).toString('hex');

  process.env.ADMIN_DATABASE_URL = admin.toString();
  process.env.MIGRATION_DATABASE_URL = owner.toString();
  process.env.DATABASE_URL = runtime.toString();
  process.env.DEVOS_SYNC_RUNTIME_PASSWORD = 'true';
  process.env.DEVOS_TEST_ENV = 'ready';
}

process.env.TEST_MODE = 'true';

// Ephemeral checkpoint signing key for the test process (never persisted).
if (!process.env.AUDIT_SIGNING_KEY) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  process.env.AUDIT_SIGNING_KEY = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
}

const bootstrap = { recreated: false, tablesAtCreation: null, database: null };
let prepared = null;

async function recreateTestDatabase() {
  const { ensurePostgresRunning } = require('../db/pg-engine');
  await ensurePostgresRunning();
  const { Client } = require('pg');
  const testName = decodeURIComponent(new URL(process.env.MIGRATION_DATABASE_URL).pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(testName)) {
    throw new Error(`Refusing to use non-test database "${testName}" for tests.`);
  }
  bootstrap.database = testName;

  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    if (process.env.DEVOS_REUSE_TEST_DB === 'true') {
      const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [testName]);
      if (rowCount === 0) await admin.query(`CREATE DATABASE "${testName}"`);
    } else {
      await admin.query(`DROP DATABASE IF EXISTS "${testName}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${testName}"`);
      bootstrap.recreated = true;
      console.log(`[TEST-ENV] Recreated empty test database "${testName}"`);
    }
  } finally {
    await admin.end();
  }

  const probe = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await probe.connect();
  try {
    const { rows: [r] } = await probe.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
    bootstrap.tablesAtCreation = r.n;
  } finally {
    await probe.end();
  }
}

// Idempotent per process: the first suite recreates the database, later
// suites in the same gate run reuse it (the seeder resets business data).
async function ensureTestDatabase() {
  if (!prepared) prepared = recreateTestDatabase();
  return prepared;
}

module.exports = { ensureTestDatabase, bootstrap };
