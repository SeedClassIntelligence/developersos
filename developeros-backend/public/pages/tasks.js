// ═══════════════════════════════════════════════
// TASKS.JS — renderTasks()
// TODO: GET /api/v1/tasks?projectId=:id
// ═══════════════════════════════════════════════

function renderTasks() {
  const app = document.getElementById('app');
  const cols = [
    { status: 'not-started', label: '⬡ Not Started', colorClass: '', countClass: '' },
    { status: 'in-progress', label: '◈ In Progress',  colorClass: 'style="color:var(--blue)"', countClass: 'style="background:rgba(58,106,154,.1);color:var(--blue)"' },
    { status: 'blocked',     label: '⊗ Blocked',      colorClass: 'style="color:var(--red)"',  countClass: 'style="background:rgba(168,74,58,.1);color:var(--red)"' },
    { status: 'complete',    label: '✓ Complete',      colorClass: 'style="color:var(--green)"',countClass: 'style="background:rgba(58,122,74,.1);color:var(--green)"' },
  ];

  app.className = 'app-main';
  app.innerHTML = `
    <!-- Toolbar -->
    <div class="tb-toolbar">
      <strong style="font-size:13px;color:var(--navy)">SOW Task Board</strong>
      <select class="tb-filter" id="filter-discipline" onchange="filterTasks()">
        <option value="">All Disciplines</option>
        <option value="arch">Architectural</option>
        <option value="civil">Civil</option>
        <option value="structural">Structural</option>
        <option value="landscape">Landscape</option>
        <option value="mep">MEP</option>
      </select>
      <select class="tb-filter" id="filter-contract" onchange="filterTasks()">
        <option value="">All Contracts</option>
        <option value="missing">Missing Contract</option>
        <option value="executed">Executed Only</option>
      </select>
      <button class="btn btn-navy btn-sm" style="margin-left:auto" onclick="alert('Add task — connect to POST /api/v1/tasks')">+ Add Task</button>
    </div>

    <!-- Kanban -->
    <div class="kanban" id="kanban-board">
      ${cols.map(col => {
        const tasks = tasksByStatus(col.status);
        return `
          <div class="kanban-col" data-status="${col.status}">
            <div class="col-header">
              <span class="col-title" ${col.colorClass}>
                ${col.label}
                <span class="col-count" ${col.countClass}>${tasks.length}</span>
              </span>
            </div>
            <div class="col-body" id="col-${col.status}">
              ${tasks.map(t => renderTaskCard(t)).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function filterTasks() {
  const discipline = document.getElementById('filter-discipline')?.value || '';
  const contract   = document.getElementById('filter-contract')?.value || '';

  let tasks = currentProjectTasks();

  if (discipline) tasks = tasks.filter(t => t.discipline === discipline);
  if (contract === 'missing')  tasks = tasks.filter(t => !t.contractId || contractStatus(t.contractId).ok === false);
  if (contract === 'executed') tasks = tasks.filter(t => t.contractId  && contractStatus(t.contractId).ok === true);

  // Re-render each column with filtered tasks
  ['not-started','in-progress','blocked','complete'].forEach(status => {
    const col = document.getElementById(`col-${status}`);
    if (col) col.innerHTML = tasks.filter(t => t.status === status).map(t => renderTaskCard(t)).join('');
  });
}
