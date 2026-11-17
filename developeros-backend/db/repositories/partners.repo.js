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

const crypto = require('crypto');
const initialsOf = name => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'P';
const toPartner = r => ({ id: r.id, name: r.name, role: r.role, initials: r.initials });

async function create(organizationId, b) {
  const { rows } = await query(`INSERT INTO partners (id, org_id, name, role, initials) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [`part-${crypto.randomUUID()}`, organizationId, b.name.trim(), b.role, (b.initials || initialsOf(b.name)).toUpperCase()]);
  return toPartner(rows[0]);
}

// Tenant-scoped: another organization's partner is indistinguishable from a missing one.
async function update(organizationId, id, b) {
  const { rows } = await query(`UPDATE partners SET name = COALESCE($3, name), role = COALESCE($4, role), initials = COALESCE($5, initials)
    WHERE org_id = $1 AND id = $2 RETURNING *`,
  [organizationId, id, b.name !== undefined ? b.name.trim() : null, b.role ?? null, b.initials ? b.initials.toUpperCase() : null]);
  return rows[0] ? toPartner(rows[0]) : null;
}

module.exports = {
  getAll,
  getById,
  create,
  update,
};
