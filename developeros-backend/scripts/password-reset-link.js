// ══════════════════════════════════════════════════════════════
// scripts/password-reset-link.js — operator-issued reset link
//
// For deployments without email: an operator issues a single-use, 1-hour
// reset link for an account and passes it to the person through a trusted
// channel. Uses the runtime database role (DATABASE_URL).
//
//   node scripts/password-reset-link.js person@example.com
// ══════════════════════════════════════════════════════════════

require('dotenv').config();
const passwordReset = require('../db/repositories/password-reset.repo');
const { closePool } = require('../db/pool');

async function main() {
  const email = (process.argv[2] || '').trim();
  if (!email.includes('@')) throw new Error('usage: node scripts/password-reset-link.js <email>');
  const issued = await passwordReset.issue(email);
  if (!issued) throw new Error('no active account with that email');
  const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  const route = `/#/reset-password?token=${encodeURIComponent(issued.token)}`;
  console.log(`[RESET] Single-use link for ${issued.email} (valid 1 hour):`);
  console.log(base ? `${base}${route}` : `<APP_BASE_URL>${route}`);
}

main()
  .then(async () => { await closePool(); process.exit(0); })
  .catch(async err => { console.error(`[RESET] failed: ${err.message}`); await closePool().catch(() => {}); process.exit(1); });
