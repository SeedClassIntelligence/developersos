// ══════════════════════════════════════════════════════════════
// routes/di.js — DEVOS-DI-1 Development Intelligence API (/api/di)
// Mounted behind protect + resolveOrganizationContext (EF-2). Order of
// checks per route: permission (403) → tenant-scoped existence (404) →
// request validation (400) → lifecycle rules (409).
// Server-owned fields (id, organizationId, status, provenance recorder and
// timestamps) are never read from the request body.
// ══════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const di = require('../db/repositories/di.repo');
const findings = require('../db/repositories/findings.repo');
const engine = require('../intelligence/engine');
const { requirePermission } = require('../middleware/auth');

const USER_SOURCE_TYPES = new Set(['USER_ENTRY', 'PUBLIC_RECORD', 'DOCUMENT', 'CONNECTED_SYSTEM']); // SYSTEM_DERIVED is system-only
const FACT_KEYS = new Set(['apn', 'ownership', 'lot_area_sqft', 'acquisition_basis', 'acquisition_structure', 'current_use',
  'zoning', 'future_land_use', 'overlays', 'density_du_per_acre', 'far', 'height_limit_ft', 'setbacks', 'parking', 'utilities',
  'access', 'easements', 'flood_zone', 'environmental', 'demolition', 'entitlement_path', 'known_constraints']);
const FACT_STATUSES = new Set(['KNOWN', 'UNKNOWN', 'NOT_APPLICABLE']);
const LIFECYCLE = ['NEW', 'SCREENING', 'INFORMATION_REQUIRED', 'READY_FOR_QUALIFICATION', 'DECLINED', 'WITHDRAWN', 'EXPIRED'];
const TRANSITIONS = {
  NEW: ['SCREENING', 'DECLINED', 'WITHDRAWN'],
  SCREENING: ['INFORMATION_REQUIRED', 'READY_FOR_QUALIFICATION', 'DECLINED', 'WITHDRAWN', 'EXPIRED'],
  INFORMATION_REQUIRED: ['SCREENING', 'READY_FOR_QUALIFICATION', 'DECLINED', 'WITHDRAWN', 'EXPIRED'],
  READY_FOR_QUALIFICATION: ['INFORMATION_REQUIRED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'],
  DECLINED: [], WITHDRAWN: [], EXPIRED: [],
};

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const bad = (res, error) => res.status(400).json({ error });
const notFound = res => res.status(404).json({ error: 'Not found' });
const nonEmpty = v => typeof v === 'string' && v.trim().length > 0;
const optString = v => v === undefined || v === null || typeof v === 'string';

function provenanceError(p) {
  if (!p || typeof p !== 'object') return 'provenance is required';
  if (p.sourceType === 'SYSTEM_DERIVED') return 'SYSTEM_DERIVED provenance is reserved for the system';
  if (!USER_SOURCE_TYPES.has(p.sourceType)) return 'provenance.sourceType must be USER_ENTRY, PUBLIC_RECORD, DOCUMENT or CONNECTED_SYSTEM';
  if (!optString(p.sourceReference)) return 'provenance.sourceReference must be a string';
  return null;
}

// References in a body must name records of the caller's organization.
async function foreignReference(org, b) {
  if (b.propertyId && !(await di.getPropertyRow(org, b.propertyId))) return true;
  if (b.relationshipId && !(await di.getRelationship(org, b.relationshipId))) return true;
  if (b.responsibleUserId && !(await di.isActiveMember(org, b.responsibleUserId))) return true;
  return false;
}

