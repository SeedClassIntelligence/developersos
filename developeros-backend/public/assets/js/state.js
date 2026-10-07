// ═══════════════════════════════════════════════
// STATE.JS — Global Application State
// Single source of truth. All data lives here.
// Backend APIs will replace mockData later.
// ═══════════════════════════════════════════════

const state = {
  // ── AUTH ───────────────────────────────────
  currentUser: null,
  isAuthenticated: false,

  // ── NAVIGATION ─────────────────────────────
  currentPage: 'portfolio',
  currentProjectId: null,

  // ── PROJECTS ───────────────────────────────
  projects: [],

  // ── TASKS ──────────────────────────────────
  tasks: [],

  // ── CONTRACTS ──────────────────────────────
  contracts: [],

  // ── PERMITS ────────────────────────────────
  permits: [],

  // ── CAPITAL ────────────────────────────────
  capitalStacks: [],

  // ── MESSAGES ───────────────────────────────
  channels: [],
  messages: {},        // keyed by channelId

  // ── DOCUMENTS ──────────────────────────────
  documents: [],

  // ── AI ALERTS ──────────────────────────────
  alerts: [],

  // ── TEAM ───────────────────────────────────
  teamMembers: [],
  organizations: [],

  // ── UI ─────────────────────────────────────
  activeChannel: null,
  taskModalOpen: false,
  activeTaskId: null,
};

// ── STATE HELPERS ──────────────────────────────

// Get current project object
function currentProject() {
  return state.projects.find(p => p.id === state.currentProjectId) || state.projects[0] || null;
}

// Get tasks for current project
function currentProjectTasks() {
  const proj = currentProject();
  if (!proj) return [];
  return state.tasks.filter(t => t.projectId === proj.id);
}

// Get tasks by status
function tasksByStatus(status) {
  return currentProjectTasks().filter(t => t.status === status);
}

// Get contract for a partner
function contractForPartner(partnerId) {
  const proj = currentProject();
  if (!proj) return null;
  return state.contracts.find(c => c.partnerId === partnerId && c.projectId === proj.id) || null;
}

// Get alerts for current project
function projectAlerts() {
  const proj = currentProject();
  if (!proj) return state.alerts;
  return state.alerts.filter(a => a.projectId === proj.id || !a.projectId);
}

// Get critical alert count
function criticalAlertCount() {
  return state.alerts.filter(a => a.severity === 'critical').length;
}

// Get total unread messages
function unreadMessageCount() {
  return state.channels.reduce((sum, ch) => sum + (ch.unread || 0), 0);
}

// Set current project
function setCurrentProject(projectId) {
  state.currentProjectId = projectId;
}

// Update task status
function updateTaskStatus(taskId, newStatus) {
  const task = state.tasks.find(t => t.id === taskId);
  if (task) {
    task.status = newStatus;
    // Re-render tasks board if on tasks page
    if (state.currentPage === 'tasks') renderTasks();
  }
}
