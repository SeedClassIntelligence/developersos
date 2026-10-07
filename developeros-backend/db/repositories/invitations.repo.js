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

module.exports = { create, accept };
