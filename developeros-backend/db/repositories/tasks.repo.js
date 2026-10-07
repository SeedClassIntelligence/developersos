// ══════════════════════════════════════════════════════════════
// db/repositories/tasks.repo.js — Tasks Repository
// Handles SOW tasks and relational task_dependencies
// ══════════════════════════════════════════════════════════════

const { query, transaction } = require('../pool');
const { v4: uuidv4 } = require('uuid');

function mapRow(r, deps = []) {
  if (!r) return null;
  const res = {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    discipline: r.discipline,
    partnerId: r.partner_id,
    contractId: r.contract_id,
    status: r.status,
    dueDate: r.due_date instanceof Date ? r.due_date.toISOString().slice(0, 10) : r.due_date,
    note: r.note || '',
  };
  if (deps && deps.length > 0) {
    res.deps = deps;
  }
  return res;
}

async function getAll(filters = {}) {
  let sql = 'SELECT tasks.* FROM tasks JOIN projects ON projects.id = tasks.project_id WHERE projects.organization_id = $1';
  const params = [filters.organizationId];
  let idx = 2;

  if (filters.projectId) {
    sql += ` AND project_id = $${idx++}`;
    params.push(filters.projectId);
  }
  if (filters.status) {
    sql += ` AND tasks.status = $${idx++}`;
    params.push(filters.status);
  }
  if (filters.discipline) {
    sql += ` AND tasks.discipline = $${idx++}`;
    params.push(filters.discipline);
  }

  sql += ' ORDER BY tasks.id ASC';
  const { rows } = await query(sql, params);

  // Fetch all dependencies for returned tasks
  if (rows.length === 0) return [];
  const taskIds = rows.map(r => r.id);
  const { rows: depRows } = await query(`
    SELECT task_id, depends_on_task_id FROM task_dependencies
    WHERE task_id = ANY($1)
  `, [taskIds]);

  const depMap = {};
  depRows.forEach(d => {
    if (!depMap[d.task_id]) depMap[d.task_id] = [];
    depMap[d.task_id].push(d.depends_on_task_id);
  });

  return rows.map(r => mapRow(r, depMap[r.id]));
}

async function getById(id) {
  const { rows } = await query('SELECT * FROM tasks WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  const { rows: depRows } = await query(
    'SELECT depends_on_task_id FROM task_dependencies WHERE task_id = $1',
    [id]
  );
  const deps = depRows.map(d => d.depends_on_task_id);
  return mapRow(rows[0], deps);
}

async function create(data) {
  const id = data.id || ('t' + uuidv4().replace(/-/g, ''));
  return transaction(async (client) => {
    const { rows } = await client.query(`
      INSERT INTO tasks (id, project_id, title, discipline, partner_id, contract_id, status, due_date, note)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      id,
      data.projectId,
      data.title,
      data.discipline || null,
      data.partnerId || null,
      data.contractId || null,
      data.status || 'not-started',
      data.dueDate || null,
      data.note || '',
    ]);

    if (Array.isArray(data.deps)) {
      for (const depId of data.deps) {
        await client.query(`
          INSERT INTO task_dependencies (task_id, depends_on_task_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [id, depId]);
      }
    }

    return mapRow(rows[0], data.deps || []);
  });
}

async function update(id, data) {
  const existing = await getById(id);
  if (!existing) return null;

  return transaction(async (client) => {
    const title = data.title !== undefined ? data.title : existing.title;
    const discipline = data.discipline !== undefined ? data.discipline : existing.discipline;
    const partnerId = data.partnerId !== undefined ? data.partnerId : existing.partnerId;
    const contractId = data.contractId !== undefined ? data.contractId : existing.contractId;
    const status = data.status !== undefined ? data.status : existing.status;
    const dueDate = data.dueDate !== undefined ? data.dueDate : existing.dueDate;
    const note = data.note !== undefined ? data.note : existing.note;

    const { rows } = await client.query(`
      UPDATE tasks SET
        title = $1, discipline = $2, partner_id = $3, contract_id = $4,
        status = $5, due_date = $6, note = $7, updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `, [title, discipline, partnerId, contractId, status, dueDate, note, id]);

    if (Array.isArray(data.deps)) {
      await client.query('DELETE FROM task_dependencies WHERE task_id = $1', [id]);
      for (const depId of data.deps) {
        await client.query(`
          INSERT INTO task_dependencies (task_id, depends_on_task_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [id, depId]);
      }
    }

    const { rows: depRows } = await client.query(
      'SELECT depends_on_task_id FROM task_dependencies WHERE task_id = $1',
      [id]
    );
    const deps = depRows.map(d => d.depends_on_task_id);
    return mapRow(rows[0], deps);
  });
}

async function updateStatus(id, status) {
  const { rows } = await query(`
    UPDATE tasks SET status = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `, [status, id]);
  if (rows.length === 0) return null;
  const { rows: depRows } = await query(
    'SELECT depends_on_task_id FROM task_dependencies WHERE task_id = $1',
    [id]
  );
  return mapRow(rows[0], depRows.map(d => d.depends_on_task_id));
}

async function deleteTask(id, organizationId = null) {
  let sql = 'DELETE FROM tasks WHERE id = $1';
  const params = [id];
  if (organizationId) {
    sql = 'DELETE FROM tasks WHERE id = $1 AND project_id IN (SELECT id FROM projects WHERE organization_id = $2)';
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
  updateStatus,
  deleteTask,
};
