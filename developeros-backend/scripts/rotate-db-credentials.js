// One-off: moves embedded DB to a private port and rotates the postgres password.
// Usage: node scripts/rotate-db-credentials.js <newPort>
// Reads current DATABASE_URL from .env, applies a new random password, rewrites .env.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '..', '.env');
const newPort = process.argv[2] || '54329';
let env = fs.readFileSync(envPath, 'utf8');
const m = env.match(/^DATABASE_URL=(.*)$/m);
if (!m) throw new Error('DATABASE_URL missing from .env');
const oldUrl = new URL(m[1].trim());
const newPassword = crypto.randomBytes(18).toString('hex');

// Connect with OLD password on the NEW port (embedded server starts there)
oldUrl.port = newPort;
process.env.DATABASE_URL = oldUrl.toString();

(async () => {
  const { getPool, closePool } = require('../db/pool');
  const { stopPostgresEngine } = require('../db/pg-engine');
  const pool = await getPool();
  await pool.query(`ALTER USER ${oldUrl.username} WITH PASSWORD '${newPassword}'`);
  await closePool();

  const nu = new URL(oldUrl.toString());
  nu.password = newPassword;
  env = env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${nu.toString()}`);
  fs.writeFileSync(envPath, env);
  console.log(`[ROTATE] DB moved to port ${newPort}; password rotated and written to .env`);
  await stopPostgresEngine();
  process.exit(0);
})().catch(e => { console.error('[ROTATE] failed:', e.message); process.exit(1); });
