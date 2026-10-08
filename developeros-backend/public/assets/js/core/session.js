// ═══════════════════════════════════════════════
// core/session.js — signed-in user and organization context
//
// Authority (role, permissions) always comes from the server for the active
// organization. The UI uses it only to decide what to show; the API enforces it.
// ═══════════════════════════════════════════════

(function (global) {
  const Session = {
    user: null,
    membership: null,   // active organization: { organizationId, roleId, roleName, permissions }
    memberships: [],    // [{ organizationId, organizationName, roleId, roleName }]

    get signedIn() { return !!(this.user && this.membership); },

    async login(email, password) {
      Api.setToken(null);
      const result = await Api.post('/auth/login', { email, password });
      Api.setToken(result.token);
      await this.load();
    },

    // Restores the session from a stored token (page reload) or after login.
    async load() {
      const [user, memberships] = await Promise.all([Api.get('/auth/me'), Api.get('/auth/memberships')]);
      this.user = user;
      this.memberships = memberships || [];
      if (!this.memberships.length) {
        this.clear();
        throw new ApiError(403, 'Your account has no active organization membership. Ask an administrator for an invitation.');
      }
      try {
        this.membership = await Api.get('/auth/context');
      } catch (err) {
        // The token's organization is no longer valid for this user: fall back to their first membership.
        if (err.status !== 403) throw err;
        await this.switchOrganization(this.memberships[0].organizationId);
      }
    },

    async switchOrganization(organizationId) {
      const result = await Api.post('/auth/switch-context', { organizationId });
      Api.setToken(result.token);
      const { token, ...membership } = result;
      this.membership = membership;
    },

    clear() {
      Api.setToken(null);
      this.user = null;
      this.membership = null;
      this.memberships = [];
    },

    can(permission) {
      return !!(this.membership && this.membership.permissions && this.membership.permissions.includes(permission));
    },

    organizationName() {
      const m = this.memberships.find(x => x.organizationId === (this.membership && this.membership.organizationId));
      return m ? m.organizationName : '';
    },

    initials() {
      const name = (this.user && this.user.name) || '';
      const parts = name.trim().split(/\s+/).filter(Boolean);
      return (parts.length ? parts.slice(0, 2).map(p => p[0]).join('') : '?').toUpperCase();
    },
  };

  global.Session = Session;
})(window);
