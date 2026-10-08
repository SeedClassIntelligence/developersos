// ═══════════════════════════════════════════════
// pages/access.js — accounts and access (WP2)
// Password recovery, team members and invitations, audit trail, and
// platform organization provisioning.
// ═══════════════════════════════════════════════

(function (global) {
  const Pages = (global.Pages = global.Pages || {});

  const MEMBER_STATUS = { ACTIVE: 'green', INACTIVE: 'navy', REVOKED: 'red' };
  const INVITE_STATUS = { PENDING: 'amber', ACCEPTED: 'green', EXPIRED: 'navy', REVOKED: 'red' };

  function authFrame(content) {
    return html`
      <div class="auth-layout">
        <aside class="auth-brand">
          <div class="l-logo"><span class="ldot"></span>DeveloperOS</div>
          <div class="auth-brand-h">The operating system for real estate development.</div>
        </aside>
        <main class="auth-main">${content}</main>
      </div>`;
  }

  function linkResult(title, path, delivery, email) {
    const link = `${location.origin}${path}`;
    return html`
      <div class="callout callout-blue invite-result" data-testid="invite-result">
        <strong>${title}</strong>
        ${delivery === 'email'
          ? html`<div>An invitation email was sent to ${email}. You can also share this link:</div>`
          : html`<div>Email delivery is not configured, so share this single-use link with ${email} through a trusted channel:</div>`}
        <div class="copy-row"><code class="mono copy-value" data-testid="invite-link">${link}</code>
          <button class="btn btn-o btn-sm" data-action="copy" data-value="${link}">Copy link</button></div>
        <div class="fine">The link expires in 7 days and can be used once.</div>
      </div>`;
  }

  Actions.onClick('copy', async el => {
    try {
      await navigator.clipboard.writeText(el.dataset.value);
      UI.toast('Link copied', 'success');
    } catch (e) {
      UI.toast('Copy failed: select the link and copy it manually', 'error');
    }
  });

  // ── Forgot / reset password (public) ─────────
  Pages.forgotPassword = {
    render() {
      return authFrame(html`
        <form class="auth-card" data-form="forgot-password" data-testid="forgot-form" novalidate>
          <h1 class="auth-title">Reset your password</h1>
          <p class="auth-p">Enter the email address of your account. If it exists, we will email you a link to set a new password.</p>
          ${UI.field({ name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'username' })}
          ${UI.formError()}
          <div class="form-notice" data-role="sent" role="status" hidden>If an account exists for that email, a reset link is on its way. The link is valid for one hour.</div>
          <button class="btn btn-navy auth-submit" type="submit">Send reset link</button>
          <a class="auth-foot" href="#/login">Back to sign in</a>
        </form>`);
    },
  };

  Actions.onSubmit('forgot-password', async form => {
    const email = form.email.value.trim();
    const done = await UI.submit(form, () => {
      if (!email.includes('@')) throw new Error('Enter the email address of your account.');
      return Api.post('/auth/password-reset', { email });
    });
    if (!done) return;
    form.querySelector('[data-role="sent"]').hidden = false;
    form.querySelector('button[type="submit"]').hidden = true;
  });

  Pages.resetPassword = {
    render(ctx) {
      if (!ctx.query.token) {
        return authFrame(html`<div class="auth-card"><h1 class="auth-title">Reset link incomplete</h1>
          <p class="auth-p">Open the full link from your email, or request a new one.</p><a class="btn btn-o" href="#/forgot-password">Request a new link</a></div>`);
      }
      return authFrame(html`
        <form class="auth-card" data-form="reset-password" data-testid="reset-form" novalidate>
          <h1 class="auth-title">Choose a new password</h1>
          <input type="hidden" name="token" value="${ctx.query.token}">
          ${UI.field({ name: 'password', label: 'New password', type: 'password', required: true, autocomplete: 'new-password', minlength: 8 })}
          ${UI.field({ name: 'confirm', label: 'Confirm new password', type: 'password', required: true, autocomplete: 'new-password', minlength: 8 })}
          ${UI.formError()}
          <button class="btn btn-navy auth-submit" type="submit">Set new password</button>
        </form>`);
    },
  };

  Actions.onSubmit('reset-password', async form => {
    const password = form.password.value;
    const done = await UI.submit(form, () => {
      if (password.length < 8) throw new Error('Use at least 8 characters.');
      if (password !== form.confirm.value) throw new Error('The passwords do not match.');
      return Api.post('/auth/password-reset/complete', { token: form.token.value, password });
    });
    if (!done) return;
    Session.clear();
    Router.go('/login?notice=reset');
  });

  // ── Team & access ────────────────────────────
  Pages.team = {
    title: () => 'Team & access',
    async render(ctx) {
      const canManage = Session.can('org:admin:manage');
      const canInvite = Session.can('invitations:create');
      const [members, roles, invitations, directory] = await Promise.all([
        Api.get('/members'), Api.get('/members/roles'),
        canInvite ? Api.get('/invitations') : Promise.resolve([]),
        Api.get('/team').catch(() => []),
      ]);
      Store.members = members;
      const pending = invitations.filter(i => i.status === 'PENDING');
      const last = Store.takeFlash('invitation');
      const roleOptions = roles.map(r => ({ value: r.id, label: r.name }));

      return html`
        <div class="page">
          ${UI.pageHeader('Team & access', `${Session.organizationName()} — members, roles and invitations`)}
          ${UI.stats([
            { value: members.filter(m => m.status === 'ACTIVE').length, label: 'Active members' },
            { value: members.filter(m => m.status === 'ACTIVE' && m.roleId === 'org-admin').length, label: 'Administrators', color: 'var(--gold)' },
            { value: pending.length, label: 'Pending invitations', color: 'var(--amber)' },
            { value: members.filter(m => m.status !== 'ACTIVE').length, label: 'Deactivated', color: 'var(--dim)' },
          ])}
          <section class="card">
            <h2 class="section-h">Members</h2>
            ${UI.table([
              { label: 'Name', cell: m => html`<span class="cell-strong">${m.name}</span>${m.userId === Session.user.id ? html` <span class="cell-dim">(you)</span>` : ''}<div class="cell-dim">${m.email}</div>` },
              { label: 'Role', cell: m => (canManage && m.userId !== Session.user.id && m.status === 'ACTIVE' ? html`
                  <label><span class="sr-only">Role for ${m.name}</span>
                    <select class="input input-sm" data-change="member-role" data-user="${m.userId}" data-testid="role-${m.email}">
                      ${roleOptions.map(o => html`<option value="${o.value}" ${o.value === m.roleId ? raw('selected') : ''}>${o.label}</option>`)}
                    </select></label>` : m.roleName) },
              { label: 'Status', cell: m => UI.badge(UI.titleCase(m.status.toLowerCase()), MEMBER_STATUS[m.status] || 'navy') },
              { label: 'Joined', cell: m => UI.date(m.joinedAt), className: 'mono' },
              { label: '', cell: m => (canManage && m.userId !== Session.user.id ? html`
                  <button class="btn ${m.status === 'ACTIVE' ? 'btn-red' : 'btn-o'} btn-sm" data-action="member-status" data-user="${m.userId}"
                    data-status="${m.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}" data-testid="status-${m.email}">${m.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</button>` : '') },
            ], members, { rowAttrs: m => html`data-testid="member-row" data-email="${m.email}"` })}
            <p class="fine">Deactivating removes access to this organization immediately. The person's account and any other organizations they belong to are not affected.</p>
          </section>
          ${canInvite ? html`
            <section class="card">
              <h2 class="section-h">Invite someone</h2>
              ${last ? linkResult(`Invitation created for ${last.email}`, last.acceptPath, last.delivery, last.email) : ''}
              <form class="form-inline" data-form="invite" data-testid="invite-form" novalidate>
                <div class="form-grid">
                  ${UI.field({ name: 'email', label: 'Email', type: 'email', required: true })}
                  ${UI.select({ name: 'role', label: 'Role', options: roleOptions, value: 'developer' })}
                </div>
                ${UI.formError()}
                <div class="form-actions"><button class="btn btn-navy btn-sm" type="submit">Send invitation</button></div>
              </form>
              <h3 class="sub-h">Invitations (last 30 days)</h3>
              ${UI.table([
                { label: 'Email', cell: i => i.email },
                { label: 'Role', cell: i => i.roleName },
                { label: 'Status', cell: i => UI.badge(UI.titleCase(i.status.toLowerCase()), INVITE_STATUS[i.status] || 'navy') },
                { label: 'Expires', cell: i => UI.date(i.expiresAt), className: 'mono' },
                { label: '', cell: i => (i.status === 'PENDING' && Session.can('invitations:revoke') ? html`<button class="btn btn-o btn-sm" data-action="revoke-invitation" data-id="${i.id}">Revoke</button>` : '') },
              ], invitations, { empty: 'No recent invitations.', rowAttrs: i => html`data-testid="invitation-row" data-email="${i.email}"` })}
            </section>` : ''}
          ${directory.length ? html`
            <section class="card">
              <h2 class="section-h">Project directory</h2>
              <p class="fine">Stakeholder directory entries (not sign-in accounts).</p>
              ${UI.table([
                { label: 'Name', cell: d => d.name },
                { label: 'Role', cell: d => d.role || '—' },
                { label: 'Projects', cell: d => d.projects || '—', className: 'cell-dim' },
              ], directory)}
            </section>` : ''}
        </div>`;
    },
  };

  Actions.onChange('member-role', async el => {
    el.disabled = true;
    try {
      const m = await Api.patch(`/members/${encodeURIComponent(el.dataset.user)}`, { roleId: el.value });
      UI.toast(`${m.name} is now ${m.roleName}`, 'success');
    } finally {
      App.rerender();
    }
  });

  Actions.onClick('member-status', async el => {
    el.disabled = true;
    try {
      const m = await Api.patch(`/members/${encodeURIComponent(el.dataset.user)}`, { status: el.dataset.status });
      UI.toast(m.status === 'ACTIVE' ? `${m.name} reactivated` : `${m.name} deactivated`, 'success');
    } finally {
      App.rerender();
    }
  });

  Actions.onSubmit('invite', async form => {
    const email = form.email.value.trim();
    const role = form.role.value;
    const created = await UI.submit(form, () => {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
      return Api.post('/invitations', { email, role });
    });
    if (!created) return;
    Store.flash('invitation', created);
    App.rerender();
  });

  Actions.onClick('revoke-invitation', async el => {
    el.disabled = true;
    try {
      await Api.post(`/invitations/${encodeURIComponent(el.dataset.id)}/revoke`);
      UI.toast('Invitation revoked', 'success');
    } finally {
      App.rerender();
    }
  });

  // ── Audit trail ──────────────────────────────
  Pages.audit = {
    title: () => 'Audit trail',
    async render(ctx) {
      const [events] = await Promise.all([Api.get('/audit?limit=100'), Store.getMembers()]);
      const verification = Store.takeFlash('verification');
      return html`
        <div class="page">
          ${UI.pageHeader('Audit trail', 'Tamper-evident record of every change in this organization (most recent first)',
            html`<button class="btn btn-navy btn-sm" data-action="verify-audit" data-testid="verify-audit">Verify integrity</button>`)}
          ${verification ? html`
            <div class="callout ${verification.valid ? 'callout-green' : 'callout-red'}" data-testid="verify-result">
              ${verification.valid
                ? html`<strong>Verified.</strong> ${UI.number(verification.count)} events; every hash and link in the chain checks out${verification.checkpoints && verification.checkpoints.verified ? html`, with ${verification.checkpoints.verified} signed checkpoint(s)` : ''}.`
                : html`<strong>Integrity failure:</strong> ${verification.failure && verification.failure.reason} — ${verification.failure && verification.failure.detail}`}
            </div>` : ''}
          ${UI.table([
            { label: '#', cell: e => e.chain_seq || '—', className: 'mono' },
            { label: 'When', cell: e => UI.dateTime(e.occurred_at), className: 'mono' },
            { label: 'Action', cell: e => UI.badge(e.action, e.action === 'DELETE' ? 'red' : e.action === 'INSERT' ? 'green' : 'blue') },
            { label: 'Record', cell: e => html`${UI.titleCase(String(e.entity_type || '').replace(/^di_/, ''))}<div class="cell-dim mono">${e.entity_id}</div>` },
            { label: 'By', cell: e => (e.actor_user_id ? Store.memberName(e.actor_user_id) : 'system') },
          ], events, { empty: 'No audit events yet.', rowAttrs: () => html`data-testid="audit-row"` })}
        </div>`;
    },
  };

  Actions.onClick('verify-audit', async el => {
    el.disabled = true;
    try {
      Store.flash('verification', await Api.get('/audit/verify'));
    } finally {
      App.rerender();
    }
  });

  // ── Platform: organizations ──────────────────
  Pages.platform = {
    title: () => 'Organizations',
    async render() {
      const [stats, orgs] = await Promise.all([Api.get('/admin/stats'), Api.get('/admin/orgs')]);
      const last = Store.takeFlash('provisioned');
      return html`
        <div class="page">
          ${UI.pageHeader('Organizations', 'Platform administration — tenants on this deployment')}
          ${UI.stats([
            { value: UI.number(stats.organizations), label: 'Organizations' },
            { value: UI.number(stats.totalUsers), label: 'Active accounts', color: 'var(--teal)' },
            { value: UI.number(stats.projects), label: 'Projects', color: 'var(--gold)' },
            { value: UI.number(stats.totalUnits), label: 'Units', color: 'var(--green)' },
          ])}
          ${Session.can('platform:orgs:manage') ? html`
            <section class="card">
              <h2 class="section-h">Create an organization</h2>
              ${last ? linkResult(`${last.organization.name} created — first administrator invited`, last.invitation.acceptPath, last.invitation.delivery, last.invitation.email) : ''}
              <form class="form-inline" data-form="provision-org" data-testid="provision-form" novalidate>
                <div class="form-grid">
                  ${UI.field({ name: 'name', label: 'Organization name', required: true })}
                  ${UI.field({ name: 'type', label: 'Type (optional)', placeholder: 'e.g. developer' })}
                  ${UI.field({ name: 'adminEmail', label: 'First administrator email', type: 'email', required: true })}
                </div>
                ${UI.formError()}
                <div class="form-actions"><button class="btn btn-navy btn-sm" type="submit">Create and invite</button></div>
              </form>
            </section>` : ''}
          ${UI.table([
            { label: 'Organization', cell: o => html`<span class="cell-strong">${o.name}</span><div class="cell-dim mono">${o.id}</div>` },
            { label: 'Type', cell: o => o.type || '—' },
            { label: 'Members', cell: o => UI.number(o.users), className: 'num' },
            { label: 'Pending invites', cell: o => UI.number(o.pendingInvitations), className: 'num' },
            { label: 'Projects', cell: o => UI.number(o.projects), className: 'num' },
            { label: 'Created', cell: o => UI.date(o.createdAt), className: 'mono' },
          ], Array.isArray(orgs) ? orgs : [], { empty: 'No organizations.', rowAttrs: o => html`data-testid="org-row" data-name="${o.name}"` })}
        </div>`;
    },
  };

  Actions.onSubmit('provision-org', async form => {
    const body = { name: form.name.value.trim(), adminEmail: form.adminEmail.value.trim() };
    if (form.type.value.trim()) body.type = form.type.value.trim();
    const created = await UI.submit(form, () => {
      if (body.name.length < 2) throw new Error('Enter the organization name.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.adminEmail)) throw new Error('Enter a valid administrator email.');
      return Api.post('/admin/orgs', body);
    });
    if (!created) return;
    Store.flash('provisioned', created);
    App.rerender();
  });
})(window);
