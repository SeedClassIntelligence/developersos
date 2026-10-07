// ═══════════════════════════════════════════════
// ROUTER.JS — SPA Navigation
// navigate(page) renders the correct page
// into #app without reloading.
// ═══════════════════════════════════════════════

const routes = {
  portfolio:   renderPortfolio,
  project:     renderProject,
  tasks:       renderTasks,
  contracts:   renderContracts,
  permits:     renderPermits,
  messages:    renderMessages,
  capital:     renderCapital,
  documents:   renderDocuments,
  'ai-alerts': renderAiAlerts,
  admin:       renderAdmin,
  'super-admin': renderSuperAdmin,
};

function navigate(page, projectId) {
  // Update state
  state.currentPage = page;
  if (projectId) setCurrentProject(projectId);

  // Update sidebar active state
  document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('on'));
  const activeLink = document.querySelector(`.sb-link[data-page="${page}"]`);
  if (activeLink) activeLink.classList.add('on');

  // Clear and render
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';

  // Scroll to top
  app.scrollTop = 0;

  // Call the render function
  const renderFn = routes[page];
  if (renderFn) {
    renderFn();
  } else {
    app.innerHTML = `<div style="padding:32px"><p>Page not found: ${page}</p></div>`;
  }
}

// Navigate from landing to app
async function enterApp() {
  state.isAuthenticated = true;
  document.getElementById('landing-page').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
  document.getElementById('app-shell').style.flexDirection = 'column';

  // Render shell components
  renderTopbar();
  renderSidebar();

  // Try API first, fall back to mock data
  if (typeof loadAllDataFromAPI === 'function') {
    await loadAllDataFromAPI();
  }

  // Start at portfolio
  navigate('portfolio');
}

// Go back to landing
function exitApp() {
  state.isAuthenticated = false;
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('landing-page').style.display = 'block';
  renderLanding();
}
