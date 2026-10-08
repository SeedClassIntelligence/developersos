const { query } = require('../pool');

async function findCurrentIdentity(userId) {
  const { rows } = await query(`
    SELECT id, name, email, active
    FROM users
    WHERE id = $1
  `, [userId]);
  return rows[0] || null;
}

async function listActiveMemberships(userId) {
  const { rows } = await query(`
    SELECT m.id, m.organization_id, m.role_id, r.name AS role_name,
           COALESCE(array_agg(rp.permission_id)
             FILTER (WHERE rp.permission_id IS NOT NULL), '{}') AS permissions
    FROM memberships m
    JOIN roles r ON r.id = m.role_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    WHERE m.user_id = $1 AND m.status = 'ACTIVE'
    GROUP BY m.id, m.organization_id, m.role_id, r.name
    ORDER BY m.created_at, m.id
  `, [userId]);
  return rows.map(row => ({
    id: row.id,
    organizationId: row.organization_id,
    roleId: row.role_id,
    roleName: row.role_name,
    permissions: row.permissions,
  }));
}

async function resolveActiveMembership(userId, organizationId) {
  const { rows } = await query(`
    SELECT m.id, m.organization_id, m.role_id, r.name AS role_name,
           COALESCE(array_agg(rp.permission_id)
             FILTER (WHERE rp.permission_id IS NOT NULL), '{}') AS permissions
    FROM memberships m
    JOIN roles r ON r.id = m.role_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    WHERE m.user_id = $1
      AND m.organization_id = $2
      AND m.status = 'ACTIVE'
    GROUP BY m.id, m.organization_id, m.role_id, r.name
  `, [userId, organizationId]);
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    organizationId: rows[0].organization_id,
    roleId: rows[0].role_id,
    roleName: rows[0].role_name,
    permissions: rows[0].permissions,
  };
}

// Organizations the user may switch into, for the organization selector.
// Carries display data only; authority is always re-resolved per request.
async function listMembershipOrganizations(userId) {
  const { rows } = await query(`
    SELECT m.organization_id, o.name AS organization_name, m.role_id, r.name AS role_name
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    JOIN roles r ON r.id = m.role_id
    WHERE m.user_id = $1 AND m.status = 'ACTIVE'
    ORDER BY o.name, m.organization_id
  `, [userId]);
  return rows.map(row => ({
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    roleId: row.role_id,
    roleName: row.role_name,
  }));
}

module.exports = { findCurrentIdentity, listActiveMemberships, resolveActiveMembership, listMembershipOrganizations };
