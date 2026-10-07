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

let guarded = null;

// EF3-D1: the API must run as an unprivileged runtime role. Refuse to hand out
// connections if the role could bypass or rewrite audit evidence.
async function assertUnprivilegedRuntimeRole(p) {
  const { rows: [r] } = await p.query(`
    SELECT current_user AS role, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
           to_regclass('public.audit_events') IS NOT NULL AS ledger_exists
    FROM pg_roles r WHERE r.rolname = current_user`);
  const problems = ['rolsuper', 'rolcreaterole', 'rolcreatedb', 'rolreplication', 'rolbypassrls'].filter(k => r[k]);
  if (!r.ledger_exists) {
    throw new Error('Audit ledger schema is missing. Run migrations with MIGRATION_DATABASE_URL (npm run db:migrate).');
  }
  const { rows: [p2] } = await p.query(`
    SELECT bool_or(pg_has_role(current_user, c.relowner, 'MEMBER')) AS owns_ledger,
           bool_or(has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE')
                OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE')
                OR has_table_privilege(c.oid, 'TRIGGER')) AS can_write_ledger
    FROM pg_class c
    WHERE c.oid IN (SELECT to_regclass(t) FROM unnest(ARRAY['public.audit_events','public.audit_chain_heads','public.audit_checkpoints']) t)`);
  if (p2.owns_ledger) problems.push('owns ledger tables');
  if (p2.can_write_ledger) problems.push('holds write/TRUNCATE/TRIGGER privilege on ledger tables');
  if (problems.length) {
    throw new Error(`Refusing to run with privileged database role "${r.role}": ${problems.join(', ')}. ` +
      'DATABASE_URL must use the dedicated runtime role provisioned by migrations.');
  }
}

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
    guarded = assertUnprivilegedRuntimeRole(pool);
  }
  try {
    await guarded;
  } catch (err) {
    const failed = pool;
    pool = null;
    guarded = null;
    await failed.end().catch(() => {});
    throw err;
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
    guarded = null;
    initialized = false;
  }
}

module.exports = {
  assertUnprivilegedRuntimeRole,
  getPool,
  query,
  transaction,
  closePool,
};
