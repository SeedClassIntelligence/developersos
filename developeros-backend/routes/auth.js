// ═══════════════════════════════════════════════
// routes/auth.js
// Login, register, token refresh
// Backed by durable PostgreSQL users table
// ═══════════════════════════════════════════════

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { signToken, protect } = require('../middleware/auth');
const authRepo = require('../db/repositories/auth.repo');
const securityRepo = require('../db/repositories/security.repo');

// ── POST /api/auth/login ───────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await authRepo.findByEmail(email);

    // Constant-time compare to mitigate timing enumeration attacks
    const passwordToCheck = user ? user.passwordHash : '$2a$12$invalid.hash.to.prevent.timing';
    const isValid = await bcrypt.compare(password, passwordToCheck);

    if (!user || !isValid || !user.active) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const memberships = await securityRepo.listActiveMemberships(user.id);
    const selected = memberships.find(m => m.organizationId === user.orgId) || memberships[0] || null;
    const token = signToken({ ...user, orgId: selected?.organizationId || null });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        orgId: selected?.organizationId || null,
      },
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /api/auth/register ────────────────────
router.post('/register', async (req, res) => {
  return res.status(403).json({
    error: 'Public registration is disabled; an authorized invitation is required',
  });
});

router.get('/context', protect, async (req, res, next) => {
  try {
    const memberships = await securityRepo.listActiveMemberships(req.user.id);
    const requested = req.get('X-Organization-Id') || req.authToken?.organizationId;
    const membership = memberships.find(m => m.organizationId === requested) ||
      (!requested && memberships.length === 1 ? memberships[0] : null);
    if (!membership) return res.status(403).json({ error: 'No authorized organization context' });
    res.json(membership);
  } catch (err) {
    next(err);
  }
});

router.post('/switch-context', protect, async (req, res, next) => {
  try {
    const organizationId = req.body?.organizationId;
    if (typeof organizationId !== 'string' || !organizationId) {
      return res.status(400).json({ error: 'organizationId is required' });
    }
    const membership = await securityRepo.resolveActiveMembership(req.user.id, organizationId);
    if (!membership) return res.status(403).json({ error: 'No authorized organization context' });
    const token = signToken({ id: req.user.id, orgId: membership.organizationId });
    res.json({ token, ...membership });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/memberships ──────────────────
// Organizations the signed-in user belongs to (for the organization switcher).
router.get('/memberships', protect, async (req, res, next) => {
  try {
    res.json(await securityRepo.listMembershipOrganizations(req.user.id));
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ───────────────────────────
router.get('/me', protect, async (req, res) => {
  try {
    const user = await authRepo.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { passwordHash, ...safeUser } = user;
    res.json(safeUser);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve user profile' });
  }
});

// ── POST /api/auth/change-password ────────────
router.post('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = await authRepo.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) return res.status(401).json({ error: 'Current password incorrect' });

    const newHash = await bcrypt.hash(newPassword, 12);
    await authRepo.updatePassword(user.id, newHash);

    res.json({ success: true, message: 'Password updated' });

  } catch (err) {
    res.status(500).json({ error: 'Password change failed' });
  }
});

module.exports = router;
