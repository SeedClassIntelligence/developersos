// ═══════════════════════════════════════════════
// shell.js — top bar and sidebar for signed-in routes
// ═══════════════════════════════════════════════

(function (global) {
  const PROJECT_SECTIONS = [
    { section: '', label: 'Overview', icon: '◇' },
    { section: 'tasks', label: 'SOW Tasks', icon: '📋' },
    { section: 'permits', label: 'Permits', icon: '🏛️' },
    { section: 'contracts', label: 'Contracts', icon: '📝' },
    { section: 'capital', label: 'Capital Stack', icon: '💰' },
    { section: 'messages', label: 'Messages', icon: '💬' },
    { section: 'documents', label: 'Documents', icon: '📁' },
  ];

  function projectPath(projectId, section) {
    return `/projects/${encodeURIComponent(projectId)}${section ? `/${section}` : ''}`;
  }

  function link(href, label, icon, active, testId) {
    return html`<a class="sb-link ${active ? 'on' : ''}" href="#${href}" data-testid="${testId}"><span class="si">${icon}</span><span class="sc">${label}</span></a>`;
  }

  function topbar(projects, ctx) {
    const orgs = Session.memberships;
    return html`
      <a class="app-logo" href="#/portfolio"><span class="ldot"></span>DeveloperOS</a>
      ${projects.length ? html`
        <label class="app-proj-sel">
          <span class="sr-only">Project</span>
          <select data-change="select-project" data-testid="project-select">
            <option value="" ${ctx.project ? '' : raw('selected')}>All projects</option>
            ${projects.map(p => html`<option value="${p.id}" ${ctx.project && ctx.project.id === p.id ? raw('selected') : ''}>${p.name}</option>`)}
          </select>
        </label>` : ''}
      <div class="topbar-right">
        ${orgs.length > 1 ? html`
          <label class="org-sel">
            <span class="sr-only">Organization</span>
            <select data-change="switch-organization" data-testid="org-select">
              ${orgs.map(o => html`<option value="${o.organizationId}" ${o.organizationId === Session.membership.organizationId ? raw('selected') : ''}>${o.organizationName}</option>`)}
            </select>
          </label>` : html`<span class="org-name" data-testid="org-name">${Session.organizationName()}</span>`}
        <div class="tb-user" title="${Session.user.email}">
          <div class="tb-avatar">${Session.initials()}</div>
          <div class="tb-user-text">
            <span class="tb-user-name" data-testid="user-name">${Session.user.name}</span>
            <span class="tb-user-role">${Session.membership.roleName}</span>
          </div>
        </div>
        <button class="btn btn-o btn-sm" data-action="sign-out" data-testid="sign-out">Sign out</button>
      </div>`;
  }

  function sidebar(ctx) {
    const page = ctx.route.name;
    const project = ctx.project;
    return html`
      <nav aria-label="Main">
        <div class="sb-section">Platform</div>
        ${link('/portfolio', 'Portfolio', '⬡', page === 'portfolio', 'nav-portfolio')}
        ${link('/alerts', 'Risk Alerts', '⚠️', page === 'alerts', 'nav-alerts')}
        ${Session.can('opportunities:read') ? html`
          <div class="sb-section">Development Intelligence</div>
          ${link('/intelligence/opportunities', 'Pipeline', '◎', ctx.route.area === 'opportunities', 'nav-pipeline')}
          ${Session.can('properties:read') ? link('/intelligence/properties', 'Properties', '▦', ctx.route.area === 'properties', 'nav-properties') : ''}
          ${Session.can('relationships:read') ? link('/intelligence/relationships', 'Relationships', '⇄', ctx.route.area === 'relationships', 'nav-relationships') : ''}
          ${Session.can('findings:read') ? link('/intelligence/findings', 'Findings', '◆', ctx.route.area === 'findings', 'nav-findings') : ''}` : ''}
        ${project ? html`
          <div class="sb-section sb-project" title="${project.name}">${project.name}</div>
          ${PROJECT_SECTIONS.map(s => link(projectPath(project.id, s.section), s.label, s.icon, (ctx.route.section || '') === s.section, `nav-${s.section || 'overview'}`))}` : ''}
        ${Session.can('team:read') ? html`
          <div class="sb-section">Organization</div>
          ${link('/team', 'Team', '👥', page === 'team', 'nav-team')}` : ''}
        ${Session.can('platform:admin:stats') ? html`
          <div class="sb-section">Platform administration</div>
          ${link('/platform', 'Organizations', '⚡', page === 'platform', 'nav-platform')}` : ''}
      </nav>`;
  }

  global.Shell = {
    projectPath,
    async render(ctx) {
      const projects = await Store.getProjects().catch(() => []);
      mount(document.getElementById('topbar'), topbar(projects, ctx));
      mount(document.getElementById('sidebar'), sidebar(ctx));
    },
  };

  Actions.onChange('select-project', el => {
    const { route } = Router.match(Router.current().path) || {};
    if (!el.value) return Router.go('/portfolio');
    Store.currentProjectId = el.value;
    Router.go(projectPath(el.value, route && route.project ? route.section : ''));
  });

  Actions.onChange('switch-organization', async el => {
    const target = el.value;
    el.disabled = true;
    try {
      await Session.switchOrganization(target);
      Store.reset();
      Router.go('/portfolio');
      UI.toast(`Switched to ${Session.organizationName()}`, 'success');
    } finally {
      el.disabled = false;
    }
  });

  Actions.onClick('sign-out', () => {
    Session.clear();
    Store.reset();
    Router.go('/login');
  });
})(window);
