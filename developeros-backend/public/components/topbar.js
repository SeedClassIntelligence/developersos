// ═══════════════════════════════════════════════
// TOPBAR.JS — Top navigation bar
// ═══════════════════════════════════════════════

function renderTopbar() {
  const el = document.getElementById('topbar');
  if (!el) return;

  const alertCount = criticalAlertCount();
  const msgCount   = unreadMessageCount();
  const proj = currentProject();

  el.className = 'app-topbar';
  el.innerHTML = `
    <div class="app-logo" onclick="navigate('portfolio')">
      <span class="ldot"></span>DeveloperOS
    </div>

    <div class="app-proj-sel">
      <span style="font-size:12px;color:var(--dim)">▾</span>
      <select onchange="switchProject(this.value)">
        ${state.projects.map(p => `
          <option value="${p.id}" ${p.id === state.currentProjectId ? 'selected' : ''}>
            ${p.name}
          </option>
        `).join('')}
      </select>
    </div>

    <div class="topbar-right">
      <div class="tb-icon" title="AI Alerts" onclick="navigate('ai-alerts')">
        ⚠️${alertCount > 0 ? `<span class="tb-badge">${alertCount}</span>` : ''}
      </div>
      <div class="tb-icon" title="Messages" onclick="navigate('messages')">
        🔔${msgCount > 0 ? `<span class="tb-badge" style="background:var(--blue)">${msgCount}</span>` : ''}
      </div>
      <div class="tb-user" onclick="navigate('admin')">
        <div class="tb-avatar">${state.currentUser?.initials || 'U'}</div>
        <span>${state.currentUser?.organization || ''}</span>
        <span style="font-size:10px;color:var(--dim)">${state.currentUser?.role || ''}</span>
      </div>
    </div>
  `;
}

function switchProject(projectId) {
  setCurrentProject(projectId);
  renderTopbar();
  renderSidebar();
  // Re-render current page with new project
  navigate(state.currentPage);
}
