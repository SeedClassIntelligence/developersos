// ═══════════════════════════════════════════════
// SUPERADMIN.JS — renderSuperAdmin()
// TODO: GET /api/v1/admin/platform
// ═══════════════════════════════════════════════

function renderSuperAdmin() {
  const app = document.getElementById('app');

  const totalProjects = state.organizations.reduce((s,o) => s+o.projects, 0);
  const totalUsers    = state.organizations.reduce((s,o) => s+o.users, 0);
  const totalUnits    = state.projects.reduce((s,p) => s+p.units, 0);

  app.innerHTML = `
    <div style="padding:0">
      <div style="background:rgba(26,35,50,.06);border-bottom:1px solid rgba(26,35,50,.15);padding:8px 32px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--navy);display:flex;align-items:center;gap:8px">
        <span style="width:6px;height:6px;border-radius:50%;background:var(--navy);display:inline-block"></span>
        Super Admin — Master Platform Control
      </div>
      <div style="padding:28px 32px">
        <div class="panel-h">Platform Overview</div>
        <div class="panel-sub">All organizations, all projects, system analytics and controls</div>

        <!-- Platform stats -->
        <div class="grid-4" style="margin-bottom:28px">
          <div class="stat-box"><div class="stat-n" style="color:var(--navy)">${state.organizations.length}</div><div class="stat-l">Organizations</div></div>
          <div class="stat-box"><div class="stat-n" style="color:var(--gold)">${totalProjects}</div><div class="stat-l">Total Projects</div></div>
          <div class="stat-box"><div class="stat-n" style="color:var(--teal)">${totalUsers}</div><div class="stat-l">Total Users</div></div>
          <div class="stat-box"><div class="stat-n" style="color:var(--green)">${totalUnits.toLocaleString()}</div><div class="stat-l">Units in Development</div></div>
        </div>

        <!-- Organizations table -->
        <div class="section-h">Organizations</div>
        <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin-bottom:28px">
          <table class="tbl">
            <thead>
              <tr><th>Organization</th><th>Type</th><th>Projects</th><th>Users</th><th>Plan</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              ${state.organizations.map(org => `
                <tr>
                  <td style="font-weight:500">${org.name}</td>
                  <td>${roleBadge(org.type)}</td>
                  <td style="font-size:12px;color:var(--mu)">${org.projects}</td>
                  <td style="font-size:12px;color:var(--mu)">${org.users}</td>
                  <td><span class="badge badge-navy" style="font-size:8.5px">${org.plan}</span></td>
                  <td><span class="badge badge-green">Active</span></td>
                  <td>
                    <div style="display:flex;gap:6px">
                      <button class="btn btn-o btn-sm" style="font-size:10px" onclick="alert('Manage org — connect to GET /api/v1/admin/orgs/${org.id}')">Manage</button>
                      <button class="btn btn-o btn-sm" style="font-size:10px;color:var(--amber);border-color:rgba(196,122,42,.3)" onclick="alert('Toggle features — connect to PATCH /api/v1/admin/orgs/${org.id}/features')">Features</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Analytics -->
        <div class="section-h">Platform Analytics (30 Days)</div>
        <div class="grid-4" style="margin-bottom:20px">
          <div class="stat-box"><div class="stat-n" style="color:var(--navy)">89</div><div class="stat-l">Active Users</div></div>
          <div class="stat-box"><div class="stat-n" style="color:var(--gold)">2,340</div><div class="stat-l">Tasks Completed</div></div>
          <div class="stat-box"><div class="stat-n" style="color:var(--red)">47</div><div class="stat-l">Risk Alerts Fired</div></div>
          <div class="stat-box"><div class="stat-n" style="color:var(--green)">99.7%</div><div class="stat-l">Uptime</div></div>
        </div>

        <!-- Activity chart -->
        <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:20px;margin-bottom:28px">
          <div class="section-h" style="margin-top:0;border:none;padding:0;margin-bottom:16px">Platform Activity — Last 7 Days</div>
          <div class="chart-bars">
            ${[45,70,55,85,60,30,20].map((h,i) => `
              <div class="bar-wrap">
                <div class="bar" style="height:${h}%;background:var(--navy)"></div>
                <div class="bar-lbl">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- System controls -->
        <div class="section-h">System Controls</div>
        <div class="grid-3">
          <div class="card" style="cursor:pointer" onclick="alert('Feature flags — connect to GET /api/v1/admin/features')">
            <div style="font-size:20px;margin-bottom:8px">🚩</div>
            <div class="card-h">Feature Flags</div>
            <div class="card-p">Toggle platform features per organization or globally.</div>
          </div>
          <div class="card" style="cursor:pointer" onclick="alert('Usage stats — connect to GET /api/v1/admin/usage')">
            <div style="font-size:20px;margin-bottom:8px">📊</div>
            <div class="card-h">Usage Statistics</div>
            <div class="card-p">Detailed per-org usage, API calls, and storage.</div>
          </div>
          <div class="card" style="cursor:pointer" onclick="alert('Permission override — connect to POST /api/v1/admin/permissions/override')">
            <div style="font-size:20px;margin-bottom:8px">🔑</div>
            <div class="card-h">Permission Override</div>
            <div class="card-p">Override access controls for specific users or organizations.</div>
          </div>
          <div class="card" style="cursor:pointer" onclick="alert('System health — connect to GET /api/v1/admin/health')">
            <div style="font-size:20px;margin-bottom:8px">💚</div>
            <div class="card-h">System Health</div>
            <div class="card-p">Server status, database connections, API response times.</div>
          </div>
          <div class="card" style="cursor:pointer" onclick="alert('Audit log — connect to GET /api/v1/admin/audit')">
            <div style="font-size:20px;margin-bottom:8px">📋</div>
            <div class="card-h">Audit Log</div>
            <div class="card-p">Immutable record of all platform actions, approvals, and changes.</div>
          </div>
          <div class="card" style="cursor:pointer;border-color:rgba(168,74,58,.2)" onclick="alert('Billing management — connect to GET /api/v1/admin/billing')">
            <div style="font-size:20px;margin-bottom:8px">💳</div>
            <div class="card-h">Billing Management</div>
            <div class="card-p">Organization plans, invoices, and subscription controls.</div>
          </div>
        </div>
      </div>
    </div>
  `;
}
