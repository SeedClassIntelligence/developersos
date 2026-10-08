// ═══════════════════════════════════════════════
// routes/contracts.js
// Backed by durable PostgreSQL contracts table
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const contractsRepo = require('../db/repositories/contracts.repo');
const { requirePermission, authorizeResource, authorizeProjectParent } = require('../middleware/auth');
const { authorizeExecutionReferences } = require('../middleware/references');

// GET contracts
router.get('/', requirePermission('contracts:read'), async (req, res, next) => {
  try {
    const contracts = await contractsRepo.getAll(req.query.projectId, req.organizationId);
    res.json(contracts);
  } catch (err) {
    next(err);
  }
});

// GET single contract
router.get('/:id', requirePermission('contracts:read'), authorizeResource('contract'), async (req, res, next) => {
  try {
    const c = await contractsRepo.getById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json(c);
  } catch (err) {
    next(err);
  }
});

// CREATE contract
router.post('/', requirePermission('contracts:create'), authorizeProjectParent, authorizeExecutionReferences(), async (req, res, next) => {
  try {
    const c = await contractsRepo.create(req.body);
    res.status(201).json(c);
  } catch (err) {
    next(err);
  }
});

// UPDATE contract
router.put('/:id', requirePermission('contracts:update'), authorizeResource('contract'), authorizeExecutionReferences(), async (req, res, next) => {
  try {
    const c = await contractsRepo.update(req.params.id, req.body);
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json(c);
  } catch (err) {
    next(err);
  }
});

// EXECUTE contract (Atomic transaction: execute contract + unblock linked tasks)
router.post('/:id/execute', requirePermission('contracts:execute'), authorizeResource('contract'), async (req, res, next) => {
  try {
    const c = await contractsRepo.execute(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json(c);
  } catch (err) {
    next(err);
  }
});

// DELETE contract
router.delete('/:id', requirePermission('contracts:delete'), authorizeResource('contract'), async (req, res, next) => {
  try {
    const success = await contractsRepo.deleteContract(req.params.id, req.organizationId);
    if (!success) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
