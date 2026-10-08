// ═══════════════════════════════════════════════
// pages/portfolio.js — portfolio, project overview, risk alerts
// ═══════════════════════════════════════════════

(function (global) {
  const Pages = (global.Pages = global.Pages || {});
  const PHASES = ['Predevelopment', 'Entitlements', 'Design Development', 'Financing', 'Construction', 'Stabilization'];
  const STATUS = {
    'on-track': { label: 'On Track', kind: 'green', color: 'var(--green)' },
    'at-risk': { label: 'At Risk', kind: 'amber', color: 'var(--amber)' },
    blocked: { label: 'Blocked', kind: 'red', color: 'var(--red)' },
  };
  const SEVERITY = {
    critical: { label: 'Critical', css: 'alert-red', icon: '🔴' },
    warning: { label: 'Warning', css: 'alert-amber', icon: '🟡' },
    info: { label: 'Information', css: 'alert-blue', icon: '🔵' },
  };
  const ALERT_SECTIONS = new Set(['tasks', 'permits', 'contracts', 'capital', 'messages', 'documents']);

  const status = s => STATUS[s] || { label: UI.titleCase(s || 'unknown'), kind: 'navy', color: 'var(--dim)' };
  const pct = n => Math.max(0, Math.min(100, Number(n) || 0));

  function alertItem(a) {
    const sev = SEVERITY[a.severity] || SEVERITY.info;
    const section = ALERT_SECTIONS.has(a.action) ? a.action : '';
    const href = `#${Shell.projectPath(a.projectId, section)}`;
    return html`
      <a class="alert-item ${sev.css}" href="${href}" data-testid="alert-item">
        <span class="alert-icon" aria-hidden="true">${sev.icon}</span>
        <div>
          <div class="alert-title">${a.title}</div>
          <div class="alert-desc">${a.desc}</div>
          ${a.projectName ? html`<div class="alert-meta">${a.projectName}${a.actionLabel ? html` · ${a.actionLabel} →` : ''}</div>` : ''}
        </div>
      </a>`;
  }

  // ── Portfolio ────────────────────────────────
  Pages.portfolio = {
    title: () => 'Portfolio',
    async render() {
      const [projects, alerts] = await Promise.all([Store.getProjects(), Api.get('/alerts')]);
      const alertsByProject = {};
      for (const a of alerts) alertsByProject[a.projectId] = (alertsByProject[a.projectId] || 0) + 1;
      const totalUnits = projects.reduce((s, p) => s + (Number(p.units) || 0), 0);
      const affordable = projects.reduce((s, p) => s + (Number(p.affordableUnits) || 0), 0);

      return html`
        <div class="page">
          ${UI.pageHeader('Portfolio', `${Session.organizationName()} — all development projects`)}
          ${UI.stats([
            { value: UI.number(projects.length), label: 'Projects' },
            { value: UI.number(totalUnits), label: 'Total Units', color: 'var(--gold)' },
            { value: UI.number(affordable), label: 'Affordable Units', color: 'var(--teal)' },
            { value: UI.number(alerts.length), label: 'Open Alerts', color: 'var(--red)' },
          ])}
          ${projects.length ? html`
            <div class="portfolio-grid" data-testid="project-cards">
              ${projects.map(p => {
                const st = status(p.status);
                const open = alertsByProject[p.id] || 0;
                return html`
                  <a class="proj-card ${st.kind === 'navy' ? 'green' : st.kind}" href="#${Shell.projectPath(p.id)}" data-testid="project-card">
                    <div class="pc-header">
                      <div>
                        <div class="pc-name">${p.name}</div>
                        <div class="pc-type">${p.type || 'Project'} · ${UI.number(p.units)} Units</div>
                      </div>
                      <div class="pc-status">${UI.badge(st.label, st.kind)}</div>
                    </div>
                    <div class="pc-metrics">
                      <div class="pc-metric"><div class="pc-m-n">${UI.moneyShort(p.budget)}</div><div class="pc-m-l">Budget</div></div>
                      <div class="pc-metric"><div class="pc-m-n">${pct(p.progress)}%</div><div class="pc-m-l">Complete</div></div>
                      <div class="pc-metric"><div class="pc-m-n">P${p.phase || '—'}</div><div class="pc-m-l">Phase</div></div>
                    </div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${pct(p.progress)}%;background:${st.color}"></div></div>
                    <div class="pc-footer">
                      <span>${p.phaseLabel || PHASES[(p.phase || 1) - 1] || ''}</span>
                      ${open ? html`<span class="pc-alerts">⚠ ${open} alert${open > 1 ? 's' : ''}</span>` : html`<span class="pc-ok">No open alerts</span>`}
                    </div>
                  </a>`;
              })}
            </div>` : UI.empty('No projects yet in this organization.')}
        </div>`;
    },
  };

  // ── Project overview ─────────────────────────
  Pages.project = {
    title: ctx => ctx.project.name,
    async render(ctx) {
      const p = ctx.project;
      const q = `?projectId=${encodeURIComponent(p.id)}`;
      const [alerts, tasks, contracts, permits] = await Promise.all([
        Api.get(`/alerts${q}`), Api.get(`/tasks${q}`), Api.get(`/contracts${q}`), Api.get(`/permits${q}`),
      ]);
      const st = status(p.status);
      const count = (list, key, value) => list.filter(x => x[key] === value).length;

      return html`
        <div class="proj-topbar">
          <h1 class="proj-title">${p.name}</h1>
          <div class="proj-meta">
            ${p.type ? UI.badge(p.type, 'gold') : ''}
            ${UI.badge(st.label, st.kind)}
            <span class="meta-dim">${UI.number(p.units)} Units · ${UI.money(p.budget)}${p.program ? html` · ${p.program}` : ''}</span>
            ${p.city ? html`<span class="meta-dim">${p.city}</span>` : ''}
          </div>
          <div class="phase-bar" aria-label="Development phase">
            ${PHASES.map((ph, i) => html`<div class="phase-step ${i + 1 < p.phase ? 'done' : i + 1 === p.phase ? 'active' : ''}">${ph}</div>`)}
          </div>
        </div>
        <div class="proj-body">
          <div class="proj-grid">
            <section>
              <h2 class="section-h">Risk alerts — requires action</h2>
              ${alerts.length ? alerts.map(alertItem) : html`<div class="ok-note">✓ No open alerts for this project</div>`}
            </section>
            <section>
              <h2 class="section-h">Project metrics</h2>
              <div class="metric-list">
                <div class="stat-box"><div class="stat-n">${UI.number(p.units)}</div><div class="stat-l">Total Units</div></div>
                <div class="stat-box"><div class="stat-n" style="color:var(--teal)">${UI.number(p.affordableUnits)}</div><div class="stat-l">Affordable Units</div></div>
                <div class="stat-box"><div class="stat-n" style="color:var(--gold)">${UI.moneyShort(p.budget)}</div><div class="stat-l">Budget</div></div>
                <div class="stat-box"><div class="stat-n" style="color:${st.color}">${pct(p.progress)}%</div><div class="stat-l">Reported Progress</div></div>
              </div>
              <h2 class="section-h">SOW snapshot</h2>
              <dl class="kv" data-testid="sow-snapshot">
                <div><dt>Complete</dt><dd class="c-green">${count(tasks, 'status', 'complete')} tasks</dd></div>
                <div><dt>In progress</dt><dd class="c-gold">${count(tasks, 'status', 'in-progress')} tasks</dd></div>
                <div><dt>Blocked</dt><dd class="c-red">${count(tasks, 'status', 'blocked')} tasks</dd></div>
                <div><dt>Not started</dt><dd>${count(tasks, 'status', 'not-started')} tasks</dd></div>
              </dl>
              <h2 class="section-h">Contracts &amp; permits</h2>
              <dl class="kv">
                <div><dt>Contracts executed</dt><dd>${count(contracts, 'status', 'executed')} of ${contracts.length}</dd></div>
                <div><dt>Permits approved</dt><dd>${count(permits, 'status', 'approved')} of ${permits.length}</dd></div>
                <div><dt>Permits with open corrections</dt><dd class="${count(permits, 'status', 'corrections') ? 'c-red' : ''}">${count(permits, 'status', 'corrections')}</dd></div>
              </dl>
            </section>
          </div>
        </div>`;
    },
  };

  // ── Risk alerts (all projects) ───────────────
  Pages.alerts = {
    title: () => 'Risk Alerts',
    async render() {
      const alerts = await Api.get('/alerts');
      const groups = ['critical', 'warning', 'info'].map(s => ({ s, items: alerts.filter(a => a.severity === s) }));
      return html`
        <div class="page">
          ${UI.pageHeader('Risk Alerts', 'Rule-based checks across contracts, permits, capital deadlines and task dependencies, evaluated live on every load')}
          ${alerts.length ? groups.filter(g => g.items.length).map(g => html`
            <h2 class="section-h">${SEVERITY[g.s].icon} ${SEVERITY[g.s].label} (${g.items.length})</h2>
            ${g.items.map(alertItem)}`) : UI.empty('No open alerts across your projects.')}
        </div>`;
    },
  };
})(window);
