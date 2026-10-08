// ═══════════════════════════════════════════════
// core/actions.js — delegated event handling
//
// Markup never carries inline handlers (the CSP forbids them). Elements name
// an action instead:
//   <button data-action="toggle-row" data-id="c1">      click
//   <form data-form="login">                            submit (default prevented)
//   <select data-change="filter-tasks">                 change
// ═══════════════════════════════════════════════

(function (global) {
  const handlers = { action: {}, form: {}, change: {} };

  function register(kind, name, fn) {
    handlers[kind][name] = fn;
  }

  async function run(fn, el, event) {
    try {
      await fn(el, event);
    } catch (err) {
      console.error(err);
      if (global.UI) global.UI.toast(err.message || 'Something went wrong', 'error');
    }
  }

  document.addEventListener('click', event => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const fn = handlers.action[el.dataset.action];
    if (!fn) return;
    event.preventDefault();
    run(fn, el, event);
  });

  document.addEventListener('submit', event => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const fn = handlers.form[form.dataset.form];
    if (fn) run(fn, form, event);
  });

  document.addEventListener('change', event => {
    const el = event.target.closest('[data-change]');
    if (!el) return;
    const fn = handlers.change[el.dataset.change];
    if (fn) run(fn, el, event);
  });

  // Keyboard access for clickable non-button elements (cards, rows).
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const el = event.target;
    if (el && el.matches && el.matches('[data-action][role="button"]')) {
      event.preventDefault();
      el.click();
    }
  });

  global.Actions = {
    onClick: (name, fn) => register('action', name, fn),
    onSubmit: (name, fn) => register('form', name, fn),
    onChange: (name, fn) => register('change', name, fn),
  };
})(window);
