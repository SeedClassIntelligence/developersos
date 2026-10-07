// ═══════════════════════════════════════════════
// routes/capital.js
// Backed by durable PostgreSQL capital_stacks & capital_sources tables
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const capitalRepo = require('../db/repositories/capital.repo');
const { requirePermission, authorizeResource } = require('../middleware/auth');

// GET all capital stacks
router.get('/', requirePermission('capital:read'), async (req, res, next) => {
  try {
    const stacks = await capitalRepo.getAll(req.query.projectId, req.organizationId);
    res.json(stacks);
  } catch (err) {
    next(err);
  }
});

// GET capital stack for project
router.get('/:projectId', requirePermission('capital:read'), authorizeResource('project', req => req.params.projectId), async (req, res, next) => {
  try {
    const stack = await capitalRepo.getByProjectId(req.params.projectId);
    if (!stack) return res.status(404).json({ error: 'Not found' });
    res.json(stack);
  } catch (err) {
    next(err);
  }
});

// PUT capital stack for project
router.put('/:projectId', requirePermission('capital:update'), authorizeResource('project', req => req.params.projectId), async (req, res, next) => {
  try {
    const stack = await capitalRepo.save(req.params.projectId, req.body);
    res.json(stack);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
