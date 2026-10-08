// ══════════════════════════════════════════════════════════════
// db/repositories/admin.repo.js — Admin Metrics & Organizations Repository
// Computes live aggregates from PostgreSQL tables
// ══════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { query, transaction } = require('../pool');

async function getStats() {
  const { rows: orgRes } = await query('SELECT COUNT(*) FROM organizations');
  const { rows: projRes } = await query('SELECT COUNT(*), COALESCE(SUM(units), 0) as units, COALESCE(SUM(affordable_units), 0) as affordable FROM projects');
  const { rows: userRes } = await query(`SELECT COUNT(DISTINCT user_id) FROM memberships WHERE status = 'ACTIVE'`);
  const { rows: alertRes } = await query("SELECT COUNT(*) FROM tasks WHERE contract_id IS NULL AND status != 'complete'");

  return {
    organizations: parseInt(orgRes[0].count, 10),
    projects: parseInt(projRes[0].count, 10),
    totalUsers: parseInt(userRes[0].count, 10),
    totalUnits: parseInt(projRes[0].units, 10),
    affordableUnits: parseInt(projRes[0].affordable, 10),
    openAlerts: parseInt(alertRes[0].count, 10),
  };
}

// Live counts (the legacy projects_count/users_count columns are not maintained).
async function getOrganizations() {
  const { rows } = await query(`
    SELECT o.id, o.name, o.type, o.plan, o.created_at,
           (SELECT COUNT(*) FROM projects p WHERE p.organization_id = o.id) AS projects,
           (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id AND m.status = 'ACTIVE') AS members,
           (SELECT COUNT(*) FROM invitations i WHERE i.organization_id = o.id AND i.status = 'PENDING' AND i.expires_at > NOW()) AS pending_invitations
    FROM organizations o ORDER BY o.created_at, o.id`);
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    type: r.type,
    plan: r.plan,
    projects: Number(r.projects),
    users: Number(r.members),
    pendingInvitations: Number(r.pending_invitations),
    createdAt: r.created_at,
  }));
}

async function organizationNameExists(name) {
  const { rowCount } = await query('SELECT 1 FROM organizations WHERE LOWER(name) = LOWER($1)', [name]);
  return rowCount > 0;
}

// Creates the organization and a pending org-admin invitation in one transaction.
async function provisionOrganization({ name, type, adminEmail, createdBy }) {
  return transaction(async client => {
    const id = `org-${crypto.randomUUID()}`;
    const { rows: [org] } = await client.query(
      `INSERT INTO organizations (id, name, type) VALUES ($1, $2, $3) RETURNING id, name, type, created_at`, [id, name, type]);
    const token = crypto.randomBytes(32).toString('base64url');
    const invitationId = `inv-${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await client.query(`
      INSERT INTO invitations (id, organization_id, email, role_id, token_hash, status, expires_at, created_by)
      VALUES ($1, $2, LOWER($3), 'org-admin', $4, 'PENDING', $5, $6)`,
    [invitationId, id, adminEmail, crypto.createHash('sha256').update(token).digest('hex'), expiresAt, createdBy]);
    return {
      organization: { id: org.id, name: org.name, type: org.type, createdAt: org.created_at },
      invitation: { id: invitationId, organizationId: id, email: adminEmail.toLowerCase(), roleId: 'org-admin', expiresAt, token },
    };
  });
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
  provisionOrganization,
  organizationNameExists,
};