// ── relationships ────────────────────────────────────────────────────────────
router.get('/relationships', requirePermission('relationships:read'), wrap(async (req, res) => {
  res.json(await di.listRelationships(req.organizationId));
}));
router.post('/relationships', requirePermission('relationships:create'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!nonEmpty(b.name)) return bad(res, 'name is required');
  if (!nonEmpty(b.relationshipType)) return bad(res, 'relationshipType is required');
  const pe = provenanceError(b.provenance); if (pe) return bad(res, pe);
  res.status(201).json(await di.createRelationship(req.organizationId, req.user.id, b));
}));
router.get('/relationships/:id', requirePermission('relationships:read'), wrap(async (req, res) => {
  const r = await di.getRelationship(req.organizationId, req.params.id);
  return r ? res.json(r) : notFound(res);
}));
router.patch('/relationships/:id', requirePermission('relationships:update'), wrap(async (req, res) => {
  if (!(await di.getRelationship(req.organizationId, req.params.id))) return notFound(res);
  const b = req.body || {};
  if (b.name !== undefined && !nonEmpty(b.name)) return bad(res, 'name must be non-empty');
  if (b.relationshipType !== undefined && !nonEmpty(b.relationshipType)) return bad(res, 'relationshipType must be non-empty');
  if (b.status !== undefined && !['ACTIVE', 'INACTIVE'].includes(b.status)) return bad(res, 'status must be ACTIVE or INACTIVE');
  res.json(await di.updateRelationship(req.organizationId, req.params.id, { name: b.name, relationshipType: b.relationshipType, status: b.status }));
}));

// ── properties ───────────────────────────────────────────────────────────────
function addressError(a) {
  if (a === undefined) return null;
  if (!a || typeof a !== 'object') return 'address must be an object';
  return ['street', 'city', 'region', 'postalCode', 'country'].every(k => optString(a[k])) ? null : 'address fields must be strings';
}
router.get('/properties', requirePermission('properties:read'), wrap(async (req, res) => {
  res.json(await di.listProperties(req.organizationId));
}));
router.post('/properties', requirePermission('properties:create'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!nonEmpty(b.name)) return bad(res, 'name is required');
  const ae = addressError(b.address); if (ae) return bad(res, ae);
  if (!optString(b.apn)) return bad(res, 'apn must be a string');
  const pe = provenanceError(b.provenance); if (pe) return bad(res, pe);
  res.status(201).json(await di.createProperty(req.organizationId, req.user.id, b));
}));
router.get('/properties/:id', requirePermission('properties:read'), wrap(async (req, res) => {
  const p = await di.getProperty(req.organizationId, req.params.id);
  return p ? res.json(p) : notFound(res);
}));
router.patch('/properties/:id', requirePermission('properties:update'), wrap(async (req, res) => {
  if (!(await di.getPropertyRow(req.organizationId, req.params.id))) return notFound(res);
  const b = req.body || {};
  if (b.name !== undefined && !nonEmpty(b.name)) return bad(res, 'name must be non-empty');
  const ae = addressError(b.address); if (ae) return bad(res, ae);
  if (!optString(b.apn)) return bad(res, 'apn must be a string');
  res.json(await di.updateProperty(req.organizationId, req.params.id, { name: b.name, apn: b.apn, address: b.address }));
}));

