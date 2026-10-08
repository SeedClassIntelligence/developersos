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
    currentProjectId: null,

    reset() {
      this.projects = null;
      this.partners = null;
      this.currentProjectId = null;
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
