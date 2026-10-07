const express = require('express');
const router = express.Router();
const auditRepo = require('../db/repositories/audit.repo');
const { requirePermission } = require('../middleware/auth');

router.get('/', requirePermission('audit:read'), async (req, res, next) => {
  try {
    res.json(await auditRepo.list(req.organizationId, req.query.limit, req.query.before));
  } catch (err) { next(err); }
});

router.get('/verify', requirePermission('audit:read'), async (req, res, next) => {
  try {
    res.json(await auditRepo.verify(req.organizationId));
  } catch (err) { next(err); }
});

module.exports = router;
