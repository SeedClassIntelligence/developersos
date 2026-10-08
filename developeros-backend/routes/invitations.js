const express = require('express');
const router = express.Router();
const invitationsRepo = require('../db/repositories/invitations.repo');
const membersRepo = require('../db/repositories/members.repo');
const mailer = require('../services/mailer');
const {
  protect,
  resolveOrganizationContext,
  requirePermission,
} = require('../middleware/auth');

router.post('/', protect, resolveOrganizationContext, requirePermission('invitations:create'), async (req, res, next) => {
  try {
    const { email, role } = req.body || {};
    if (typeof email !== 'string' || !email.includes('@') || typeof role !== 'string') {
      return res.status(400).json({ error: 'Valid email and role are required' });
    }
    if (await membersRepo.isActiveMemberByEmail(req.organizationId, email)) {
      return res.status(409).json({ error: 'This person is already an active member of the organization' });
    }
    const invitation = await invitationsRepo.create({
      organizationId: req.organizationId,
      email,
      roleId: role,
      createdBy: req.user.id,
    });
    if (!invitation) return res.status(400).json({ error: 'Invalid organization role' });
    res.status(201).json({ ...invitation, ...(await deliverInvitation(invitation, req.user.name)) });
  } catch (err) {
    next(err);
  }
});

// Emails the acceptance link when email is configured; otherwise the inviter shares the link.
// Shared with platform organization provisioning (routes/admin.js).
async function deliverInvitation(invitation, inviterName) {
  const acceptPath = `/#/accept-invite?token=${encodeURIComponent(invitation.token)}`;
  const link = mailer.appLink(`/accept-invite?token=${encodeURIComponent(invitation.token)}`);
  if (!link || !mailer.enabled()) return { acceptPath, delivery: 'link' };
  const sent = await mailer.send({
    to: invitation.email,
    subject: 'You are invited to DeveloperOS',
    text: `${inviterName || 'An administrator'} invited you to join an organization on DeveloperOS.\n\n`
      + `Accept the invitation and set your password:\n${link}\n\nThis link expires in 7 days.`,
  });
  return { acceptPath, delivery: sent.delivered ? 'email' : 'link' };
}

router.get('/', protect, resolveOrganizationContext, requirePermission('invitations:create'), async (req, res, next) => {
  try {
    res.json(await invitationsRepo.list(req.organizationId));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/revoke', protect, resolveOrganizationContext, requirePermission('invitations:revoke'), async (req, res, next) => {
  try {
    const result = await invitationsRepo.revoke(req.organizationId, req.params.id);
    if (result.notFound) return res.status(404).json({ error: 'Not found' });
    if (result.conflict) return res.status(409).json({ error: result.conflict });
    res.json({ id: req.params.id, status: 'REVOKED' });
  } catch (err) {
    next(err);
  }
});

router.post('/accept', async (req, res, next) => {
  try {
    const { token, password, role, organizationId } = req.body || {};
    if (role !== undefined || organizationId !== undefined) {
      return res.status(400).json({ error: 'Invitation authority cannot be overridden' });
    }
    if (typeof token !== 'string' || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Valid token and password are required' });
    }
    const result = await invitationsRepo.accept({ token, password });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.deliverInvitation = deliverInvitation;
