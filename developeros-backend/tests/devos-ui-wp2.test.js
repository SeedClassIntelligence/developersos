// ══════════════════════════════════════════════════════════════
// DEVOS-ACCESS — WP2 tenant provisioning, members, invitations,
// password recovery and audit viewer (API + browser acceptance)
//
// Email runs through the in-process memory transport (MAIL_TRANSPORT=memory),
// so every message the product sends is inspected exactly as a recipient
// would receive it.
// ══════════════════════════════════════════════════════════════

const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');
const { startTestServer, apiRequest, loginAs } = require('./helpers');

const PORT = 3005;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');
const ADMIN = { email: 'admin@developeros.com', password: 'password123' };
const DEV = { email: 'maria@kgdevelopment.com', password: 'password123' };

async function withOwner(fn) {
  const c = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function runAccessSuite() {
  console.log('\n===============================================================');
  console.log('RUNNING SUITE: DEVOS-ACCESS WP2 (provisioning, members, recovery)');
  console.log('===============================================================\n');

  Object.assign(process.env, { MAIL_TRANSPORT: 'memory', MAIL_FROM: 'DeveloperOS <noreply@devos.test>', APP_BASE_URL: BASE });
  await startTestServer(PORT, true);
  const mailer = require('../services/mailer');
  mailer.outbox.length = 0;
  const stamp = Date.now();
  const tokenOf = async (email, password) => {
    const r = await apiRequest('POST', '/api/auth/login', { body: { email, password } });
    return r.status === 200 ? r.body.token : null;
  };
  const api = (token, method, p, body) => apiRequest(method, p, { headers: { Authorization: `Bearer ${token}` }, body });
  const admin = (await loginAs(ADMIN.email)).token;
  const linkIn = msg => (msg && msg.text.match(/https?:\/\/\S+/) || [null])[0];
  const tokenFromLink = link => decodeURIComponent(new URL(link.replace('/#/', '/')).searchParams.get('token'));
  const lastMailTo = email => mailer.outbox.filter(m => m.to === email).pop();

  // A member created through the real invitation flow.
  async function inviteAndAccept(email, role, password, token = admin) {
    const inv = await api(token, 'POST', '/api/invitations', { email, role });
    const acc = await apiRequest('POST', '/api/invitations/accept', { body: { token: inv.body.token, password } });
    return { inv, acc, userId: acc.body && acc.body.userId };
  }

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

  // ── API ──────────────────────────────────────
  await t('DEVOS-ACC-MEM-001', 'Member directory lists accounts with roles; every member can read it; only administrators can change access', async () => {
    const dev = (await loginAs(DEV.email)).token;
    const list = await api(dev, 'GET', '/api/members');
    const maria = (list.body || []).find(m => m.email === DEV.email);
    const adminRow = (list.body || []).find(m => m.email === ADMIN.email);
    const attempt = await api(dev, 'PATCH', `/api/members/${adminRow && adminRow.userId}`, { roleId: 'viewer' });
    return { pass: list.status === 200 && maria && maria.roleId === 'developer' && adminRow && adminRow.roleId === 'org-admin' && attempt.status === 403 && !('password_hash' in maria),
      detail: { status: list.status, attempt: attempt.status } };
  });

  await t('DEVOS-ACC-MEM-002', 'Role changes take effect on the next request (developer → viewer loses write access; restored on promotion back)', async () => {
    const m = await inviteAndAccept(`role.${stamp}@acc.test`, 'developer', 'role-pass-123');
    const tok = await tokenOf(`role.${stamp}@acc.test`, 'role-pass-123');
    const before = await api(tok, 'POST', '/api/di/relationships', { name: 'Before', relationshipType: 'broker', provenance: { sourceType: 'USER_ENTRY' } });
    const demote = await api(admin, 'PATCH', `/api/members/${m.userId}`, { roleId: 'viewer' });
    const during = await api(tok, 'POST', '/api/di/relationships', { name: 'During', relationshipType: 'broker', provenance: { sourceType: 'USER_ENTRY' } });
    const promote = await api(admin, 'PATCH', `/api/members/${m.userId}`, { roleId: 'developer' });
    const after = await api(tok, 'POST', '/api/di/relationships', { name: 'After', relationshipType: 'broker', provenance: { sourceType: 'USER_ENTRY' } });
    const bogus = await api(admin, 'PATCH', `/api/members/${m.userId}`, { roleId: 'platform-admin' });
    return { pass: before.status === 201 && demote.status === 200 && demote.body.roleId === 'viewer' && during.status === 403 && promote.status === 200 && after.status === 201 && bogus.status === 400,
      detail: { before: before.status, demote: demote.status, during: during.status, after: after.status, bogus: bogus.status } };
  });

  await t('DEVOS-ACC-MEM-003', 'Deactivation removes access to the organization immediately; the account can still sign in; reactivation restores access', async () => {
    const email = `deact.${stamp}@acc.test`;
    const m = await inviteAndAccept(email, 'developer', 'deact-pass-123');
    const tok = await tokenOf(email, 'deact-pass-123');
    const ok = await api(tok, 'GET', '/api/projects');
    const off = await api(admin, 'PATCH', `/api/members/${m.userId}`, { status: 'INACTIVE' });
    const denied = await api(tok, 'GET', '/api/projects');
    const canLogin = !!(await tokenOf(email, 'deact-pass-123'));
    const memberships = await api(tok, 'GET', '/api/auth/memberships');
    const on = await api(admin, 'PATCH', `/api/members/${m.userId}`, { status: 'ACTIVE' });
    const again = await api(tok, 'GET', '/api/projects');
    return { pass: ok.status === 200 && off.status === 200 && denied.status === 403 && canLogin && memberships.body.length === 0 && on.status === 200 && again.status === 200,
      detail: { ok: ok.status, denied: denied.status, memberships: memberships.body.length, again: again.status } };
  });

  await t('DEVOS-ACC-MEM-004', 'Administrators cannot change their own access; two administrators demoting each other concurrently cannot leave zero administrators', async () => {
    const self = await api(admin, 'GET', '/api/members');
    const me = self.body.find(m => m.email === ADMIN.email);
    const selfChange = await api(admin, 'PATCH', `/api/members/${me.userId}`, { roleId: 'viewer' });
    // A fresh organization with exactly two administrators.
    const orgId = `acc-org-${stamp}`;
    await withOwner(c => c.query(`INSERT INTO organizations (id, name) VALUES ($1, 'Two Admins Co')`, [orgId]));
    const users = [];
    for (const n of [1, 2]) {
      const email = `twoadmin${n}.${stamp}@acc.test`;
      await withOwner(async c => {
        const { rows: [u] } = await c.query(`INSERT INTO users (id, org_id, name, email, password_hash, role, active)
          SELECT $1, $2, $3, $3, password_hash, 'user', TRUE FROM users WHERE email = $4 RETURNING id`, [`u-acc-${n}-${stamp}`, orgId, email, ADMIN.email]);
        await c.query(`INSERT INTO memberships (id, user_id, organization_id, role_id, status) VALUES ($1, $2, $3, 'org-admin', 'ACTIVE')`, [`m-acc-${n}-${stamp}`, u.id, orgId]);
        users.push({ id: u.id, token: null, email });
      });
    }
    for (const u of users) u.token = await tokenOf(u.email, ADMIN.password);
    const [a, b] = await Promise.all([
      api(users[0].token, 'PATCH', `/api/members/${users[1].id}`, { roleId: 'viewer' }),
      api(users[1].token, 'PATCH', `/api/members/${users[0].id}`, { roleId: 'viewer' }),
    ]);
    const { rows: [{ n }] } = await withOwner(c => c.query(`SELECT count(*)::int AS n FROM memberships WHERE organization_id = $1 AND role_id = 'org-admin' AND status = 'ACTIVE'`, [orgId]));
    const statuses = [a.status, b.status].sort();
    // Either one demotion wins and the loser is refused (409), or the loser's authority is already gone (403).
    return { pass: selfChange.status === 409 && n === 1 && statuses[0] === 200 && [403, 409].includes(statuses[1]),
      detail: { selfChange: selfChange.status, statuses, remainingAdmins: n } };
  });

  await t('DEVOS-ACC-INV-001', 'Invitations: listed without token material, revocable once, revoked links fail, and active members cannot be re-invited', async () => {
    const email = `revoke.${stamp}@acc.test`;
    const inv = await api(admin, 'POST', '/api/invitations', { email, role: 'viewer' });
    const list = await api(admin, 'GET', '/api/invitations');
    const row = (list.body || []).find(i => i.id === inv.body.id);
    const leak = JSON.stringify(list.body).includes(inv.body.token) || /token/i.test(JSON.stringify(Object.keys(row || {})));
    const revoke = await api(admin, 'POST', `/api/invitations/${inv.body.id}/revoke`);
    const again = await api(admin, 'POST', `/api/invitations/${inv.body.id}/revoke`);
    const accept = await apiRequest('POST', '/api/invitations/accept', { body: { token: inv.body.token, password: 'revoked-pass-1' } });
    const dup = await api(admin, 'POST', '/api/invitations', { email: DEV.email, role: 'viewer' });
    const dev = (await loginAs(DEV.email)).token;
    const devList = await api(dev, 'GET', '/api/invitations');
    return { pass: inv.status === 201 && row && row.status === 'PENDING' && !leak && revoke.status === 200 && again.status === 409 && accept.status === 400 && dup.status === 409 && devList.status === 403,
      detail: { leak, revoke: revoke.status, again: again.status, accept: accept.status, dup: dup.status, devList: devList.status } };
  });

  await t('DEVOS-ACC-INV-002', 'With email configured, an invitation is emailed to the invitee with a working acceptance link', async () => {
    const email = `mailed.${stamp}@acc.test`;
    const inv = await api(admin, 'POST', '/api/invitations', { email, role: 'developer' });
    const msg = lastMailTo(email);
    const link = linkIn(msg);
    const acc = link ? await apiRequest('POST', '/api/invitations/accept', { body: { token: tokenFromLink(link), password: 'mailed-pass-1' } }) : { status: 0 };
    return { pass: inv.body.delivery === 'email' && !!msg && link.startsWith(`${BASE}/#/accept-invite?token=`) && acc.status === 201,
      detail: { delivery: inv.body.delivery, subject: msg && msg.subject, accept: acc.status } };
  });

  await t('DEVOS-ACC-PWD-001', 'Password reset: same response for unknown and known accounts; only real accounts get a single-use link; the new password works and the old one does not', async () => {
    const email = `reset.${stamp}@acc.test`;
    await inviteAndAccept(email, 'viewer', 'old-pass-1234');
    const opts = await apiRequest('GET', '/api/auth/options');
    const sentBefore = mailer.outbox.length;
    const unknown = await apiRequest('POST', '/api/auth/password-reset', { body: { email: `nobody.${stamp}@acc.test` } });
    const unknownMailed = mailer.outbox.length !== sentBefore;
    const known = await apiRequest('POST', '/api/auth/password-reset', { body: { email } });
    const link = linkIn(lastMailTo(email));
    const token = tokenFromLink(link);
    const complete = await apiRequest('POST', '/api/auth/password-reset/complete', { body: { token, password: 'new-pass-5678' } });
    const reuse = await apiRequest('POST', '/api/auth/password-reset/complete', { body: { token, password: 'other-pass-999' } });
    const oldWorks = !!(await tokenOf(email, 'old-pass-1234'));
    const newWorks = !!(await tokenOf(email, 'new-pass-5678'));
    return { pass: opts.body.passwordResetByEmail === true && unknown.status === 202 && known.status === 202 && JSON.stringify(unknown.body) === JSON.stringify(known.body) &&
      !unknownMailed && link.includes('/#/reset-password?token=') && complete.status === 200 && reuse.status === 400 && !oldWorks && newWorks,
      detail: { unknown: unknown.status, unknownMailed, complete: complete.status, reuse: reuse.status, oldWorks, newWorks } };
  });

  await t('DEVOS-ACC-PWD-002', 'Expired reset tokens are refused; reset tokens never appear in the audit ledger', async () => {
    const email = `expire.${stamp}@acc.test`;
    await inviteAndAccept(email, 'viewer', 'expire-pass-1');
    await apiRequest('POST', '/api/auth/password-reset', { body: { email } });
    const token = tokenFromLink(linkIn(lastMailTo(email)));
    await withOwner(c => c.query(`UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL '1 minute'
      WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]));
    const expired = await apiRequest('POST', '/api/auth/password-reset/complete', { body: { token, password: 'never-applied-1' } });
    const { rows } = await withOwner(c => c.query(`SELECT before_state, after_state FROM audit_events WHERE entity_type = 'password_reset_tokens'`));
    const leaked = rows.some(r => JSON.stringify(r).includes('token_hash') || JSON.stringify(r).includes(token));
    return { pass: expired.status === 400 && /expired/i.test(expired.body.error) && rows.length > 0 && !leaked, detail: { expired: expired.status, ledgerRows: rows.length, leaked } };
  });

  const PLATFORM = { email: `platform.${stamp}@acc.test`, password: `Platform-${stamp}-Pass` };
  await t('DEVOS-ACC-PLAT-001', 'Bootstrap CLI creates the first platform administrator (idempotent; refuses weak passwords)', async () => {
    const run = (args, extra = {}) => spawnSync(process.execPath, ['scripts/bootstrap-platform-admin.js', ...args], { cwd: ROOT, env: { ...process.env, ...extra }, encoding: 'utf8' });
    const weak = run(['--email', PLATFORM.email, '--name', 'Platform Ops'], { BOOTSTRAP_ADMIN_PASSWORD: 'short' });
    const first = run(['--email', PLATFORM.email, '--name', 'Platform Ops'], { BOOTSTRAP_ADMIN_PASSWORD: PLATFORM.password });
    const second = run(['--email', PLATFORM.email, '--name', 'Platform Ops'], { BOOTSTRAP_ADMIN_PASSWORD: 'Different-Password-1' });
    const tok = await tokenOf(PLATFORM.email, PLATFORM.password);
    const ctx = tok ? await api(tok, 'GET', '/api/auth/context') : { body: {} };
    return { pass: weak.status !== 0 && first.status === 0 && second.status === 0 && /password unchanged/.test(second.stdout) && !!tok && ctx.body.roleId === 'platform-admin',
      detail: { weak: weak.status, first: first.status, firstErr: first.stderr.slice(0, 200), second: second.stdout.trim().slice(-80), role: ctx.body.roleId } };
  });

  await t('DEVOS-ACC-PLAT-002', 'Only a platform administrator can provision an organization; its first administrator is invited and lands as org-admin of that organization only', async () => {
    const plat = await tokenOf(PLATFORM.email, PLATFORM.password);
    const denied = await api(admin, 'POST', '/api/admin/orgs', { name: 'Should Fail', adminEmail: 'x@acc.test' });
    const invalid = await api(plat, 'POST', '/api/admin/orgs', { name: 'X', adminEmail: 'not-an-email' });
    const firstAdmin = `founder.${stamp}@acc.test`;
    const created = await api(plat, 'POST', '/api/admin/orgs', { name: `Coastal Builders ${stamp}`, type: 'developer', adminEmail: firstAdmin });
    const duplicate = await api(plat, 'POST', '/api/admin/orgs', { name: `coastal builders ${stamp}`, adminEmail: `other.${stamp}@acc.test` });
    const link = linkIn(lastMailTo(firstAdmin));
    const acc = await apiRequest('POST', '/api/invitations/accept', { body: { token: tokenFromLink(link), password: 'founder-pass-1' } });
    const founder = await tokenOf(firstAdmin, 'founder-pass-1');
    const ctx = await api(founder, 'GET', '/api/auth/context');
    const projects = await api(founder, 'GET', '/api/projects');
    const orgs = await api(plat, 'GET', '/api/admin/orgs');
    const listed = (orgs.body || []).find(o => o.id === created.body.organization.id);
    const platProjects = await api(plat, 'GET', '/api/projects');
    return { pass: denied.status === 403 && invalid.status === 400 && created.status === 201 && duplicate.status === 409 && created.body.invitation.delivery === 'email' && !!link &&
      acc.status === 201 && ctx.body.organizationId === created.body.organization.id && ctx.body.roleId === 'org-admin' && projects.status === 200 && projects.body.length === 0 &&
      listed && listed.users === 1 && platProjects.status === 200 && !(platProjects.body || []).some(p => p.organizationId === 'org1'),
      detail: { denied: denied.status, invalid: invalid.status, created: created.status, duplicate: duplicate.status, accept: acc.status, role: ctx.body.roleId, listed } };
  });

  await t('DEVOS-ACC-STATS-001', 'Platform statistics are computed from live data (no fabricated uptime figure; accounts are real memberships)', async () => {
    const plat = await tokenOf(PLATFORM.email, PLATFORM.password);
    const stats = await api(plat, 'GET', '/api/admin/stats');
    const { rows: [{ n }] } = await withOwner(c => c.query(`SELECT count(DISTINCT user_id)::int AS n FROM memberships WHERE status = 'ACTIVE'`));
    return { pass: stats.status === 200 && !('uptime' in stats.body) && stats.body.totalUsers === n, detail: { totalUsers: stats.body.totalUsers, expected: n, keys: Object.keys(stats.body) } };
  });

  // ── Browser ──────────────────────────────────
  let browser;
  try { browser = await require('playwright').chromium.launch(); } catch (err) {
    results.push({ id: 'DEVOS-ACC-BROWSER', title: 'Headless Chromium available', passed: false, detail: err.message.split('\n')[0] });
    console.log(`  [FAIL] DEVOS-ACC-BROWSER — ${err.message.split('\n')[0]}`);
  }
  if (browser) {
    const csp = []; const pageErrors = [];
    async function newPage() {
      const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
      const page = await context.newPage();
      page.on('console', m => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text().slice(0, 160)); });
      page.on('pageerror', e => pageErrors.push(e.message.slice(0, 160)));
      page.setDefaultTimeout(10000);
      return page;
    }
    const ready = (page, src) => page.waitForFunction(s => new RegExp(s).test(document.getElementById('app').dataset.ready || ''), src);
    async function signIn(page, who) {
      await page.goto(`${BASE}/`);
      await page.waitForSelector('[data-testid=login-form]');
      await page.fill('input[name=email]', who.email);
      await page.fill('input[name=password]', who.password);
      await page.click('[data-testid=login-form] button[type=submit]');
      await ready(page, '^/portfolio$');
    }
    const open = async (page, route) => { await page.goto(`${BASE}/#${route}`); await ready(page, `^${route.replace(/[?]/g, '\\?')}$`); };

    try {
      const page = await newPage();
      await signIn(page, ADMIN);

      await t('DEVOS-ACC-UI-001', 'An administrator invites someone from Team & access, sees the link and delivery, and revokes the pending invitation', async () => {
        await open(page, '/team');
        const email = `ui.invite.${stamp}@acc.test`;
        await page.fill('[data-testid=invite-form] input[name=email]', email);
        await page.selectOption('[data-testid=invite-form] select[name=role]', 'viewer');
        await page.click('[data-testid=invite-form] button[type=submit]');
        await page.waitForSelector('[data-testid=invite-result]');
        const link = await page.textContent('[data-testid=invite-link]');
        const resultText = await page.textContent('[data-testid=invite-result]');
        await page.click('[data-testid=invite-result] [data-action=copy]');
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        const row = page.locator(`[data-testid=invitation-row][data-email="${email}"]`);
        await row.locator('[data-action=revoke-invitation]').click();
        await page.waitForFunction(e => /Revoked/.test(document.querySelector(`[data-testid=invitation-row][data-email="${e}"]`)?.textContent || ''), email);
        return { pass: link.startsWith(`${BASE}/#/accept-invite?token=`) && /email was sent/.test(resultText) && copied === link, detail: { link: link.slice(0, 60), copied: copied === link } };
      });

      await t('DEVOS-ACC-UI-002', 'An administrator changes a member\'s role and deactivates/reactivates them from the members table', async () => {
        const email = `ui.member.${stamp}@acc.test`;
        const m = await inviteAndAccept(email, 'developer', 'ui-member-pass-1');
        // Full reload: the page is already on /team and must pick up the new member.
        await page.goto(`${BASE}/?reload=${Date.now()}#/team`);
        await ready(page, '^/team$');
        await page.selectOption(`[data-testid="role-${email}"]`, 'viewer');
        await page.waitForSelector('.toast:has-text("is now Read-Only Viewer")');
        await page.click(`[data-testid="status-${email}"]`);
        await page.waitForSelector('.toast:has-text("deactivated")');
        const mid = (await api(admin, 'GET', '/api/members')).body.find(x => x.userId === m.userId);
        await page.click(`[data-testid="status-${email}"]`);
        await page.waitForSelector('.toast:has-text("reactivated")');
        const end = (await api(admin, 'GET', '/api/members')).body.find(x => x.userId === m.userId);
        const selfControls = await page.locator(`[data-testid="status-${ADMIN.email}"]`).count();
        return { pass: mid.roleId === 'viewer' && mid.status === 'INACTIVE' && end.status === 'ACTIVE' && selfControls === 0, detail: { mid, end: end.status, selfControls } };
      });

      await t('DEVOS-ACC-UI-003', 'Audit trail lists this organization\'s events with who acted, and verifies the chain from the UI', async () => {
        await open(page, '/audit');
        const rows = await page.locator('[data-testid=audit-row]').count();
        await page.click('[data-testid=verify-audit]');
        await page.waitForSelector('[data-testid=verify-result]');
        const result = await page.textContent('[data-testid=verify-result]');
        return { pass: rows > 0 && /Verified/.test(result), detail: { rows, result: result.trim().slice(0, 120) } };
      });

      await t('DEVOS-ACC-UI-004', 'Forgotten password: request from the sign-in screen, follow the emailed link, set a new password, sign in with it', async () => {
        const email = `ui.forgot.${stamp}@acc.test`;
        await inviteAndAccept(email, 'viewer', 'ui-forgot-old-1');
        const p2 = await newPage();
        await p2.goto(`${BASE}/`);
        await p2.click('[data-testid=forgot-link]');
        await p2.waitForSelector('[data-testid=forgot-form]');
        await p2.fill('[data-testid=forgot-form] input[name=email]', email);
        await p2.click('[data-testid=forgot-form] button[type=submit]');
        await p2.waitForSelector('[data-role=sent]:not([hidden])');
        const link = linkIn(lastMailTo(email));
        await p2.goto(link);
        await p2.waitForSelector('[data-testid=reset-form]');
        await p2.fill('[data-testid=reset-form] input[name=password]', 'ui-forgot-new-2');
        await p2.fill('[data-testid=reset-form] input[name=confirm]', 'ui-forgot-new-2');
        await p2.click('[data-testid=reset-form] button[type=submit]');
        await p2.waitForSelector('.form-notice:has-text("password was updated")');
        await p2.fill('input[name=email]', email);
        await p2.fill('input[name=password]', 'ui-forgot-new-2');
        await p2.click('[data-testid=login-form] button[type=submit]');
        await ready(p2, '^/portfolio$');
        await p2.context().close();
        return { pass: !!link, detail: link };
      });

      await t('DEVOS-ACC-UI-005', 'A platform administrator creates an organization in the UI; the invited first administrator accepts and signs in to the new organization', async () => {
        const p3 = await newPage();
        await signIn(p3, PLATFORM);
        await p3.click('[data-testid=nav-platform]');
        await ready(p3, '^/platform$');
        const orgName = `Harbor Ventures ${stamp}`;
        const founder = `ui.founder.${stamp}@acc.test`;
        await p3.fill('[data-testid=provision-form] input[name=name]', orgName);
        await p3.fill('[data-testid=provision-form] input[name=adminEmail]', founder);
        await p3.click('[data-testid=provision-form] button[type=submit]');
        await p3.waitForSelector('[data-testid=invite-result]');
        const link = await p3.textContent('[data-testid=invite-link]');
        const listed = await p3.locator(`[data-testid=org-row][data-name="${orgName}"]`).count();
        await p3.context().close();
        const p4 = await newPage();
        await p4.goto(link);
        await p4.waitForSelector('[data-testid=accept-form]');
        await p4.fill('input[name=password]', 'ui-founder-pass-1');
        await p4.fill('input[name=confirm]', 'ui-founder-pass-1');
        await p4.click('[data-testid=accept-form] button[type=submit]');
        await p4.waitForSelector('.form-notice');
        await p4.fill('input[name=email]', founder);
        await p4.fill('input[name=password]', 'ui-founder-pass-1');
        await p4.click('[data-testid=login-form] button[type=submit]');
        await ready(p4, '^/portfolio$');
        const org = await p4.textContent('[data-testid=org-name]');
        const role = await p4.textContent('.tb-user-role');
        await p4.context().close();
        return { pass: listed === 1 && org === orgName && /Organization Administrator/.test(role), detail: { listed, org, role } };
      });

      await t('DEVOS-ACC-UI-006', 'Zero CSP violations and zero uncaught page errors across the WP2 run', async () => (
        { pass: csp.length === 0 && pageErrors.length === 0, detail: { csp: csp.slice(0, 3), pageErrors: pageErrors.slice(0, 3) } }
      ));
    } finally {
      await browser.close();
    }
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;
  console.log(`\nDEVOS-ACCESS WP2: ${passedCount} PASSED, ${failedCount} FAILED (Total: ${results.length})`);
  return { passedCount, failedCount, total: results.length, results };
}

module.exports = { runAccessSuite };
