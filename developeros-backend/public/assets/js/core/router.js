// ═══════════════════════════════════════════════
// core/router.js — hash routing
//
// Routes are addressable (#/projects/p1/tasks), so reload, back/forward and
// shared links work. A route is { pattern, page, public?, project? }.
// ═══════════════════════════════════════════════

(function (global) {
  const routes = [];

  function compile(pattern) {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    return { regex, keys };
  }

  function current() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [path, queryString = ''] = hash.split('?');
    const query = Object.fromEntries(new URLSearchParams(queryString));
    return { path, query };
  }

  function match(path) {
    for (const route of routes) {
      const m = route.compiled.regex.exec(path);
      if (m) {
        const params = {};
        route.compiled.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route, params };
      }
    }
    return null;
  }

  global.Router = {
    add(pattern, options) {
      routes.push({ pattern, compiled: compile(pattern), ...options });
    },
    current,
    match,
    go(path) {
      if (location.hash === `#${path}`) global.dispatchEvent(new HashChangeEvent('hashchange'));
      else location.hash = path;
    },
    replace(path) {
      history.replaceState(null, '', `#${path}`);
      global.dispatchEvent(new HashChangeEvent('hashchange'));
    },
  };
})(window);
