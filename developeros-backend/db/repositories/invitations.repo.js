const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('../pool');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function create({ organizationId, email, roleId, createdBy }) {
  const role = await query(
    `SELECT id FROM roles WHERE id = $1 AND scope = 'organization'`,
    [roleId]
  );
  if (!role.rows[0]) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const id = `inv-${uuidv4()}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query(`
    INSERT INTO invitations
      (id, organization_id, email, role_id, token_hash, status, expires_at, created_by)
    VALUES ($1, $2, LOWER($3), $4, $5, 'PENDING', $6, $7)
  `, [id, organizationId, email, roleId, hashToken(token), expiresAt, createdBy]);
  return { id, organizationId, email: email.toLowerCase(), roleId, expiresAt, token };
}

async function accept({ token, password }) {
  const tokenHash = hashToken(token);
  return transaction(async client => {
    const invitationResult = await client.query(`
      SELECT * FROM invitations WHERE token_hash = $1 FOR UPDATE
    `, [tokenHash]);
    const invitation = invitationResult.rows[0];
    if (!invitation || invitation.status !== 'PENDING') {
      return { error: 'Invitation is invalid or no longer active', status: 400 };
    }
    if (new Date(invitation.expires_at) <= new Date()) {
      await client.query(`UPDATE invitations SET status = 'EXPIRED' WHERE id = $1`, [invitation.id]);
      return { error: 'Invitation has expired', status: 410 };
    }

    let userResult = await client.query(`SELECT * FROM users WHERE LOWER(email) = LOWER($1)`, [invitation.email]);
    let user = userResult.rows[0];
    if (!user) {
      const passwordHash = await bcrypt.hash(password, 12);
      userResult = await client.query(`
        INSERT INTO users (id, org_id, name, email, password_hash, role, active)
        VALUES ($1, NULL, $2, LOWER($3), $4, 'user', true)
        RETURNING *
      `, [`u${uuidv4().replace(/-/g, '')}`, invitation.email.split('@')[0], invitation.email, passwordHash]);
      user = userResult.rows[0];
    }

    await client.query(`
      INSERT INTO memberships (id, user_id, organization_id, role_id, status, created_by)
      VALUES ($1, $2, $3, $4, 'ACTIVE', $5)
      ON CONFLICT (user_id, organization_id) DO UPDATE SET
        role_id = EXCLUDED.role_id, status = 'ACTIVE', updated_at = NOW()
    `, [`mem-${uuidv4()}`, user.id, invitation.organization_id, invitation.role_id, invitation.created_by]);
    await client.query(`UPDATE invitations SET status = 'ACCEPTED', accepted_at = NOW() WHERE id = $1`, [invitation.id]);
    return { userId: user.id, organizationId: invitation.organization_id, roleId: invitation.role_id };
  });
}

// Pending and recent invitations of an organization. Never returns token material.
async function list(organizationId) {
  const { rows } = await query(`
    SELECT i.id, i.email, i.role_id, r.name AS role_name, i.status, i.expires_at, i.created_at, i.accepted_at
    FROM invitations i JOIN roles r ON r.id = i.role_id
    WHERE i.organization_id = $1 AND (i.status = 'PENDING' OR i.created_at > NOW() - INTERVAL '30 days')
    ORDER BY i.created_at DESC`, [organizationId]);
  return rows.map(r => ({
    id: r.id, email: r.email, roleId: r.role_id, roleName: r.role_name,
    status: r.status === 'PENDING' && new Date(r.expires_at) <= new Date() ? 'EXPIRED' : r.status,
    expiresAt: r.expires_at, createdAt: r.created_at, acceptedAt: r.accepted_at,
  }));
}

// PENDING → REVOKED within the organization. Returns { notFound } or { conflict } or { revoked }.
async function revoke(organizationId, id) {
  const { rows } = await query(`UPDATE invitations SET status = 'REVOKED'
    WHERE organization_id = $1 AND id = $2 AND status = 'PENDING' RETURNING id`, [organizationId, id]);
  if (rows[0]) return { revoked: true };
  const { rowCount } = await query('SELECT 1 FROM invitations WHERE organization_id = $1 AND id = $2', [organizationId, id]);
  return rowCount ? { conflict: 'Only a pending invitation can be revoked' } : { notFound: true };
}

module.exports = { create, accept, list, revoke };
