// ══════════════════════════════════════════════════════════════
// db/pool.js — PostgreSQL Connection Pool & Transaction Layer
// Centralized connection management, query execution & transactions
// ══════════════════════════════════════════════════════════════

require('dotenv').config();
const { Pool } = require('pg');
const { ensurePostgresRunning } = require('./pg-engine');
const auditContext = require('./audit-context');

function resolveConnectionString() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Configure it in .env (see .env.example).');
  }
  return process.env.DATABASE_URL;
}

let pool = null;
let initialized = false;

async function getPool() {
  if (!pool) {
    await ensurePostgresRunning();
    pool = new Pool({
      connectionString: resolveConnectionString(),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    initialized = true;
  }
  return pool;
}

async function query(text, params) {
  const p = await getPool();
  const isMutation = /^\s*(INSERT|UPDATE|DELETE)\b/i.test(text);
  if (!isMutation) return p.query(text, params);

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await auditContext.applyToClient(client);
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function transaction(callback) {
  const p = await getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await auditContext.applyToClient(client);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    initialized = false;
  }
}

module.exports = {
  getPool,
  query,
  transaction,
  closePool,
};
