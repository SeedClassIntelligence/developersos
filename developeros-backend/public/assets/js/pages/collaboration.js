// ═══════════════════════════════════════════════
// pages/collaboration.js — messages and documents (live, read)
// ═══════════════════════════════════════════════

(function (global) {
  const Pages = (global.Pages = global.Pages || {});
  const projectQuery = ctx => `?projectId=${encodeURIComponent(ctx.project.id)}`;

  // ── Messages ─────────────────────────────────
  Pages.messages = {
    title: ctx => `Messages · ${ctx.project.name}`,
    async render(ctx) {
      const channels = await Api.get(`/messages/channels${projectQuery(ctx)}`);
      if (!channels.length) {
        return html`<div class="page">${UI.pageHeader('Messages', ctx.project.name)}${UI.empty('No channels for this project yet.')}</div>`;
      }
      const active = channels.find(c => c.id === ctx.query.channel) || channels[0];
      const messages = await Api.get(`/messages/channels/${encodeURIComponent(active.id)}/messages`);
      const base = `#${Shell.projectPath(ctx.project.id, 'messages')}`;
      return html`
        <div class="msg-layout">
          <nav class="msg-channels" aria-label="Channels">
            <div class="ch-section">Project channels</div>
            ${channels.map(ch => html`<a class="ch-item ${ch.id === active.id ? 'on' : ''}" href="${base}?channel=${encodeURIComponent(ch.id)}" data-testid="channel"><span class="ch-hash">#</span>${ch.name}</a>`)}
          </nav>
          <section class="msg-main">
            <div class="msg-topbar">
              <span class="msg-hash">#</span>
              <div><h1 class="msg-ch-name">${active.name}</h1><div class="msg-ch-desc">${active.desc || ''}</div></div>
            </div>
            <div class="msg-messages" data-testid="message-list">
              ${messages.length ? messages.map(m => html`
                <div class="msg-row">
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
          </section>
        </div>`;
    },
  };

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
          ${UI.pageHeader('Documents', 'Document register for this project')}
          ${categories.length ? html`
            <div class="chip-row" role="tablist">
              <a class="chip ${category ? '' : 'on'}" href="${base}">All (${docs.length})</a>
              ${categories.map(c => html`<a class="chip ${c === category ? 'on' : ''}" href="${base}?category=${encodeURIComponent(c)}">${UI.titleCase(c)} (${docs.filter(d => d.category === c).length})</a>`)}
            </div>` : ''}
          ${UI.table([
            { label: 'Document', cell: d => html`<span class="doc-ico" aria-hidden="true">${d.icon || '📄'}</span> <span class="cell-strong">${d.name}</span>` },
            { label: 'Category', cell: d => UI.titleCase(d.category || '—') },
            { label: 'From', cell: d => d.uploadedBy || '—', className: 'cell-dim' },
            { label: 'Date', cell: d => UI.date(d.date), className: 'mono' },
            { label: 'Type', cell: d => d.type || '—', className: 'mono' },
          ], shown, { empty: 'No documents registered for this project yet.' })}
        </div>`;
    },
  };

})(window);
