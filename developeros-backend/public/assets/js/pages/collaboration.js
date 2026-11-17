// ═══════════════════════════════════════════════
// pages/collaboration.js — messages, documents (WP7: read + write), partners
// ═══════════════════════════════════════════════

(function (global) {
  const Pages = (global.Pages = global.Pages || {});
  const projectQuery = ctx => `?projectId=${encodeURIComponent(ctx.project.id)}`;
  const DOC_CATEGORIES = { plans: 'Plans', contracts: 'Contracts', permits: 'Permits', reports: 'Reports', mous: 'MOUs', financial: 'Financial', other: 'Other' };
  const ACCEPT = '.pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx,.doc,.xls,.dwg,.csv,.txt';
  const EXT_TYPES = { dwg: 'image/vnd.dwg', csv: 'text/csv', txt: 'text/plain' };
  const PARTNER_ROLES = ['architect', 'civil', 'structural', 'landscape', 'mep', 'survey', 'environmental', 'geotechnical', 'contractor', 'legal', 'lender', 'investor', 'consultant', 'other'];
  const fileSize = n => (n === null || n === undefined ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  // ── Messages ─────────────────────────────────
  Pages.messages = {
    title: ctx => `Messages · ${ctx.project.name}`,
    async render(ctx) {
      const channels = await Api.get(`/messages/channels${projectQuery(ctx)}`);
      const canSend = Session.can('messages:send');
      const newChannel = canSend ? html`
        <form class="new-channel" data-form="channel-create" data-project="${ctx.project.id}" data-testid="channel-form" novalidate>
          <label><span class="sr-only">New channel name</span><input class="input input-sm" name="name" placeholder="new-channel-name"></label>
          <button class="btn btn-o btn-sm" type="submit">+ Channel</button>
          ${UI.formError()}
        </form>` : '';
      if (!channels.length) {
        return html`<div class="page">${UI.pageHeader('Messages', ctx.project.name)}${UI.empty('No channels for this project yet.')}${newChannel}</div>`;
      }
      const active = channels.find(c => c.id === ctx.query.channel) || channels[0];
      const messages = await Api.get(`/messages/channels/${encodeURIComponent(active.id)}/messages`);
      const base = `#${Shell.projectPath(ctx.project.id, 'messages')}`;
      return html`
        <div class="msg-layout">
          <nav class="msg-channels" aria-label="Channels">
            <div class="ch-section">Project channels</div>
            ${channels.map(ch => html`<a class="ch-item ${ch.id === active.id ? 'on' : ''}" href="${base}?channel=${encodeURIComponent(ch.id)}" data-testid="channel"><span class="ch-hash">#</span>${ch.name}</a>`)}
            ${newChannel}
          </nav>
          <section class="msg-main">
            <div class="msg-topbar">
              <span class="msg-hash">#</span>
              <div><h1 class="msg-ch-name">${active.name}</h1><div class="msg-ch-desc">${active.desc || ''}</div></div>
            </div>
            <div class="msg-messages" data-testid="message-list">
              ${messages.length ? messages.map(m => html`
                <div class="msg-row" data-testid="message">
                  <div class="msg-av" style="background:${safeColor(m.senderColor)}">${m.senderInitials || '?'}</div>
                  <div class="msg-content">
                    <div class="msg-header">
                      <span class="msg-name">${m.senderName}</span>
                      <span class="msg-time">${UI.dateTime(m.timestamp)}</span>
                      ${m.role ? UI.badge(m.role, 'gold') : ''}
                    </div>
                    <div class="msg-bubble">${m.text}</div>
                  </div>
                </div>`) : UI.empty('No messages in this channel yet.')}
            </div>
            ${canSend ? html`
              <form class="msg-input-area" data-form="message-send" data-channel="${active.id}" data-testid="message-form" novalidate>
                <div class="msg-input-row">
                  <label class="grow"><span class="sr-only">Message #${active.name}</span>
                    <textarea class="msg-textarea" name="text" rows="2" placeholder="Message #${active.name}"></textarea></label>
                  <button class="btn btn-navy btn-sm" type="submit">Send</button>
                </div>
                ${UI.formError()}
              </form>` : ''}
          </section>
        </div>`;
    },
    after() {
      const list = document.querySelector('[data-testid="message-list"]');
      if (list) list.scrollTop = list.scrollHeight;
    },
  };

  Actions.onSubmit('message-send', async form => {
    const text = form.text.value.trim();
    const sent = await UI.submit(form, () => {
      if (!text) throw new Error('Write a message first.');
      return Api.post(`/messages/channels/${encodeURIComponent(form.dataset.channel)}/messages`, { text });
    });
    if (!sent) return;
    App.rerender();
  });

  Actions.onSubmit('channel-create', async form => {
    const name = form.name.value.trim().toLowerCase().replace(/\s+/g, '-');
    const created = await UI.submit(form, () => Api.post('/messages/channels', { projectId: form.dataset.project, name }));
    if (!created) return;
    UI.toast(`#${created.name} created`, 'success');
    Router.go(`${Shell.projectPath(form.dataset.project, 'messages')}?channel=${encodeURIComponent(created.id)}`);
  });

  // ── Documents ────────────────────────────────
  Pages.documents = {
    title: ctx => `Documents · ${ctx.project.name}`,
    async render(ctx) {
      const docs = await Api.get(`/documents${projectQuery(ctx)}`);
      const category = ctx.query.category || '';
      const categories = [...new Set(docs.map(d => d.category).filter(Boolean))];
      const shown = category ? docs.filter(d => d.category === category) : docs;
      const base = `#${Shell.projectPath(ctx.project.id, 'documents')}`;
      return html`
        <div class="page">
          ${UI.pageHeader('Documents', 'Project files and register entries')}
          ${Session.can('documents:create') ? html`
            <form class="card form-card" data-form="document-upload" data-project="${ctx.project.id}" data-testid="upload-form" novalidate>
              <div class="form-grid">
                <label class="field"><span class="lbl">File</span><input class="input" type="file" name="file" accept="${ACCEPT}" data-testid="upload-file"></label>
                ${UI.field({ name: 'name', label: 'Document name (optional)', placeholder: 'Defaults to the file name' })}
                <label class="field"><span class="lbl">Category</span><select class="input" name="category">
                  ${Object.entries(DOC_CATEGORIES).map(([k, v]) => html`<option value="${k}" ${k === 'plans' ? raw('selected') : ''}>${v}</option>`)}</select></label>
              </div>
              <div class="fine">PDF, images, Office documents, DWG, CSV or text — up to 25 MB.</div>
              ${UI.formError()}
              <div class="form-actions"><button class="btn btn-navy btn-sm" type="submit">Upload</button></div>
            </form>` : ''}
          ${categories.length ? html`
            <div class="chip-row" role="tablist">
              <a class="chip ${category ? '' : 'on'}" href="${base}">All (${docs.length})</a>
              ${categories.map(c => html`<a class="chip ${c === category ? 'on' : ''}" href="${base}?category=${encodeURIComponent(c)}">${DOC_CATEGORIES[c] || UI.titleCase(c)} (${docs.filter(d => d.category === c).length})</a>`)}
            </div>` : ''}
          ${UI.table([
            { label: 'Document', cell: d => html`<span class="doc-ico" aria-hidden="true">${d.icon || '📄'}</span> <span class="cell-strong">${d.name}</span>
                ${d.hasFile ? html`<div class="cell-dim">${d.originalFilename} · ${fileSize(d.sizeBytes)}</div>` : html`<div class="cell-dim">Register entry (no file stored)</div>`}` },
            { label: 'Category', cell: d => DOC_CATEGORIES[d.category] || UI.titleCase(d.category || '—') },
            { label: 'From', cell: d => d.uploadedBy || '—', className: 'cell-dim' },
            { label: 'Date', cell: d => UI.date(d.date), className: 'mono' },
            { label: 'Type', cell: d => d.type || '—', className: 'mono' },
            { label: '', cell: d => html`<div class="row-actions">
                ${d.hasFile ? html`<button class="btn btn-o btn-sm" data-action="document-download" data-id="${d.id}" data-name="${d.originalFilename || d.name}" data-testid="download">Download</button>` : ''}
                ${Session.can('documents:delete') ? html`<button class="btn btn-red btn-sm" data-action="document-delete" data-id="${d.id}">Delete</button>` : ''}
              </div>` },
          ], shown, { empty: 'No documents for this project yet.', rowAttrs: d => html`data-testid="document-row" data-name="${d.name}"` })}
        </div>`;
    },
  };

  Actions.onSubmit('document-upload', async form => {
    const file = form.file.files[0];
    const name = form.name.value.trim() || (file && file.name.replace(/\.[^.]+$/, '')) || '';
    const done = await UI.submit(form, () => {
      if (!file) throw new Error('Choose a file to upload.');
      if (file.size > 25 * 1024 * 1024) throw new Error('The file is larger than 25 MB.');
      // Browsers leave some types blank (e.g. .dwg); send a type the server can verify.
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const typed = file.type ? file : new File([file], file.name, { type: EXT_TYPES[ext] || 'application/octet-stream' });
      const qs = new URLSearchParams({ projectId: form.dataset.project, name, category: form.category.value, filename: file.name });
      return Api.upload(`/documents/upload?${qs}`, typed);
    });
    if (!done) return;
    UI.toast(`Uploaded ${done.name}`, 'success');
    App.rerender();
  });

  Actions.onClick('document-download', async el => {
    el.disabled = true;
    try {
      await Api.download(`/documents/${encodeURIComponent(el.dataset.id)}/download`, el.dataset.name);
    } finally {
      el.disabled = false;
    }
  });

  Actions.onClick('document-delete', async el => {
    if (!global.confirm('Delete this document and its stored file?')) return;
    await Api.del(`/documents/${encodeURIComponent(el.dataset.id)}`);
    UI.toast('Document deleted', 'success');
    App.rerender();
  });

  // ── Partners (organization directory) ────────
  Pages.partners = {
    title: () => 'Partners',
    async render(ctx) {
      Store.partners = null;
      const partners = await Store.getPartners();
      const canManage = Session.can('partners:manage');
      const editing = partners.find(p => p.id === ctx.query.edit);
      const roleSelect = value => html`<label class="field"><span class="lbl">Role</span><select class="input" name="role">
        ${PARTNER_ROLES.map(r => html`<option value="${r}" ${r === value ? raw('selected') : ''}>${UI.titleCase(r)}</option>`)}</select></label>`;
      return html`
        <div class="page">
          ${UI.pageHeader('Partners', `${Session.organizationName()} — consultants, contractors and other partners assigned to tasks and contracts`)}
          ${canManage ? html`
            <form class="card form-card" data-form="${editing ? 'partner-update' : 'partner-create'}" data-id="${editing ? editing.id : ''}" data-testid="partner-form" novalidate>
              <h2 class="section-h">${editing ? `Edit ${editing.name}` : 'Add partner'}</h2>
              <div class="form-grid">
                ${UI.field({ name: 'name', label: 'Name', value: editing ? editing.name : '', required: true, placeholder: 'e.g. Smith Civil Engineering' })}
                ${roleSelect(editing ? editing.role : 'consultant')}
                ${UI.field({ name: 'initials', label: 'Initials (optional)', value: editing ? editing.initials || '' : '' })}
              </div>
              ${UI.formError()}
              <div class="form-actions"><button class="btn btn-navy btn-sm" type="submit">${editing ? 'Save partner' : 'Add partner'}</button>
                ${editing ? html`<a class="btn btn-o btn-sm" href="#/partners">Cancel</a>` : ''}</div>
            </form>` : ''}
          ${UI.table([
            { label: 'Partner', cell: p => html`<span class="cell-strong">${p.name}</span>` },
            { label: 'Role', cell: p => UI.badge(UI.titleCase(p.role), 'gold') },
            { label: 'Initials', cell: p => p.initials || '—', className: 'mono' },
            { label: '', cell: p => (canManage ? html`<a class="btn btn-o btn-sm" href="#/partners?edit=${encodeURIComponent(p.id)}">Edit</a>` : '') },
          ], partners, { empty: 'No partners yet.', rowAttrs: p => html`data-testid="partner-row" data-name="${p.name}"` })}
        </div>`;
    },
  };

  const readPartner = form => {
    const b = { name: form.name.value.trim(), role: form.role.value };
    if (form.initials.value.trim()) b.initials = form.initials.value.trim();
    return b;
  };

  Actions.onSubmit('partner-create', async form => {
    const created = await UI.submit(form, () => Api.post('/partners', readPartner(form)));
    if (!created) return;
    Store.partners = null;
    UI.toast(`${created.name} added`, 'success');
    App.rerender();
  });

  Actions.onSubmit('partner-update', async form => {
    const saved = await UI.submit(form, () => Api.patch(`/partners/${encodeURIComponent(form.dataset.id)}`, readPartner(form)));
    if (!saved) return;
    Store.partners = null;
    UI.toast(`${saved.name} saved`, 'success');
    Router.go('/partners');
  });
})(window);
