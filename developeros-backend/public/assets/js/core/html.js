// ═══════════════════════════════════════════════
// core/html.js — escaping templates
//
// Every value interpolated into html`` is HTML-escaped unless it is itself
// the output of html`` (or raw()). Pages render only through mount(), which
// accepts nothing but SafeHtml, so tenant data can never become markup.
// ═══════════════════════════════════════════════

(function (global) {
  class SafeHtml {
    constructor(value) { this.value = value; }
    toString() { return this.value; }
  }

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, c => ESCAPES[c]);
  }

  function renderValue(value) {
    if (value instanceof SafeHtml) return value.value;
    if (Array.isArray(value)) return value.map(renderValue).join('');
    if (value === null || value === undefined || value === false) return '';
    return esc(value);
  }

  function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
    return new SafeHtml(out);
  }

  // Trusted, developer-authored markup only. Never pass data through raw().
  function raw(markup) { return new SafeHtml(String(markup)); }

  function mount(element, content) {
    if (!(content instanceof SafeHtml)) throw new Error('mount() requires html`` output');
    element.innerHTML = content.value;
  }

  // Colors arrive as data (e.g. capital sources); only plain hex colors reach a style attribute.
  function safeColor(value, fallback = 'var(--navy)') {
    return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
  }

  Object.assign(global, { SafeHtml, html, raw, esc, mount, safeColor });
})(window);
