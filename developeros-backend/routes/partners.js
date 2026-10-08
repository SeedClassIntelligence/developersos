// ═══════════════════════════════════════════════
// routes/partners.js
// Tenant-scoped execution partners (read). Partners are reference data for
// tasks and contracts, so reading them follows projects:read.
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const partnersRepo = require('../db/repositories/partners.repo');
const { requirePermission } = require('../middleware/auth');

router.get('/', requirePermission('projects:read'), async (req, res, next) => {
  try {
    res.json(await partnersRepo.getAll(req.organizationId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
