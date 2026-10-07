// ══════════════════════════════════════════════════════════════
// db/migrate.js — Idempotent Migration Runner (migration/owner role)
// Applies SQL migrations in sequence and records them in schema_migrations,
// then provisions the runtime role's privileges.
//
// Connections:
//   MIGRATION_DATABASE_URL  owner role: creates/alters schema, owns the ledger
//   DATABASE_URL            runtime role: used by the API; never owns schema
// The runtime role must be a different, non-superuser role.
// ══════════════════════════════════════════════════════════════

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { ensurePostgresRunning } = require('./pg-engine');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATION_LOCK_KEY = 4247001; // pg_advisory_xact_lock key for migration runs

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
}

function migrationConnectionString() {
  if (!process.env.MIGRATION_DATABASE_URL) {
    throw new Error(
      'MIGRATION_DATABASE_URL is not set. Migrations run as the schema-owner role, ' +
      'separate from the runtime role in DATABASE_URL (see .env.example).'
    );
  }
  return process.env.MIGRATION_DATABASE_URL;
}

function runtimeCredentials() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Configure it in .env (see .env.example).');
  }
  const u = new URL(process.env.DATABASE_URL);
  return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
}

async function withMigrationClient(fn) {
  await ensurePostgresRunning();
  const client = new Client({ connectionString: migrationConnectionString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Creates the runtime login role if it is missing, enforces its attributes,
// and grants it exactly the runtime privileges defined by the migrations.
async function provisionRuntimeRole(client) {
  const { rows: [fn] } = await client.query(`SELECT to_regprocedure('devos_apply_runtime_grants(text)') AS oid`);
  if (!fn.oid) return null; // migrations that define runtime grants are not applied yet

  const { user, password } = runtimeCredentials();
  const { rows: [owner] } = await client.query('SELECT current_user AS name, rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user');
  if (!user || user === owner.name) {
    throw new Error('DATABASE_URL must use a dedicated runtime role, distinct from the MIGRATION_DATABASE_URL role.');
  }

  const { rowCount: exists } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user]);
  if (!exists) {
    if (!owner.rolsuper && !owner.rolcreaterole) {
      throw new Error(`Runtime role "${user}" does not exist and the migration role cannot create it. Create it as a LOGIN role first.`);
    }
    const { rows: [stmt] } = await client.query(
      `SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', $1::text, $2::text) AS sql`,
      [user, password]);
    await client.query(stmt.sql);
  } else if (process.env.DEVOS_SYNC_RUNTIME_PASSWORD === 'true') {
    const { rows: [stmt] } = await client.query(`SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS sql`, [user, password]);
    await client.query(stmt.sql);
  }

  if (owner.rolsuper) {
    // Only a superuser may clear these attributes; the runtime guard refuses
    // to serve traffic if any remain set, whoever provisioned the role.
    const { rows: [stmt] } = await client.query(
      `SELECT format('ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', $1::text) AS sql`, [user]);
    await client.query(stmt.sql);
  }

  await client.query('SELECT devos_apply_runtime_grants($1)', [user]);
  return user;
}

// options.until: stop after this migration file (used to build historical
// schemas in hash-version upgrade tests). options.quiet: suppress logging.
async function runMigrations(options = {}) {
  const files = migrationFiles();
  const log = options.quiet ? () => {} : console.log;
  log(`[MIGRATE] Checking ${files.length} migration file(s)...`);

  return withMigrationClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version VARCHAR(255) PRIMARY KEY,
          applied_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const { rows: applied } = await client.query('SELECT version FROM schema_migrations');
      const appliedSet = new Set(applied.map(r => r.version));

      let count = 0;
      for (const file of files) {
        if (!appliedSet.has(file)) {
          log(`[MIGRATE] Applying ${file}...`);
          await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
          count++;
        }
        if (options.until && file === options.until) break;
      }

      const runtimeRole = options.skipProvision ? null : await provisionRuntimeRole(client);
      await client.query('COMMIT');
      log(`[MIGRATE] Migration complete. Applied ${count} new migration(s).${runtimeRole ? ` Runtime grants applied to "${runtimeRole}".` : ''}`);
      return { applied: count, total: files.length, runtimeRole };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  });
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[MIGRATE] Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { runMigrations, migrationFiles, withMigrationClient, provisionRuntimeRole };
