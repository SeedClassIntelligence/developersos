// ═══════════════════════════════════════════════
// SIDEBAR.JS — Sidebar component
// ═══════════════════════════════════════════════

function renderSidebar() {
  const el = document.getElementById('sidebar');
  if (!el) return;

  const alertCount = criticalAlertCount();
  const msgCount   = unreadMessageCount();
  const blockedTasks = state.tasks.filter(t => t.projectId === state.currentProjectId && t.status === 'blocked').length;

  el.className = 'app-sidebar';
  el.innerHTML = `
    <div class="sb-section">Platform</div>
    <div class="sb-link ${state.currentPage==='portfolio'?'on':''}" data-page="portfolio" onclick="navigate('portfolio')">
      <span class="si">⬡</span><span class="sc">Portfolio</span>
    </div>
    <div class="sb-link ${state.currentPage==='project'?'on':''}" data-page="project" onclick="navigate('project')">
      <span class="si">◇</span><span class="sc">Project</span>
    </div>

    <div class="sb-section">Execution</div>
    <div class="sb-link ${state.currentPage==='tasks'?'on':''}" data-page="tasks" onclick="navigate('tasks')">
      <span class="si">📋</span><span class="sc">SOW Tasks</span>
      ${blockedTasks > 0 ? `<span class="scount">${blockedTasks}</span>` : ''}
    </div>
    <div class="sb-link ${state.currentPage==='permits'?'on':''}" data-page="permits" onclick="navigate('permits')">
      <span class="si">🏛️</span><span class="sc">Permits</span>
    </div>
    <div class="sb-link ${state.currentPage==='contracts'?'on':''}" data-page="contracts" onclick="navigate('contracts')">
      <span class="si">📝</span><span class="sc">Contracts</span>
      ${state.contracts.filter(c=>c.status==='missing').length > 0 ? `<span class="scount">${state.contracts.filter(c=>c.status==='missing').length}</span>` : ''}
    </div>

    <div class="sb-section">Finance</div>
    <div class="sb-link ${state.currentPage==='capital'?'on':''}" data-page="capital" onclick="navigate('capital')">
      <span class="si">💰</span><span class="sc">Capital Stack</span>
    </div>

    <div class="sb-section">Communication</div>
    <div class="sb-link ${state.currentPage==='messages'?'on':''}" data-page="messages" onclick="navigate('messages')">
      <span class="si">💬</span><span class="sc">Messages</span>
      ${msgCount > 0 ? `<span class="scount">${msgCount}</span>` : ''}
    </div>
    <div class="sb-link ${state.currentPage==='documents'?'on':''}" data-page="documents" onclick="navigate('documents')">
      <span class="si">📁</span><span class="sc">Documents</span>
    </div>

    <div class="sb-section">Intelligence</div>
    <div class="sb-link ${state.currentPage==='ai-alerts'?'on':''}" data-page="ai-alerts" onclick="navigate('ai-alerts')">
      <span class="si">⚠️</span><span class="sc">AI Alerts</span>
      ${alertCount > 0 ? `<span class="scount">${alertCount}</span>` : ''}
    </div>

    <div class="sb-section">Admin</div>
    <div class="sb-link ${state.currentPage==='admin'?'on':''}" data-page="admin" onclick="navigate('admin')" style="color:var(--amber)">
      <span class="si">👥</span><span class="sc">Team Admin</span>
    </div>
    <div class="sb-link ${state.currentPage==='super-admin'?'on':''}" data-page="super-admin" onclick="navigate('super-admin')" style="color:var(--red)">
      <span class="si">⚡</span><span class="sc">Super Admin</span>
    </div>

    <div class="sb-bottom">
      <div class="sb-user-row">
        <div class="sb-av">${state.currentUser?.initials || 'U'}</div>
        <div>
          <div class="sb-uname">${state.currentUser?.organization || 'Organization'}</div>
          <div class="sb-urole">${state.currentUser?.role || 'user'} · Pro</div>
        </div>
      </div>
    </div>
  `;
}
