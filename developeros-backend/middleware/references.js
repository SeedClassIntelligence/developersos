// ══════════════════════════════════════════════════════════════
// middleware/references.js — same-tenant execution references (DI-1)
//
// Tasks and contracts feed the deterministic intelligence rules, so a body
// reference to another tenant's partner or contract must be refused before
// it is stored. Foreign or unknown references follow the EF-2 concealment
// policy (404). A same-tenant contract from a different project is a request
// error (400) instead of an unhandled database constraint failure (500).
// ══════════════════════════════════════════════════════════════

const { query } = require('../db/pool');

function authorizeExecutionReferences({ taskProjectFromRow = false } = {}) {
  return async (req, res, next) => {
    try {
      const b = req.body || {};
      if (b.partnerId) {
        const { rows } = await query('SELECT org_id FROM partners WHERE id = $1', [b.partnerId]);
        if (!rows[0] || rows[0].org_id !== req.organizationId) return res.status(404).json({ error: 'Not found' });
      }
      if (b.contractId) {
        const { rows } = await query(
          'SELECT c.project_id, p.organization_id FROM contracts c JOIN projects p ON p.id = c.project_id WHERE c.id = $1', [b.contractId]);
        if (!rows[0] || rows[0].organization_id !== req.organizationId) return res.status(404).json({ error: 'Not found' });
        let projectId = b.projectId;
        if (taskProjectFromRow) {
          const { rows: [task] } = await query('SELECT project_id FROM tasks WHERE id = $1', [req.params.id]);
          projectId = task && task.project_id;
        }
        if (projectId && rows[0].project_id !== projectId) {
          return res.status(400).json({ error: 'contractId belongs to a different project' });
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { authorizeExecutionReferences };
