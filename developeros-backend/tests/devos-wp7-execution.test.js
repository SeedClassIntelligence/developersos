// ══════════════════════════════════════════════════════════════
// DEVOS-EXEC — WP7 execution & collaboration write paths
// (API + browser acceptance)
//
// API: sender identity on messages, server-generated ids, validation of
// every execution write, task-dependency integrity at the API and database
// boundaries, derived capital percentages, partner directory, project edits,
// and document storage (type + signature allowlist, size limit, integrity
// hash, safe download headers, tenant isolation, deletion of stored bytes).
// Browser: tasks, contracts, permits, capital, messages, documents, partners
// and project edits operated in the application, cross-checked with the API.
// ══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const { startTestServer, apiRequest, loginAs } = require('./helpers');

const PORT = 3005;
const BASE = `http://127.0.0.1:${PORT}`;
const DEV = { email: 'maria@kgdevelopment.com', password: 'password123' };
const ADMIN = { email: 'admin@developeros.com', password: 'password123' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');

async function withOwner(fn) {
  const c = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

// Raw HTTP upload (the shared helper only sends JSON).
async function upload(token, query, body, contentType) {
  const res = await fetch(`${BASE}/api/documents/upload?${new URLSearchParams(query)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType }, body,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function runExecutionSuite() {
  console.log('\n===============================================================');
  console.log('RUNNING SUITE: DEVOS-EXEC WP7 (execution & collaboration writes)');
  console.log('===============================================================\n');

  const storageDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'devos-docs-'));
  process.env.DOCUMENT_STORAGE_DIR = storageDir;
  await startTestServer(PORT, true);
  const stamp = Date.now();
  const api = (token, method, p, body) => apiRequest(method, p, { headers: { Authorization: `Bearer ${token}` }, body });
  const dev = (await loginAs(DEV.email)).token;
  const admin = (await loginAs(ADMIN.email)).token;
  const { rows: [devUser] } = await withOwner(c => c.query('SELECT id, name FROM users WHERE email = $1', [DEV.email]));

  // Workbench project in org1, and a second tenant with its own project.
  const wb = (await api(admin, 'POST', '/api/projects', { name: `WP7 Workbench ${stamp}`, type: 'Mixed Income', units: 80, budget: 30000000 })).body;
  await withOwner(async c => {
    await c.query(`INSERT INTO organizations (id, name) VALUES ('wp7-beta', 'WP7 Beta')`);
    await c.query(`INSERT INTO projects (id, organization_id, name, type) VALUES ('wp7-b-p1', 'wp7-beta', 'Beta Project', 'Market Rate')`);
    await c.query(`INSERT INTO tasks (id, project_id, title, status) VALUES ('wp7-b-t1', 'wp7-b-p1', 'Beta task', 'not-started')`);
    await c.query(`INSERT INTO users (id, org_id, name, email, password_hash, role, active)
      SELECT 'wp7-b-u1', 'wp7-beta', 'Beta Dev', 'beta.dev@wp7.test', password_hash, 'user', TRUE FROM users WHERE email = $1`, [DEV.email]);
    await c.query(`INSERT INTO memberships (id, user_id, organization_id, role_id, status) VALUES ('wp7-b-m1', 'wp7-b-u1', 'wp7-beta', 'developer', 'ACTIVE')`);
  });
  const beta = (await loginAs('beta.dev@wp7.test')).token;
  const viewerEmail = `viewer.${stamp}@wp7.test`;
  const inv = await api(admin, 'POST', '/api/invitations', { email: viewerEmail, role: 'viewer' });
  await apiRequest('POST', '/api/invitations/accept', { body: { token: inv.body.token, password: 'viewer-pass-1' } });
  const viewer = (await loginAs(viewerEmail, 'viewer-pass-1')).token;

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
  await t('DEVOS-EXEC-MSG-001', 'Messages are attributed to the signed-in member; sender fields in the request are ignored', async () => {
    const r = await api(dev, 'POST', '/api/messages/channels/ch1/messages', { text: 'Who sent this?', senderName: 'Platform Administrator', senderInitials: 'PA', role: 'org-admin', senderColor: '#000000' });
    const { rows: [row] } = await withOwner(c => c.query('SELECT sender_user_id, sender_name FROM messages WHERE id = $1', [r.body.id]));
    const empty = await api(dev, 'POST', '/api/messages/channels/ch1/messages', { text: '   ' });
    return { pass: r.status === 201 && r.body.senderName === devUser.name && r.body.senderInitials === 'MR' && /Developer/.test(r.body.role) && row.sender_user_id === devUser.id && empty.status === 400,
      detail: { status: r.status, sender: r.body.senderName, role: r.body.role, stored: row, empty: empty.status } };
  });

  await t('DEVOS-EXEC-VAL-001', 'Task writes are validated (title, status, due date) and ids are always server-generated', async () => {
    const statuses = {
      noTitle: (await api(dev, 'POST', '/api/tasks', { projectId: wb.id })).status,
      badStatus: (await api(dev, 'POST', '/api/tasks', { projectId: wb.id, title: 'x', status: 'done-ish' })).status,
      badDate: (await api(dev, 'POST', '/api/tasks', { projectId: wb.id, title: 'x', dueDate: '31/12/2025' })).status,
    };
    const ok = await api(dev, 'POST', '/api/tasks', { id: 't-chosen-by-client', projectId: wb.id, title: 'Grading plan', dueDate: '2026-12-01' });
    const emptyTitle = await api(dev, 'PUT', `/api/tasks/${ok.body.id}`, { title: '  ' });
    return { pass: Object.values(statuses).every(s => s === 400) && ok.status === 201 && ok.body.id !== 't-chosen-by-client' && ok.body.dueDate === '2026-12-01' && emptyTitle.status === 400,
      detail: { statuses, created: ok.body && ok.body.id, emptyTitle: emptyTitle.status } };
  });

  await t('DEVOS-EXEC-VAL-002', 'Contract, permit, correction, capital and project writes reject invalid values', async () => {
    const pm = (await api(dev, 'POST', '/api/permits', { projectId: wb.id, name: 'Grading Permit' })).body;
    const s = {
      contractNoType: (await api(dev, 'POST', '/api/contracts', { projectId: wb.id, status: 'pending' })).status,
      contractBadStatus: (await api(dev, 'POST', '/api/contracts', { projectId: wb.id, type: 'Survey', status: 'signed-maybe' })).status,
      contractNegative: (await api(dev, 'POST', '/api/contracts', { projectId: wb.id, type: 'Survey', value: -5 })).status,
      permitNoName: (await api(dev, 'POST', '/api/permits', { projectId: wb.id })).status,
      permitBadStatus: (await api(dev, 'PATCH', `/api/permits/${pm.id}/status`, { status: 'lost' })).status,
      permitMissingStatus: (await api(dev, 'PATCH', `/api/permits/${pm.id}/status`, {})).status,
      correctionNoText: (await api(dev, 'POST', `/api/permits/${pm.id}/corrections`, { text: '' })).status,
      capitalBadAmount: (await api(dev, 'PUT', `/api/capital/${wb.id}`, { totalCost: 100, sources: [{ name: 'Loan', type: 'debt', amount: 'lots' }] })).status,
      capitalBadColor: (await api(dev, 'PUT', `/api/capital/${wb.id}`, { totalCost: 100, sources: [{ name: 'Loan', type: 'debt', amount: 10, color: 'url(x)' }] })).status,
      projectProgress: (await api(dev, 'PUT', `/api/projects/${wb.id}`, { progress: 150 })).status,
      projectAffordable: (await api(dev, 'PUT', `/api/projects/${wb.id}`, { units: 10, affordableUnits: 20 })).status,
    };
    const okCorrection = await api(dev, 'POST', `/api/permits/${pm.id}/corrections`, { text: 'Show drainage swale' });
    return { pass: Object.values(s).every(x => x === 400) && pm.status === 'draft' && okCorrection.status === 201 && okCorrection.body.status === 'not-started', detail: { s, okCorrection: okCorrection.status } };
  });

  await t('DEVOS-EXEC-DEP-001', 'Task dependencies stay within one project: refused at the API (other project, other tenant, self) and in the database', async () => {
    const a = (await api(dev, 'POST', '/api/tasks', { projectId: wb.id, title: 'Dep A' })).body;
    const b = (await api(dev, 'POST', '/api/tasks', { projectId: wb.id, title: 'Dep B', deps: [a.id] })).body;
    const otherProject = await api(dev, 'PUT', `/api/tasks/${b.id}`, { deps: ['t1'] });
    const otherTenant = await api(dev, 'PUT', `/api/tasks/${b.id}`, { deps: ['wp7-b-t1'] });
    const self = await api(dev, 'PUT', `/api/tasks/${b.id}`, { deps: [b.id] });
    const db = await withOwner(async c => {
      try { await c.query(`INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ($1, 'wp7-b-t1')`, [b.id]); return 'ACCEPTED'; } catch (e) { return e.code; }
    });
    const still = (await api(dev, 'GET', `/api/tasks/${b.id}`)).body;
    return { pass: b.deps && b.deps[0] === a.id && otherProject.status === 400 && otherTenant.status === 400 && self.status === 400 && db === '23514' && JSON.stringify(still.deps) === JSON.stringify([a.id]),
      detail: { created: b.deps, otherProject: otherProject.status, otherTenant: otherTenant.status, self: self.status, db, still: still.deps } };
  });

  await t('DEVOS-EXEC-CAP-001', 'Capital: source shares are derived from amounts (client pct and ids ignored); the stack round-trips', async () => {
    const r = await api(dev, 'PUT', `/api/capital/${wb.id}`, { totalCost: 30000000, sources: [
      { id: 'cap1', name: 'Senior Loan', type: 'debt', amount: 18000000, status: 'committed', pct: 99 },
      { name: 'LIHTC Equity', type: 'tax-credit', amount: 9000000, status: 'pending', deadline: '2027-03-01' },
    ] });
    const back = (await api(dev, 'GET', `/api/capital/${wb.id}`)).body;
    const loan = back.sources.find(s => s.name === 'Senior Loan');
    const fixtureSource = (await api(dev, 'GET', '/api/capital/p1')).body.sources.find(s => s.id === 'cap1');
    return { pass: r.status === 200 && loan.pct === 60 && loan.id !== 'cap1' && back.sources.length === 2 && back.totalCost === 30000000 && !!fixtureSource,
      detail: { status: r.status, loan, fixtureIntact: !!fixtureSource } };
  });

  await t('DEVOS-EXEC-PART-001', 'Partners: developers add and edit their organization\'s partners; viewers cannot; other tenants\' partners are not found', async () => {
    const created = await api(dev, 'POST', '/api/partners', { name: 'Pacific Geotech', role: 'geotechnical' });
    const badRole = await api(dev, 'POST', '/api/partners', { name: 'X', role: 'wizard' });
    const byViewer = await api(viewer, 'POST', '/api/partners', { name: 'Viewer Co', role: 'other' });
    const renamed = await api(dev, 'PATCH', `/api/partners/${created.body.id}`, { name: 'Pacific Geotechnical Inc.' });
    const foreign = await api(beta, 'PATCH', `/api/partners/${created.body.id}`, { name: 'hijack' });
    const assign = await api(dev, 'POST', '/api/tasks', { projectId: wb.id, title: 'Geotech report', partnerId: created.body.id });
    const betaList = (await api(beta, 'GET', '/api/partners')).body;
    return { pass: created.status === 201 && created.body.initials === 'PG' && badRole.status === 400 && byViewer.status === 403 && renamed.body.name === 'Pacific Geotechnical Inc.' &&
      foreign.status === 404 && assign.status === 201 && !betaList.some(p => p.id === created.body.id),
      detail: { created: created.status, badRole: badRole.status, byViewer: byViewer.status, foreign: foreign.status, assign: assign.status } };
  });

  const docQuery = (extra = {}) => ({ projectId: wb.id, name: 'Site plan', category: 'plans', filename: 'site-plan.pdf', ...extra });
  await t('DEVOS-EXEC-DOC-001', 'Upload stores the file with its SHA-256; download returns the same bytes as an attachment with nosniff and a sandbox CSP', async () => {
    const up = await upload(dev, docQuery(), PDF, 'application/pdf');
    const res = await fetch(`${BASE}/api/documents/${up.body.id}/download`, { headers: { Authorization: `Bearer ${dev}` } });
    const bytes = Buffer.from(await res.arrayBuffer());
    const sha = crypto.createHash('sha256').update(PDF).digest('hex');
    const h = Object.fromEntries(['content-type', 'content-disposition', 'x-content-type-options', 'content-security-policy', 'x-document-sha256'].map(k => [k, res.headers.get(k)]));
    const listed = (await api(dev, 'GET', `/api/documents?projectId=${wb.id}`)).body.find(d => d.id === up.body.id);
    return { pass: up.status === 201 && up.body.hasFile && up.body.sha256 === sha && up.body.uploadedBy === devUser.name && res.status === 200 && bytes.equals(PDF) &&
      h['content-type'] === 'application/pdf' && /^attachment;/.test(h['content-disposition']) && h['x-content-type-options'] === 'nosniff' &&
      /sandbox/.test(h['content-security-policy']) && h['x-document-sha256'] === sha && listed && listed.sizeBytes === PDF.length,
      detail: { up: up.status, download: res.status, headers: h } };
  });

  await t('DEVOS-EXEC-DOC-002', 'Only allowlisted types with matching content are stored; empty and oversized files are refused; nothing is left on disk', async () => {
    const listFiles = () => fs.readdirSync(storageDir, { recursive: true }).filter(f => !fs.statSync(path.join(storageDir, f)).isDirectory());
    const beforeFiles = listFiles();
    const before = beforeFiles.length;
    const s = {
      html: (await upload(dev, docQuery(), Buffer.from('<script>alert(1)</script>'), 'text/html')).status,
      svg: (await upload(dev, docQuery(), Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml')).status,
      disguised: (await upload(dev, docQuery(), Buffer.from('<html><script>alert(1)</script></html>'), 'application/pdf')).status,
      empty: (await upload(dev, docQuery(), Buffer.alloc(0), 'application/pdf')).status,
      badCategory: (await upload(dev, docQuery({ category: 'secret' }), PDF, 'application/pdf')).status,
      noName: (await upload(dev, docQuery({ name: '' }), PDF, 'application/pdf')).status,
    };
    process.env.DOCUMENT_MAX_BYTES = '1024';
    s.tooLarge = (await upload(dev, docQuery(), Buffer.concat([PDF, Buffer.alloc(4096, 0x20)]), 'application/pdf')).status;
    delete process.env.DOCUMENT_MAX_BYTES;
    const afterFiles = listFiles();
    const after = afterFiles.length;
    return { pass: s.html === 415 && s.svg === 415 && s.disguised === 415 && s.empty === 400 && s.badCategory === 400 && s.noName === 400 && s.tooLarge === 413 && after === before,
      detail: { s, filesBefore: before, filesAfter: after, newFiles: afterFiles.filter(f => !beforeFiles.includes(f)) } };
  });

  await t('DEVOS-EXEC-DOC-003', 'Documents are tenant-isolated and permissioned; deleting a document removes its stored bytes', async () => {
    const up = await upload(dev, docQuery({ name: 'Survey', filename: 'survey.pdf' }), PDF, 'application/pdf');
    const foreignDownload = await fetch(`${BASE}/api/documents/${up.body.id}/download`, { headers: { Authorization: `Bearer ${beta}` } });
    const foreignUpload = await upload(beta, docQuery(), PDF, 'application/pdf');
    const viewerUpload = await upload(viewer, docQuery(), PDF, 'application/pdf');
    const viewerDownload = await fetch(`${BASE}/api/documents/${up.body.id}/download`, { headers: { Authorization: `Bearer ${viewer}` } });
    const key = path.join(storageDir, 'org1', wb.id, up.body.id);
    const existed = fs.existsSync(key);
    const del = await api(dev, 'DELETE', `/api/documents/${up.body.id}`);
    const gone = !fs.existsSync(key);
    const afterDelete = await fetch(`${BASE}/api/documents/${up.body.id}/download`, { headers: { Authorization: `Bearer ${dev}` } });
    const registerOnly = await fetch(`${BASE}/api/documents/d1/download`, { headers: { Authorization: `Bearer ${dev}` } });
    return { pass: foreignDownload.status === 404 && foreignUpload.status === 404 && viewerUpload.status === 403 && viewerDownload.status === 200 &&
      existed && del.status === 200 && gone && afterDelete.status === 404 && registerOnly.status === 404,
      detail: { foreignDownload: foreignDownload.status, foreignUpload: foreignUpload.status, viewerUpload: viewerUpload.status, existed, gone, registerOnly: registerOnly.status } };
  });

  // ── Browser ──────────────────────────────────
  let browser;
  try { browser = await require('./browser').launchChromium(); } catch (err) {
    results.push({ id: 'DEVOS-EXEC-BROWSER', title: 'Headless Chromium available', passed: false, detail: err.message.split('\n')[0] });
    console.log(`  [FAIL] DEVOS-EXEC-BROWSER — ${err.message.split('\n')[0]}`);
  }
  if (browser) {
    const csp = []; const pageErrors = [];
    async function newPage() {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
      const page = await ctx.newPage();
      page.on('console', m => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text().slice(0, 160)); });
      page.on('pageerror', e => pageErrors.push(e.message.slice(0, 160)));
      page.on('dialog', d => d.accept());
      page.setDefaultTimeout(10000);
      return page;
    }
    const ready = (page, src) => page.waitForFunction(s => new RegExp(s).test(document.getElementById('app').dataset.ready || ''), src);
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Navigates to a route and waits for it to render; re-renders when already there (fresh data).
    const open = async (page, route) => {
      const target = `${BASE}/#${route}`;
      if (page.url() === target) await page.reload();
      else await page.goto(target);
      await ready(page, `^${esc(route)}$`);
    };
    async function signIn(page, who) {
      await page.goto(`${BASE}/`);
      await page.waitForSelector('[data-testid=login-form]');
      await page.fill('input[name=email]', who.email);
      await page.fill('input[name=password]', who.password);
      await page.click('[data-testid=login-form] button[type=submit]');
      await ready(page, '^/portfolio$');
    }
    const P = route => `/projects/${wb.id}${route}`;
    const S = {};

    try {
      const page = await newPage();
      await signIn(page, DEV);

      await t('DEVOS-EXEC-UI-001', 'Tasks: create, assign partner and dependency, move through statuses and delete — all from the board', async () => {
        await open(page, P('/tasks?task=new'));
        await page.fill('[data-testid=task-form] input[name=title]', 'Foundation design');
        await page.selectOption('[data-testid=task-form] select[name=discipline]', 'structural');
        await page.fill('[data-testid=task-form] input[name=dueDate]', '2026-12-15');
        await page.click('[data-testid=task-form] button[type=submit]');
        await page.waitForSelector('[data-testid=task-card]:has-text("Foundation design")');
        const created = (await api(dev, 'GET', `/api/tasks?projectId=${wb.id}`)).body.find(x => x.title === 'Foundation design');
        S.taskId = created.id;
        await open(page, P(`/tasks?task=${created.id}`));
        const geotech = (await api(dev, 'GET', '/api/partners')).body.find(p => p.name === 'Pacific Geotechnical Inc.');
        await page.selectOption('[data-testid=task-form] select[name=partnerId]', geotech.id);
        await page.check(`[data-testid=task-form] input[name=deps] >> nth=0`);
        await page.click('[data-testid=task-form] button[type=submit]');
        await ready(page, `^${esc(P('/tasks'))}$`);
        await open(page, P(`/tasks?task=${created.id}`));
        await page.click('[data-testid=task-status-blocked]');
        await page.waitForSelector('[data-column=blocked] [data-testid=task-card]:has-text("Foundation design")');
        const saved = (await api(dev, 'GET', `/api/tasks/${created.id}`)).body;
        const throwaway = (await api(dev, 'POST', '/api/tasks', { projectId: wb.id, title: 'Throwaway task' })).body;
        await open(page, P(`/tasks?task=${throwaway.id}`));
        await page.click('[data-testid=task-form] [data-action=task-delete]');
        await ready(page, `^${esc(P('/tasks'))}$`);
        const deleted = (await api(dev, 'GET', `/api/tasks/${throwaway.id}`)).status;
        return { pass: created.discipline === 'structural' && created.dueDate === '2026-12-15' && saved.partnerId === geotech.id && saved.deps.length === 1 && saved.status === 'blocked' && deleted === 404,
          detail: { saved: { partner: saved.partnerId, deps: saved.deps, status: saved.status }, deleted } };
      });

      await t('DEVOS-EXEC-UI-002', 'Contracts: add with value, link to a blocked task, execute (task unblocks), edit and delete', async () => {
        await open(page, P('/contracts'));
        await page.fill('[data-testid=contract-create] input[name=type]', 'Structural Engineering Services');
        await page.fill('[data-testid=contract-create] input[name=value]', '$185,000');
        await page.click('[data-testid=contract-create] button[type=submit]');
        await page.waitForSelector('[data-testid=contract-row][data-type="Structural Engineering Services"]');
        const c = (await api(dev, 'GET', `/api/contracts?projectId=${wb.id}`)).body.find(x => x.type === 'Structural Engineering Services');
        await api(dev, 'PUT', `/api/tasks/${S.taskId}`, { contractId: c.id, status: 'blocked' });
        await open(page, P('/contracts'));
        await page.click(`[data-testid=contract-row][data-type="Structural Engineering Services"] [data-testid=execute-contract]`);
        await page.waitForSelector('.toast:has-text("Contract executed")');
        const executed = (await api(dev, 'GET', `/api/contracts/${c.id}`)).body;
        const task = (await api(dev, 'GET', `/api/tasks/${S.taskId}`)).body;
        await open(page, P(`/contracts?edit=${c.id}`));
        await page.fill('[data-testid=contract-update] input[name=value]', '190000');
        await page.click('[data-testid=contract-update] button[type=submit]');
        await ready(page, `^${esc(P('/contracts'))}$`);
        const edited = (await api(dev, 'GET', `/api/contracts/${c.id}`)).body;
        const spare = (await api(dev, 'POST', '/api/contracts', { projectId: wb.id, type: 'Spare Contract' })).body;
        await open(page, P('/contracts'));
        await page.click(`[data-testid=contract-row][data-type="Spare Contract"] [data-action=contract-delete]`);
        await page.waitForSelector('.toast:has-text("Contract deleted")');
        const deleted = (await api(dev, 'GET', `/api/contracts/${spare.id}`)).status;
        return { pass: c.value === 185000 && executed.status === 'executed' && !!executed.executedDate && task.status === 'not-started' && edited.value === 190000 && deleted === 404,
          detail: { value: c.value, executed: executed.status, taskAfterExecute: task.status, edited: edited.value, deleted } };
      });

      await t('DEVOS-EXEC-UI-003', 'Permits: add a permit, change its status, add a correction item and complete it', async () => {
        await open(page, P('/permits'));
        await page.click('summary:has-text("+ Add permit")').catch(() => {});
        await page.fill('[data-testid=permit-form] input[name=name]', 'Building Permit');
        await page.fill('[data-testid=permit-form] input[name=jurisdiction]', 'City of Long Beach');
        await page.click('[data-testid=permit-form] button[type=submit]');
        await page.waitForSelector('[data-testid=permit-row][data-name="Building Permit"]');
        await page.selectOption('[data-testid=permit-row][data-name="Building Permit"] [data-testid=permit-status]', 'corrections');
        await page.waitForSelector('.toast:has-text("Corrections Open")');
        const f = page.locator('[data-testid=permit-row][data-name="Building Permit"] form[data-form=correction-add]');
        await f.locator('input[name=text]').fill('Revise fire access plan');
        await f.locator('button[type=submit]').click();
        await page.waitForSelector('[data-testid=permit-row][data-name="Building Permit"] .corrections li:has-text("Revise fire access plan")');
        await page.selectOption('[data-testid=permit-row][data-name="Building Permit"] [data-change=correction-status]', 'complete');
        await page.waitForSelector('.toast:has-text("Correction updated")');
        const permit = (await api(dev, 'GET', `/api/permits?projectId=${wb.id}`)).body.find(p => p.name === 'Building Permit');
        return { pass: permit.status === 'corrections' && permit.jurisdiction === 'City of Long Beach' && permit.corrections.length === 1 && permit.corrections[0].status === 'complete',
          detail: permit };
      });

      await t('DEVOS-EXEC-UI-004', 'Capital: add and remove sources in the editor; the funding gap reflects the saved stack', async () => {
        await open(page, P('/capital?edit=1'));
        const lihtc = page.locator('[data-source-row]').filter({ has: page.locator('input[name^=name-][value="LIHTC Equity"]') });
        await lihtc.locator('[data-action=source-remove]').click();
        await page.click('[data-testid=add-source]');
        const last = page.locator('[data-source-row]').last();
        await last.locator('input[name^=name-]').fill('City Gap Loan');
        await last.locator('input[name^=amount-]').fill('2,500,000');
        await last.locator('select[name^=status-]').selectOption('committed');
        await page.click('[data-testid=capital-form] button[type=submit]');
        await ready(page, `^${esc(P('/capital'))}$`);
        const gapText = await page.textContent('[data-testid=funding-gap]');
        const stack = (await api(dev, 'GET', `/api/capital/${wb.id}`)).body;
        return { pass: stack.sources.map(s => s.name).join() === 'Senior Loan,City Gap Loan' && stack.sources[1].amount === 2500000 && /9,500,000 short/.test(gapText),
          detail: { sources: stack.sources.map(s => [s.name, s.amount]), gapText: gapText.trim() } };
      });

      await t('DEVOS-EXEC-UI-005', 'Messages: create a channel and post to it; the message is attributed to the signed-in member', async () => {
        await open(page, P('/messages'));
        await page.fill('[data-testid=channel-form] input[name=name]', 'structural-review');
        await page.click('[data-testid=channel-form] button[type=submit]');
        await page.waitForSelector('.msg-ch-name:has-text("structural-review")');
        await page.fill('[data-testid=message-form] textarea', 'Rev B foundation drawings are ready for review.');
        await page.click('[data-testid=message-form] button[type=submit]');
        await page.waitForSelector('[data-testid=message]:has-text("Rev B foundation drawings")');
        const sender = await page.textContent('[data-testid=message]:has-text("Rev B foundation drawings") .msg-name');
        return { pass: sender === devUser.name, detail: sender };
      });

      await t('DEVOS-EXEC-UI-006', 'Documents: upload a PDF, download identical bytes, see a refused type explained, delete', async () => {
        await open(page, P('/documents'));
        await page.setInputFiles('[data-testid=upload-file]', { name: 'geotech-report.pdf', mimeType: 'application/pdf', buffer: PDF });
        await page.selectOption('[data-testid=upload-form] select[name=category]', 'reports');
        await page.click('[data-testid=upload-form] button[type=submit]');
        await page.waitForSelector('[data-testid=document-row][data-name="geotech-report"]');
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=document-row][data-name="geotech-report"] [data-testid=download]')]);
        const bytes = fs.readFileSync(await dl.path());
        await page.setInputFiles('[data-testid=upload-file]', { name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<h1>x</h1>') });
        await page.click('[data-testid=upload-form] button[type=submit]');
        await page.waitForSelector('[data-testid=upload-form] [data-role=form-error]:not([hidden])');
        const refusal = await page.textContent('[data-testid=upload-form] [data-role=form-error]');
        await page.click('[data-testid=document-row][data-name="geotech-report"] [data-action=document-delete]');
        await page.waitForSelector('.toast:has-text("Document deleted")');
        const remaining = (await api(dev, 'GET', `/api/documents?projectId=${wb.id}`)).body.filter(d => d.name === 'geotech-report').length;
        return { pass: bytes.equals(PDF) && dl.suggestedFilename() === 'geotech-report.pdf' && /not accepted/.test(refusal) && remaining === 0,
          detail: { filename: dl.suggestedFilename(), same: bytes.equals(PDF), refusal, remaining } };
      });

      await t('DEVOS-EXEC-UI-007', 'Partners page adds a partner; the project profile (phase, status, progress) is edited from its overview', async () => {
        await open(page, '/partners');
        await page.fill('[data-testid=partner-form] input[name=name]', 'Harbor Survey Group');
        await page.selectOption('[data-testid=partner-form] select[name=role]', 'survey');
        await page.click('[data-testid=partner-form] button[type=submit]');
        await page.waitForSelector('[data-testid=partner-row][data-name="Harbor Survey Group"]');
        await open(page, P('?edit=1'));
        await page.selectOption('[data-testid=project-form] select[name=phase]', '3');
        await page.selectOption('[data-testid=project-form] select[name=status]', 'at-risk');
        await page.fill('[data-testid=project-form] input[name=progress]', '35');
        await page.click('[data-testid=project-form] button[type=submit]');
        await ready(page, `^${esc(P(''))}$`);
        const p = (await api(dev, 'GET', `/api/projects/${wb.id}`)).body;
        const partner = (await api(dev, 'GET', '/api/partners')).body.find(x => x.name === 'Harbor Survey Group');
        return { pass: !!partner && partner.role === 'survey' && p.phase === 3 && p.phaseLabel === 'Design Development' && p.status === 'at-risk' && p.progress === 35,
          detail: { partner, project: { phase: p.phase, label: p.phaseLabel, status: p.status, progress: p.progress } } };
      });

      await t('DEVOS-EXEC-UI-008', 'A viewer sees execution data but no create, edit, status, upload or delete controls', async () => {
        const v = await newPage();
        await signIn(v, { email: viewerEmail, password: 'viewer-pass-1' });
        const counts = {};
        await open(v, P('/tasks'));
        counts.newTask = await v.locator('[data-testid=new-task]').count();
        counts.cards = await v.locator('[data-testid=task-card]').count();
        await open(v, P(`/tasks?task=${S.taskId}`));
        counts.taskForm = await v.locator('[data-testid=task-form]').count();
        counts.statusButtons = await v.locator('[data-action=task-status]').count();
        await open(v, P('/contracts'));
        counts.contractActions = await v.locator('[data-action^=contract-], [data-testid=execute-contract], [data-testid=contract-create]').count();
        await open(v, P('/permits'));
        counts.permitControls = await v.locator('[data-testid=permit-status], [data-testid=permit-form], form[data-form=correction-add]').count();
        await open(v, P('/capital'));
        counts.editCapital = await v.locator('[data-testid=edit-capital]').count();
        await open(v, P('/messages'));
        counts.composer = await v.locator('[data-testid=message-form], [data-testid=channel-form]').count();
        await open(v, P('/documents'));
        counts.upload = await v.locator('[data-testid=upload-form], [data-action=document-delete]').count();
        await open(v, '/partners');
        counts.partnerForm = await v.locator('[data-testid=partner-form]').count();
        await open(v, P(''));
        counts.editProject = await v.locator('[data-testid=edit-project]').count();
        await v.context().close();
        const { cards, ...controls } = counts;
        return { pass: cards > 0 && Object.values(controls).every(n => n === 0), detail: counts };
      });

      await t('DEVOS-EXEC-UI-009', 'Zero CSP violations and zero uncaught page errors across the WP7 run', async () => (
        { pass: csp.length === 0 && pageErrors.length === 0, detail: { csp: csp.slice(0, 3), pageErrors: pageErrors.slice(0, 3) } }
      ));
    } finally {
      await browser.close();
    }
  }

  fs.rmSync(storageDir, { recursive: true, force: true });
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;
  console.log(`\nDEVOS-EXEC WP7: ${passedCount} PASSED, ${failedCount} FAILED (Total: ${results.length})`);
  return { passedCount, failedCount, total: results.length, results };
}

module.exports = { runExecutionSuite };
