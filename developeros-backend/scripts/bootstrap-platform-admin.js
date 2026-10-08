// ══════════════════════════════════════════════════════════════
// scripts/bootstrap-platform-admin.js — first platform administrator
//
// A fresh production database has no users. This operator command (run with
// the schema-owner credentials, after `npm run db:migrate`) creates the
// platform organization and a platform administrator, who then provisions
// tenant organizations from the application (Organizations page).
//
//   node scripts/bootstrap-platform-admin.js --email ops@example.com --name "Ops Admin"
//
// Password: BOOTSTRAP_ADMIN_PASSWORD (12+ characters) if set, otherwise a
// random one is generated and printed once. An existing account keeps its
// password; only its platform-admin membership is ensured. Idempotent.
// ══════════════════════════════════════════════════════════════

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { withMigrationClient } = require('../db/migrate');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = (arg('email') || '').trim().toLowerCase();
  const name = (arg('name') || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) {
    throw new Error('usage: node scripts/bootstrap-platform-admin.js --email <email> --name "<full name>"');
  }
  let password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  let generated = false;
  if (password !== undefined && password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters');
  if (!password) { password = crypto.randomBytes(15).toString('base64url'); generated = true; }

  const result = await withMigrationClient(async client => {
    const { rowCount: migrated } = await client.query(`SELECT 1 FROM permissions WHERE id = 'platform:orgs:manage'`);
    if (!migrated) throw new Error('schema is not up to date: run `npm run db:migrate` first');
    await client.query('BEGIN');
    try {
      await client.query(`INSERT INTO organizations (id, name, type) VALUES ('platform', 'DeveloperOS Platform', 'platform') ON CONFLICT (id) DO NOTHING`);
      let { rows: [user] } = await client.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
      let created = false;
      if (!user) {
        const hash = await bcrypt.hash(password, 12);
        ({ rows: [user] } = await client.query(
          `INSERT INTO users (id, org_id, name, email, password_hash, role, active) VALUES ($1, 'platform', $2, $3, $4, 'user', TRUE) RETURNING id`,
          [`u${crypto.randomUUID().replace(/-/g, '')}`, name, email, hash]));
        created = true;
      }
      await client.query(`
        INSERT INTO memberships (id, user_id, organization_id, role_id, status)
        VALUES ($1, $2, 'platform', 'platform-admin', 'ACTIVE')
        ON CONFLICT (user_id, organization_id) DO UPDATE SET role_id = 'platform-admin', status = 'ACTIVE', updated_at = NOW()`,
      [`mem-${crypto.randomUUID()}`, user.id]);
      await client.query('COMMIT');
      return { created };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  });

  console.log(`[BOOTSTRAP] Platform administrator ${email} is ready (organization "platform").`);
  if (result.created && generated) console.log(`[BOOTSTRAP] Temporary password (shown once): ${password}`);
  if (result.created && !generated) console.log('[BOOTSTRAP] Password set from BOOTSTRAP_ADMIN_PASSWORD.');
  if (!result.created) console.log('[BOOTSTRAP] Existing account: password unchanged; platform-admin membership ensured.');
}

main().then(() => process.exit(0)).catch(err => { console.error(`[BOOTSTRAP] failed: ${err.message}`); process.exit(1); });
