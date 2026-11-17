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
    hasFile: !!r.storage_key,
    originalFilename: r.original_filename || null,
    contentType: r.content_type || null,
    sizeBytes: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
    sha256: r.sha256 || null,
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

// Returns the deleted row's storage key (or null for register-only entries), or false if absent.
async function deleteDocument(id) {
  const { rows } = await query('DELETE FROM documents WHERE id = $1 RETURNING storage_key', [id]);
  return rows.length ? (rows[0].storage_key || null) : false;
}

async function getRow(id) {
  const { rows } = await query('SELECT * FROM documents WHERE id = $1', [id]);
  return rows[0] || null;
}

// Records a stored file. `file` comes from services/storage.put().
async function createWithFile(data) {
  const { rows } = await query(`
    INSERT INTO documents (id, project_id, name, category, uploaded_by, date, type, icon, created_at,
      storage_key, original_filename, content_type, size_bytes, sha256, uploaded_by_user_id)
    VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, NOW(), $8, $9, $10, $11, $12, $13)
    RETURNING *
  `, [data.id, data.projectId, data.name, data.category, data.uploadedByName, data.typeLabel, data.icon,
    data.storageKey, data.originalFilename, data.contentType, data.size, data.sha256, data.uploadedByUserId]);
  return mapRow(rows[0]);
}

module.exports = {
  getRow,
  createWithFile,
  getAll,
  create,
  deleteDocument,
};
