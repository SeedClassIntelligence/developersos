// ══════════════════════════════════════════════════════════════
// db/repositories/partners.repo.js — Partners Repository
// ══════════════════════════════════════════════════════════════

const { query } = require('../pool');

async function getAll() {
  const { rows } = await query('SELECT * FROM partners ORDER BY id ASC');
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    role: r.role,
    initials: r.initials,
  }));
}

async function getById(id) {
  const { rows } = await query('SELECT * FROM partners WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  return {
    id: rows[0].id,
    name: rows[0].name,
    role: rows[0].role,
    initials: rows[0].initials,
  };
}

module.exports = {
  getAll,
  getById,
};
