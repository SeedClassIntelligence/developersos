// ═══════════════════════════════════════════════
// routes/projects.js
// Backed by durable PostgreSQL projects table
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const projectsRepo = require('../db/repositories/projects.repo');
const { requirePermission, authorizeResource } = require('../middleware/auth');

// GET all projects
router.get('/', requirePermission('projects:read'), async (req, res, next) => {
  try {
    const projects = await projectsRepo.getAll(req.organizationId);
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

// GET single project
router.get('/:id', requirePermission('projects:read'), authorizeResource('project'), async (req, res, next) => {
  try {
    const p = await projectsRepo.getById(req.params.id, req.organizationId);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    res.json(p);
  } catch (err) {
    next(err);
  }
});

// CREATE project
router.post('/', requirePermission('projects:create'), async (req, res, next) => {
  try {
    const p = await projectsRepo.create(req.body, req.organizationId);
    res.status(201).json(p);
  } catch (err) {
    next(err);
  }
});

// UPDATE project
router.put('/:id', requirePermission('projects:update'), authorizeResource('project'), async (req, res, next) => {
  try {
    const p = await projectsRepo.update(req.params.id, req.body, req.organizationId);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    res.json(p);
  } catch (err) {
    next(err);
  }
});

// DELETE project
router.delete('/:id', requirePermission('projects:delete'), authorizeResource('project'), async (req, res, next) => {
  try {
    const success = await projectsRepo.deleteProject(req.params.id, req.organizationId);
    if (!success) return res.status(404).json({ error: 'Project not found' });
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') { // foreign_key_violation — dependents exist (ON DELETE RESTRICT)
      return res.status(409).json({
        error: 'Project has dependent records (tasks, contracts, permits, capital, channels or documents). Remove or archive them first.',
      });
    }
    next(err);
  }
});

module.exports = router;
