// ══════════════════════════════════════════════════════════════
// db/repositories/password-reset.repo.js — single-use reset tokens
// Tokens are random 32-byte values; only their SHA-256 is stored.
// ══════════════════════════════════════════════════════════════

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query, transaction } = require('../pool');

const TTL_MS = 60 * 60 * 1000; // 1 hour
const hash = token => crypto.createHash('sha256').update(token).digest('hex');

// Issues a token for an active user. Returns { token, email } or null (unknown/inactive: caller reveals nothing).
async function issue(email) {
  const { rows: [user] } = await query('SELECT id, email, active FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (!user || !user.active) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  await query(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [`prt-${crypto.randomUUID()}`, user.id, hash(token), new Date(Date.now() + TTL_MS)]);
  return { token, email: user.email };
}

// Sets the new password and consumes the token (and every other open token of that user).
async function complete(token, password) {
  return transaction(async client => {
    const { rows: [row] } = await client.query(`
      SELECT t.id, t.user_id, t.expires_at, t.used_at, u.active
      FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 FOR UPDATE OF t`, [hash(token)]);
    if (!row || row.used_at || !row.active) return { error: 'This reset link is invalid or has already been used' };
    if (new Date(row.expires_at) <= new Date()) return { error: 'This reset link has expired. Request a new one.' };
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [row.user_id, passwordHash]);
    await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [row.user_id]);
    return { ok: true };
  });
}

module.exports = { issue, complete, TTL_MS };
