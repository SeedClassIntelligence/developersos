#!/usr/bin/env node
// Verifies that the database in DATABASE_URL is usable by this build, using
// the same checks the API performs before it serves traffic, plus a full
// audit-ledger verification of every chain:
//   1. AUDIT_SIGNING_KEY loads (required when NODE_ENV=production)
//   2. DATABASE_URL is the unprivileged runtime role (EF3-D1 guard)
//   3. every migration shipped with this build is recorded in schema_migrations
//   4. business tables are readable by the runtime role
//   5. every audit chain verifies (hashes, links, head, stored checkpoints;
//      checkpoint signatures need the matching AUDIT_SIGNING_KEY or
//      AUDIT_TRUSTED_PUBLIC_KEYS)
// Read-only. Used by deploy/restore-drill.sh; also safe against a live database.
//   node scripts/verify-database.js        exit 0 = usable, 1 = not usable
require('dotenv').config();
const { getPool, closePool } = require('../db/pool');
const { migrationFiles } = require('../db/migrate');
const auditSigning = require('../db/audit-signing');
const auditRepo = require('../db/repositories/audit.repo');

async function main() {
  auditSigning.load();
  console.log('[VERIFY] audit signing key loaded');

  const pool = await getPool();
  const { rows: [who] } = await pool.query('SELECT current_user AS role, current_database() AS db, version() AS v');
  console.log(`[VERIFY] runtime role guard passed: role="${who.role}" database="${who.db}"`);
  console.log(`[VERIFY] server: ${who.v.split(' on ')[0]}`);

  const { rows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  const applied = new Set(rows.map(r => r.version));
  const pending = migrationFiles().filter(f => !applied.has(f));
  if (pending.length) throw new Error(`pending migrations: ${pending.join(', ')}`);
  console.log(`[VERIFY] schema_migrations: ${rows.length} applied, 0 pending (${rows.map(r => r.version).join(', ')})`);

  const { rows: [biz] } = await pool.query(`SELECT
      (SELECT count(*) FROM organizations)::int AS organizations,
      (SELECT count(*) FROM users)::int AS users,
      (SELECT count(*) FROM projects)::int AS projects,
      (SELECT count(*) FROM memberships)::int AS memberships`);
  console.log(`[VERIFY] runtime reads OK: ${JSON.stringify(biz)}`);

  const { rows: chains } = await pool.query(
    'SELECT DISTINCT organization_id FROM audit_events ORDER BY organization_id NULLS FIRST');
  let failed = 0;
  for (const { organization_id: org } of chains) {
    const r = await auditRepo.verify(org);
    if (!r.valid) failed++;
    console.log(`[VERIFY] audit chain org=${org === null ? '(platform)' : org}: valid=${r.valid} events=${r.count} ` +
      `hashesVerified=${r.hashesVerified} head=${r.headSeq} checkpoints=${r.checkpoints.verified}/${r.checkpoints.stored}` +
      (r.failure ? ` failure=${r.failure.reason}: ${r.failure.detail}` : ''));
  }
  console.log(`[VERIFY] audit ledger: ${chains.length} chain(s), ${failed} failed`);
  if (failed) throw new Error(`${failed} audit chain(s) failed verification`);
}

main()
  .then(async () => { await closePool(); console.log('[VERIFY] OK: database is usable by this build'); process.exit(0); })
  .catch(async (err) => {
    console.error('[VERIFY] FAILED:', (err && err.message) || String(err));
    await closePool().catch(() => {});
    process.exit(1);
  });
