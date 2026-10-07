// ═══════════════════════════════════════════════
// api.js — Frontend → Backend connector
//
// DROP THIS FILE into developeros/assets/js/
// ADD <script src="assets/js/api.js"></script>
// BEFORE app.js in index.html
//
// Handles JWT authentication, token persistence,
// and all CRUD endpoints to the DeveloperOS API.
// ═══════════════════════════════════════════════

const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || 'http://localhost:3000/api';

// ── AUTH TOKEN STORAGE ─────────────────────────
let authToken = null;
if (typeof localStorage !== 'undefined') {
  authToken = localStorage.getItem('developeros_token');
}

function setAuthToken(token) {
  authToken = token;
  if (typeof localStorage !== 'undefined') {
    if (token) {
      localStorage.setItem('developeros_token', token);
    } else {
      localStorage.removeItem('developeros_token');
    }
  }
}

function getAuthToken() {
  if (!authToken && typeof localStorage !== 'undefined') {
    authToken = localStorage.getItem('developeros_token');
  }
  return authToken;
}

// ── CORE FETCH WRAPPER ─────────────────────────
async function apiFetch(path, options = {}) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const token = getAuthToken();
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error(`API error [${path}]:`, err.message);
    throw err;
  }
}

// ── API CLIENT ─────────────────────────────────
const API = {

  auth: {
    login: async (email, password) => {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (data && data.token) {
        setAuthToken(data.token);
      }
      return data;
    },
    register: async (userData) => {
      const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify(userData),
      });
      if (data && data.token) {
        setAuthToken(data.token);
      }
      return data;
    },
    me: () => apiFetch('/auth/me'),
    logout: () => {
      setAuthToken(null);
    },
    getToken: getAuthToken,
    setToken: setAuthToken,
  },

  projects: {
    getAll:    ()         => apiFetch('/projects'),
    getOne:    (id)       => apiFetch(`/projects/${id}`),
    create:    (data)     => apiFetch('/projects', { method: 'POST', body: JSON.stringify(data) }),
    update:    (id, data) => apiFetch(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete:    (id)       => apiFetch(`/projects/${id}`, { method: 'DELETE' }),
  },

  tasks: {
    getAll:    (projectId)  => apiFetch(`/tasks${projectId ? '?projectId=' + projectId : ''}`),
    getOne:    (id)         => apiFetch(`/tasks/${id}`),
    create:    (data)       => apiFetch('/tasks', { method: 'POST', body: JSON.stringify(data) }),
    update:    (id, data)   => apiFetch(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    setStatus: (id, status) => apiFetch(`/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    delete:    (id)         => apiFetch(`/tasks/${id}`, { method: 'DELETE' }),
  },

  contracts: {
    getAll:    (projectId) => apiFetch(`/contracts${projectId ? '?projectId=' + projectId : ''}`),
    getOne:    (id)        => apiFetch(`/contracts/${id}`),
    create:    (data)      => apiFetch('/contracts', { method: 'POST', body: JSON.stringify(data) }),
    update:    (id, data)  => apiFetch(`/contracts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    execute:   (id)        => apiFetch(`/contracts/${id}/execute`, { method: 'POST' }),
  },

  permits: {
    getAll:           (projectId)        => apiFetch(`/permits${projectId ? '?projectId=' + projectId : ''}`),
    getOne:           (id)               => apiFetch(`/permits/${id}`),
    create:           (data)             => apiFetch('/permits', { method: 'POST', body: JSON.stringify(data) }),
    update:           (id, data)         => apiFetch(`/permits/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    setStatus:        (id, status)       => apiFetch(`/permits/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    updateCorrection: (permitId, corrId, data) => apiFetch(`/permits/${permitId}/corrections/${corrId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },

  capital: {
    getForProject: (projectId)       => apiFetch(`/capital/${projectId}`),
    update:        (projectId, data) => apiFetch(`/capital/${projectId}`, { method: 'PUT', body: JSON.stringify(data) }),
  },

  messages: {
    getChannels:   (projectId)        => apiFetch(`/messages/channels${projectId ? '?projectId=' + projectId : ''}`),
    getMessages:   (channelId)        => apiFetch(`/messages/channels/${channelId}/messages`),
    sendMessage:   (channelId, data)  => apiFetch(`/messages/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify(data) }),
    createChannel: (data)             => apiFetch('/messages/channels', { method: 'POST', body: JSON.stringify(data) }),
  },

  documents: {
    getAll: (projectId) => apiFetch(`/documents${projectId ? '?projectId=' + projectId : ''}`),
    create: (data)      => apiFetch('/documents', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id)        => apiFetch(`/documents/${id}`, { method: 'DELETE' }),
  },

  alerts: {
    getAll: (projectId) => apiFetch(`/alerts${projectId ? '?projectId=' + projectId : ''}`),
  },

  team: {
    getAll: ()         => apiFetch('/team'),
    invite: (data)     => apiFetch('/team', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiFetch(`/team/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id)       => apiFetch(`/team/${id}`, { method: 'DELETE' }),
  },

  admin: {
    stats:  () => apiFetch('/admin/stats'),
    orgs:   () => apiFetch('/admin/orgs'),
    health: () => apiFetch('/admin/health'),
  },
};

// ── LOAD ALL DATA FROM BACKEND ─────────────────
// Call this instead of using static mockData.js
async function loadAllDataFromAPI() {
  try {
    // If not authenticated yet, auto-login with demo credentials
    if (!getAuthToken()) {
      try {
        await API.auth.login('maria@kgdevelopment.com', 'password123');
      } catch (authErr) {
        console.warn('Auto-login notice:', authErr.message);
      }
    }

    const projectId = (typeof state !== 'undefined' && state.currentProjectId) || 'p1';
    const [projects, tasks, contracts, permits, capital, channels, documents, alerts, team] = await Promise.all([
      API.projects.getAll(),
      API.tasks.getAll(projectId),
      API.contracts.getAll(projectId),
      API.permits.getAll(projectId),
      API.capital.getForProject(projectId),
      API.messages.getChannels(projectId),
      API.documents.getAll(projectId),
      API.alerts.getAll(projectId),
      API.team.getAll(),
    ]);

    if (typeof state !== 'undefined') {
      state.projects      = projects;
      state.tasks         = tasks;
      state.contracts     = contracts;
      state.permits       = permits;
      if (capital) state.capitalStacks = [capital];
      state.channels      = channels;
      state.documents     = documents;
      state.alerts        = alerts;
      state.teamMembers   = team;
    }

    console.log('✓ All data successfully loaded from live DeveloperOS API');
    return true;
  } catch (err) {
    console.warn('Live API unavailable — falling back to mock data:', err.message);
    return false;
  }
}

// ── LIVE ACTION HELPERS ────────────────────────
// These replace the alert() placeholders in the SPA

async function executeContractLive(contractId) {
  const updated = await API.contracts.execute(contractId);
  const projectId = (typeof state !== 'undefined' && state.currentProjectId) || 'p1';
  if (typeof state !== 'undefined') {
    state.contracts = await API.contracts.getAll(projectId);
    state.tasks     = await API.tasks.getAll(projectId);
    state.alerts    = await API.alerts.getAll(projectId);
    if (typeof renderSidebar === 'function') renderSidebar();
    if (typeof navigate === 'function') navigate(state.currentPage);
  }
  return updated;
}

async function updateTaskStatusLive(taskId, newStatus) {
  await API.tasks.setStatus(taskId, newStatus);
  const projectId = (typeof state !== 'undefined' && state.currentProjectId) || 'p1';
  if (typeof state !== 'undefined') {
    state.tasks  = await API.tasks.getAll(projectId);
    state.alerts = await API.alerts.getAll(projectId);
    if (typeof renderSidebar === 'function') renderSidebar();
  }
}

async function sendMessageLive(channelId, text) {
  const msg = await API.messages.sendMessage(channelId, {
    senderName:     (typeof state !== 'undefined' && state.currentUser?.name) || 'User',
    senderInitials: (typeof state !== 'undefined' && state.currentUser?.initials) || 'U',
    senderColor:    '#1A2332',
    role:           (typeof state !== 'undefined' && state.currentUser?.role) || 'developer',
    text,
  });
  if (typeof state !== 'undefined') {
    if (!state.messages) state.messages = {};
    if (!state.messages[channelId]) state.messages[channelId] = [];
    state.messages[channelId].push(msg);
  }
  return msg;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { API, apiFetch, setAuthToken, getAuthToken, loadAllDataFromAPI };
}
