// ═══════════════════════════════════════════════
// PROJECT.JS — renderProject()
// TODO: GET /api/v1/projects/:id
// ═══════════════════════════════════════════════

function renderProject() {
  const app = document.getElementById('app');
  const p = currentProject();
  if (!p) { app.innerHTML = '<div style="padding:32px">No project selected.</div>'; return; }

  const phases = ['Predevelopment','Entitlements','Design Development','Financing','Construction','Stabilization'];
  const alerts = state.alerts.filter(a => a.projectId === p.id);
  const tasks  = currentProjectTasks();
  const blockedCount   = tasks.filter(t => t.status === 'blocked').length;
  const inProgCount    = tasks.filter(t => t.status === 'in-progress').length;
  const completeCount  = tasks.filter(t => t.status === 'complete').length;
  const notStartCount  = tasks.filter(t => t.status === 'not-started').length;

  app.innerHTML = `
    <!-- Project top bar -->
    <div class="proj-topbar">
      <div class="proj-title">${p.name}</div>
      <div class="proj-meta">
        <span class="badge badge-gold">${p.type}</span>
        <span class="badge badge-${p.status==='on-track'?'green':p.status==='at-risk'?'amber':'red'}">
          <span class="status-dot ${p.status==='on-track'?'dot-green':p.status==='at-risk'?'dot-amber':'dot-red'}" style="width:5px;height:5px"></span>
          ${statusLabel(p.status)}
        </span>
        <span style="color:var(--dim)">${p.units} Units · ${fmt(p.budget)} · ${p.program}</span>
        <span style="color:var(--dim)">${p.city}</span>
      </div>

      <!-- Phase bar -->
      <div class="phase-bar">
        ${phases.map((ph,i) => `
          <div class="phase-step ${i+1 < p.phase ? 'done' : i+1 === p.phase ? 'active' : ''}">${ph}</div>
        `).join('')}
      </div>

      <!-- Quick actions -->
      <div class="quick-actions">
        <div class="qa-btn" onclick="navigate('tasks')">📋 SOW Tasks</div>
        <div class="qa-btn" onclick="navigate('permits')">🏛️ Permits</div>
        <div class="qa-btn" onclick="navigate('contracts')">📝 Contracts</div>
        <div class="qa-btn" onclick="navigate('messages')">💬 Messages</div>
        <div class="qa-btn" onclick="navigate('capital')">💰 Capital Stack</div>
        <div class="qa-btn" onclick="navigate('documents')">📁 Documents</div>
      </div>
    </div>

    <div class="proj-body">
      <div class="proj-grid">
        <!-- Left -->
        <div>
          <div class="section-h">⚠ AI Alerts — Requires Action</div>
          ${alerts.length === 0
            ? `<div style="font-size:13px;color:var(--green);padding:12px">✓ No active alerts for this project</div>`
            : alerts.map(a => `
                <div class="alert-item ${severityClass(a.severity)}" onclick="navigate('${a.action}')">
                  <span class="alert-icon">${severityIcon(a.severity)}</span>
                  <div>
                    <div class="alert-title">${a.title}</div>
                    <div class="alert-desc">${a.desc}</div>
                  </div>
                </div>
              `).join('')
          }

          <div class="section-h" style="margin-top:28px">Recent Activity</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
              <span style="font-size:20px">📐</span>
              <div><div style="font-size:12.5px;color:var(--navy);font-weight:500">Structural drawings Rev C uploaded</div><div style="font-size:11px;color:var(--mu)">Anthony R. · 2 hours ago · linked to SOW #14</div></div>
            </div>
            <div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
              <span style="font-size:20px">✅</span>
              <div><div style="font-size:12.5px;color:var(--navy);font-weight:500">Civil engineering contract executed</div><div style="font-size:11px;color:var(--mu)">Contract #8 signed · Yesterday · 12 tasks unblocked</div></div>
            </div>
            <div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
              <span style="font-size:20px">🏛️</span>
              <div><div style="font-size:12.5px;color:var(--navy);font-weight:500">Building permit submitted to City of LA</div><div style="font-size:11px;color:var(--mu)">Plan check #2025-0042 · Jan 28 · Under review</div></div>
            </div>
          </div>
        </div>

        <!-- Right -->
        <div>
          <div class="section-h">Project Metrics</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
            <div class="stat-box" style="padding:14px"><div class="stat-n">${p.units}</div><div class="stat-l">Total Units</div></div>
            <div class="stat-box" style="padding:14px"><div class="stat-n" style="color:var(--teal)">${p.affordableUnits}</div><div class="stat-l">Affordable Units</div></div>
            <div class="stat-box" style="padding:14px"><div class="stat-n" style="color:var(--gold)">${fmt(p.budget)}</div><div class="stat-l">Total Dev Cost</div></div>
            <div class="stat-box" style="padding:14px"><div class="stat-n" style="color:${statusColor(p.status)}">${p.progress}%</div><div class="stat-l">Overall Progress</div></div>
          </div>
          <div class="section-h">SOW Snapshot</div>
          <div style="display:flex;flex-direction:column;gap:0">
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bd);font-size:12px"><span style="color:var(--mu)">Complete</span><span style="color:var(--green);font-weight:500">${completeCount} tasks</span></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bd);font-size:12px"><span style="color:var(--mu)">In Progress</span><span style="color:var(--gold);font-weight:500">${inProgCount} tasks</span></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bd);font-size:12px"><span style="color:var(--mu)">Blocked</span><span style="color:var(--red);font-weight:500">${blockedCount} tasks</span></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:12px"><span style="color:var(--mu)">Not Started</span><span style="color:var(--dim);font-weight:500">${notStartCount} tasks</span></div>
          </div>
        </div>
      </div>
    </div>
  `;
}
