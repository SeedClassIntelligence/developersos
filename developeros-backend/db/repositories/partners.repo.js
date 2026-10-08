// ══════════════════════════════════════════════════════════════
// db/repositories/partners.repo.js — Partners Repository
// ══════════════════════════════════════════════════════════════

const { query } = require('../pool');

// organizationId is required: partners are tenant-owned (partners.org_id).
async function getAll(organizationId) {
  if (!organizationId) throw new Error('partnersRepo.getAll requires an organizationId');
  const { rows } = await query('SELECT * FROM partners WHERE org_id = $1 ORDER BY id ASC', [organizationId]);
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