// ── site intelligence (Property aggregate) ──────────────────────────────────
router.get('/properties/:id/site-intelligence', requirePermission('site_intelligence:read'), wrap(async (req, res) => {
  if (!(await di.getPropertyRow(req.organizationId, req.params.id))) return notFound(res);
  res.json(await di.getSiteIntelligence(req.organizationId, req.params.id));
}));
router.get('/properties/:id/site-intelligence/history', requirePermission('site_intelligence:read'), wrap(async (req, res) => {
  if (!(await di.getPropertyRow(req.organizationId, req.params.id))) return notFound(res);
  res.json(await di.getSiteIntelligenceHistory(req.organizationId, req.params.id));
}));
router.put('/properties/:id/site-intelligence', requirePermission('site_intelligence:update'), wrap(async (req, res) => {
  if (!(await di.getPropertyRow(req.organizationId, req.params.id))) return notFound(res);
  const facts = req.body && req.body.facts;
  if (!facts || typeof facts !== 'object' || Array.isArray(facts) || !Object.keys(facts).length) return bad(res, 'facts must be a non-empty object');
  // Validate every fact before writing any (all-or-nothing).
  for (const [key, f] of Object.entries(facts)) {
    if (!FACT_KEYS.has(key)) return bad(res, `unknown site fact "${key}"`);
    if (!f || typeof f !== 'object') return bad(res, `fact "${key}" must be an object`);
    if (!FACT_STATUSES.has(f.status)) return bad(res, `fact "${key}" status must be KNOWN, UNKNOWN or NOT_APPLICABLE`);
    const hasValue = f.value !== undefined && f.value !== null;
    if (f.status === 'KNOWN' && !hasValue) return bad(res, `fact "${key}" is KNOWN but has no value`);
    if (f.status !== 'KNOWN' && hasValue) return bad(res, `fact "${key}" is ${f.status}; a value must not be supplied`);
    const pe = provenanceError(f.provenance); if (pe) return bad(res, `fact "${key}": ${pe}`);
  }
  await di.putSiteFacts(req.organizationId, req.params.id, req.user.id, facts);
  res.json(await di.getSiteIntelligence(req.organizationId, req.params.id));
}));

// ── opportunities ────────────────────────────────────────────────────────────
router.get('/opportunities', requirePermission('opportunities:read'), wrap(async (req, res) => {
  res.json(await di.listOpportunities(req.organizationId));
}));
router.post('/opportunities', requirePermission('opportunities:create'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!nonEmpty(b.name)) return bad(res, 'name is required');
  if (b.concept !== undefined && (!b.concept || typeof b.concept !== 'object' || !optString(b.concept.description))) return bad(res, 'concept.description must be a string');
  for (const k of ['propertyId', 'relationshipId', 'responsibleUserId']) if (!optString(b[k])) return bad(res, `${k} must be a string`);
  const pe = provenanceError(b.provenance); if (pe) return bad(res, pe);
  if (await foreignReference(req.organizationId, b)) return notFound(res);
  res.status(201).json(await di.createOpportunity(req.organizationId, req.user.id, b));
}));
router.get('/opportunities/:id', requirePermission('opportunities:read'), wrap(async (req, res) => {
  const o = await di.getOpportunity(req.organizationId, req.params.id);
  return o ? res.json(o) : notFound(res);
}));
router.patch('/opportunities/:id', requirePermission('opportunities:update'), wrap(async (req, res) => {
  if (!(await di.getOpportunityRow(req.organizationId, req.params.id))) return notFound(res);
  const b = req.body || {};
  if (b.name !== undefined && !nonEmpty(b.name)) return bad(res, 'name must be non-empty');
  if (b.concept !== undefined && (!b.concept || typeof b.concept !== 'object' || !optString(b.concept.description))) return bad(res, 'concept.description must be a string');
  for (const k of ['propertyId', 'relationshipId', 'responsibleUserId']) if (!optString(b[k])) return bad(res, `${k} must be a string`);
  if (await foreignReference(req.organizationId, b)) return notFound(res);
  // status is deliberately not accepted: lifecycle changes only via /transition.
  res.json(await di.updateOpportunity(req.organizationId, req.params.id,
    { name: b.name, propertyId: b.propertyId, relationshipId: b.relationshipId, responsibleUserId: b.responsibleUserId, concept: b.concept }));
}));
router.post('/opportunities/:id/transition', requirePermission('opportunities:transition'), wrap(async (req, res) => {
  if (!(await di.getOpportunityRow(req.organizationId, req.params.id))) return notFound(res);
  const { to, reason } = req.body || {};
  if (!LIFECYCLE.includes(to)) return bad(res, `"${to}" is not a DI-1 lifecycle state`);
  if (!nonEmpty(reason)) return bad(res, 'reason is required');
  const result = await di.transitionOpportunity(req.organizationId, req.params.id, req.user.id, to, reason, async (row, client) => {
    if (!TRANSITIONS[row.status].includes(to)) return { conflict: { error: `Transition ${row.status} → ${to} is not allowed` } };
    if (to === 'READY_FOR_QUALIFICATION') {
      const r = await di.readinessFor(req.organizationId, row, client);
      if (r.status !== 'READY_FOR_QUALIFICATION') return { conflict: { error: 'Information required before qualification', missing: r.missing } };
    }
    return null;
  });
  if (result.notFound) return notFound(res);
  if (result.conflict) return res.status(409).json(result.conflict);
  res.json(result.opportunity);
}));
router.get('/opportunities/:id/history', requirePermission('opportunities:read'), wrap(async (req, res) => {
  if (!(await di.getOpportunityRow(req.organizationId, req.params.id))) return notFound(res);
  res.json(await di.opportunityHistory(req.organizationId, req.params.id));
}));
router.get('/opportunities/:id/readiness', requirePermission('opportunities:read'), wrap(async (req, res) => {
  const row = await di.getOpportunityRow(req.organizationId, req.params.id);
  if (!row) return notFound(res);
  res.json(await di.readinessFor(req.organizationId, row));
}));

