// ═══════════════════════════════════════════════
// app.js — bootstrap and route rendering
// ═══════════════════════════════════════════════

(function (global) {
  const Pages = global.Pages;
  let renderSeq = 0;
  let restored = false;
  let intendedPath = null;

  // Public routes
  Router.add('/login', { name: 'login', page: Pages.login, public: true });
  Router.add('/accept-invite', { name: 'accept-invite', page: Pages.acceptInvite, public: true });
  Router.add('/forgot-password', { name: 'forgot-password', page: Pages.forgotPassword, public: true });
  Router.add('/reset-password', { name: 'reset-password', page: Pages.resetPassword, public: true });
  // Signed-in routes
  Router.add('/portfolio', { name: 'portfolio', page: Pages.portfolio });
  Router.add('/alerts', { name: 'alerts', page: Pages.alerts });
  Router.add('/team', { name: 'team', page: Pages.team });
  Router.add('/platform', { name: 'platform', page: Pages.platform });
  Router.add('/audit', { name: 'audit', page: Pages.audit });
  // Development Intelligence (fixed paths before parameterised ones)
  Router.add('/intelligence/opportunities', { name: 'opportunities', page: Pages.opportunities, area: 'opportunities' });
  Router.add('/intelligence/opportunities/new', { name: 'opportunity-new', page: Pages.opportunityNew, area: 'opportunities' });
  Router.add('/intelligence/opportunities/:id', { name: 'opportunity', page: Pages.opportunity, area: 'opportunities' });
  Router.add('/intelligence/properties', { name: 'properties', page: Pages.properties, area: 'properties' });
  Router.add('/intelligence/properties/new', { name: 'property-new', page: Pages.propertyNew, area: 'properties' });
  Router.add('/intelligence/properties/:id', { name: 'property', page: Pages.property, area: 'properties' });
  Router.add('/intelligence/relationships', { name: 'relationships', page: Pages.relationships, area: 'relationships' });
  Router.add('/intelligence/findings', { name: 'findings', page: Pages.findings, area: 'findings' });
  Router.add('/projects/:projectId', { name: 'project', page: Pages.project, project: true, section: '' });
  for (const section of ['tasks', 'permits', 'contracts', 'capital', 'messages', 'documents']) {
    Router.add(`/projects/:projectId/${section}`, { name: section, page: Pages[section], project: true, section });
  }

  function showShell(signedIn) {
    document.getElementById('auth-root').hidden = signedIn;
    document.getElementById('app-shell').hidden = !signedIn;
  }

  async function render() {
    const seq = ++renderSeq;
    const { path, query } = Router.current();
    const routeKey = location.hash.replace(/^#/, '') || '/';

    // Restore a stored session once per page load before routing.
    if (!restored) {
      restored = true;
      if (Api.hasToken()) {
        try { await Session.load(); } catch (err) { Session.clear(); }
      }
    }

    const matched = Router.match(path);
    if (!matched) return Router.replace(Session.signedIn ? '/portfolio' : '/login');
    const { route, params } = matched;

    if (!route.public && !Session.signedIn) {
      intendedPath = path;
      return Router.replace('/login');
    }
    if (route.name === 'login' && Session.signedIn) return Router.replace('/portfolio');

    const ctx = { route, params, query, project: null };

    if (route.public) {
      showShell(false);
      const root = document.getElementById('auth-root');
      mount(root, await route.page.render(ctx));
      if (route.page.after) route.page.after(ctx);
      return;
    }

    showShell(true);
    const main = document.getElementById('app');
    // data-ready names the route (path and query) whose content or error is shown.
    main.dataset.ready = '';
    main.setAttribute('aria-busy', 'true');
    mount(main, UI.loading());
    try {
      if (route.project) {
        ctx.project = await Store.getProject(params.projectId);
        Store.currentProjectId = ctx.project.id;
      }
      await Shell.render(ctx);
      const view = await route.page.render(ctx);
      if (seq !== renderSeq) return; // a newer navigation won
      mount(main, view);
      main.dataset.ready = routeKey;
      main.removeAttribute('aria-busy');
      document.title = `${route.page.title ? route.page.title(ctx) + ' · ' : ''}DeveloperOS`;
      main.scrollTop = 0;
      if (route.page.after) route.page.after(ctx);
    } catch (err) {
      if (seq !== renderSeq) return;
      if (!Session.signedIn) return; // session ended mid-render; the 401 handler routes to login
      await Shell.render(ctx).catch(() => {});
      mount(main, UI.error(err));
      main.dataset.ready = routeKey;
      main.removeAttribute('aria-busy');
    }
  }

  // After sign-in, return to the page the user originally asked for.
  global.App = {
    afterSignIn() {
      const target = intendedPath && intendedPath !== '/login' ? intendedPath : '/portfolio';
      intendedPath = null;
      Router.go(target);
    },
    rerender: render,
  };

  Api.onUnauthorized(() => {
    if (!Session.signedIn) return;
    Session.clear();
    Store.reset();
    intendedPath = Router.current().path;
    UI.toast('Your session has ended. Please sign in again.', 'error');
    Router.replace('/login');
  });

  Actions.onClick('retry', () => render());

  window.addEventListener('hashchange', render);
  document.addEventListener('DOMContentLoaded', render);
})(window);
