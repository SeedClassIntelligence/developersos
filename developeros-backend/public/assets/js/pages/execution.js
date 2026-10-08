// ═══════════════════════════════════════════════
// pages/execution.js — tasks, permits, contracts, capital (live, read)
// ═══════════════════════════════════════════════

(function (global) {
  const Pages = (global.Pages = global.Pages || {});

  const DISCIPLINES = {
    arch: 'Architectural', civil: 'Civil', structural: 'Structural', landscape: 'Landscape', mep: 'MEP',
    survey: 'Survey', environmental: 'Environmental', geotechnical: 'Geotechnical', contractor: 'Contractor',
  };
  const TAG_CLASS = { arch: 'tag-arch', civil: 'tag-civil', structural: 'tag-struct', landscape: 'tag-land', mep: 'tag-mep', survey: 'tag-survey', environmental: 'tag-env' };
  const COLUMNS = [
    { status: 'not-started', label: '⬡ Not Started', css: '' },
    { status: 'in-progress', label: '◈ In Progress', css: 'col-blue' },
    { status: 'blocked', label: '⊗ Blocked', css: 'col-red' },
    { status: 'complete', label: '✓ Complete', css: 'col-green' },
  ];
  const CONTRACT_STATUS = {
    executed: { label: '✓ Executed', kind: 'green' },
    pending: { label: '⏳ Pending', kind: 'amber' },
    missing: { label: '❌ Missing', kind: 'red' },
  };
  const PERMIT_STATUS = {
    approved: { label: 'Approved', kind: 'green' },
    'under-review': { label: 'Under Review', kind: 'blue' },
    submitted: { label: 'Submitted', kind: 'blue' },
    corrections: { label: 'Corrections Open', kind: 'red' },
    draft: { label: 'Draft', kind: 'navy' },
  };
  const projectQuery = ctx => `?projectId=${encodeURIComponent(ctx.project.id)}`;
  const tasksPath = (ctx, params) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return `#${Shell.projectPath(ctx.project.id, 'tasks')}${qs ? `?${qs}` : ''}`;
  };
  const disciplineTag = d => html`<span class="tc-tag ${TAG_CLASS[d] || ''}">${DISCIPLINES[d] || UI.titleCase(d || 'General')}</span>`;

  function coverage(task, contracts) {
    if (!task.contractId) return { ok: false, label: 'No contract' };
    const c = contracts.find(x => x.id === task.contractId);
    if (!c) return { ok: false, label: 'No contract' };
    return c.status === 'executed' ? { ok: true, label: 'Contract' } : { ok: false, label: c.status === 'pending' ? 'Pending' : 'No contract' };
  }

  // ── Tasks ────────────────────────────────────
  Pages.tasks = {
    title: ctx => `Tasks · ${ctx.project.name}`,
    async render(ctx) {
      const [tasks, contracts, partners] = await Promise.all([
        Api.get(`/tasks${projectQuery(ctx)}`), Api.get(`/contracts${projectQuery(ctx)}`), Store.getPartners(),
      ]);
      const { discipline = '', contract = '', task: openTaskId = '' } = ctx.query;
      let shown = tasks;
      if (discipline) shown = shown.filter(t => t.discipline === discipline);
      if (contract === 'missing') shown = shown.filter(t => !coverage(t, contracts).ok);
      if (contract === 'covered') shown = shown.filter(t => coverage(t, contracts).ok);
      const openTask = tasks.find(t => t.id === openTaskId);
      const disciplines = [...new Set(tasks.map(t => t.discipline).filter(Boolean))];

      const card = t => {
        const cov = coverage(t, contracts);
        return html`
          <a class="task-card ${t.status === 'blocked' ? 'blocked' : ''}" href="${tasksPath(ctx, { discipline, contract, task: t.id })}" data-testid="task-card">
            <div class="tc-tagrow">${disciplineTag(t.discipline)}</div>
            <div class="tc-title">${t.title}</div>
            ${t.note ? html`<div class="tc-note">${t.note}</div>` : ''}
            <div class="tc-meta">
              <div class="tc-assignee">${Store.partnerName(partners, t.partnerId)}</div>
              <div class="tc-contract ${cov.ok ? 'ok' : 'missing'}">${cov.ok ? '✓' : '✕'} ${cov.label}</div>
            </div>
          </a>`;
      };

      return html`
        <div class="tb-toolbar">
          <h1 class="toolbar-h">SOW Task Board</h1>
          <label><span class="sr-only">Discipline</span>
            <select class="tb-filter" data-change="task-filter" data-key="discipline" data-testid="filter-discipline">
              <option value="">All disciplines</option>
              ${disciplines.map(d => html`<option value="${d}" ${d === discipline ? raw('selected') : ''}>${DISCIPLINES[d] || UI.titleCase(d)}</option>`)}
            </select>
          </label>
          <label><span class="sr-only">Contract coverage</span>
            <select class="tb-filter" data-change="task-filter" data-key="contract">
              <option value="">All contract coverage</option>
              <option value="missing" ${contract === 'missing' ? raw('selected') : ''}>Missing executed contract</option>
              <option value="covered" ${contract === 'covered' ? raw('selected') : ''}>Covered by executed contract</option>
            </select>
          </label>
          <span class="toolbar-count">${shown.length} of ${tasks.length} tasks</span>
        </div>
        ${tasks.length ? html`
          <div class="kanban" data-testid="kanban">
            ${COLUMNS.map(col => {
              const items = shown.filter(t => t.status === col.status);
              return html`
                <div class="kanban-col">
                  <div class="col-header"><span class="col-title ${col.css}">${col.label}<span class="col-count">${items.length}</span></span></div>
                  <div class="col-body">${items.map(card)}</div>
                </div>`;
            })}
          </div>` : html`<div class="page">${UI.empty('No tasks recorded for this project yet.')}</div>`}
        ${openTask ? taskPanel(ctx, openTask, contracts, partners, { discipline, contract }) : ''}`;
    },
  };

  function taskPanel(ctx, t, contracts, partners, filters) {
    const contract = contracts.find(c => c.id === t.contractId);
    const cs = contract ? CONTRACT_STATUS[contract.status] || { label: contract.status, kind: 'navy' } : null;
    return html`
      <div class="side-panel" role="dialog" aria-label="Task details" data-testid="task-panel">
        <div class="side-panel-head">
          <div>${disciplineTag(t.discipline)}<h2 class="side-panel-title">${t.title}</h2></div>
          <a class="tm-close" href="${tasksPath(ctx, filters)}" aria-label="Close">✕</a>
        </div>
        <dl class="kv">
          <div><dt>Status</dt><dd>${UI.titleCase(t.status)}</dd></div>
          <div><dt>Assigned partner</dt><dd>${Store.partnerName(partners, t.partnerId)}</dd></div>
          <div><dt>Contract</dt><dd>${contract ? html`${contract.type} ${UI.badge(cs.label, cs.kind)}` : 'None linked'}</dd></div>
          <div><dt>Due</dt><dd>${UI.date(t.dueDate)}</dd></div>
        </dl>
        ${t.note ? html`<div class="panel-note">${t.note}</div>` : ''}
      </div>`;
  }

  Actions.onChange('task-filter', el => {
    const { path, query } = Router.current();
    const next = { ...query, [el.dataset.key]: el.value };
    delete next.task;
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v)).toString();
    Router.go(`${path}${qs ? `?${qs}` : ''}`);
  });

  // ── Permits ──────────────────────────────────
  Pages.permits = {
    title: ctx => `Permits · ${ctx.project.name}`,
    async render(ctx) {
      const permits = await Api.get(`/permits${projectQuery(ctx)}`);
      const n = s => permits.filter(p => p.status === s).length;
      return html`
        <div class="page">
          ${UI.pageHeader('Permit Tracker', 'Every permit from submission through approval, with open correction items')}
          ${UI.stats([
            { value: n('approved'), label: 'Approved', color: 'var(--green)' },
            { value: n('under-review') + n('submitted'), label: 'In Review', color: 'var(--blue)' },
            { value: n('corrections'), label: 'Corrections Open', color: 'var(--red)' },
            { value: permits.length, label: 'Total Permits' },
          ])}
          ${UI.table([
            { label: 'Permit', cell: p => html`<div class="cell-strong">${p.name}</div>${(p.corrections || []).length ? html`
                <ol class="corrections">${p.corrections.map(c => html`<li><span>${c.text}</span> ${UI.badge(UI.titleCase(c.status), c.status === 'complete' ? 'green' : c.status === 'in-progress' ? 'amber' : 'red')}</li>`)}</ol>` : ''}` },
            { label: 'Jurisdiction', cell: p => p.jurisdiction || '—', className: 'cell-dim' },
            { label: 'Type', cell: p => UI.badge(p.type || '—', 'navy') },
            { label: 'Status', cell: p => { const s = PERMIT_STATUS[p.status] || { label: UI.titleCase(p.status), kind: 'navy' }; return UI.badge(s.label, s.kind); } },
            { label: 'Submitted', cell: p => UI.date(p.submittedDate), className: 'mono' },
            { label: 'Approved', cell: p => UI.date(p.approvedDate), className: 'mono' },
          ], permits, { empty: 'No permits recorded for this project yet.' })}
        </div>`;
    },
  };

  // ── Contracts ────────────────────────────────
  Pages.contracts = {
    title: ctx => `Contracts · ${ctx.project.name}`,
    async render(ctx) {
      const [contracts, partners] = await Promise.all([Api.get(`/contracts${projectQuery(ctx)}`), Store.getPartners()]);
      const n = s => contracts.filter(c => c.status === s).length;
      return html`
        <div class="page">
          ${UI.pageHeader('Contracts', 'Contract status cross-referenced with SOW tasks — work proceeds only under an executed contract')}
          ${UI.stats([
            { value: n('executed'), label: 'Executed', color: 'var(--green)' },
            { value: n('missing'), label: 'Missing', color: 'var(--red)' },
            { value: n('pending'), label: 'Pending Signature', color: 'var(--amber)' },
            { value: contracts.length, label: 'Total Contracts' },
          ])}
          ${UI.table([
            { label: 'Partner', cell: c => html`<span class="cell-strong">${Store.partnerName(partners, c.partnerId)}</span>` },
            { label: 'Contract type', cell: c => c.type || '—' },
            { label: 'Status', cell: c => { const s = CONTRACT_STATUS[c.status] || { label: UI.titleCase(c.status), kind: 'navy' }; return UI.badge(s.label, s.kind); } },
            { label: 'Value', cell: c => UI.money(c.value), className: 'num' },
            { label: 'Executed', cell: c => UI.date(c.executedDate), className: 'mono' },
            { label: 'Linked tasks', cell: c => UI.number(c.linkedTaskCount), className: 'num' },
          ], contracts, { empty: 'No contracts recorded for this project yet.' })}
        </div>`;
    },
  };

  // ── Capital ──────────────────────────────────
  Pages.capital = {
    title: ctx => `Capital · ${ctx.project.name}`,
    async render(ctx) {
      let stack = null;
      try {
        stack = await Api.get(`/capital/${encodeURIComponent(ctx.project.id)}`);
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      if (!stack || !Array.isArray(stack.sources)) {
        return html`<div class="page">${UI.pageHeader('Capital Stack', ctx.project.name)}${UI.empty('No capital stack recorded for this project yet.')}</div>`;
      }
      const sum = list => list.reduce((s, x) => s + (Number(x.amount) || 0), 0);
      const committed = sum(stack.sources.filter(s => s.status === 'committed'));
      const pending = sum(stack.sources.filter(s => s.status !== 'committed'));
      const total = Number(stack.totalCost) || 0;
      const capitalized = total > 0 ? Math.round((committed / total) * 100) : 0;
      const gap = total - sum(stack.sources);

      return html`
        <div class="page">
          ${UI.pageHeader('Capital Stack', `${ctx.project.name} — ${UI.money(total)} total development cost`)}
          ${UI.stats([
            { value: UI.moneyShort(total), label: 'Total Dev Cost', color: 'var(--gold)' },
            { value: UI.moneyShort(committed), label: 'Committed', color: 'var(--green)' },
            { value: UI.moneyShort(pending), label: 'Pending', color: 'var(--amber)' },
            { value: `${capitalized}%`, label: 'Capitalized (committed)', color: 'var(--teal)' },
          ])}
          ${gap !== 0 ? html`<div class="callout ${gap > 0 ? 'callout-amber' : 'callout-blue'}" data-testid="funding-gap">
            ${gap > 0 ? html`Funding gap: sources total ${UI.money(sum(stack.sources))}, ${UI.money(gap)} short of total development cost.`
                      : html`Sources exceed total development cost by ${UI.money(-gap)}.`}</div>` : ''}
          <h2 class="section-h">Sources</h2>
          <div class="capital-stack" data-testid="capital-sources">
            ${stack.sources.length ? stack.sources.map(s => {
              const share = total > 0 ? (Number(s.amount) / total) * 100 : 0;
              return html`
                <div class="cs-row">
                  <div class="cs-track"><div class="cs-bar" style="width:${Math.max(4, Math.min(100, share))}%;background:${safeColor(s.color)}"></div></div>
                  <div class="cs-source">${s.name}<div class="cs-type">${UI.titleCase(s.type)}${s.deadline ? html` · deadline ${UI.date(s.deadline)}` : ''}</div></div>
                  <div>${UI.badge(s.status || 'pending', s.status === 'committed' ? 'green' : 'amber')}</div>
                  <div class="cs-pct">${share.toFixed(1)}%</div>
                  <div class="cs-amount">${UI.money(s.amount)}</div>
                </div>`;
            }) : UI.empty('No sources recorded.')}
          </div>
          ${stack.sources.filter(s => s.alert).map(s => html`
            <div class="callout callout-amber"><strong>${s.name}:</strong> ${s.alert}</div>`)}
        </div>`;
    },
  };
})(window);
