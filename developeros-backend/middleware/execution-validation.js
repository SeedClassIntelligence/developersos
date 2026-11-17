// ══════════════════════════════════════════════════════════════
// middleware/execution-validation.js — request validation for execution
// write paths (tasks, contracts, permits, capital, messages, documents).
//
// Runs after permission and tenant checks. Server-owned fields (ids, sender
// identity) are never taken from the body. Vocabularies match what the
// product and the alert rules understand. Invalid input is a 400 with a
// message a person can act on.
// ══════════════════════════════════════════════════════════════

const { query } = require('../db/pool');

const TASK_STATUSES = ['not-started', 'in-progress', 'blocked', 'complete'];
const CONTRACT_STATUSES = ['pending', 'executed', 'missing'];
const PERMIT_STATUSES = ['draft', 'submitted', 'under-review', 'corrections', 'approved'];
const CORRECTION_STATUSES = ['not-started', 'in-progress', 'complete'];
const SOURCE_STATUSES = ['committed', 'pending'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = v => typeof v === 'string' && DATE.test(v) && !isNaN(new Date(`${v}T00:00:00Z`));
const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const optText = (v, max) => v === undefined || v === null || (typeof v === 'string' && v.length <= max);
const optDate = v => v === undefined || v === null || v === '' || isDate(v);
const optAmount = v => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

function bad(res, error) {
  return res.status(400).json({ error });
}

// Server-generated ids only.
function stripIds(b) {
  if (b && typeof b === 'object') delete b.id;
  return b;
}

// Every dependency must be another task of the same project. Unknown and
// foreign tasks are reported identically (no existence leak).
async function dependencyError(deps, projectId, selfId) {
  if (deps === undefined) return null;
  if (!Array.isArray(deps) || deps.length > 50 || deps.some(d => typeof d !== 'string')) return 'deps must be a list of task ids';
  const unique = [...new Set(deps)];
  if (selfId && unique.includes(selfId)) return 'a task cannot depend on itself';
  if (!unique.length) return null;
  const { rows } = await query('SELECT id FROM tasks WHERE id = ANY($1) AND project_id = $2', [unique, projectId]);
  return rows.length === unique.length ? null : 'deps must be tasks of the same project';
}

function validateTask({ create }) {
  return async (req, res, next) => {
    try {
      const b = stripIds(req.body || {});
      if (create && !isText(b.title, 300)) return bad(res, 'title is required (up to 300 characters)');
      if (!create && b.title !== undefined && !isText(b.title, 300)) return bad(res, 'title must be non-empty (up to 300 characters)');
      if (b.status !== undefined && !TASK_STATUSES.includes(b.status)) return bad(res, `status must be one of ${TASK_STATUSES.join(', ')}`);
      if (!optText(b.discipline, 50)) return bad(res, 'discipline must be text');
      if (!optText(b.note, 2000)) return bad(res, 'note must be text (up to 2000 characters)');
      if (!optDate(b.dueDate)) return bad(res, 'dueDate must be a date (YYYY-MM-DD)');
      if (b.dueDate === '') b.dueDate = null;
      let projectId = b.projectId;
      if (!create) {
        const { rows: [row] } = await query('SELECT project_id FROM tasks WHERE id = $1', [req.params.id]);
        projectId = row && row.project_id;
      }
      const depError = await dependencyError(b.deps, projectId, create ? null : req.params.id);
      if (depError) return bad(res, depError);
      if (Array.isArray(b.deps)) b.deps = [...new Set(b.deps)];
      next();
    } catch (err) { next(err); }
  };
}

function validateContract({ create }) {
  return (req, res, next) => {
    const b = stripIds(req.body || {});
    if (create && !isText(b.type, 200)) return bad(res, 'type is required (e.g. "Civil Engineering Services")');
    if (!create && b.type !== undefined && !isText(b.type, 200)) return bad(res, 'type must be non-empty');
    if (b.status !== undefined && !CONTRACT_STATUSES.includes(b.status)) return bad(res, `status must be one of ${CONTRACT_STATUSES.join(', ')}`);
    if (!optAmount(b.value)) return bad(res, 'value must be a non-negative number');
    if (!optDate(b.executedDate)) return bad(res, 'executedDate must be a date (YYYY-MM-DD)');
    if (b.linkedTaskCount !== undefined && !(Number.isInteger(b.linkedTaskCount) && b.linkedTaskCount >= 0)) return bad(res, 'linkedTaskCount must be a non-negative integer');
    next();
  };
}

function validatePermit({ create }) {
  return (req, res, next) => {
    const b = stripIds(req.body || {});
    if (create && !isText(b.name, 200)) return bad(res, 'name is required');
    if (!create && b.name !== undefined && !isText(b.name, 200)) return bad(res, 'name must be non-empty');
    if (b.status !== undefined && !PERMIT_STATUSES.includes(b.status)) return bad(res, `status must be one of ${PERMIT_STATUSES.join(', ')}`);
    if (!optText(b.jurisdiction, 200) || !optText(b.type, 100)) return bad(res, 'jurisdiction and type must be text');
    if (!optDate(b.submittedDate) || !optDate(b.approvedDate)) return bad(res, 'dates must be YYYY-MM-DD');
    if (b.corrections !== undefined) {
      if (!create) return bad(res, 'corrections are added and updated individually');
      if (!Array.isArray(b.corrections) || b.corrections.some(c => !c || !isText(c.text, 1000) || (c.status !== undefined && !CORRECTION_STATUSES.includes(c.status)))) {
        return bad(res, 'corrections must be a list of { text, status }');
      }
      b.corrections.forEach(stripIds);
    }
    next();
  };
}

function validatePermitStatus(req, res, next) {
  const status = req.body && req.body.status;
  if (!PERMIT_STATUSES.includes(status)) return bad(res, `status must be one of ${PERMIT_STATUSES.join(', ')}`);
  next();
}

function validateCorrection({ create }) {
  return (req, res, next) => {
    const b = stripIds(req.body || {});
    if (create && !isText(b.text, 1000)) return bad(res, 'text is required');
    if (!create && b.text !== undefined && !isText(b.text, 1000)) return bad(res, 'text must be non-empty');
    if (b.status !== undefined && !CORRECTION_STATUSES.includes(b.status)) return bad(res, `status must be one of ${CORRECTION_STATUSES.join(', ')}`);
    next();
  };
}

function validateCapital(req, res, next) {
  const b = stripIds(req.body || {});
  if (b.totalCost !== undefined && !optAmount(b.totalCost)) return bad(res, 'totalCost must be a non-negative number');
  if (b.sources !== undefined) {
    if (!Array.isArray(b.sources) || b.sources.length > 50) return bad(res, 'sources must be a list (up to 50)');
    for (const [i, s] of b.sources.entries()) {
      const at = `source ${i + 1}`;
      if (!s || typeof s !== 'object') return bad(res, `${at} must be an object`);
      stripIds(s);
      if (!isText(s.name, 255)) return bad(res, `${at}: name is required`);
      if (!isText(s.type, 100)) return bad(res, `${at}: type is required (e.g. debt, equity, grant)`);
      if (typeof s.amount !== 'number' || !optAmount(s.amount)) return bad(res, `${at}: amount must be a non-negative number`);
      if (s.status !== undefined && !SOURCE_STATUSES.includes(s.status)) return bad(res, `${at}: status must be committed or pending`);
      if (!optDate(s.deadline)) return bad(res, `${at}: deadline must be YYYY-MM-DD`);
      if (s.deadline === '') s.deadline = null;
      if (s.color !== undefined && s.color !== null && !/^#[0-9a-f]{3,8}$/i.test(s.color)) return bad(res, `${at}: color must be a hex color`);
      if (!optText(s.alert, 500)) return bad(res, `${at}: alert must be text`);
      delete s.pct; // derived from amount / total cost below, never trusted
    }
    const total = typeof b.totalCost === 'number' ? b.totalCost : null;
    for (const s of b.sources) {
      if (total > 0) s.pct = Math.min(999.99, Math.round((s.amount / total) * 10000) / 100);
    }
  }
  next();
}

// Project profile edits (creation is unchanged: projects will be created by authorization, WP6).
function validateProjectUpdate(req, res, next) {
  const b = req.body || {};
  const intIn = (v, min, max) => v === undefined || (Number.isInteger(v) && v >= min && v <= max);
  if (b.name !== undefined && !isText(b.name, 255)) return bad(res, 'name must be non-empty');
  if (!optText(b.type, 100) || !optText(b.program, 100) || !optText(b.city, 100) || !optText(b.phaseLabel, 100)) return bad(res, 'type, program, city and phaseLabel must be text');
  if (!intIn(b.units, 0, 100000) || !intIn(b.affordableUnits, 0, 100000)) return bad(res, 'units must be whole numbers');
  if (b.units !== undefined && b.affordableUnits !== undefined && b.affordableUnits > b.units) return bad(res, 'affordable units cannot exceed total units');
  if (b.budget !== undefined && !optAmount(b.budget)) return bad(res, 'budget must be a non-negative number');
  if (!intIn(b.progress, 0, 100)) return bad(res, 'progress must be a whole number from 0 to 100');
  if (!intIn(b.phase, 1, 6)) return bad(res, 'phase must be 1–6');
  if (b.status !== undefined && !['on-track', 'at-risk', 'blocked'].includes(b.status)) return bad(res, 'status must be on-track, at-risk or blocked');
  next();
}

function validateMessage(req, res, next) {
  const b = req.body || {};
  if (!isText(b.text, 5000)) return bad(res, 'text is required (up to 5000 characters)');
  next();
}

function validateChannel(req, res, next) {
  const b = stripIds(req.body || {});
  if (!isText(b.name, 80) || !/^[a-z0-9][a-z0-9-]*$/.test(b.name)) return bad(res, 'name must be lowercase letters, digits and dashes (e.g. "permits-and-city")');
  if (!optText(b.desc, 300)) return bad(res, 'desc must be text');
  next();
}

module.exports = {
  TASK_STATUSES, CONTRACT_STATUSES, PERMIT_STATUSES, CORRECTION_STATUSES, SOURCE_STATUSES,
  validateTask, validateContract, validatePermit, validatePermitStatus, validateCorrection,
  validateCapital, validateMessage, validateChannel, validateProjectUpdate, stripIds,
};
