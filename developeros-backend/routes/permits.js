// ═══════════════════════════════════════════════
// routes/permits.js
// Backed by durable PostgreSQL permits & permit_corrections tables
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const permitsRepo = require('../db/repositories/permits.repo');
const { requirePermission, authorizeResource, authorizeProjectParent } = require('../middleware/auth');

// GET permits
router.get('/', requirePermission('permits:read'), async (req, res, next) => {
  try {
    const permits = await permitsRepo.getAll(req.query.projectId, req.organizationId);
    res.json(permits);
  } catch (err) {
    next(err);
  }
});

// GET single permit
router.get('/:id', requirePermission('permits:read'), authorizeResource('permit'), async (req, res, next) => {
  try {
    const p = await permitsRepo.getById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch (err) {
    next(err);
  }
});

// CREATE permit
router.post('/', requirePermission('permits:status:update'), authorizeProjectParent, async (req, res, next) => {
  try {
    const p = await permitsRepo.create(req.body);
    res.status(201).json(p);
  } catch (err) {
    next(err);
  }
});

// UPDATE permit
router.put('/:id', requirePermission('permits:status:update'), authorizeResource('permit'), async (req, res, next) => {
  try {
    const p = await permitsRepo.update(req.params.id, req.body);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch (err) {
    next(err);
  }
});

// PATCH permit status
router.patch('/:id/status', requirePermission('permits:status:update'), authorizeResource('permit'), async (req, res, next) => {
  try {
    const p = await permitsRepo.updateStatus(req.params.id, req.body.status);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch (err) {
    next(err);
  }
});

// UPDATE correction item
router.patch('/:id/corrections/:corrId', requirePermission('permits:corrections:update'), authorizeResource('permit'), async (req, res, next) => {
  try {
    const cor = await permitsRepo.updateCorrection(req.params.id, req.params.corrId, req.body);
    if (!cor) return res.status(404).json({ error: 'Correction not found' });
    res.json(cor);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
