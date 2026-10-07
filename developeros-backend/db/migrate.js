// ══════════════════════════════════════════════════════════════
// db/migrate.js — Idempotent Migration Runner
// Applies SQL migrations in sequence and records them in schema_migrations
// ══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { getPool, transaction } = require('./pool');

async function runMigrations() {
  await getPool();
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`[MIGRATE] Checking ${files.length} migration file(s)...`);

  return transaction(async (client) => {
    // Ensure tracking table exists
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
        console.log(`[MIGRATE] Applying ${file}...`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        count++;
      }
    }

    console.log(`[MIGRATE] Migration complete. Applied ${count} new migration(s).`);
    return { applied: count, total: files.length };
  });
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[MIGRATE] Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
