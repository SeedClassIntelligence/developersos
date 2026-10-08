// ═══════════════════════════════════════════════
// core/store.js — per-organization reference data
//
// Small, frequently reused lists (projects, partners) are cached for the
// active organization only and dropped on any organization switch or sign-out.
// Page data is always fetched fresh.
// ═══════════════════════════════════════════════

(function (global) {
  const Store = {
    projects: null,
    partners: null,
    members: null,
    currentProjectId: null,
    flashes: {},

    // One-shot values shown on the next render only (e.g. a just-created invitation link).
    flash(key, value) { this.flashes[key] = value; },
    takeFlash(key) { const v = this.flashes[key]; delete this.flashes[key]; return v || null; },

    reset() {
      this.projects = null;
      this.partners = null;
      this.members = null;
      this.currentProjectId = null;
      this.flashes = {};
    },

    // Member directory of the active organization (empty without team:read).
    async getMembers() {
      if (!this.members) this.members = Session.can('team:read') ? await Api.get('/members') : [];
      return this.members;
    },

    // Display name for a user id recorded on a record (provenance, history).
    memberName(id) {
      if (!id) return 'unknown';
      if (Session.user && id === Session.user.id) return 'you';
      const m = (this.members || []).find(x => x.userId === id);
      return m ? m.name : (this.members && this.members.length ? 'someone outside this organization' : 'a team member');
    },

    async getProjects() {
      if (!this.projects) this.projects = await Api.get('/projects');
      return this.projects;
    },

    async getPartners() {
      if (!this.partners) this.partners = await Api.get('/partners');
      return this.partners;
    },

    async getProject(id) {
      const projects = await this.getProjects();
      const project = projects.find(p => p.id === id);
      if (!project) throw new ApiError(404, 'Project not found');
      return project;
    },

    partnerName(partners, id) {
      if (!id) return 'Unassigned';
      const p = partners.find(x => x.id === id);
      return p ? p.name : 'Unknown partner';
    },
  };

  global.Store = Store;
})(window);
