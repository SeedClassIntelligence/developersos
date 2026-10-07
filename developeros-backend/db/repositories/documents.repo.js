// ══════════════════════════════════════════════════════════════
// db/repositories/documents.repo.js — Documents Repository
// ══════════════════════════════════════════════════════════════

const { query } = require('../pool');
const { v4: uuidv4 } = require('uuid');

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    category: r.category,
    uploadedBy: r.uploaded_by,
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
    type: r.type,
    icon: r.icon,
  };
}

async function getAll(filters = {}) {
  let sql = 'SELECT documents.* FROM documents JOIN projects ON projects.id = documents.project_id WHERE projects.organization_id = $1';
  const params = [filters.organizationId];
  let idx = 2;

  if (filters.projectId) {
    sql += ` AND project_id = $${idx++}`;
    params.push(filters.projectId);
  }
  if (filters.category) {
    sql += ` AND category = $${idx++}`;
    params.push(filters.category);
  }

  sql += ' ORDER BY documents.id ASC';
  const { rows } = await query(sql, params);
  return rows.map(mapRow);
}

async function create(data) {
  const id = data.id || ('d' + uuidv4().replace(/-/g, ''));
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await query(`
    INSERT INTO documents (id, project_id, name, category, uploaded_by, date, type, icon, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    RETURNING *
  `, [
    id,
    data.projectId,
    data.name,
    data.category || 'reports',
    data.uploadedBy || 'User',
    data.date || today,
    data.type || 'PDF',
    data.icon || '',
  ]);
  return mapRow(rows[0]);
}

async function deleteDocument(id) {
  const { rowCount } = await query('DELETE FROM documents WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  getAll,
  create,
  deleteDocument,
};
