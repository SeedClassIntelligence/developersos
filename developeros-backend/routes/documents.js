// ═══════════════════════════════════════════════
// routes/documents.js
// Backed by durable PostgreSQL documents table
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const documentsRepo = require('../db/repositories/documents.repo');
const { requirePermission, authorizeResource, authorizeProjectParent } = require('../middleware/auth');

router.get('/', requirePermission('documents:read'), async (req, res, next) => {
  try {
    const docs = await documentsRepo.getAll({
      projectId: req.query.projectId,
      category: req.query.category,
      organizationId: req.organizationId,
    });
    res.json(docs);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('documents:create'), authorizeProjectParent, async (req, res, next) => {
  try {
    const d = await documentsRepo.create(req.body);
    res.status(201).json(d);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('documents:delete'), authorizeResource('document'), async (req, res, next) => {
  try {
    const success = await documentsRepo.deleteDocument(req.params.id);
    if (!success) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
