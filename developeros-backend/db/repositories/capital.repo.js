// ══════════════════════════════════════════════════════════════
// db/repositories/capital.repo.js — Capital Stack & Sources Repository
// Relational capital_stacks & capital_sources with exact numeric precision
// ══════════════════════════════════════════════════════════════

const { query, transaction } = require('../pool');
const { v4: uuidv4 } = require('uuid');

function mapStack(r, sources = []) {
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.project_id,
    totalCost: Number(r.total_cost),
    sources: sources.map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
      amount: Number(s.amount),
      pct: s.pct !== null ? Number(s.pct) : null,
      status: s.status,
      color: s.color,
      deadline: s.deadline instanceof Date ? s.deadline.toISOString().slice(0, 10) : s.deadline,
      alert: s.alert,
    })),
  };
}

async function getAll(projectId = null, organizationId) {
  let sql = 'SELECT capital_stacks.* FROM capital_stacks JOIN projects ON projects.id = capital_stacks.project_id WHERE projects.organization_id = $1';
  const params = [organizationId];
  if (projectId) {
    sql += ' AND project_id = $2';
    params.push(projectId);
  }
  sql += ' ORDER BY id ASC';
  const { rows } = await query(sql, params);
  if (rows.length === 0) return [];

  const stackIds = rows.map(r => r.id);
  const { rows: sourceRows } = await query(`
    SELECT * FROM capital_sources
    WHERE capital_stack_id = ANY($1)
    ORDER BY id ASC
  `, [stackIds]);

  const sourceMap = {};
  sourceRows.forEach(s => {
    if (!sourceMap[s.capital_stack_id]) sourceMap[s.capital_stack_id] = [];
    sourceMap[s.capital_stack_id].push(s);
  });

  return rows.map(r => mapStack(r, sourceMap[r.id] || []));
}

async function getByProjectId(projectId) {
  const { rows } = await query('SELECT * FROM capital_stacks WHERE project_id = $1', [projectId]);
  if (rows.length === 0) return null;
  const { rows: sourceRows } = await query(
    'SELECT * FROM capital_sources WHERE capital_stack_id = $1 ORDER BY id ASC',
    [rows[0].id]
  );
  return mapStack(rows[0], sourceRows);
}

async function save(projectId, data) {
  return transaction(async (client) => {
    const totalCost = Number(data.totalCost || 0);
    const stackId = data.id || ('cap-' + projectId);

    const { rows: existing } = await client.query('SELECT * FROM capital_stacks WHERE project_id = $1', [projectId]);

    let stackRow;
    if (existing.length === 0) {
      const { rows } = await client.query(`
        INSERT INTO capital_stacks (id, project_id, total_cost, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING *
      `, [stackId, projectId, totalCost]);
      stackRow = rows[0];
    } else {
      const { rows } = await client.query(`
        UPDATE capital_stacks SET total_cost = $1, updated_at = NOW()
        WHERE project_id = $2
        RETURNING *
      `, [totalCost, projectId]);
      stackRow = rows[0];
    }

    if (Array.isArray(data.sources)) {
      await client.query('DELETE FROM capital_sources WHERE capital_stack_id = $1', [stackRow.id]);
      for (const s of data.sources) {
        const srcId = s.id || ('cap' + uuidv4().replace(/-/g, ''));
        await client.query(`
          INSERT INTO capital_sources (id, capital_stack_id, name, type, amount, pct, status, color, deadline, alert)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          srcId,
          stackRow.id,
          s.name,
          s.type,
          Number(s.amount || 0),
          s.pct !== undefined ? Number(s.pct) : null,
          s.status || 'pending',
          s.color || '#1A2332',
          s.deadline || null,
          s.alert || null,
        ]);
      }
    }

    const { rows: finalSources } = await client.query(
      'SELECT * FROM capital_sources WHERE capital_stack_id = $1 ORDER BY id ASC',
      [stackRow.id]
    );

    return mapStack(stackRow, finalSources);
  });
}

module.exports = {
  getAll,
  getByProjectId,
  save,
};
