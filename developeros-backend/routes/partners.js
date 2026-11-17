// ═══════════════════════════════════════════════
// routes/partners.js — tenant partner directory (consultants, contractors)
//   GET   /api/partners        projects:read
//   POST  /api/partners        partners:manage   { name, role, initials? }
//   PATCH /api/partners/:id    partners:manage   { name?, role?, initials? }
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const partnersRepo = require('../db/repositories/partners.repo');
const { requirePermission } = require('../middleware/auth');

const ROLES = ['architect', 'civil', 'structural', 'landscape', 'mep', 'survey', 'environmental', 'geotechnical', 'contractor', 'legal', 'lender', 'investor', 'consultant', 'other'];

function partnerError(b, create) {
  if (create || b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 255) return 'name is required (up to 255 characters)';
  }
  if (create || b.role !== undefined) {
    if (!ROLES.includes(b.role)) return `role must be one of ${ROLES.join(', ')}`;
  }
  if (b.initials !== undefined && b.initials !== null && !/^[A-Za-z0-9]{1,4}$/.test(b.initials)) return 'initials must be 1–4 letters or digits';
  return null;
}

router.get('/', requirePermission('projects:read'), async (req, res, next) => {
  try {
    res.json(await partnersRepo.getAll(req.organizationId));
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('partners:manage'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const error = partnerError(b, true);
    if (error) return res.status(400).json({ error });
    res.status(201).json(await partnersRepo.create(req.organizationId, b));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requirePermission('partners:manage'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const error = partnerError(b, false);
    if (error) return res.status(400).json({ error });
    const p = await partnersRepo.update(req.organizationId, req.params.id, b);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
