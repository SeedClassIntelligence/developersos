// ═══════════════════════════════════════════════
// core/ui.js — shared view components and formatting
// Every component returns html`` output (escaped by construction).
// ═══════════════════════════════════════════════

(function (global) {
  const moneyFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat('en-US');

  const UI = {
    // ── formatting ─────────────────────────────
    money(n) {
      if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '—';
      return moneyFull.format(Number(n));
    },
    moneyShort(n) {
      if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '—';
      const v = Number(n);
      if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
      if (Math.abs(v) >= 1e3) return `$${Math.round(v / 1e3)}K`;
      return moneyFull.format(v);
    },
    number(n) {
      return n === null || n === undefined || isNaN(Number(n)) ? '—' : number.format(Number(n));
    },
    // Date-only strings (YYYY-MM-DD) are calendar dates: format them in UTC so they never shift a day.
    date(value) {
      if (!value) return '—';
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
      const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
      if (isNaN(d)) return String(value);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: dateOnly ? 'UTC' : undefined });
    },
    dateTime(value) {
      if (!value) return '—';
      const d = new Date(value);
      if (isNaN(d)) return String(value);
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    },
    titleCase(s) {
      return String(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    },

    // ── building blocks ────────────────────────
    pageHeader(title, subtitle, actions) {
      return html`
        <div class="page-head">
          <div>
            <h1 class="panel-h">${title}</h1>
            ${subtitle ? html`<div class="panel-sub">${subtitle}</div>` : ''}
          </div>
          ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
        </div>`;
    },

    stats(items) {
      return html`<div class="grid-4 stats-row">${items.map(i => html`
        <div class="stat-box"><div class="stat-n" style="color:${i.color || 'var(--navy)'}">${i.value}</div><div class="stat-l">${i.label}</div></div>`)}</div>`;
    },

    badge(text, kind = 'navy') {
      return html`<span class="badge badge-${kind}">${text}</span>`;
    },

    // columns: [{ label, cell(row) → string | html, className? }]
    table(columns, rows, { empty = 'Nothing to show yet.', rowAttrs } = {}) {
      if (!rows.length) return UI.empty(empty);
      return html`
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr>${columns.map(c => html`<th>${c.label}</th>`)}</tr></thead>
            <tbody>${rows.map(r => html`<tr ${rowAttrs ? rowAttrs(r) : ''}>${columns.map(c => html`<td class="${c.className || ''}">${c.cell(r)}</td>`)}</tr>`)}</tbody>
          </table>
        </div>`;
    },

    empty(message) {
      return html`<div class="empty-state">${message}</div>`;
    },

    loading(label = 'Loading…') {
      return html`<div class="loading-state" role="status"><span class="spinner"></span>${label}</div>`;
    },

    error(err) {
      const status = err && err.status;
      const message = status === 403
        ? 'You do not have access to this in the current organization.'
        : status === 404
          ? 'This item was not found in the current organization.'
          : (err && err.message) || 'Something went wrong.';
      return html`
        <div class="error-state" role="alert">
          <div class="error-title">Could not load this page</div>
          <div class="error-msg">${message}</div>
          <button class="btn btn-o btn-sm" data-action="retry">Try again</button>
        </div>`;
    },

    field({ name, label, type = 'text', value = '', required = false, autocomplete, placeholder, minlength }) {
      return html`
        <label class="field">
          <span class="lbl">${label}</span>
          <input class="input" name="${name}" type="${type}" value="${value}" ${required ? raw('required') : ''}
            ${autocomplete ? html`autocomplete="${autocomplete}"` : ''} ${placeholder ? html`placeholder="${placeholder}"` : ''}
            ${minlength ? html`minlength="${minlength}"` : ''}>
        </label>`;
    },

    select({ name, label, options, value = '', required = false, testid }) {
      return html`
        <label class="field">
          <span class="lbl">${label}</span>
          <select class="input" name="${name}" ${required ? raw('required') : ''} ${testid ? html`data-testid="${testid}"` : ''}>
            ${options.map(o => html`<option value="${o.value}" ${String(o.value) === String(value ?? '') ? raw('selected') : ''}>${o.label}</option>`)}
          </select>
        </label>`;
    },

    textarea({ name, label, value = '', required = false, rows = 3, placeholder }) {
      return html`
        <label class="field">
          <span class="lbl">${label}</span>
          <textarea class="input" name="${name}" rows="${rows}" ${required ? raw('required') : ''} ${placeholder ? html`placeholder="${placeholder}"` : ''}>${value}</textarea>
        </label>`;
    },

    formError() {
      return html`<div class="form-error" data-role="form-error" role="alert" hidden></div>`;
    },

    // Runs a form submission: disables the submit button, shows API errors
    // in the form's error slot, and returns the result (undefined on failure).
    async submit(form, fn, { missingLabel = k => k } = {}) {
      const button = form.querySelector('button[type="submit"]');
      const box = form.querySelector('[data-role="form-error"]');
      const show = message => { if (box) { box.textContent = message || ''; box.hidden = !message; } };
      show('');
      if (button) button.disabled = true;
      try {
        return await fn();
      } catch (err) {
        const missing = err.body && Array.isArray(err.body.missing) && err.body.missing.length
          ? ` Missing: ${err.body.missing.map(missingLabel).join(', ')}.` : '';
        show(`${err.message.replace(/[.\s]*$/, '')}.${missing}`);
        return undefined;
      } finally {
        if (button) button.disabled = false;
      }
    },

    // ── feedback ───────────────────────────────
    toast(message, kind = 'info') {
      const root = document.getElementById('toast-root');
      if (!root) return;
      const el = document.createElement('div');
      el.className = `toast toast-${kind}`;
      el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      el.textContent = message;
      root.appendChild(el);
      while (root.children.length > 3) root.firstElementChild.remove();
      setTimeout(() => el.remove(), 5000);
    },
  };

  global.UI = UI;
})(window);
