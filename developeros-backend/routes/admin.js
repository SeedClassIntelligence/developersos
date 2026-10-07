// ═══════════════════════════════════════════════
// routes/admin.js
// Backed by durable PostgreSQL aggregations
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const adminRepo = require('../db/repositories/admin.repo');

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
