// ═══════════════════════════════════════════════
// APP.JS — Bootstrap
// Runs on DOMContentLoaded. Decides whether
// to show landing or app shell.
// ═══════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  if (state.isAuthenticated) {
    enterApp();
  } else {
    renderLanding();
  }
});

// ── UTILITY FUNCTIONS (used across all pages) ──

function fmt(n) {
  if (n >= 1000000) return '$' + (n/1000000).toFixed(1) + 'M';
  if (n >= 1000)    return '$' + (n/1000).toFixed(0) + 'K';
  return '$' + n;
}

function phaseName(n) {
  return ['','Predevelopment','Entitlements','Design Development','Financing','Construction','Stabilization'][n] || '';
}

function statusColor(s) {
  return { 'on-track': 'var(--green)', 'at-risk': 'var(--amber)', 'blocked': 'var(--red)' }[s] || 'var(--dim)';
}

function statusLabel(s) {
  return { 'on-track': 'On Track', 'at-risk': 'At Risk', 'blocked': 'Blocked' }[s] || s;
}

function disciplineTag(d) {
  const map = {
    arch:        { label: 'Arch',       class: 'tag-arch' },
    civil:       { label: 'Civil',      class: 'tag-civil' },
    structural:  { label: 'Structural', class: 'tag-struct' },
    landscape:   { label: 'Landscape',  class: 'tag-land' },
    mep:         { label: 'MEP',        class: 'tag-mep' },
    survey:      { label: 'Survey',     class: 'tag-survey' },
    environmental:{ label: 'Env',       class: 'tag-env' },
  };
  const t = map[d] || { label: d, class: '' };
  return `<span class="tc-tag ${t.class}">${t.label}</span>`;
}

function partnerName(partnerId) {
  if (!partnerId) return 'Unassigned';
  const p = (state.partners || []).find(p => p.id === partnerId);
  return p ? p.name : partnerId;
}

function partnerInitials(partnerId) {
  if (!partnerId) return '?';
  const p = (state.partners || []).find(p => p.id === partnerId);
  return p ? p.initials : '??';
}

function contractStatus(contractId) {
  if (!contractId) return { ok: false, label: 'No Contract', badge: 'badge-red' };
  const c = state.contracts.find(c => c.id === contractId);
  if (!c) return { ok: false, label: 'No Contract', badge: 'badge-red' };
  if (c.status === 'executed') return { ok: true, label: '✓ Executed', badge: 'badge-green' };
  if (c.status === 'pending')  return { ok: false, label: '⏳ Pending', badge: 'badge-amber' };
  return { ok: false, label: '❌ Missing', badge: 'badge-red' };
}

function roleBadge(role) {
  const map = {
    developer:    'badge-gold',
    architect:    'badge-gold',
    civil:        'badge-blue',
    structural:   'badge-blue',
    landscape:    'badge-navy',
    contractor:   'badge-amber',
    municipal:    'badge-navy',
    investor:     'badge-green',
    nonprofit:    'badge-teal',
  };
  return `<span class="badge ${map[role]||'badge-navy'}">${role}</span>`;
}

function severityClass(s) {
  return { critical: 'alert-red', warning: 'alert-amber', info: 'alert-blue' }[s] || 'alert-blue';
}

function severityIcon(s) {
  return { critical: '🔴', warning: '🟡', info: '🔵' }[s] || '🔵';
}
