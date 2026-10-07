// ══════════════════════════════════════════════════════════════
// db/repositories/permits.repo.js — Permits & Corrections Repository
// Normalizes permits and permit_corrections while preserving nested JSON API
// ══════════════════════════════════════════════════════════════

const { query, transaction } = require('../pool');
const { v4: uuidv4 } = require('uuid');

function mapPermit(r, corrections = []) {
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    jurisdiction: r.jurisdiction,
    type: r.type,
    status: r.status,
    submittedDate: r.submitted_date instanceof Date ? r.submitted_date.toISOString().slice(0, 10) : r.submitted_date,
    approvedDate: r.approved_date instanceof Date ? r.approved_date.toISOString().slice(0, 10) : r.approved_date,
    corrections: corrections.map(c => ({
      id: c.id,
      text: c.text,
      status: c.status,
    })),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function getAll(projectId = null, organizationId) {
  let sql = 'SELECT permits.* FROM permits JOIN projects ON projects.id = permits.project_id WHERE projects.organization_id = $1';
  const params = [organizationId];
  if (projectId) {
    sql += ' AND project_id = $2';
    params.push(projectId);
  }
  sql += ' ORDER BY id ASC';
  const { rows } = await query(sql, params);
  if (rows.length === 0) return [];

  const permitIds = rows.map(r => r.id);
  const { rows: corrRows } = await query(`
    SELECT * FROM permit_corrections
    WHERE permit_id = ANY($1)
    ORDER BY id ASC
  `, [permitIds]);

  const corrMap = {};
  corrRows.forEach(c => {
    if (!corrMap[c.permit_id]) corrMap[c.permit_id] = [];
    corrMap[c.permit_id].push(c);
  });

  return rows.map(r => mapPermit(r, corrMap[r.id] || []));
}

async function getById(id) {
  const { rows } = await query('SELECT * FROM permits WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  const { rows: corrRows } = await query('SELECT * FROM permit_corrections WHERE permit_id = $1 ORDER BY id ASC', [id]);
  return mapPermit(rows[0], corrRows);
}

async function create(data) {
  const id = data.id || ('pm' + uuidv4().replace(/-/g, ''));
  return transaction(async (client) => {
    const { rows } = await client.query(`
      INSERT INTO permits (id, project_id, name, jurisdiction, type, status, submitted_date, approved_date, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *
    `, [
      id,
      data.projectId,
      data.name,
      data.jurisdiction || null,
      data.type || 'building',
      data.status || 'draft',
      data.submittedDate || null,
      data.approvedDate || null,
    ]);

    const createdCorrections = [];
    if (Array.isArray(data.corrections)) {
      for (const cor of data.corrections) {
        const corId = cor.id || ('cor' + uuidv4().replace(/-/g, ''));
        const { rows: cRows } = await client.query(`
          INSERT INTO permit_corrections (id, permit_id, text, status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, NOW(), NOW())
          RETURNING *
        `, [corId, id, cor.text, cor.status || 'not-started']);
        createdCorrections.push(cRows[0]);
      }
    }

    return mapPermit(rows[0], createdCorrections);
  });
}

async function update(id, data) {
  const existing = await getById(id);
  if (!existing) return null;

  const name = data.name !== undefined ? data.name : existing.name;
  const jurisdiction = data.jurisdiction !== undefined ? data.jurisdiction : existing.jurisdiction;
  const type = data.type !== undefined ? data.type : existing.type;
  const status = data.status !== undefined ? data.status : existing.status;
  const submittedDate = data.submittedDate !== undefined ? data.submittedDate : existing.submittedDate;
  const approvedDate = data.approvedDate !== undefined ? data.approvedDate : existing.approvedDate;

  const { rows } = await query(`
    UPDATE permits SET
      name = $1, jurisdiction = $2, type = $3, status = $4,
      submitted_date = $5, approved_date = $6, updated_at = NOW()
    WHERE id = $7
    RETURNING *
  `, [name, jurisdiction, type, status, submittedDate, approvedDate, id]);

  const { rows: corrRows } = await query('SELECT * FROM permit_corrections WHERE permit_id = $1 ORDER BY id ASC', [id]);
  return mapPermit(rows[0], corrRows);
}

async function updateStatus(id, status) {
  const { rows } = await query(`
    UPDATE permits SET status = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `, [status, id]);
  if (rows.length === 0) return null;
  const { rows: corrRows } = await query('SELECT * FROM permit_corrections WHERE permit_id = $1 ORDER BY id ASC', [id]);
  return mapPermit(rows[0], corrRows);
}

async function updateCorrection(permitId, corrId, data) {
  const { rows: existing } = await query(
    'SELECT * FROM permit_corrections WHERE id = $1 AND permit_id = $2',
    [corrId, permitId]
  );
  if (existing.length === 0) return null;

  const text = data.text !== undefined ? data.text : existing[0].text;
  const status = data.status !== undefined ? data.status : existing[0].status;

  const { rows } = await query(`
    UPDATE permit_corrections SET text = $1, status = $2, updated_at = NOW()
    WHERE id = $3 AND permit_id = $4
    RETURNING *
  `, [text, status, corrId, permitId]);

  return {
    id: rows[0].id,
    text: rows[0].text,
    status: rows[0].status,
  };
}

module.exports = {
  getAll,
  getById,
  create,
  update,
  updateStatus,
  updateCorrection,
};
