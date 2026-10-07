// ═══════════════════════════════════════════════
// routes/team.js
// Backed by durable PostgreSQL team_members table
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const teamRepo = require('../db/repositories/team.repo');
const { requirePermission, authorizeResource } = require('../middleware/auth');

router.get('/', requirePermission('team:read'), async (req, res, next) => {
  try {
    const team = await teamRepo.getAll(req.organizationId);
    res.json(team);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('team:manage'), async (req, res, next) => {
  try {
    const m = await teamRepo.create(req.body, req.organizationId);
    res.status(201).json(m);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('team:manage'), authorizeResource('team'), async (req, res, next) => {
  try {
    const m = await teamRepo.update(req.params.id, req.body, req.organizationId);
    if (!m) return res.status(404).json({ error: 'Not found' });
    res.json(m);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('team:manage'), authorizeResource('team'), async (req, res, next) => {
  try {
    const success = await teamRepo.deleteMember(req.params.id, req.organizationId);
    if (!success) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
