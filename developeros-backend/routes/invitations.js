const express = require('express');
const router = express.Router();
const invitationsRepo = require('../db/repositories/invitations.repo');
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
    const invitation = await invitationsRepo.create({
      organizationId: req.organizationId,
      email,
      roleId: role,
      createdBy: req.user.id,
    });
    if (!invitation) return res.status(400).json({ error: 'Invalid organization role' });
    res.status(201).json(invitation);
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
