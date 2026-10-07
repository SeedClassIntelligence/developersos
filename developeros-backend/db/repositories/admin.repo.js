// ══════════════════════════════════════════════════════════════
// db/repositories/admin.repo.js — Admin Metrics & Organizations Repository
// Computes live aggregates from PostgreSQL tables
// ══════════════════════════════════════════════════════════════

const { query } = require('../pool');

async function getStats() {
  const { rows: orgRes } = await query('SELECT COUNT(*) FROM organizations');
  const { rows: projRes } = await query('SELECT COUNT(*), COALESCE(SUM(units), 0) as units, COALESCE(SUM(affordable_units), 0) as affordable FROM projects');
  const { rows: userRes } = await query('SELECT COUNT(*) FROM team_members');
  const { rows: alertRes } = await query("SELECT COUNT(*) FROM tasks WHERE contract_id IS NULL AND status != 'complete'");

  return {
    organizations: parseInt(orgRes[0].count, 10),
    projects: parseInt(projRes[0].count, 10),
    totalUsers: parseInt(userRes[0].count, 10),
    totalUnits: parseInt(projRes[0].units, 10),
    affordableUnits: parseInt(projRes[0].affordable, 10),
    openAlerts: parseInt(alertRes[0].count, 10),
    uptime: '99.7%',
  };
}

async function getOrganizations() {
  const { rows } = await query('SELECT * FROM organizations ORDER BY id ASC');
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    type: r.type,
    projects: Number(r.projects_count),
    users: Number(r.users_count),
    plan: r.plan,
  }));
}

async function getOrgById(id) {
  const { rows } = await query('SELECT * FROM organizations WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    projects: Number(r.projects_count),
    users: Number(r.users_count),
    plan: r.plan,
  };
}

module.exports = {
  getStats,
  getOrganizations,
  getOrgById,
};
