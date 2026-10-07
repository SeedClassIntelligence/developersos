// ══════════════════════════════════════════════════════════════
// db/repositories/team.repo.js — Team Members Repository
// ══════════════════════════════════════════════════════════════

const { query } = require('../pool');
const { v4: uuidv4 } = require('uuid');

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    organizationId: r.organization_id,
    name: r.name,
    role: r.role,
    projects: r.projects,
    status: r.status,
    lastActive: r.last_active instanceof Date ? r.last_active.toISOString() : r.last_active,
  };
}

async function getAll(organizationId) {
  const { rows } = await query('SELECT * FROM team_members WHERE organization_id = $1 ORDER BY id ASC', [organizationId]);
  return rows.map(mapRow);
}

async function getById(id) {
  const { rows } = await query('SELECT * FROM team_members WHERE id = $1', [id]);
  return mapRow(rows[0]);
}

async function create(data, organizationId) {
  const id = data.id || ('tm' + uuidv4().replace(/-/g, ''));
  const orgId = organizationId;
  const { rows } = await query(`
    INSERT INTO team_members (id, organization_id, name, role, projects, status, last_active, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    RETURNING *
  `, [
    id,
    orgId,
    data.name,
    data.role || 'developer',
    data.projects || 'All',
    data.status || 'active',
  ]);
  return mapRow(rows[0]);
}

async function update(id, data, organizationId) {
  const existing = await getById(id);
  if (existing?.organizationId !== organizationId) return null;
  if (!existing) return null;

  const name = data.name !== undefined ? data.name : existing.name;
  const role = data.role !== undefined ? data.role : existing.role;
  const projects = data.projects !== undefined ? data.projects : existing.projects;
  const status = data.status !== undefined ? data.status : existing.status;

  const { rows } = await query(`
    UPDATE team_members SET
      name = $1, role = $2, projects = $3, status = $4, last_active = NOW()
    WHERE id = $5 AND organization_id = $6
    RETURNING *
  `, [name, role, projects, status, id, organizationId]);
  return mapRow(rows[0]);
}

async function deleteMember(id, organizationId) {
  const { rowCount } = await query('DELETE FROM team_members WHERE id = $1 AND organization_id = $2', [id, organizationId]);
  return rowCount > 0;
}

module.exports = {
  getAll,
  getById,
  create,
  update,
  deleteMember,
};
