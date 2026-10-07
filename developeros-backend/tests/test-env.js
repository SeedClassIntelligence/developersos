// ══════════════════════════════════════════════════════════════
// tests/test-env.js — Test database isolation
// MUST be required before db/pool, db/seed or server.
// Redirects DATABASE_URL to a dedicated "<db>_test" database so the
// destructive fixture seeder can never touch the application database.
// ══════════════════════════════════════════════════════════════

require('dotenv').config();

if (!process.env.ADMIN_DATABASE_URL) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set in .env to run tests.');
  }
  // Admin connection (create DB only) targets the "postgres" maintenance DB,
  // which exists on every cluster — the app DB may not exist yet on a fresh one.
  const admin = new URL(process.env.DATABASE_URL);
  admin.pathname = '/postgres';
  process.env.ADMIN_DATABASE_URL = admin.toString();
  const u = new URL(process.env.DATABASE_URL);
  const base = u.pathname.replace(/^\//, '') || 'postgres';
  u.pathname = '/' + (base.endsWith('_test') ? base : `${base}_test`);
  process.env.DATABASE_URL = u.toString();
}

process.env.TEST_MODE = 'true';

async function ensureTestDatabase() {
  const { ensurePostgresRunning } = require('../db/pg-engine');
  await ensurePostgresRunning();
  const { Client } = require('pg');
  const testName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(testName)) {
    throw new Error(`Refusing to use non-test database "${testName}" for tests.`);
  }
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [testName]);
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE "${testName}"`);
      console.log(`[TEST-ENV] Created isolated test database "${testName}"`);
    }
  } finally {
    await admin.end();
  }
}

module.exports = { ensureTestDatabase };
