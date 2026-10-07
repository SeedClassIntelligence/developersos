// ═══════════════════════════════════════════════
// PORTFOLIO.JS — renderPortfolio()
// TODO: replace state.projects with
//       GET /api/v1/projects
// ═══════════════════════════════════════════════

function renderPortfolio() {
  const app = document.getElementById('app');
  const totalUnits = state.projects.reduce((s,p) => s + p.units, 0);
  const affordableUnits = state.projects.reduce((s,p) => s + p.affordableUnits, 0);
  const totalAlerts = state.projects.reduce((s,p) => s + p.alertCount, 0);

  app.innerHTML = `
    <div style="padding:28px 32px">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div>
          <div class="panel-h">Portfolio</div>
          <div class="panel-sub">All active development projects</div>
        </div>
        <button class="btn btn-navy btn-sm" onclick="alert('New project form — connect to POST /api/v1/projects')">+ New Project</button>
      </div>

      <!-- Stats -->
      <div class="grid-4" style="margin-bottom:28px">
        <div class="stat-box"><div class="stat-n">${state.projects.length}</div><div class="stat-l">Active Projects</div></div>
        <div class="stat-box"><div class="stat-n" style="color:var(--gold)">${totalUnits.toLocaleString()}</div><div class="stat-l">Total Units</div></div>
        <div class="stat-box"><div class="stat-n" style="color:var(--teal)">${affordableUnits.toLocaleString()}</div><div class="stat-l">Affordable Units</div></div>
        <div class="stat-box"><div class="stat-n" style="color:var(--red)">${totalAlerts}</div><div class="stat-l">Open Alerts</div></div>
      </div>

      <!-- Project cards -->
      <div class="portfolio-grid">
        ${state.projects.map(p => renderProjectCard(p)).join('')}
      </div>
    </div>
  `;
}

function renderProjectCard(p) {
  const color = { 'on-track': 'green', 'at-risk': 'amber', 'blocked': 'red' }[p.status] || 'green';
  const dotColor = { 'on-track': 'dot-green', 'at-risk': 'dot-amber', 'blocked': 'dot-red' }[p.status];
  const alertHtml = p.alertCount > 0
    ? `<span class="pc-alerts">⚠ ${p.alertCount} alert${p.alertCount>1?'s':''}</span>`
    : `<span style="font-size:11px;color:var(--green)">0 alerts</span>`;

  return `
    <div class="proj-card ${color}" onclick="navigate('project','${p.id}')">
      <div class="pc-header">
        <div>
          <div class="pc-name">${p.name}</div>
          <div class="pc-type">${p.type} · ${p.units} Units</div>
        </div>
        <div class="pc-status">
          <span class="status-dot ${dotColor}"></span>
          <span style="font-size:10px;color:${statusColor(p.status)}">${statusLabel(p.status)}</span>
        </div>
      </div>
      <div class="pc-metrics">
        <div class="pc-metric"><div class="pc-m-n">${fmt(p.budget)}</div><div class="pc-m-l">Budget</div></div>
        <div class="pc-metric"><div class="pc-m-n">${p.progress}%</div><div class="pc-m-l">Complete</div></div>
        <div class="pc-metric"><div class="pc-m-n">P${p.phase}</div><div class="pc-m-l">Phase</div></div>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${p.progress}%;background:${statusColor(p.status)}"></div>
      </div>
      <div class="pc-footer" style="margin-top:10px">
        <span>${p.phaseLabel}</span>
        ${alertHtml}
      </div>
    </div>
  `;
}
