// ══════════════════════════════════════════════════════════════
// db/repositories/contracts.repo.js — Contracts Repository
// Features atomic transaction for execution + task unblocking
// ══════════════════════════════════════════════════════════════

const { query, transaction } = require('../pool');
const { v4: uuidv4 } = require('uuid');

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.project_id,
    partnerId: r.partner_id,
    type: r.type,
    status: r.status,
    value: r.value !== null ? Number(r.value) : null,
    executedDate: r.executed_date instanceof Date ? r.executed_date.toISOString().slice(0, 10) : r.executed_date,
    linkedTaskCount: Number(r.linked_task_count || 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function getAll(projectId = null, organizationId) {
  let sql = 'SELECT contracts.* FROM contracts JOIN projects ON projects.id = contracts.project_id WHERE projects.organization_id = $1';
  const params = [organizationId];
  if (projectId) {
    sql += ' AND project_id = $2';
    params.push(projectId);
  }
  sql += ' ORDER BY id ASC';
  const { rows } = await query(sql, params);
  return rows.map(mapRow);
}

async function getById(id) {
  const { rows } = await query('SELECT * FROM contracts WHERE id = $1', [id]);
  return mapRow(rows[0]);
}

async function create(data) {
  const id = data.id || ('c' + uuidv4().replace(/-/g, ''));
  const { rows } = await query(`
    INSERT INTO contracts (id, project_id, partner_id, type, status, value, executed_date, linked_task_count, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    RETURNING *
  `, [
    id,
    data.projectId,
    data.partnerId || null,
    data.type,
    data.status || 'pending',
    data.value !== undefined ? data.value : null,
    data.executedDate || null,
    Number(data.linkedTaskCount) || 0,
  ]);
  return mapRow(rows[0]);
}

async function update(id, data) {
  const existing = await getById(id);
  if (!existing) return null;

  const type = data.type !== undefined ? data.type : existing.type;
  const partnerId = data.partnerId !== undefined ? data.partnerId : existing.partnerId;
  const status = data.status !== undefined ? data.status : existing.status;
  const value = data.value !== undefined ? data.value : existing.value;
  const executedDate = data.executedDate !== undefined ? data.executedDate : existing.executedDate;
  const linkedTaskCount = data.linkedTaskCount !== undefined ? data.linkedTaskCount : existing.linkedTaskCount;

  const { rows } = await query(`
    UPDATE contracts SET
      type = $1, partner_id = $2, status = $3, value = $4,
      executed_date = $5, linked_task_count = $6, updated_at = NOW()
    WHERE id = $7
    RETURNING *
  `, [type, partnerId, status, value, executedDate, linkedTaskCount, id]);

  return mapRow(rows[0]);
}

// ── ATOMIC CONTRACT EXECUTION WITH DEPENDENT TASK UNBLOCKING ──
async function execute(id) {
  return transaction(async (client) => {
    // 1. Mark contract as executed
    const today = new Date().toISOString().slice(0, 10);
    const { rows: contractRows } = await client.query(`
      UPDATE contracts 
      SET status = 'executed', executed_date = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [today, id]);

    if (contractRows.length === 0) {
      return null;
    }

    // 2. Unblock all tasks waiting on this contract
    await client.query(`
      UPDATE tasks
      SET status = 'not-started', updated_at = NOW()
      WHERE contract_id = $1 AND status = 'blocked'
    `, [id]);

    return mapRow(contractRows[0]);
  });
}

async function deleteContract(id, organizationId = null) {
  let sql = 'DELETE FROM contracts WHERE id = $1';
  const params = [id];
  if (organizationId) {
    sql = 'DELETE FROM contracts WHERE id = $1 AND project_id IN (SELECT id FROM projects WHERE organization_id = $2)';
    params.push(organizationId);
  }
  const { rowCount } = await query(sql, params);
  return rowCount > 0;
}

module.exports = {
  getAll,
  getById,
  create,
  update,
  execute,
  deleteContract,
};
