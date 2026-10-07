// ═══════════════════════════════════════════════
// middleware/validate.js
// Input sanitization and validation
// Prevents SQL injection, XSS, bad data
// ═══════════════════════════════════════════════

const { body, param, query, validationResult } = require('express-validator');

// ── Run validations and return errors ──────────
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

// ── Sanitize all string inputs ─────────────────
function sanitizeInputs(req, res, next) {
  function clean(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    Object.keys(obj).forEach(key => {
      if (typeof obj[key] === 'string') {
        // Strip dangerous characters, trim whitespace
        obj[key] = obj[key]
          .trim()
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+\s*=/gi, '');
      } else if (typeof obj[key] === 'object') {
        clean(obj[key]);
      }
    });
    return obj;
  }
  if (req.body)  clean(req.body);
  if (req.query) clean(req.query);
  next();
}

// ── Validation rule sets ───────────────────────

const rules = {
  login: [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password min 8 characters'),
  ],

  register: [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name required (2-100 chars)'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password min 8 characters'),
    body('role').optional().isIn(['developer','architect','civil','contractor','municipal','investor','service-provider','admin']).withMessage('Invalid role'),
  ],

  createProject: [
    body('name').trim().isLength({ min: 2, max: 200 }).withMessage('Project name required'),
    body('type').isIn(['Affordable Housing','Market Rate','Supportive Housing','Senior Housing','Workforce Housing','Mixed Income']).withMessage('Invalid project type'),
    body('units').isInt({ min: 1 }).withMessage('Units must be a positive integer'),
    body('budget').isFloat({ min: 0 }).withMessage('Budget must be a positive number'),
  ],

  createTask: [
    body('title').trim().isLength({ min: 2, max: 300 }).withMessage('Task title required'),
    body('projectId').notEmpty().withMessage('projectId required'),
    body('status').optional().isIn(['not-started','in-progress','blocked','complete']).withMessage('Invalid status'),
    body('discipline').optional().isIn(['arch','civil','structural','landscape','mep','survey','environmental','geotechnical','contractor']).withMessage('Invalid discipline'),
  ],

  updateStatus: [
    body('status').isIn(['not-started','in-progress','blocked','complete']).withMessage('Invalid status'),
  ],

  sendMessage: [
    body('text').trim().isLength({ min: 1, max: 5000 }).withMessage('Message cannot be empty or over 5000 chars'),
  ],

  idParam: [
    param('id').trim().isLength({ min: 1, max: 100 }).withMessage('Invalid ID'),
  ],
};

module.exports = { validate, sanitizeInputs, rules };
