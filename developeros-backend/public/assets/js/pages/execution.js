// ═══════════════════════════════════════════════
// pages/execution.js — tasks, permits, contracts, capital (WP7: read + edit)
// Every action is offered only with the matching permission; the API
// enforces permissions, tenant scope and validation and the UI reports it.
// ═══════════════════════════════════════════════

(function (global) {
  const Pages = (global.Pages = global.Pages || {});

  const DISCIPLINES = {
    arch: 'Architectural', civil: 'Civil', structural: 'Structural', landscape: 'Landscape', mep: 'MEP',
    survey: 'Survey', environmental: 'Environmental', geotechnical: 'Geotechnical', contractor: 'Contractor',
  };
  const TAG_CLASS = { arch: 'tag-arch', civil: 'tag-civil', structural: 'tag-struct', landscape: 'tag-land', mep: 'tag-mep', survey: 'tag-survey', environmental: 'tag-env' };
  const COLUMNS = [
    { status: 'not-started', label: '⬡ Not Started', short: 'Not started', css: '' },
    { status: 'in-progress', label: '◈ In Progress', short: 'In progress', css: 'col-blue' },
    { status: 'blocked', label: '⊗ Blocked', short: 'Blocked', css: 'col-red' },
    { status: 'complete', label: '✓ Complete', short: 'Complete', css: 'col-green' },
  ];
  const CONTRACT_STATUS = {
    executed: { label: '✓ Executed', kind: 'green' },
    pending: { label: '⏳ Pending', kind: 'amber' },
    missing: { label: '❌ Missing', kind: 'red' },
  };
  const PERMIT_STATUS = {
    draft: { label: 'Draft', kind: 'navy' },
    submitted: { label: 'Submitted', kind: 'blue' },
    'under-review': { label: 'Under Review', kind: 'blue' },
    corrections: { label: 'Corrections Open', kind: 'red' },
    approved: { label: 'Approved', kind: 'green' },
  };
  const CORRECTION_STATUS = { 'not-started': 'Not started', 'in-progress': 'In progress', complete: 'Complete' };
  const SOURCE_TYPES = ['debt', 'equity', 'grant', 'tax-credit', 'subsidy', 'deferred-fee', 'other'];

  const projectQuery = ctx => `?projectId=${encodeURIComponent(ctx.project.id)}`;
  const sectionPath = (ctx, section, params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return `${Shell.projectPath(ctx.project.id, section)}${qs ? `?${qs}` : ''}`;
  };
  const disciplineTag = d => html`<span class="tc-tag ${TAG_CLASS[d] || ''}">${DISCIPLINES[d] || UI.titleCase(d || 'General')}</span>`;
  const options = (map, value, { blank } = {}) => html`${blank !== undefined ? html`<option value="">${blank}</option>` : ''}${Object.entries(map).map(([k, v]) =>
    html`<option value="${k}" ${k === (value || '') ? raw('selected') : ''}>${typeof v === 'string' ? v : v.label}</option>`)}`;
  const num = v => (v === '' || v === null || v === undefined ? undefined : Number(String(v).replace(/[$,\s]/g, '')));

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
      const openTask = openTaskId === 'new' ? { id: null, status: 'not-started' } : tasks.find(t => t.id === openTaskId);
      const disciplines = [...new Set(tasks.map(t => t.discipline).filter(Boolean))];
      const filters = { discipline, contract };

      const card = t => {
        const cov = coverage(t, contracts);
        return html`
          <a class="task-card ${t.status === 'blocked' ? 'blocked' : ''}" href="#${sectionPath(ctx, 'tasks', { ...filters, task: t.id })}" data-testid="task-card" data-task="${t.id}">
            <div class="tc-tagrow">${disciplineTag(t.discipline)}</div>
            <div class="tc-title">${t.title}</div>
            ${t.note ? html`<div class="tc-note">${t.note}</div>` : ''}
            ${t.deps && t.deps.length ? html`<div class="tc-note">Depends on ${t.deps.length} task${t.deps.length > 1 ? 's' : ''}</div>` : ''}
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
          ${Session.can('tasks:create') ? html`<a class="btn btn-navy btn-sm" href="#${sectionPath(ctx, 'tasks', { ...filters, task: 'new' })}" data-testid="new-task">+ Add task</a>` : ''}
        </div>
        ${tasks.length ? html`
          <div class="kanban" data-testid="kanban">
            ${COLUMNS.map(col => {
              const items = shown.filter(t => t.status === col.status);
              return html`
                <div class="kanban-col" data-column="${col.status}">
                  <div class="col-header"><span class="col-title ${col.css}">${col.label}<span class="col-count">${items.length}</span></span></div>
                  <div class="col-body">${items.map(card)}</div>
                </div>`;
            })}
          </div>` : html`<div class="page">${UI.empty('No tasks recorded for this project yet.')}</div>`}
        ${openTask ? taskPanel(ctx, openTask, tasks, contracts, partners, filters) : ''}`;
    },
  };

  function taskPanel(ctx, t, tasks, contracts, partners, filters) {
    const isNew = !t.id;
    const canEdit = isNew ? Session.can('tasks:create') : Session.can('tasks:update');
    const contract = contracts.find(c => c.id === t.contractId);
    const cs = contract ? CONTRACT_STATUS[contract.status] || { label: contract.status, kind: 'navy' } : null;
    const close = `#${sectionPath(ctx, 'tasks', filters)}`;
    const others = tasks.filter(x => x.id !== t.id);
    return html`
      <div class="side-panel" role="dialog" aria-label="${isNew ? 'New task' : 'Task details'}" data-testid="task-panel">
        <div class="side-panel-head">
          <div>${isNew ? '' : disciplineTag(t.discipline)}<h2 class="side-panel-title">${isNew ? 'New task' : t.title}</h2></div>
          <a class="tm-close" href="${close}" aria-label="Close">✕</a>
        </div>
        ${!isNew && Session.can('tasks:status:update') ? html`
          <div class="status-switch" role="group" aria-label="Status">
            ${COLUMNS.map(c => html`<button class="btn btn-sm ${c.status === t.status ? 'btn-navy' : 'btn-o'}" data-action="task-status" data-id="${t.id}" data-status="${c.status}"
              ${c.status === t.status ? raw('aria-pressed="true"') : ''} data-testid="task-status-${c.status}">${c.short}</button>`)}
          </div>` : ''}
        ${canEdit ? html`
          <form class="form-card" data-form="task-save" data-id="${t.id || ''}" data-project="${ctx.project.id}" data-close="${close}" data-testid="task-form" novalidate>
            ${UI.field({ name: 'title', label: 'Title', value: t.title || '', required: true })}
            <div class="form-grid">
              <label class="field"><span class="lbl">Discipline</span>
                <select class="input" name="discipline">${options(DISCIPLINES, t.discipline, { blank: 'General' })}</select></label>
              ${UI.field({ name: 'dueDate', label: 'Due date', type: 'date', value: t.dueDate || '' })}
            </div>
            <div class="form-grid">
              ${UI.select({ name: 'partnerId', label: 'Assigned partner', value: t.partnerId || '',
                options: [{ value: '', label: 'Unassigned' }, ...partners.map(p => ({ value: p.id, label: p.name }))] })}
              ${UI.select({ name: 'contractId', label: 'Contract', value: t.contractId || '', testid: 'task-contract',
                options: [{ value: '', label: 'None' }, ...contracts.map(c => ({ value: c.id, label: `${c.type} (${c.status})` }))] })}
            </div>
            ${UI.textarea({ name: 'note', label: 'Note', value: t.note || '', rows: 2 })}
            ${others.length ? html`
              <fieldset class="dep-list"><legend class="lbl">Depends on</legend>
                ${others.map(o => html`<label class="dep-item"><input type="checkbox" name="deps" value="${o.id}" ${(t.deps || []).includes(o.id) ? raw('checked') : ''}> ${o.title}</label>`)}
              </fieldset>` : ''}
            ${UI.formError()}
            <div class="form-actions">
              <button class="btn btn-navy btn-sm" type="submit">${isNew ? 'Create task' : 'Save task'}</button>
              ${!isNew && Session.can('tasks:delete') ? html`<button class="btn btn-red btn-sm" type="button" data-action="task-delete" data-id="${t.id}" data-close="${close}">Delete</button>` : ''}
            </div>
          </form>` : html`
          <dl class="kv">
            <div><dt>Status</dt><dd>${UI.titleCase(t.status)}</dd></div>
            <div><dt>Assigned partner</dt><dd>${Store.partnerName(partners, t.partnerId)}</dd></div>
            <div><dt>Contract</dt><dd>${contract ? html`${contract.type} ${UI.badge(cs.label, cs.kind)}` : 'None linked'}</dd></div>
            <div><dt>Due</dt><dd>${UI.date(t.dueDate)}</dd></div>
          </dl>
          ${t.note ? html`<div class="panel-note">${t.note}</div>` : ''}`}
      </div>`;
  }

  Actions.onChange('task-filter', el => {
    const { path, query } = Router.current();
    const next = { ...query, [el.dataset.key]: el.value };
    delete next.task;
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v)).toString();
    Router.go(`${path}${qs ? `?${qs}` : ''}`);
  });

  Actions.onSubmit('task-save', async form => {
    const id = form.dataset.id;
    const body = {
      title: form.title.value.trim(),
      discipline: form.discipline.value || null,
      dueDate: form.dueDate.value || null,
      partnerId: form.partnerId.value || null,
      contractId: form.contractId.value || null,
      note: form.note.value.trim() || null,
      deps: [...form.querySelectorAll('input[name="deps"]:checked')].map(i => i.value),
    };
    const saved = await UI.submit(form, () => {
      if (!body.title) throw new Error('Title is required.');
      if (id) return Api.put(`/tasks/${encodeURIComponent(id)}`, body);
      return Api.post('/tasks', { ...body, projectId: form.dataset.project, status: 'not-started' });
    });
    if (!saved) return;
    UI.toast(id ? 'Task saved' : 'Task created', 'success');
    Router.go(form.dataset.close.replace(/^#/, ''));
  });

  Actions.onClick('task-status', async el => {
    el.disabled = true;
    try {
      const t = await Api.patch(`/tasks/${encodeURIComponent(el.dataset.id)}/status`, { status: el.dataset.status });
      UI.toast(`Moved to ${UI.titleCase(t.status)}`, 'success');
    } finally {
      App.rerender();
    }
  });

  Actions.onClick('task-delete', async el => {
    if (!global.confirm('Delete this task? This cannot be undone.')) return;
    await Api.del(`/tasks/${encodeURIComponent(el.dataset.id)}`);
    UI.toast('Task deleted', 'success');
    Router.go(el.dataset.close.replace(/^#/, ''));
  });

  // ── Permits ──────────────────────────────────
  Pages.permits = {
    title: ctx => `Permits · ${ctx.project.name}`,
    async render(ctx) {
      const permits = await Api.get(`/permits${projectQuery(ctx)}`);
      const n = s => permits.filter(p => p.status === s).length;
      const canStatus = Session.can('permits:status:update');
      const canCorrect = Session.can('permits:corrections:update');
      return html`
        <div class="page">
          ${UI.pageHeader('Permit Tracker', 'Every permit from submission through approval, with open correction items')}
          ${UI.stats([
            { value: n('approved'), label: 'Approved', color: 'var(--green)' },
            { value: n('under-review') + n('submitted'), label: 'In Review', color: 'var(--blue)' },
            { value: n('corrections'), label: 'Corrections Open', color: 'var(--red)' },
            { value: permits.length, label: 'Total Permits' },
          ])}
          ${canStatus ? html`
            <details class="card add-card" ${permits.length ? '' : raw('open')}>
              <summary class="section-h">+ Add permit</summary>
              <form data-form="permit-create" data-project="${ctx.project.id}" data-testid="permit-form" novalidate>
                <div class="form-grid">
                  ${UI.field({ name: 'name', label: 'Permit name', required: true, placeholder: 'e.g. Building Permit' })}
                  ${UI.field({ name: 'jurisdiction', label: 'Jurisdiction', placeholder: 'e.g. City of LA — Building' })}
                  ${UI.field({ name: 'type', label: 'Type', placeholder: 'e.g. building' })}
                  <label class="field"><span class="lbl">Status</span><select class="input" name="status">${options(PERMIT_STATUS, 'draft')}</select></label>
                  ${UI.field({ name: 'submittedDate', label: 'Submitted', type: 'date' })}
                </div>
                ${UI.formError()}
                <div class="form-actions"><button class="btn btn-navy btn-sm" type="submit">Add permit</button></div>
              </form>
            </details>` : ''}
          ${UI.table([
            { label: 'Permit', cell: p => html`<div class="cell-strong">${p.name}</div>
                ${(p.corrections || []).length ? html`
                  <ol class="corrections">${p.corrections.map(c => html`<li><span>${c.text}</span>
                    ${canCorrect ? html`<label><span class="sr-only">Correction status</span><select class="input input-sm" data-change="correction-status" data-permit="${p.id}" data-id="${c.id}">${options(CORRECTION_STATUS, c.status)}</select></label>`
                      : UI.badge(CORRECTION_STATUS[c.status] || c.status, c.status === 'complete' ? 'green' : c.status === 'in-progress' ? 'amber' : 'red')}</li>`)}</ol>` : ''}
                ${canCorrect ? html`
                  <form class="inline-add" data-form="correction-add" data-permit="${p.id}" novalidate>
                    <label class="grow"><span class="sr-only">New correction item</span><input class="input input-sm" name="text" placeholder="Add a correction item…"></label>
                    <button class="btn btn-o btn-sm" type="submit">Add</button>${UI.formError()}
                  </form>` : ''}` },
            { label: 'Jurisdiction', cell: p => p.jurisdiction || '—', className: 'cell-dim' },
            { label: 'Type', cell: p => UI.badge(p.type || '—', 'navy') },
            { label: 'Status', cell: p => (canStatus ? html`<label><span class="sr-only">Status of ${p.name}</span>
                <select class="input input-sm" data-change="permit-status" data-id="${p.id}" data-testid="permit-status">${options(PERMIT_STATUS, p.status)}</select></label>`
                : (() => { const s = PERMIT_STATUS[p.status] || { label: UI.titleCase(p.status), kind: 'navy' }; return UI.badge(s.label, s.kind); })()) },
            { label: 'Submitted', cell: p => UI.date(p.submittedDate), className: 'mono' },
            { label: 'Approved', cell: p => UI.date(p.approvedDate), className: 'mono' },
          ], permits, { empty: 'No permits recorded for this project yet.', rowAttrs: p => html`data-testid="permit-row" data-name="${p.name}"` })}
        </div>`;
    },
  };

  Actions.onSubmit('permit-create', async form => {
    const body = {
      projectId: form.dataset.project, name: form.name.value.trim(), jurisdiction: form.jurisdiction.value.trim() || null,
      type: form.type.value.trim() || null, status: form.status.value, submittedDate: form.submittedDate.value || null,
    };
    const created = await UI.submit(form, () => {
      if (!body.name) throw new Error('Permit name is required.');
      return Api.post('/permits', body);
    });
    if (!created) return;
    UI.toast('Permit added', 'success');
    App.rerender();
  });

  Actions.onChange('permit-status', async el => {
    el.disabled = true;
    try {
      const p = await Api.patch(`/permits/${encodeURIComponent(el.dataset.id)}/status`, { status: el.value });
      UI.toast(`${p.name}: ${PERMIT_STATUS[p.status].label}`, 'success');
    } finally {
      App.rerender();
    }
  });

  Actions.onSubmit('correction-add', async form => {
    const text = form.text.value.trim();
    const created = await UI.submit(form, () => {
      if (!text) throw new Error('Describe the correction item.');
      return Api.post(`/permits/${encodeURIComponent(form.dataset.permit)}/corrections`, { text });
    });
    if (!created) return;
    UI.toast('Correction item added', 'success');
    App.rerender();
  });

  Actions.onChange('correction-status', async el => {
    el.disabled = true;
    try {
      await Api.patch(`/permits/${encodeURIComponent(el.dataset.permit)}/corrections/${encodeURIComponent(el.dataset.id)}`, { status: el.value });
      UI.toast('Correction updated', 'success');
    } finally {
      App.rerender();
    }
  });

  // ── Contracts ────────────────────────────────
  Pages.contracts = {
    title: ctx => `Contracts · ${ctx.project.name}`,
    async render(ctx) {
      const [contracts, partners] = await Promise.all([Api.get(`/contracts${projectQuery(ctx)}`), Store.getPartners()]);
      const n = s => contracts.filter(c => c.status === s).length;
      const editing = contracts.find(c => c.id === ctx.query.edit);
      const partnerOptions = [{ value: '', label: 'Not assigned' }, ...partners.map(p => ({ value: p.id, label: p.name }))];
      const form = (c, formName, label) => html`
        <form data-form="${formName}" data-id="${c.id || ''}" data-project="${ctx.project.id}" data-testid="${formName}" novalidate>
          <div class="form-grid">
            ${UI.select({ name: 'partnerId', label: 'Partner', value: c.partnerId || '', options: partnerOptions })}
            ${UI.field({ name: 'type', label: 'Contract type', value: c.type || '', required: true, placeholder: 'e.g. Civil Engineering Services' })}
            <label class="field"><span class="lbl">Status</span><select class="input" name="status">${options(CONTRACT_STATUS, c.status || 'pending')}</select></label>
            ${UI.field({ name: 'value', label: 'Value ($)', value: c.value === null || c.value === undefined ? '' : String(c.value), placeholder: 'e.g. 250000' })}
          </div>
          ${UI.formError()}
          <div class="form-actions"><button class="btn btn-navy btn-sm" type="submit">${label}</button>
            ${c.id ? html`<a class="btn btn-o btn-sm" href="#${sectionPath(ctx, 'contracts')}">Cancel</a>` : ''}</div>
        </form>`;
      return html`
        <div class="page">
          ${UI.pageHeader('Contracts', 'Contract status cross-referenced with SOW tasks — work proceeds only under an executed contract')}
          ${UI.stats([
            { value: n('executed'), label: 'Executed', color: 'var(--green)' },
            { value: n('missing'), label: 'Missing', color: 'var(--red)' },
            { value: n('pending'), label: 'Pending Signature', color: 'var(--amber)' },
            { value: contracts.length, label: 'Total Contracts' },
          ])}
          ${editing && Session.can('contracts:update') ? html`<section class="card"><h2 class="section-h">Edit contract</h2>${form(editing, 'contract-update', 'Save contract')}</section>` : ''}
          ${!editing && Session.can('contracts:create') ? html`
            <details class="card add-card" ${contracts.length ? '' : raw('open')}>
              <summary class="section-h">+ Add contract</summary>${form({}, 'contract-create', 'Add contract')}
            </details>` : ''}
          ${UI.table([
            { label: 'Partner', cell: c => html`<span class="cell-strong">${Store.partnerName(partners, c.partnerId)}</span>` },
            { label: 'Contract type', cell: c => c.type || '—' },
            { label: 'Status', cell: c => { const s = CONTRACT_STATUS[c.status] || { label: UI.titleCase(c.status), kind: 'navy' }; return UI.badge(s.label, s.kind); } },
            { label: 'Value', cell: c => UI.money(c.value), className: 'num' },
            { label: 'Executed', cell: c => UI.date(c.executedDate), className: 'mono' },
            { label: 'Linked tasks', cell: c => UI.number(c.linkedTaskCount), className: 'num' },
            { label: '', cell: c => html`<div class="row-actions">
                ${c.status !== 'executed' && Session.can('contracts:execute') ? html`<button class="btn btn-gold btn-sm" data-action="contract-execute" data-id="${c.id}" data-testid="execute-contract">Execute</button>` : ''}
                ${Session.can('contracts:update') ? html`<a class="btn btn-o btn-sm" href="#${sectionPath(ctx, 'contracts', { edit: c.id })}">Edit</a>` : ''}
                ${Session.can('contracts:delete') ? html`<button class="btn btn-red btn-sm" data-action="contract-delete" data-id="${c.id}">Delete</button>` : ''}
              </div>` },
          ], contracts, { empty: 'No contracts recorded for this project yet.', rowAttrs: c => html`data-testid="contract-row" data-type="${c.type}"` })}
        </div>`;
    },
  };

  const readContract = form => ({
    partnerId: form.partnerId.value || null, type: form.type.value.trim(), status: form.status.value, value: num(form.value.value),
  });

  Actions.onSubmit('contract-create', async form => {
    const body = { ...readContract(form), projectId: form.dataset.project };
    const created = await UI.submit(form, () => {
      if (!body.type) throw new Error('Contract type is required.');
      if (body.value !== undefined && !(body.value >= 0)) throw new Error('Value must be a positive number.');
      return Api.post('/contracts', body);
    });
    if (!created) return;
    UI.toast('Contract added', 'success');
    App.rerender();
  });

  Actions.onSubmit('contract-update', async form => {
    const body = readContract(form);
    const saved = await UI.submit(form, () => {
      if (!body.type) throw new Error('Contract type is required.');
      if (body.value !== undefined && !(body.value >= 0)) throw new Error('Value must be a positive number.');
      return Api.put(`/contracts/${encodeURIComponent(form.dataset.id)}`, body);
    });
    if (!saved) return;
    UI.toast('Contract saved', 'success');
    Router.go(Router.current().path);
  });

  Actions.onClick('contract-execute', async el => {
    if (!global.confirm('Mark this contract as executed today? Tasks blocked on it will be unblocked.')) return;
    el.disabled = true;
    try {
      await Api.post(`/contracts/${encodeURIComponent(el.dataset.id)}/execute`);
      UI.toast('Contract executed', 'success');
    } finally {
      App.rerender();
    }
  });

  Actions.onClick('contract-delete', async el => {
    if (!global.confirm('Delete this contract? Tasks linked to it will lose the link.')) return;
    await Api.del(`/contracts/${encodeURIComponent(el.dataset.id)}`);
    UI.toast('Contract deleted', 'success');
    App.rerender();
  });

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
      const canEdit = Session.can('capital:update');
      const editing = canEdit && ctx.query.edit === '1';
      if (!stack || !Array.isArray(stack.sources)) stack = editing ? { totalCost: 0, sources: [] } : null;
      if (!stack) {
        return html`<div class="page">${UI.pageHeader('Capital Stack', ctx.project.name,
          canEdit ? html`<a class="btn btn-navy btn-sm" href="#${sectionPath(ctx, 'capital', { edit: '1' })}" data-testid="edit-capital">Build capital stack</a>` : '')}
          ${UI.empty('No capital stack recorded for this project yet.')}</div>`;
      }
      if (editing) return capitalEditor(ctx, stack);
      const sum = list => list.reduce((s, x) => s + (Number(x.amount) || 0), 0);
      const committed = sum(stack.sources.filter(s => s.status === 'committed'));
      const pending = sum(stack.sources.filter(s => s.status !== 'committed'));
      const total = Number(stack.totalCost) || 0;
      const capitalized = total > 0 ? Math.round((committed / total) * 100) : 0;
      const gap = total - sum(stack.sources);

      return html`
        <div class="page">
          ${UI.pageHeader('Capital Stack', `${ctx.project.name} — ${UI.money(total)} total development cost`,
            canEdit ? html`<a class="btn btn-o btn-sm" href="#${sectionPath(ctx, 'capital', { edit: '1' })}" data-testid="edit-capital">Edit capital stack</a>` : '')}
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

  function sourceRow(s, i) {
    return html`
      <div class="source-row" data-source-row>
        ${UI.field({ name: `name-${i}`, label: 'Source', value: s.name || '', placeholder: 'e.g. Construction loan — Western Bank' })}
        <label class="field"><span class="lbl">Type</span><select class="input" name="type-${i}">
          ${SOURCE_TYPES.map(t => html`<option value="${t}" ${t === (s.type || 'debt') ? raw('selected') : ''}>${UI.titleCase(t)}</option>`)}</select></label>
        ${UI.field({ name: `amount-${i}`, label: 'Amount ($)', value: s.amount === undefined || s.amount === null ? '' : String(s.amount) })}
        <label class="field"><span class="lbl">Status</span><select class="input" name="status-${i}">
          ${['committed', 'pending'].map(st => html`<option value="${st}" ${st === (s.status || 'pending') ? raw('selected') : ''}>${UI.titleCase(st)}</option>`)}</select></label>
        ${UI.field({ name: `deadline-${i}`, label: 'Deadline', type: 'date', value: s.deadline || '' })}
        <input type="hidden" name="color-${i}" value="${s.color || ''}">
        <input type="hidden" name="alert-${i}" value="${s.alert || ''}">
        <button class="btn btn-red btn-sm source-remove" type="button" data-action="source-remove" aria-label="Remove source">✕</button>
      </div>`;
  }

  function capitalEditor(ctx, stack) {
    const rows = stack.sources.length ? stack.sources : [{}];
    return html`
      <div class="page">
        ${UI.pageHeader('Edit capital stack', ctx.project.name)}
        <form class="card form-card" data-form="capital-save" data-project="${ctx.project.id}" data-testid="capital-form" novalidate>
          ${UI.field({ name: 'totalCost', label: 'Total development cost ($)', value: String(stack.totalCost || '') })}
          <div class="sources" data-sources>${rows.map((s, i) => sourceRow(s, i))}</div>
          <div><button class="btn btn-o btn-sm" type="button" data-action="source-add" data-testid="add-source">+ Add source</button></div>
          ${UI.formError()}
          <div class="form-actions">
            <button class="btn btn-navy btn-sm" type="submit">Save capital stack</button>
            <a class="btn btn-o btn-sm" href="#${sectionPath(ctx, 'capital')}">Cancel</a>
          </div>
        </form>
      </div>`;
  }

  let sourceSeq = 1000;
  Actions.onClick('source-add', el => {
    const list = el.closest('form').querySelector('[data-sources]');
    const holder = document.createElement('div');
    mount(holder, sourceRow({}, sourceSeq++));
    list.appendChild(holder.firstElementChild);
  });
  Actions.onClick('source-remove', el => { el.closest('[data-source-row]').remove(); });

  Actions.onSubmit('capital-save', async form => {
    const field = (row, prefix) => row.querySelector(`[name^="${prefix}-"]`);
    const saved = await UI.submit(form, () => {
      const totalCost = num(form.totalCost.value);
      if (!(totalCost >= 0)) throw new Error('Total development cost must be a number.');
      const sources = [];
      for (const [i, row] of [...form.querySelectorAll('[data-source-row]')].entries()) {
        const name = field(row, 'name').value.trim();
        const amountText = field(row, 'amount').value;
        if (!name && !amountText) continue; // blank row
        const amount = num(amountText);
        if (!name) throw new Error(`Source ${i + 1}: name is required.`);
        if (!(amount >= 0)) throw new Error(`Source ${i + 1}: amount must be a number.`);
        sources.push({
          name, amount, type: field(row, 'type').value, status: field(row, 'status').value,
          deadline: field(row, 'deadline').value || null,
          color: field(row, 'color').value || null, alert: field(row, 'alert').value || null,
        });
      }
      return Api.put(`/capital/${encodeURIComponent(form.dataset.project)}`, { totalCost, sources });
    });
    if (!saved) return;
    UI.toast('Capital stack saved', 'success');
    Router.go(Shell.projectPath(form.dataset.project, 'capital'));
  });
})(window);
