// ══════════════════════════════════════════════════════════════
// DEVOS-UI — WP1 frontend foundation (browser acceptance)
//
// Drives the real application in headless Chromium against the gate's API
// server and seeded database. Covers: real sign-in and sign-out, session
// restore and expiry, invitation acceptance, organization switching with
// tenant isolation, live data on every page (no mock fallback), escaped
// rendering of hostile stored data, and a strict script CSP with zero
// violations.
// ══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { startTestServer, apiRequest, loginAs } = require('./helpers');

const PORT = 3005;
const BASE = `http://127.0.0.1:${PORT}`;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ADMIN = { email: 'admin@developeros.com', password: 'password123' };
const XSS_NAME = '<img src=x onerror="window.__devosXss=1">Beta Tower';

async function withOwner(fn) {
  const c = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

async function runUIAcceptanceSuite() {
  console.log('\n===============================================================');
  console.log('RUNNING SUITE: DEVOS-UI WP1 FRONTEND FOUNDATION (browser)');
  console.log('===============================================================\n');

  await startTestServer(PORT, true);

  // A second tenant the admin also belongs to (viewer), holding a project whose
  // stored name is hostile markup, written directly as imported data would be.
  await withOwner(async c => {
    await c.query(`INSERT INTO organizations (id, name, type, plan) VALUES ('ui-beta', 'UI Beta Holdings', 'developer', 'enterprise') ON CONFLICT DO NOTHING`);
    await c.query(`INSERT INTO projects (id, organization_id, name, type, units, affordable_units, budget, progress, phase, phase_label, status, city, program)
      VALUES ('ui-b-p1', 'ui-beta', $1, 'Market Rate', 40, 0, 9000000, 10, 1, 'Predevelopment', 'on-track', 'Oakland', 'Market') ON CONFLICT DO NOTHING`, [XSS_NAME]);
    await c.query(`INSERT INTO memberships (id, user_id, organization_id, role_id, status)
      SELECT 'ui-m-admin-beta', id, 'ui-beta', 'viewer', 'ACTIVE' FROM users WHERE email = $1 ON CONFLICT DO NOTHING`, [ADMIN.email]);
  });

  const results = [];
  async function t(id, title, fn) {
    let passed = false; let detail = '';
    try {
      const out = await fn();
      passed = out === true || (out && out.pass === true);
      detail = out && out.detail !== undefined ? (typeof out.detail === 'string' ? out.detail : JSON.stringify(out.detail)) : '';
    } catch (err) { detail = `error: ${err.message.split('\n')[0]}`; }
    results.push({ id, title, passed, detail: detail.slice(0, 600) });
    console.log(`  ${passed ? '[PASS]' : '[FAIL]'} ${id} — ${title}${passed ? '' : ` :: ${detail.slice(0, 300)}`}`);
  }

  // Static checks run even if no browser is available.
  await t('DEVOS-UI-SEC-001', 'Shipped frontend contains no credentials, demo accounts, mock data or inline event handlers', async () => {
    const files = walk(PUBLIC_DIR).filter(f => /\.(js|html)$/.test(f));
    const hits = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      const rel = path.relative(PUBLIC_DIR, f);
      if (/password123|kgdevelopment|mockData|loadAllDataFromAPI/i.test(text)) hits.push(`${rel}: credential/mock reference`);
      if (/\son[a-z]+\s*=\s*["'`]/i.test(text)) hits.push(`${rel}: inline event handler`);
      if (/localhost:\d+/.test(text)) hits.push(`${rel}: hard-coded API host`);
    }
    return { pass: files.length > 0 && hits.length === 0, detail: hits };
  });

  await t('DEVOS-UI-SEC-002', 'Served Content-Security-Policy allows scripts from this origin only (no unsafe-inline)', async () => {
    const res = await fetch(`${BASE}/`);
    const csp = res.headers.get('content-security-policy') || '';
    const scriptSrc = (csp.split(';').find(d => d.trim().startsWith('script-src ')) || '').trim();
    return { pass: res.status === 200 && scriptSrc === "script-src 'self'" && csp.includes("script-src-attr 'none'"), detail: scriptSrc };
  });

  await t('DEVOS-UI-SRV-001', 'Same-origin API calls pass CORS; a foreign origin is still refused', async () => {
    const own = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(ADMIN) });
    const foreign = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify(ADMIN) });
    return { pass: own.status === 200 && foreign.status === 403, detail: { sameOrigin: own.status, foreign: foreign.status } };
  });

  let browser = null;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch();
  } catch (err) {
    results.push({ id: 'DEVOS-UI-BROWSER', title: 'Headless Chromium available for UI tests', passed: false, detail: err.message.split('\n')[0] });
    console.log(`  [FAIL] DEVOS-UI-BROWSER — Chromium could not be launched: ${err.message.split('\n')[0]}`);
  }

  if (browser) {
    const cspViolations = [];
    const pageErrors = [];
    async function newPage() {
      const context = await browser.newContext({ viewport: { width: 1360, height: 860 } });
      const page = await context.newPage();
      page.on('console', m => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text().slice(0, 160)); });
      page.on('pageerror', e => pageErrors.push(e.message.slice(0, 160)));
      page.setDefaultTimeout(10000);
      return page;
    }
    async function signIn(page, email, password) {
      await page.waitForSelector('[data-testid=login-form]');
      await page.fill('input[name=email]', email);
      await page.fill('input[name=password]', password);
      await page.click('[data-testid=login-form] button[type=submit]');
    }
    const token = page => page.evaluate(() => localStorage.getItem('devos.session'));
    // Navigates to a signed-in route and waits until the router has rendered it (content or error).
    async function open(page, route) {
      await page.goto(`${BASE}/#${route}`);
      await page.waitForFunction(r => document.getElementById('app').dataset.ready === r, route);
    }
    const adminToken = (await loginAs(ADMIN.email)).token;
    const apiCount = async p => (await apiRequest('GET', p, { headers: { Authorization: `Bearer ${adminToken}` } })).body.length;

    try {
      const page = await newPage();

      await t('DEVOS-UI-AUTH-001', 'Signed-out visitors get the sign-in form; the application shell is not rendered', async () => {
        await page.goto(`${BASE}/`);
        await page.waitForSelector('[data-testid=login-form]');
        return { pass: page.url().endsWith('#/login') && await page.isHidden('#app-shell') && (await page.locator('#app').innerHTML()) === '', detail: page.url() };
      });

      await t('DEVOS-UI-AUTH-002', 'Wrong password: error shown, still signed out, no session stored', async () => {
        await signIn(page, ADMIN.email, 'not-the-password');
        await page.waitForSelector('[data-role=form-error]:not([hidden])');
        const msg = await page.textContent('[data-role=form-error]');
        return { pass: /incorrect email or password/i.test(msg) && !(await token(page)) && await page.isHidden('#app-shell'), detail: msg };
      });

      await t('DEVOS-UI-AUTH-003', 'Real sign-in lands on the portfolio with live API data and the signed-in user', async () => {
        await page.fill('input[name=password]', ADMIN.password);
        await page.click('[data-testid=login-form] button[type=submit]');
        await page.waitForSelector('[data-testid=project-cards]');
        const cards = await page.locator('[data-testid=project-card]').count();
        const expected = await apiCount('/api/projects');
        const name = await page.textContent('[data-testid=user-name]');
        return { pass: cards === expected && cards > 0 && name === 'Admin User' && !!(await token(page)), detail: { cards, expected, name } };
      });

      await t('DEVOS-UI-DATA-001', 'Every project section renders live data matching the API, with no error state', async () => {
        const problems = [];
        const checks = [
          ['', '[data-testid=sow-snapshot]', null],
          ['tasks', '[data-testid=task-card]', '/api/tasks?projectId=p1'],
          ['permits', 'tbody tr', '/api/permits?projectId=p1'],
          ['contracts', 'tbody tr', '/api/contracts?projectId=p1'],
          ['capital', '[data-testid=capital-sources] .cs-row', null],
          ['messages', '[data-testid=channel]', '/api/messages/channels?projectId=p1'],
          ['documents', 'tbody tr', '/api/documents?projectId=p1'],
        ];
        for (const [section, selector, apiPath] of checks) {
          await open(page, `/projects/p1${section ? `/${section}` : ''}`);
          if (await page.locator('.error-state').count()) { problems.push(`${section || 'overview'}: error state`); continue; }
          const n = await page.locator(selector).count();
          if (apiPath) {
            const expected = await apiCount(apiPath);
            if (n !== expected) problems.push(`${section}: ${n} rendered vs ${expected} from API`);
          } else if (n === 0) problems.push(`${section || 'overview'}: nothing rendered`);
        }
        return { pass: !problems.length, detail: problems };
      });

      await t('DEVOS-UI-DATA-002', 'Selecting another project in the top bar loads that project\'s data', async () => {
        await open(page, '/projects/p1/tasks');
        await page.selectOption('[data-testid=project-select]', 'p2');
        await page.waitForFunction(() => document.getElementById('app').dataset.ready === '/projects/p2/tasks');
        const n = await page.locator('[data-testid=task-card]').count();
        const expected = await apiCount('/api/tasks?projectId=p2');
        return { pass: n === expected, detail: { rendered: n, expected } };
      });

      await t('DEVOS-UI-DATA-003', 'API unreachable → visible error with retry (never placeholder data); retry recovers', async () => {
        await page.route('**/api/alerts**', route => route.abort());
        await open(page, '/alerts');
        const msg = await page.textContent('.error-state');
        const placeholder = await page.locator('[data-testid=alert-item]').count();
        await page.unroute('**/api/alerts**');
        await page.click('.error-state [data-action=retry]');
        await page.waitForFunction(() => document.getElementById('app').dataset.ready === '/alerts' && !document.querySelector('.error-state'));
        const recovered = await page.locator('.error-state').count() === 0;
        return { pass: /cannot reach/i.test(msg) && placeholder === 0 && recovered, detail: { msg: msg.replace(/\s+/g, ' ').trim(), recovered } };
      });

      await t('DEVOS-UI-UX-001', 'Unknown or foreign project id shows "not found" inside the shell (no crash, no foreign data)', async () => {
        await open(page, '/projects/ui-b-p1');
        const msg = await page.textContent('.error-state');
        return { pass: /not found/i.test(msg) && !(await page.content()).includes('Beta Tower'), detail: msg.replace(/\s+/g, ' ').trim() };
      });

      await t('DEVOS-UI-ORG-001', 'Organization switcher changes tenant context; each tenant sees only its own projects', async () => {
        await open(page, '/portfolio');
        const before = await page.locator('[data-testid=project-card]').count();
        await page.selectOption('[data-testid=org-select]', 'ui-beta');
        await page.waitForFunction(() => document.querySelectorAll('[data-testid=project-card]').length === 1);
        const cards = await page.locator('[data-testid=project-card]').allTextContents();
        const leak = cards.some(c => /Westside|Eastside/.test(c));
        const role = await page.textContent('.tb-user-role');
        return { pass: before > 1 && cards.length === 1 && !leak && /Read-Only Viewer/.test(role), detail: { before, after: cards.length, role } };
      });

      await t('DEVOS-UI-XSS-001', 'Hostile markup stored in tenant data renders as text and never executes', async () => {
        // Still in ui-beta: the only project's stored name is an <img onerror> payload.
        const executed = await page.evaluate(() => window.__devosXss === 1);
        const imgs = await page.locator('[data-testid=project-card] img').count();
        const text = await page.textContent('[data-testid=project-card] .pc-name');
        await open(page, '/projects/ui-b-p1');
        const executedAfter = await page.evaluate(() => window.__devosXss === 1);
        return { pass: !executed && !executedAfter && imgs === 0 && text === XSS_NAME, detail: { executed, executedAfter, imgs, text } };
      });

      await t('DEVOS-UI-AUTH-004', 'Session survives reload; sign-out clears it and protected links return to sign-in', async () => {
        await page.selectOption('[data-testid=org-select]', 'org1');
        await page.waitForURL(/#\/portfolio/);
        await page.reload();
        await page.waitForSelector('[data-testid=project-cards]');
        const restored = await page.isVisible('#app-shell');
        await page.click('[data-testid=sign-out]');
        await page.waitForSelector('[data-testid=login-form]');
        const cleared = !(await token(page));
        await page.goto(`${BASE}/#/projects/p1/contracts`);
        await page.waitForSelector('[data-testid=login-form]');
        return { pass: restored && cleared && page.url().endsWith('#/login'), detail: { restored, cleared, url: page.url() } };
      });

      await t('DEVOS-UI-AUTH-005', 'A deep link opened while signed out is restored after sign-in', async () => {
        // The previous test left /projects/p1/contracts as the intended destination.
        await signIn(page, ADMIN.email, ADMIN.password);
        await page.waitForURL(/#\/projects\/p1\/contracts/);
        await page.waitForSelector('tbody tr');
        return { pass: true, detail: page.url() };
      });

      await t('DEVOS-UI-AUTH-006', 'An invalid stored token is discarded on load and the user is asked to sign in', async () => {
        const p2 = await newPage();
        await p2.goto(`${BASE}/`);
        await p2.evaluate(() => localStorage.setItem('devos.session', 'not-a-valid-token'));
        await p2.goto(`${BASE}/?reload=1#/portfolio`); // full page load, so the stored token is restored
        await p2.waitForSelector('[data-testid=login-form]');
        const stored = await token(p2);
        await p2.context().close();
        return { pass: !stored, detail: { stored } };
      });

      await t('DEVOS-UI-INVITE-001', 'Invitation acceptance: an invited person sets a password, signs in and lands in the inviting organization with the invited role', async () => {
        const email = `invitee.${Date.now()}@ui-wp1.test`;
        const inv = await apiRequest('POST', '/api/invitations', { headers: { Authorization: `Bearer ${adminToken}` }, body: { email, role: 'viewer' } });
        if (inv.status !== 201 || !inv.body.token) return { pass: false, detail: `invitation → ${inv.status}` };
        const p3 = await newPage();
        await p3.goto(`${BASE}/#/accept-invite?token=${encodeURIComponent(inv.body.token)}`);
        await p3.waitForSelector('[data-testid=accept-form]');
        await p3.fill('input[name=password]', 'invited-pass-1');
        await p3.fill('input[name=confirm]', 'mismatch-pass-1');
        await p3.click('[data-testid=accept-form] button[type=submit]');
        await p3.waitForSelector('[data-role=form-error]:not([hidden])');
        const mismatch = await p3.textContent('[data-role=form-error]');
        await p3.fill('input[name=confirm]', 'invited-pass-1');
        await p3.click('[data-testid=accept-form] button[type=submit]');
        await p3.waitForSelector('.form-notice');
        await signIn(p3, email, 'invited-pass-1');
        await p3.waitForSelector('[data-testid=project-cards]');
        const role = await p3.textContent('.tb-user-role');
        const org = await p3.textContent('[data-testid=org-name]');
        // Reusing the link fails visibly.
        await p3.click('[data-testid=sign-out]');
        await p3.goto(`${BASE}/#/accept-invite?token=${encodeURIComponent(inv.body.token)}`);
        await p3.waitForSelector('[data-testid=accept-form]');
        await p3.fill('input[name=password]', 'invited-pass-1');
        await p3.fill('input[name=confirm]', 'invited-pass-1');
        await p3.click('[data-testid=accept-form] button[type=submit]');
        await p3.waitForSelector('[data-role=form-error]:not([hidden])');
        const reuse = await p3.textContent('[data-role=form-error]');
        await p3.context().close();
        return { pass: /do not match/i.test(mismatch) && /Read-Only Viewer/.test(role) && org === 'KG Development' && /no longer active|invalid/i.test(reuse),
          detail: { mismatch, role, org, reuse } };
      });

      await t('DEVOS-UI-AUTH-007', 'A session that ends server-side (user deactivated) returns the user to sign-in with a notice', async () => {
        const email = `expiring.${Date.now()}@ui-wp1.test`;
        const inv = await apiRequest('POST', '/api/invitations', { headers: { Authorization: `Bearer ${adminToken}` }, body: { email, role: 'viewer' } });
        await apiRequest('POST', '/api/invitations/accept', { body: { token: inv.body.token, password: 'expiring-pass-1' } });
        const p4 = await newPage();
        await p4.goto(`${BASE}/`);
        await signIn(p4, email, 'expiring-pass-1');
        await p4.waitForSelector('[data-testid=project-cards]');
        await withOwner(c => c.query('UPDATE users SET active = FALSE WHERE email = $1', [email]));
        await p4.goto(`${BASE}/#/alerts`);
        await p4.waitForSelector('[data-testid=login-form]');
        const toast = await p4.locator('.toast').allTextContents();
        const stored = await token(p4);
        await p4.context().close();
        return { pass: !stored && toast.some(x => /session has ended/i.test(x)), detail: { toast, stored } };
      });

      await t('DEVOS-UI-SEC-003', 'Zero Content-Security-Policy violations and zero uncaught page errors across the whole run', async () => (
        { pass: cspViolations.length === 0 && pageErrors.length === 0, detail: { cspViolations: cspViolations.slice(0, 3), pageErrors: pageErrors.slice(0, 3) } }
      ));
    } finally {
      await browser.close();
    }
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;
  console.log(`\nDEVOS-UI WP1: ${passedCount} PASSED, ${failedCount} FAILED (Total: ${results.length})`);
  return { passedCount, failedCount, total: results.length, results };
}

module.exports = { runUIAcceptanceSuite };
