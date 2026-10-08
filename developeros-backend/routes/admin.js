// ═══════════════════════════════════════════════
// routes/admin.js
// Backed by durable PostgreSQL aggregations
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const adminRepo = require('../db/repositories/admin.repo');
const { requirePermission } = require('../middleware/auth');
const { deliverInvitation } = require('./invitations');

// Platform overview stats
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await adminRepo.getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// All organizations
router.get('/orgs', async (req, res, next) => {
  try {
    const orgs = await adminRepo.getOrganizations();
    res.json(orgs);
  } catch (err) {
    next(err);
  }
});

// Provision an organization and invite its first administrator.
router.post('/orgs', requirePermission('platform:orgs:manage'), async (req, res, next) => {
  try {
    const { name, type, adminEmail } = req.body || {};
    if (typeof name !== 'string' || name.trim().length < 2) return res.status(400).json({ error: 'name is required' });
    if (type !== undefined && (typeof type !== 'string' || type.length > 100)) return res.status(400).json({ error: 'type must be a string' });
    if (typeof adminEmail !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail.trim())) {
      return res.status(400).json({ error: 'adminEmail must be a valid email address' });
    }
    const { organization, invitation } = await adminRepo.provisionOrganization({
      name: name.trim(), type: type ? type.trim() : null, adminEmail: adminEmail.trim(), createdBy: req.user.id,
    });
    res.status(201).json({ organization, invitation: { ...invitation, ...(await deliverInvitation(invitation, req.user.name)) } });
  } catch (err) {
    next(err);
  }
});

router.get('/orgs/:id', async (req, res, next) => {
  try {
    const org = await adminRepo.getOrgById(req.params.id);
    if (!org) return res.status(404).json({ error: 'Not found' });
    res.json(org);
  } catch (err) {
    next(err);
  }
});

// Health check (detailed)
router.get('/health', async (req, res) => {
  res.json({
    status: 'ok',
    services: {
      api: 'running',
      database: 'postgresql (active)',
      auth: 'jwt (active)',
    },
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
