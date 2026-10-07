// ═══════════════════════════════════════════════
// routes/alerts.js — Deterministic Alert Engine
// Scans PostgreSQL relational data and generates risk alerts.
// ═══════════════════════════════════════════════

const express = require('express');
const router = express.Router();

const tasksRepo = require('../db/repositories/tasks.repo');
const projectsRepo = require('../db/repositories/projects.repo');
const partnersRepo = require('../db/repositories/partners.repo');
const contractsRepo = require('../db/repositories/contracts.repo');
const permitsRepo = require('../db/repositories/permits.repo');
const capitalRepo = require('../db/repositories/capital.repo');
const { requirePermission } = require('../middleware/auth');

// GET all alerts (auto-generated from PostgreSQL data)
router.get('/', requirePermission('projects:read'), async (req, res, next) => {
  try {
    const projectId = req.query.projectId || null;
    const [tasks, projects, partners, contracts, permits, capitalStacks] = await Promise.all([
      tasksRepo.getAll({ organizationId: req.organizationId }),
      projectsRepo.getAll(req.organizationId),
      // DI-1: every intelligence input is tenant scoped. Partner names come
      // only from this organization (TENANT-PARTNER-001) and capital stacks
      // are fetched with the organization context (TENANT-CAPITAL-001; the
      // unscoped call matched organization_id = NULL and returned nothing).
      partnersRepo.getAll(req.organizationId),
      contractsRepo.getAll(null, req.organizationId),
      permitsRepo.getAll(null, req.organizationId),
      capitalRepo.getAll(null, req.organizationId),
    ]);

    const alerts = generateAlerts(projectId, {
      tasks,
      projects,
      partners,
      contracts,
      permits,
      capitalStacks,
    });

    res.json(alerts);
  } catch (err) {
    next(err);
  }
});

