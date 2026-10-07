// ═══════════════════════════════════════════════
// middleware/auth.js
// JWT verification + role-based access control
// ═══════════════════════════════════════════════

const jwt = require('jsonwebtoken');
const securityRepo = require('../db/repositories/security.repo');
const { query } = require('../db/pool');
const auditContext = require('../db/audit-context');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET not set. Refusing to start without a signing secret.');
  process.exit(1);
}

// ── protect — verify JWT on every request ─────
async function protect(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — no token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const identity = await securityRepo.findCurrentIdentity(decoded.id);
    if (!identity || !identity.active) {
      return res.status(401).json({ error: 'Authenticated identity is no longer active' });
    }
    // JWT establishes identity only. Mutable authority is resolved separately
    // from PostgreSQL for each protected request.
    req.user = { id: identity.id, name: identity.name, email: identity.email };
    auditContext.update({ actorUserId: identity.id });
    req.authToken = { organizationId: decoded.orgId || null };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired — please log in again' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function resolveOrganizationContext(req, res, next) {
  try {
    const requestedOrganizationId = req.get('X-Organization-Id') || req.authToken?.organizationId;
    if (!requestedOrganizationId) {
      return res.status(403).json({ error: 'No authorized organization context' });
    }
    const membership = await securityRepo.resolveActiveMembership(req.user.id, requestedOrganizationId);
    if (!membership) {
      return res.status(403).json({ error: 'No authorized organization context' });
    }
    req.authorization = membership;
    req.organizationId = membership.organizationId;
    auditContext.update({ organizationId: membership.organizationId });
    next();
  } catch (err) {
    next(err);
  }
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.authorization?.permissions?.includes(permission)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

const ownershipQueries = {
  project: 'SELECT organization_id FROM projects WHERE id = $1',
  task: `SELECT p.organization_id FROM tasks r JOIN projects p ON p.id = r.project_id WHERE r.id = $1`,
  contract: `SELECT p.organization_id FROM contracts r JOIN projects p ON p.id = r.project_id WHERE r.id = $1`,
  permit: `SELECT p.organization_id FROM permits r JOIN projects p ON p.id = r.project_id WHERE r.id = $1`,
  channel: `SELECT p.organization_id FROM channels r JOIN projects p ON p.id = r.project_id WHERE r.id = $1`,
  document: `SELECT p.organization_id FROM documents r JOIN projects p ON p.id = r.project_id WHERE r.id = $1`,
  team: 'SELECT organization_id FROM team_members WHERE id = $1',
};

function authorizeResource(resource, idResolver = req => req.params.id) {
  return async (req, res, next) => {
    try {
      const sql = ownershipQueries[resource];
      if (!sql) throw new Error(`Unknown authorization resource: ${resource}`);
      const id = idResolver(req);
      const { rows } = await query(sql, [id]);
      if (!rows[0] || rows[0].organization_id !== req.organizationId) {
        return res.status(404).json({ error: 'Not found' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

const authorizeProjectParent = authorizeResource('project', req => req.body?.projectId || req.params.projectId);

// ── adminOnly — requires explicit platform permission ─────────
function adminOnly(req, res, next) {
  if (!req.authorization?.permissions?.includes('platform:admin:stats')) {
    return res.status(403).json({ error: 'Forbidden — admin access required' });
  }
  next();
}

// ── signToken — create JWT ─────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user.id, orgId: user.orgId || null },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

module.exports = {
  protect,
  resolveOrganizationContext,
  requirePermission,
  authorizeResource,
  authorizeProjectParent,
  adminOnly,
  signToken,
};
