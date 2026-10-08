// ═══════════════════════════════════════════════
// routes/members.js — organization members (accounts and access)
//   GET   /api/members           team:read          directory of the active organization
//   GET   /api/members/roles     team:read          assignable organization roles
//   PATCH /api/members/:userId   org:admin:manage   { roleId?, status: ACTIVE | INACTIVE }
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const membersRepo = require('../db/repositories/members.repo');
const { requirePermission } = require('../middleware/auth');

router.get('/', requirePermission('team:read'), async (req, res, next) => {
  try {
    res.json(await membersRepo.list(req.organizationId));
  } catch (err) { next(err); }
});

router.get('/roles', requirePermission('team:read'), async (req, res, next) => {
  try {
    res.json(await membersRepo.organizationRoles());
  } catch (err) { next(err); }
});

router.patch('/:userId', requirePermission('org:admin:manage'), async (req, res, next) => {
  try {
    const { roleId, status } = req.body || {};
    if (roleId === undefined && status === undefined) return res.status(400).json({ error: 'roleId or status is required' });
    if (roleId !== undefined && typeof roleId !== 'string') return res.status(400).json({ error: 'roleId must be a string' });
    if (status !== undefined && !['ACTIVE', 'INACTIVE'].includes(status)) return res.status(400).json({ error: 'status must be ACTIVE or INACTIVE' });
    // Administrators cannot change their own access (prevents self-lockout); another administrator must.
    if (req.params.userId === req.user.id) return res.status(409).json({ error: 'You cannot change your own role or access' });
    const result = await membersRepo.update(req.organizationId, req.params.userId, { roleId, status });
    if (result.notFound) return res.status(404).json({ error: 'Not found' });
    if (result.invalid) return res.status(400).json({ error: result.invalid });
    if (result.conflict) return res.status(409).json({ error: result.conflict });
    res.json(result.member);
  } catch (err) { next(err); }
});

module.exports = router;
