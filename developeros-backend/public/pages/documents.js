// ═══════════════════════════════════════════════
// DOCUMENTS.JS
// ═══════════════════════════════════════════════

function renderDocuments() {
  const app = document.getElementById('app');
  const proj = currentProject();
  const docs = state.documents.filter(d => d.projectId === proj?.id);

  app.innerHTML = `
    <div style="padding:28px 32px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div><div class="panel-h">Documents</div><div class="panel-sub">All project files — plans, contracts, permits, reports, and agreements</div></div>
        <button class="btn btn-navy btn-sm" onclick="alert('Upload — connect to POST /api/v1/files')">+ Upload File</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap" id="doc-filter-btns">
        ${['all','plans','contracts','permits','reports','mous'].map((cat,i) => `
          <button class="btn btn-o btn-sm ${i===0?'btn-gold-border':''}" onclick="filterDocs('${cat}',this)" style="${i===0?'border-color:var(--gold);color:var(--gold)':''}">
            ${cat==='all'?'All Files':cat.charAt(0).toUpperCase()+cat.slice(1)}
          </button>
        `).join('')}
      </div>
      <div class="doc-grid" id="doc-grid">
        ${docs.map(d => `
          <div class="doc-card" onclick="alert('Open document — connect to GET /api/v1/files/${d.id}/download')">
            <div class="doc-icon">${d.icon}</div>
            <div class="doc-name">${d.name}</div>
            <div class="doc-meta">${d.uploadedBy} · ${d.date} · ${d.type}</div>
          </div>
        `).join('')}
        <div class="doc-card" style="border:1px dashed var(--bd2);text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:110px;color:var(--dim);cursor:pointer" onclick="alert('Upload — connect to POST /api/v1/files')">
          <div style="font-size:28px;margin-bottom:6px">+</div>
          <div style="font-size:11px">Upload Document</div>
        </div>
      </div>
    </div>
  `;
}

function filterDocs(category, btn) {
  document.querySelectorAll('#doc-filter-btns button').forEach(b => {
    b.style.borderColor = ''; b.style.color = '';
  });
  if (btn) { btn.style.borderColor = 'var(--gold)'; btn.style.color = 'var(--gold)'; }

  const proj = currentProject();
  const docs = state.documents.filter(d => d.projectId === proj?.id && (category === 'all' || d.category === category));
  const grid = document.getElementById('doc-grid');
  if (grid) grid.innerHTML = docs.map(d => `
    <div class="doc-card" onclick="alert('Open document')">
      <div class="doc-icon">${d.icon}</div>
      <div class="doc-name">${d.name}</div>
      <div class="doc-meta">${d.uploadedBy} · ${d.date} · ${d.type}</div>
    </div>
  `).join('') + `<div class="doc-card" style="border:1px dashed var(--bd2);text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:110px;color:var(--dim);cursor:pointer"><div style="font-size:28px;margin-bottom:6px">+</div><div style="font-size:11px">Upload Document</div></div>`;
}


// ═══════════════════════════════════════════════
// AIALERTS.JS — renderAiAlerts()
// TODO: GET /api/v1/alerts
// ═══════════════════════════════════════════════

function renderAiAlerts() {
  const app = document.getElementById('app');
  const critical = state.alerts.filter(a => a.severity === 'critical');
  const warnings  = state.alerts.filter(a => a.severity === 'warning');
  const info      = state.alerts.filter(a => a.severity === 'info');

  app.innerHTML = `
    <div style="padding:28px 32px">
      <div class="panel-h">AI Risk Intelligence</div>
      <div class="panel-sub">Automated risk detection across contracts, permits, financing, and schedule dependencies</div>

      <div style="background:rgba(26,35,50,.04);border:1px solid rgba(26,35,50,.1);border-radius:10px;padding:16px 20px;margin-bottom:24px;display:flex;align-items:center;gap:14px">
        <span style="font-size:28px">🧠</span>
        <div>
          <div style="font-size:12px;font-weight:500;color:var(--navy)">DeveloperOS Intelligence Engine — Active</div>
          <div style="font-size:11px;color:var(--mu)">Continuously monitoring contracts, permits, dependencies, and deadlines</div>
          <div style="font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--green);font-weight:500;margin-top:2px">Last scan: 4 minutes ago · ${state.alerts.length} alerts active</div>
        </div>
      </div>

      ${critical.length > 0 ? `
        <div class="section-h">🔴 Critical — Immediate Action Required</div>
        ${critical.map(a => renderAlert(a)).join('')}
      ` : ''}

      ${warnings.length > 0 ? `
        <div class="section-h" style="margin-top:24px">🟡 Warning — Action Needed This Week</div>
        ${warnings.map(a => renderAlert(a)).join('')}
      ` : ''}

      ${info.length > 0 ? `
        <div class="section-h" style="margin-top:24px">🔵 Information — Monitor</div>
        ${info.map(a => renderAlert(a)).join('')}
      ` : ''}
    </div>
  `;
}

function renderAlert(a) {
  return `
    <div class="alert-item ${severityClass(a.severity)}" onclick="navigate('${a.action}')">
      <span class="alert-icon">${severityIcon(a.severity)}</span>
      <div style="flex:1">
        <div class="alert-title">${a.title}</div>
        <div class="alert-desc">${a.desc}</div>
        <div style="margin-top:8px">
          <button class="btn btn-o btn-sm" style="font-size:10px" onclick="event.stopPropagation();navigate('${a.action}')">${a.actionLabel} →</button>
        </div>
      </div>
    </div>
  `;
}
