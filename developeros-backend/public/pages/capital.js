// ═══════════════════════════════════════════════
// CAPITAL.JS — renderCapital()
// TODO: GET /api/v1/capital?projectId=:id
// ═══════════════════════════════════════════════

function renderCapital() {
  const app = document.getElementById('app');
  const proj = currentProject();
  const stack = state.capitalStacks.find(s => s.projectId === proj?.id);
  if (!stack) { app.innerHTML = '<div style="padding:32px">No capital stack data.</div>'; return; }

  const committed = stack.sources.filter(s => s.status === 'committed').reduce((sum,s) => sum+s.amount, 0);
  const pending   = stack.sources.filter(s => s.status === 'pending').reduce((sum,s) => sum+s.amount, 0);

  app.innerHTML = `
    <div style="padding:28px 32px">
      <div class="panel-h">Capital Stack</div>
      <div class="panel-sub">${proj?.name} — ${fmt(stack.totalCost)} total development cost</div>

      <div class="grid-4" style="margin-bottom:24px">
        <div class="stat-box"><div class="stat-n" style="color:var(--gold)">${fmt(stack.totalCost)}</div><div class="stat-l">Total Dev Cost</div></div>
        <div class="stat-box"><div class="stat-n" style="color:var(--green)">${fmt(committed)}</div><div class="stat-l">Committed</div></div>
        <div class="stat-box"><div class="stat-n" style="color:var(--amber)">${fmt(pending)}</div><div class="stat-l">Pending</div></div>
        <div class="stat-box"><div class="stat-n" style="color:var(--teal)">${Math.round(committed/stack.totalCost*100)}%</div><div class="stat-l">Capitalized</div></div>
      </div>

      <div class="section-h">Sources & Uses</div>
      <div class="capital-stack">
        ${stack.sources.map(s => `
          <div class="cs-row">
            <div class="cs-bar" style="width:${Math.round(s.pct/2)}px;min-width:8px;background:${s.color}"></div>
            <div class="cs-source">${s.name}</div>
            <div><span class="badge ${s.status==='committed'?'badge-green':'badge-amber'}">${s.status}</span></div>
            <div class="cs-pct">${s.pct}%</div>
            <div class="cs-amount">${fmt(s.amount)}</div>
          </div>
        `).join('')}
      </div>

      ${stack.sources.filter(s => s.alert).map(s => `
        <div class="card" style="margin-top:16px;border-left:3px solid var(--amber)">
          <div class="card-h">⚠ ${s.name} — Deadline Alert</div>
          <div class="card-p" style="margin-top:6px">${s.alert}</div>
          <button class="btn btn-gold btn-sm" style="margin-top:12px" onclick="alert('Closing checklist — connect to /api/v1/capital/${s.id}/checklist')">View Closing Checklist</button>
        </div>
      `).join('')}
    </div>
  `;
}
