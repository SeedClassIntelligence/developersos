// ═══════════════════════════════════════════════
// ADMIN.JS — renderAdmin()
// TODO: GET /api/v1/admin/team
// ═══════════════════════════════════════════════

function renderAdmin() {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div style="padding:0">
      <div style="background:rgba(196,122,42,.06);border-bottom:1px solid rgba(196,122,42,.15);padding:8px 32px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--amber);display:flex;align-items:center;gap:8px">
        <span style="width:6px;height:6px;border-radius:50%;background:var(--amber);display:inline-block"></span>
        Team Admin Access — ${state.currentUser?.organization || 'Organization'}
      </div>
      <div style="padding:28px 32px">
        <div class="panel-h">Team Management</div>
        <div class="panel-sub">Manage team members, roles, and project access permissions</div>

        <div class="grid-4" style="margin-bottom:24px">
          <div class="stat-box"><div class="stat-n">${state.teamMembers.length}</div><div class="stat-l">Team Members</div></div>
          <div class="stat-box"><div class="stat-n" style="color:var(--gold)">${state.projects.length}</div><div class="stat-l">Active Projects</div></div>
          <div class="stat-box"><div class="stat-n" style="color:var(--teal)">4</div><div class="stat-l">User Roles</div></div>
          <div class="stat-box"><div class="stat-n" style="color:var(--green)">${(state.partners||[]).length}</div><div class="stat-l">Partner Orgs</div></div>
        </div>

        <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
          <input class="input" type="text" placeholder="Search team members…" style="max-width:280px" oninput="filterTeam(this.value)">
          <select class="input" style="max-width:160px" onchange="filterTeamByRole(this.value)">
            <option value="">All Roles</option>
            <option value="developer">Developer</option>
            <option value="architect">Architect</option>
            <option value="civil">Civil</option>
            <option value="municipal">Municipal</option>
            <option value="investor">Investor</option>
          </select>
          <button class="btn btn-navy btn-sm" onclick="alert('Invite member — connect to POST /api/v1/team/invite')">+ Invite Member</button>
        </div>

        <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;overflow:hidden" id="team-table-wrap">
          ${renderTeamTable(state.teamMembers)}
        </div>

        <!-- Role permissions reference -->
        <div class="section-h" style="margin-top:32px">Role Permissions Matrix</div>
        <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;overflow:hidden">
          <table class="tbl">
            <thead>
              <tr>
                <th>Permission</th>
                <th>Developer</th>
                <th>Architect / Eng</th>
                <th>Municipal</th>
                <th>Investor</th>
                <th>Service Provider</th>
              </tr>
            </thead>
            <tbody>
              ${[
                ['View Portfolio',         '✓','✓','—','—','—'],
                ['Edit SOW Tasks',         '✓','✓','—','—','—'],
                ['Upload Contracts',       '✓','—','—','—','—'],
                ['View Capital Stack',     '✓','—','—','✓','—'],
                ['Submit Permits',         '✓','✓','—','—','—'],
                ['Review Plans (City)',    '—','—','✓','—','—'],
                ['View Service Plans',     '✓','—','—','—','✓'],
                ['Manage Team',            '✓','—','—','—','—'],
              ].map(([perm,...roles]) => `
                <tr>
                  <td style="font-weight:500">${perm}</td>
                  ${roles.map(r => `<td style="text-align:center;color:${r==='✓'?'var(--green)':'var(--dim)'};font-size:14px">${r}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderTeamTable(members) {
  const statusBadge = { active:'badge-green', readonly:'badge-amber', 'finance-view':'badge-blue' };
  const statusLabel = { active:'Active', readonly:'Read Only', 'finance-view':'Finance View' };

  return `
    <table class="user-table" style="width:100%">
      <thead><tr><th>Name</th><th>Role</th><th>Projects</th><th>Last Active</th><th>Access</th><th>Actions</th></tr></thead>
      <tbody>
        ${members.map(m => `
          <tr>
            <td>${m.name}</td>
            <td>${roleBadge(m.role)}</td>
            <td style="font-size:11px;color:var(--mu)">${m.projects}</td>
            <td style="font-size:11px;color:var(--mu)">${m.lastActive}</td>
            <td><span class="badge ${statusBadge[m.status]||'badge-navy'}">${statusLabel[m.status]||m.status}</span></td>
            <td>
              <div style="display:flex;gap:6px">
                <button class="btn btn-o btn-sm" style="font-size:10px" onclick="alert('Edit member — connect to PUT /api/v1/team/${m.id}')">Edit</button>
                <button class="btn btn-red btn-sm" style="font-size:10px" onclick="alert('Remove member — connect to DELETE /api/v1/team/${m.id}')">Remove</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function filterTeam(query) {
  const filtered = state.teamMembers.filter(m =>
    m.name.toLowerCase().includes(query.toLowerCase()) ||
    m.role.toLowerCase().includes(query.toLowerCase())
  );
  const wrap = document.getElementById('team-table-wrap');
  if (wrap) wrap.innerHTML = renderTeamTable(filtered);
}

function filterTeamByRole(role) {
  const filtered = role ? state.teamMembers.filter(m => m.role === role) : state.teamMembers;
  const wrap = document.getElementById('team-table-wrap');
  if (wrap) wrap.innerHTML = renderTeamTable(filtered);
}
