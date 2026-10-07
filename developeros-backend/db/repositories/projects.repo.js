// ══════════════════════════════════════════════════════════════
// db/repositories/projects.repo.js — Projects Repository
// ══════════════════════════════════════════════════════════════

const { query } = require('../pool');
const { v4: uuidv4 } = require('uuid');

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    organizationId: r.organization_id,
    name: r.name,
    type: r.type,
    units: Number(r.units),
    affordableUnits: Number(r.affordable_units),
    budget: Number(r.budget),
    progress: Number(r.progress),
    phase: Number(r.phase),
    phaseLabel: r.phase_label,
    status: r.status,
    alertCount: Number(r.alert_count),
    city: r.city,
    program: r.program,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 10) : r.created_at,
  };
}

async function getAll(organizationId) {
  const { rows } = await query('SELECT * FROM projects WHERE organization_id = $1 ORDER BY created_at ASC', [organizationId]);
  return rows.map(mapRow);
}

async function getById(id, organizationId = null) {
  const { rows } = organizationId
    ? await query('SELECT * FROM projects WHERE id = $1 AND organization_id = $2', [id, organizationId])
    : await query('SELECT * FROM projects WHERE id = $1', [id]);
  return mapRow(rows[0]);
}

async function create(data, organizationId) {
  const id = data.id || ('p' + uuidv4().replace(/-/g, ''));
  const orgId = organizationId;
  const units = Number(data.units) || 0;
  const affordableUnits = Number(data.affordableUnits) || 0;
  const budget = Number(data.budget) || 0;
  const progress = Number(data.progress) || 0;
  const phase = Number(data.phase) || 1;
  const phaseLabel = data.phaseLabel || '';
  const status = data.status || 'on-track';
  const alertCount = Number(data.alertCount) || 0;
  const city = data.city || '';
  const program = data.program || '';

  const { rows } = await query(`
    INSERT INTO projects (id, organization_id, name, type, units, affordable_units, budget, progress, phase, phase_label, status, alert_count, city, program, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
    RETURNING *
  `, [id, orgId, data.name, data.type, units, affordableUnits, budget, progress, phase, phaseLabel, status, alertCount, city, program]);

  return mapRow(rows[0]);
}

async function update(id, data, organizationId) {
  const existing = await getById(id, organizationId);
  if (!existing) return null;

  const name = data.name !== undefined ? data.name : existing.name;
  const type = data.type !== undefined ? data.type : existing.type;
  const units = data.units !== undefined ? Number(data.units) : existing.units;
  const affordableUnits = data.affordableUnits !== undefined ? Number(data.affordableUnits) : existing.affordableUnits;
  const budget = data.budget !== undefined ? Number(data.budget) : existing.budget;
  const progress = data.progress !== undefined ? Number(data.progress) : existing.progress;
  const phase = data.phase !== undefined ? Number(data.phase) : existing.phase;
  const phaseLabel = data.phaseLabel !== undefined ? data.phaseLabel : existing.phaseLabel;
  const status = data.status !== undefined ? data.status : existing.status;
  const alertCount = data.alertCount !== undefined ? Number(data.alertCount) : existing.alertCount;
  const city = data.city !== undefined ? data.city : existing.city;
  const program = data.program !== undefined ? data.program : existing.program;

  const { rows } = await query(`
    UPDATE projects SET
      name = $1, type = $2, units = $3, affordable_units = $4, budget = $5,
      progress = $6, phase = $7, phase_label = $8, status = $9, alert_count = $10,
      city = $11, program = $12
    WHERE id = $13 AND organization_id = $14
    RETURNING *
  `, [name, type, units, affordableUnits, budget, progress, phase, phaseLabel, status, alertCount, city, program, id, organizationId]);

  return mapRow(rows[0]);
}

async function deleteProject(id, organizationId) {
  const { rowCount } = await query('DELETE FROM projects WHERE id = $1 AND organization_id = $2', [id, organizationId]);
  return rowCount > 0;
}

module.exports = {
  getAll,
  getById,
  create,
  update,
  deleteProject,
};