// ── rules, evaluation, findings ─────────────────────────────────────────────
router.get('/rules', requirePermission('findings:read'), (req, res) => {
  res.json({ registryVersion: engine.registry.registryVersion, rules: engine.registry.rules });
});
router.post('/evaluate', requirePermission('findings:evaluate'), wrap(async (req, res) => {
  const b = req.body || {};
  const asOf = engine.parseAsOf(b.asOf);
  if (!asOf) return bad(res, 'asOf is required and must be an ISO-8601 instant (for example 2025-02-01T00:00:00Z)');
  if (b.dryRun !== undefined && typeof b.dryRun !== 'boolean') return bad(res, 'dryRun must be a boolean');
  // organizationId is always the authorized context, never the body.
  if (b.dryRun) return res.json(await findings.dryRun(req.organizationId, asOf));
  res.json(await findings.evaluate(req.organizationId, asOf, req.user.id));
}));
router.get('/findings', requirePermission('findings:read'), wrap(async (req, res) => {
  const list = await findings.list(req.organizationId, req.query.state);
  return list ? res.json(list) : bad(res, 'state must be OPEN, ACKNOWLEDGED, RESOLVED or ACTIVE');
}));
router.get('/findings/:id', requirePermission('findings:read'), wrap(async (req, res) => {
  const f = await findings.get(req.organizationId, req.params.id);
  return f ? res.json(f) : notFound(res);
}));
router.get('/findings/:id/history', requirePermission('findings:read'), wrap(async (req, res) => {
  if (!(await findings.get(req.organizationId, req.params.id))) return notFound(res);
  res.json(await findings.history(req.organizationId, req.params.id));
}));
router.post('/findings/:id/acknowledge', requirePermission('findings:acknowledge'), wrap(async (req, res) => {
  const note = req.body && req.body.note;
  if (!optString(note)) return bad(res, 'note must be a string');
  const r = await findings.move(req.organizationId, req.params.id, 'ACKNOWLEDGED', ['OPEN'], req.user.id, note);
  if (r.notFound) return notFound(res);
  if (r.conflict) return res.status(409).json({ error: r.conflict });
  res.json(r.finding);
}));
router.post('/findings/:id/resolve', requirePermission('findings:resolve'), wrap(async (req, res) => {
  if (!(await findings.get(req.organizationId, req.params.id))) return notFound(res);
  const note = req.body && req.body.note;
  if (!nonEmpty(note)) return bad(res, 'note is required');
  const r = await findings.move(req.organizationId, req.params.id, 'RESOLVED', ['OPEN', 'ACKNOWLEDGED'], req.user.id, note);
  if (r.notFound) return notFound(res);
  if (r.conflict) return res.status(409).json({ error: r.conflict });
  res.json(r.finding);
}));

module.exports = router;
