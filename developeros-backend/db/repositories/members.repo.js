// ══════════════════════════════════════════════════════════════
// db/repositories/members.repo.js — organization members (accounts)
//
// A membership is a user's authority inside one organization. Changing a
// role or deactivating a membership affects only that organization: the
// user's account and other memberships are untouched.
// ══════════════════════════════════════════════════════════════

const { query, transaction } = require('../pool');

const iso = v => (v ? new Date(v).toISOString() : null);
const toMember = r => ({
  userId: r.user_id, name: r.name, email: r.email, roleId: r.role_id, roleName: r.role_name,
  status: r.status, joinedAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

async function list(organizationId) {
  const { rows } = await query(`
    SELECT m.user_id, u.name, u.email, m.role_id, r.name AS role_name, m.status, m.created_at, m.updated_at
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    JOIN roles r ON r.id = m.role_id
    WHERE m.organization_id = $1
    ORDER BY (m.status = 'ACTIVE') DESC, u.name, u.email`, [organizationId]);
  return rows.map(toMember);
}

async function organizationRoles() {
  const { rows } = await query(`SELECT id, name FROM roles WHERE scope = 'organization' ORDER BY id`);
  return rows;
}

// Applies { roleId?, status? } to a member. Returns { member } or
// { notFound } / { conflict } / { invalid }. Never lets an organization lose
// its last active administrator.
async function update(organizationId, userId, changes) {
  return transaction(async client => {
    // Lock the organization's memberships so concurrent changes cannot both remove "the other" admin.
    const { rows } = await client.query(
      `SELECT user_id, role_id, status FROM memberships WHERE organization_id = $1 ORDER BY user_id FOR UPDATE`, [organizationId]);
    const target = rows.find(r => r.user_id === userId);
    if (!target) return { notFound: true };
    if (changes.roleId !== undefined) {
      const { rowCount } = await client.query(`SELECT 1 FROM roles WHERE id = $1 AND scope = 'organization'`, [changes.roleId]);
      if (!rowCount) return { invalid: 'roleId must be an organization role (org-admin, developer or viewer)' };
    }
    const nextRole = changes.roleId !== undefined ? changes.roleId : target.role_id;
    const nextStatus = changes.status !== undefined ? changes.status : target.status;
    const wasAdmin = target.role_id === 'org-admin' && target.status === 'ACTIVE';
    const staysAdmin = nextRole === 'org-admin' && nextStatus === 'ACTIVE';
    if (wasAdmin && !staysAdmin) {
      const others = rows.filter(r => r.user_id !== userId && r.role_id === 'org-admin' && r.status === 'ACTIVE').length;
      if (others === 0) return { conflict: 'An organization must keep at least one active administrator' };
    }
    await client.query(
      `UPDATE memberships SET role_id = $3, status = $4, updated_at = NOW() WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId, nextRole, nextStatus]);
    const { rows: [row] } = await client.query(`
      SELECT m.user_id, u.name, u.email, m.role_id, r.name AS role_name, m.status, m.created_at, m.updated_at
      FROM memberships m JOIN users u ON u.id = m.user_id JOIN roles r ON r.id = m.role_id
      WHERE m.organization_id = $1 AND m.user_id = $2`, [organizationId, userId]);
    return { member: toMember(row) };
  });
}

async function isActiveMemberByEmail(organizationId, email) {
  const { rowCount } = await query(`
    SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = $1 AND LOWER(u.email) = LOWER($2) AND m.status = 'ACTIVE'`, [organizationId, email]);
  return rowCount > 0;
}

module.exports = { list, update, organizationRoles, isActiveMemberByEmail };
