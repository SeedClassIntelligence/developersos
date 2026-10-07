// ══════════════════════════════════════════════════════════════
// db/repositories/auth.repo.js — Users & Auth Repository
// Eliminates split in-memory store; makes users durable database records
// ══════════════════════════════════════════════════════════════

const { query } = require('../pool');

function mapUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    email: r.email,
    passwordHash: r.password_hash,
    role: r.role,
    active: r.active,
    createdAt: r.created_at,
  };
}

async function findByEmail(email) {
  const { rows } = await query(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  return mapUser(rows[0]);
}

async function findById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  return mapUser(rows[0]);
}

async function updatePassword(id, passwordHash) {
  const { rows } = await query(`
    UPDATE users SET password_hash = $1
    WHERE id = $2
    RETURNING *
  `, [passwordHash, id]);
  return mapUser(rows[0]);
}

module.exports = {
  findByEmail,
  findById,
  updatePassword,
};