// Core deterministic alert generation engine
function generateAlerts(filterProjectId, data) {
  const { tasks, projects, partners, contracts, permits, capitalStacks } = data;
  const alerts = [];

  // partners is tenant-scoped; a reference outside it (possible only in
  // pre-existing rows) is rendered generically, never as the foreign id.
  function partnerName(partnerId) {
    const p = partners.find(p => p.id === partnerId);
    return p ? p.name : 'an unlisted partner';
  }

  // ── RULE 1: Task with no contract ──────────────
  tasks.forEach(task => {
    if (filterProjectId && task.projectId !== filterProjectId) return;
    if (task.status === 'complete') return;

    if (!task.contractId) {
      const proj = projects.find(p => p.id === task.projectId);
      alerts.push({
        id: `alert-nocontract-${task.id}`,
        projectId: task.projectId,
        projectName: proj?.name || task.projectId,
        severity: 'critical',
        type: 'missing-contract',
        title: `${task.title} — no contract`,
        desc: `Task assigned${task.partnerId ? ' to ' + partnerName(task.partnerId) : ' (no partner)'} but no executed contract exists. Work cannot legally proceed.`,
        action: 'contracts',
        actionLabel: task.partnerId ? 'Execute Contract' : 'Assign Partner',
        taskId: task.id,
        createdAt: new Date().toISOString(),
      });
    }
  });

  // ── RULE 2: Contract status = missing ──────────
  contracts.forEach(c => {
    if (filterProjectId && c.projectId !== filterProjectId) return;
    if (c.status === 'missing' && c.linkedTaskCount > 0) {
      const proj = projects.find(p => p.id === c.projectId);
      const partner = partners.find(p => p.id === c.partnerId);
      alerts.push({
        id: `alert-contract-${c.id}`,
        projectId: c.projectId,
        projectName: proj?.name || c.projectId,
        severity: 'critical',
        type: 'missing-contract',
        title: `${partner?.name || 'Partner'} contract missing`,
        desc: `${c.type} contract not executed. ${c.linkedTaskCount} task${c.linkedTaskCount !== 1 ? 's' : ''} blocked.`,
        action: 'contracts',
        actionLabel: 'Execute Contract',
        contractId: c.id,
        createdAt: new Date().toISOString(),
      });
    }
  });

  // ── RULE 3: Blocked tasks ──────────────────────
  const blockedTasks = tasks.filter(t => {
    if (filterProjectId && t.projectId !== filterProjectId) return false;
    return t.status === 'blocked';
  });
  if (blockedTasks.length > 0) {
    const proj = projects.find(p => p.id === blockedTasks[0].projectId);
    alerts.push({
      id: `alert-blocked-${blockedTasks[0].projectId}`,
      projectId: blockedTasks[0].projectId,
      projectName: proj?.name || '',
      severity: 'warning',
      type: 'blocked-tasks',
      title: `${blockedTasks.length} task${blockedTasks.length !== 1 ? 's' : ''} blocked`,
      desc: blockedTasks.map(t => t.title).join(', ') + ' — resolve dependencies to unblock.',
      action: 'tasks',
      actionLabel: 'View Task Board',
      createdAt: new Date().toISOString(),
    });
  }

  // ── RULE 4: Permit corrections open ───────────
  permits.forEach(pm => {
    if (filterProjectId && pm.projectId !== filterProjectId) return;
    if (pm.status === 'corrections') {
      const proj = projects.find(p => p.id === pm.projectId);
      const openCorrCount = pm.corrections.filter(c => c.status !== 'complete').length;
      alerts.push({
        id: `alert-permit-${pm.id}`,
        projectId: pm.projectId,
        projectName: proj?.name || '',
        severity: 'warning',
        type: 'permit-corrections',
        title: `${pm.name} — ${openCorrCount} correction${openCorrCount !== 1 ? 's' : ''} open`,
        desc: `City corrections received. ${openCorrCount} item${openCorrCount !== 1 ? 's' : ''} outstanding. Risk of losing review slot.`,
        action: 'permits',
        actionLabel: 'View Corrections',
        permitId: pm.id,
        createdAt: new Date().toISOString(),
      });
    }
  });

  // ── RULE 5: Capital with deadline ─────────────
  capitalStacks.forEach(stack => {
    if (filterProjectId && stack.projectId !== filterProjectId) return;
    stack.sources.forEach(src => {
      if (src.deadline && src.status === 'pending') {
        const daysLeft = Math.round((new Date(src.deadline) - new Date()) / (1000 * 60 * 60 * 24));
        if (daysLeft < 60) {
          const proj = projects.find(p => p.id === stack.projectId);
          alerts.push({
            id: `alert-capital-${src.id}`,
            projectId: stack.projectId,
            projectName: proj?.name || '',
            severity: daysLeft < 30 ? 'critical' : 'warning',
            type: 'capital-deadline',
            title: `${src.name} expires in ${daysLeft} days`,
            desc: src.alert || 'Capital commitment deadline approaching. Requires immediate action.',
            action: 'capital',
            actionLabel: 'Review Capital Stack',
            createdAt: new Date().toISOString(),
          });
        }
      }
    });
  });

  // ── RULE 6: GC contract missing before construction
  projects.forEach(proj => {
    if (filterProjectId && proj.id !== filterProjectId) return;
    if (proj.phase >= 3) {
      const gcContract = contracts.find(c => c.projectId === proj.id && c.type.toLowerCase().includes('general contractor') && c.status !== 'executed');
      if (gcContract) {
        alerts.push({
          id: `alert-gc-${proj.id}`,
          projectId: proj.id,
          projectName: proj.name,
          severity: 'warning',
          type: 'gc-contract',
          title: 'GC contract not executed — construction approaching',
          desc: `${gcContract.linkedTaskCount} construction tasks cannot begin without executed GC contract.`,
          action: 'contracts',
          actionLabel: 'Follow Up',
          createdAt: new Date().toISOString(),
        });
      }
    }
  });

  // Sort: critical first, then warning, then info
  // Using explicit null-coalesce so 0 is not treated as falsy
  const order = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => {
    const ordA = order[a.severity] !== undefined ? order[a.severity] : 2;
    const ordB = order[b.severity] !== undefined ? order[b.severity] : 2;
    return ordA - ordB;
  });
}

module.exports = router;
