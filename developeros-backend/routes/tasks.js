// ═══════════════════════════════════════════════
// routes/tasks.js
// Backed by durable PostgreSQL tasks & task_dependencies tables
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const tasksRepo = require('../db/repositories/tasks.repo');
const { requirePermission, authorizeResource, authorizeProjectParent } = require('../middleware/auth');

// GET tasks (optionally filter by projectId, status, discipline)
router.get('/', requirePermission('tasks:read'), async (req, res, next) => {
  try {
    const filters = {};
    if (req.query.projectId) filters.projectId = req.query.projectId;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.discipline) filters.discipline = req.query.discipline;

    const tasks = await tasksRepo.getAll({ ...filters, organizationId: req.organizationId });
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

// GET single task
router.get('/:id', requirePermission('tasks:read'), authorizeResource('task'), async (req, res, next) => {
  try {
    const t = await tasksRepo.getById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    res.json(t);
  } catch (err) {
    next(err);
  }
});

// CREATE task
router.post('/', requirePermission('tasks:create'), authorizeProjectParent, async (req, res, next) => {
  try {
    const t = await tasksRepo.create(req.body);
    res.status(201).json(t);
  } catch (err) {
    next(err);
  }
});

// UPDATE task
router.put('/:id', requirePermission('tasks:update'), authorizeResource('task'), async (req, res, next) => {
  try {
    const t = await tasksRepo.update(req.params.id, req.body);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    res.json(t);
  } catch (err) {
    next(err);
  }
});

// PATCH task status only
router.patch('/:id/status', requirePermission('tasks:status:update'), authorizeResource('task'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ['not-started', 'in-progress', 'blocked', 'complete'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const t = await tasksRepo.updateStatus(req.params.id, status);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    res.json(t);
  } catch (err) {
    next(err);
  }
});

// DELETE task
router.delete('/:id', requirePermission('tasks:delete'), authorizeResource('task'), async (req, res, next) => {
  try {
    const success = await tasksRepo.deleteTask(req.params.id, req.organizationId);
    if (!success) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
