// ═══════════════════════════════════════════════
// pages/auth.js — sign in and invitation acceptance
// ═══════════════════════════════════════════════

(function (global) {
  const Pages = (global.Pages = global.Pages || {});

  function frame(content) {
    return html`
      <div class="auth-layout">
        <aside class="auth-brand">
          <div class="l-logo"><span class="ldot"></span>DeveloperOS</div>
          <div class="auth-brand-h">The operating system for real estate development.</div>
          <div class="auth-brand-p">Opportunities, site intelligence, execution and portfolio — one governed record for every project.</div>
        </aside>
        <main class="auth-main">${content}</main>
      </div>`;
  }

  function formError(form, message) {
    const box = form.querySelector('[data-role="form-error"]');
    if (box) {
      box.textContent = message || '';
      box.hidden = !message;
    }
  }

  function setBusy(form, busy, label) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = busy;
    if (label) button.textContent = label;
  }

  Pages.login = {
    render(ctx) {
      const notice = ctx.query.notice === 'invited'
        ? html`<div class="form-notice" role="status">Invitation accepted. Sign in to continue.</div>` : '';
      return frame(html`
        <form class="auth-card" data-form="login" data-testid="login-form" novalidate>
          <h1 class="auth-title">Sign in</h1>
          ${notice}
          ${UI.field({ name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'username', value: ctx.query.email || '' })}
          ${UI.field({ name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'current-password' })}
          <div class="form-error" data-role="form-error" role="alert" hidden></div>
          <button class="btn btn-navy auth-submit" type="submit">Sign in</button>
          <div class="auth-foot">Access is by invitation from your organization's administrator.</div>
        </form>`);
    },
    after() {
      const input = document.querySelector('[data-form="login"] input[name="email"]');
      if (input && !input.value) input.focus();
    },
  };

  Actions.onSubmit('login', async form => {
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) return formError(form, 'Enter your email and password.');
    formError(form, '');
    setBusy(form, true, 'Signing in…');
    try {
      await Session.login(email, password);
      Store.reset();
      App.afterSignIn();
    } catch (err) {
      formError(form, err.status === 401 ? 'Incorrect email or password.' : err.message);
      setBusy(form, false, 'Sign in');
    }
  });

  Pages.acceptInvite = {
    render(ctx) {
      if (!ctx.query.token) {
        return frame(html`
          <div class="auth-card">
            <h1 class="auth-title">Invitation link incomplete</h1>
            <p class="auth-p">This link is missing its invitation code. Open the full link from your invitation, or ask your administrator to send a new one.</p>
            <a class="btn btn-o" href="#/login">Go to sign in</a>
          </div>`);
      }
      return frame(html`
        <form class="auth-card" data-form="accept-invite" data-testid="accept-form" novalidate>
          <h1 class="auth-title">Accept invitation</h1>
          <p class="auth-p">Choose a password for your DeveloperOS account. If you already have an account, enter any password of at least 8 characters — your existing password is kept, and you will sign in with it.</p>
          <input type="hidden" name="token" value="${ctx.query.token}">
          ${UI.field({ name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'new-password', minlength: 8 })}
          ${UI.field({ name: 'confirm', label: 'Confirm password', type: 'password', required: true, autocomplete: 'new-password', minlength: 8 })}
          <div class="form-error" data-role="form-error" role="alert" hidden></div>
          <button class="btn btn-navy auth-submit" type="submit">Accept invitation</button>
        </form>`);
    },
  };

  Actions.onSubmit('accept-invite', async form => {
    const password = form.password.value;
    if (password.length < 8) return formError(form, 'Use at least 8 characters.');
    if (password !== form.confirm.value) return formError(form, 'The passwords do not match.');
    formError(form, '');
    setBusy(form, true, 'Accepting…');
    try {
      await Api.post('/invitations/accept', { token: form.token.value, password });
      Session.clear();
      Router.go('/login?notice=invited');
    } catch (err) {
      formError(form, err.message);
      setBusy(form, false, 'Accept invitation');
    }
  });
})(window);
