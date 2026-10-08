// ═══════════════════════════════════════════════
// core/api.js — same-origin API client
//
// The UI is served by the API, so every call goes to /api on the same
// origin (no configurable base URL, no CORS). Failures surface as ApiError;
// nothing falls back to placeholder data.
// ═══════════════════════════════════════════════

(function (global) {
  const TOKEN_KEY = 'devos.session';

  class ApiError extends Error {
    constructor(status, message, body) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }

  function readToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }

  let token = readToken();
  let unauthorizedHandler = () => {};

  function setToken(value) {
    token = value || null;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* storage unavailable: session lasts for this page only */ }
  }

  async function request(method, path, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      });
    } catch (e) {
      throw new ApiError(0, 'Cannot reach the DeveloperOS server. Check your connection and try again.');
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = null; }
    }
    if (!res.ok) {
      const message = (data && data.error) || `Request failed (HTTP ${res.status})`;
      // A 401 while holding a token means the session ended (expired or revoked).
      if (res.status === 401 && token) unauthorizedHandler(message);
      throw new ApiError(res.status, message, data);
    }
    return data;
  }

  global.ApiError = ApiError;
  global.Api = {
    get: path => request('GET', path),
    post: (path, body) => request('POST', path, body === undefined ? {} : body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: path => request('DELETE', path),
    setToken,
    hasToken: () => !!token,
    onUnauthorized(fn) { unauthorizedHandler = fn; },
  };
})(window);
