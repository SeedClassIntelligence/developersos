// ══════════════════════════════════════════════════════════════
// DEVOS-UI — WP3 Development Intelligence screens (browser acceptance)
//
// Workflow stages 1–4 operated entirely through the application:
// relationship sourcing → property → opportunity → site intelligence →
// readiness → lifecycle, plus findings, read-only access and tenant
// isolation. The API (DI-1, frozen) is the system of record; every UI
// claim is cross-checked against it.
// ══════════════════════════════════════════════════════════════

const { Client } = require('pg');
const { startTestServer, apiRequest, loginAs } = require('./helpers');

const PORT = 3005;
const BASE = `http://127.0.0.1:${PORT}`;
const DEV = { email: 'maria@kgdevelopment.com', password: 'password123' };
const ADMIN = { email: 'admin@developeros.com', password: 'password123' };
// Set DEVOS_UI_SHOTS=<dir> to save screenshots of each workflow stage (evidence/review).
const SHOTS = process.env.DEVOS_UI_SHOTS;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

async function withOwner(fn) {
  const c = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function runUIWP3Suite() {
  console.log('\n===============================================================');
  console.log('RUNNING SUITE: DEVOS-UI WP3 DEVELOPMENT INTELLIGENCE (browser)');
  console.log('===============================================================\n');

  await startTestServer(PORT, true);
  const stamp = Date.now();
  const adminToken = (await loginAs(ADMIN.email)).token;
  const devToken = (await loginAs(DEV.email)).token;
  const api = (token, method, path, body) => apiRequest(method, path, { headers: { Authorization: `Bearer ${token}` }, body });

  // A read-only member of org1 and a second tenant the admin can switch into.
  const viewerEmail = `viewer.${stamp}@ui-wp3.test`;
  const inv = await api(adminToken, 'POST', '/api/invitations', { email: viewerEmail, role: 'viewer' });
  await apiRequest('POST', '/api/invitations/accept', { body: { token: inv.body.token, password: 'viewer-pass-1' } });
  await withOwner(async c => {
    await c.query(`INSERT INTO organizations (id, name, type, plan) VALUES ('ui3-beta', 'UI3 Beta Holdings', 'developer', 'enterprise') ON CONFLICT DO NOTHING`);
    await c.query(`INSERT INTO memberships (id, user_id, organization_id, role_id, status)
      SELECT 'ui3-m-admin-beta', id, 'ui3-beta', 'developer', 'ACTIVE' FROM users WHERE email = $1 ON CONFLICT DO NOTHING`, [ADMIN.email]);
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

  let browser;
  try {
    browser = await require('playwright').chromium.launch();
  } catch (err) {
    results.push({ id: 'DEVOS-UI3-BROWSER', title: 'Headless Chromium available', passed: false, detail: err.message.split('\n')[0] });
    console.log(`  [FAIL] DEVOS-UI3-BROWSER — ${err.message.split('\n')[0]}`);
  }

  if (browser) {
    const cspViolations = [];
    const pageErrors = [];
    async function newPage() {
      const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
      const page = await context.newPage();
      page.on('console', m => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text().slice(0, 160)); });
      page.on('pageerror', e => pageErrors.push(e.message.slice(0, 160)));
      page.setDefaultTimeout(10000);
      return page;
    }
    const ready = (page, matcher) => page.waitForFunction(src => new RegExp(src).test(document.getElementById('app').dataset.ready || ''), matcher.source || matcher);
    async function open(page, route) {
      await page.goto(`${BASE}/#${route}`);
      const p = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await ready(page, `^${p}$`);
    }
    async function signIn(page, who) {
      await page.goto(`${BASE}/`);
      await page.waitForSelector('[data-testid=login-form]');
      await page.fill('input[name=email]', who.email);
      await page.fill('input[name=password]', who.password);
      await page.click('[data-testid=login-form] button[type=submit]');
      await ready(page, '^/portfolio$');
    }
    const shot = async (page, name) => { if (SHOTS) { require('fs').mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); } };
    const formError = async page => (await page.locator('[data-role=form-error]:not([hidden])').first().textContent().catch(() => '')) || '';
    const S = {};

    try {
      const page = await newPage();
      await signIn(page, DEV);

      await t('DEVOS-UI3-NAV-001', 'Development Intelligence is reachable from the navigation for a developer', async () => {
        const items = ['nav-pipeline', 'nav-properties', 'nav-relationships', 'nav-findings'];
        const visible = [];
        for (const i of items) if (await page.isVisible(`[data-testid=${i}]`)) visible.push(i);
        await page.click('[data-testid=nav-pipeline]');
        await ready(page, '^/intelligence/opportunities$');
        return { pass: visible.length === items.length, detail: visible };
      });

      await t('DEVOS-UI3-REL-001', 'Stage 1 — a developer records a sourcing relationship with provenance', async () => {
        await open(page, '/intelligence/relationships');
        S.relName = `Harbor Brokerage ${stamp}`;
        await page.fill('[data-testid=relationship-form] input[name=name]', S.relName);
        await page.fill('[data-testid=relationship-form] input[name=relationshipType]', 'broker');
        await page.selectOption('[data-testid=relationship-form] select[name=sourceType]', 'DOCUMENT');
        await page.fill('[data-testid=relationship-form] input[name=sourceReference]', 'Broker engagement letter');
        await page.click('[data-testid=relationship-form] button[type=submit]');
        await page.waitForSelector(`[data-testid=relationship-row]:has-text("${S.relName}")`);
        const list = (await api(devToken, 'GET', '/api/di/relationships')).body;
        const rel = list.find(r => r.name === S.relName);
        S.relId = rel && rel.id;
        return { pass: !!rel && rel.relationshipType === 'broker' && rel.provenance.sourceType === 'DOCUMENT' && rel.provenance.sourceReference === 'Broker engagement letter', detail: rel };
      });

      await t('DEVOS-UI3-PROP-001', 'Stage 2 — a developer records a property with address, APN and provenance, and lands on its page', async () => {
        await open(page, '/intelligence/properties/new');
        S.propName = `1200 Harbor Blvd ${stamp}`;
        const f = '[data-testid=property-create]';
        await page.fill(`${f} input[name=name]`, S.propName);
        await page.fill(`${f} input[name=street]`, '1200 Harbor Blvd');
        await page.fill(`${f} input[name=city]`, 'Long Beach');
        await page.fill(`${f} input[name=region]`, 'CA');
        await page.fill(`${f} input[name=apn]`, '7280-012-034');
        await page.selectOption(`${f} select[name=sourceType]`, 'PUBLIC_RECORD');
        await page.fill(`${f} input[name=sourceReference]`, 'LA County assessor');
        await page.click(`${f} button[type=submit]`);
        await ready(page, `^/intelligence/properties/${UUID}$`);
        S.propId = (await page.evaluate(() => document.getElementById('app').dataset.ready)).split('/').pop();
        const heading = await page.textContent('#app h1');
        const p = (await api(devToken, 'GET', `/api/di/properties/${S.propId}`)).body;
        return { pass: heading === S.propName && p.address.city === 'Long Beach' && p.apn === '7280-012-034' && p.provenance.sourceType === 'PUBLIC_RECORD', detail: { heading, address: p.address, apn: p.apn } };
      });

      await t('DEVOS-UI3-OPP-001', 'Stage 3 — an opportunity is opened on the property, linked to the relationship, and starts in New with readiness reported', async () => {
        await page.click('a:has-text("+ Opportunity on this site")');
        await ready(page, '^/intelligence/opportunities/new\\?propertyId=');
        const f = '[data-testid=opportunity-create]';
        S.oppName = `Harbor Blvd Family Housing ${stamp}`;
        const preselected = await page.inputValue(`${f} select[name=propertyId]`);
        await page.fill(`${f} input[name=name]`, S.oppName);
        await page.fill(`${f} textarea[name=concept]`, '150 units of family housing over podium parking');
        await page.selectOption(`${f} select[name=relationshipId]`, S.relId);
        await page.click(`${f} button[type=submit]`);
        await ready(page, `^/intelligence/opportunities/${UUID}$`);
        S.oppId = (await page.evaluate(() => document.getElementById('app').dataset.ready)).split('/').pop();
        await shot(page, 'wp3-03-opportunity-new');
        const status = await page.textContent('#app .page-head .badge');
        const missing = await page.locator('[data-testid=requirement].missing').count();
        const o = (await api(devToken, 'GET', `/api/di/opportunities/${S.oppId}`)).body;
        return { pass: preselected === S.propId && /new/i.test(status) && missing === 6 && o.propertyId === S.propId && o.relationshipId === S.relId && o.status === 'NEW',
          detail: { preselected, status, missing, api: { status: o.status, propertyId: o.propertyId } } };
      });

      await t('DEVOS-UI3-LIFE-001', 'Lifecycle — NEW → SCREENING with a recorded reason; the move to READY is refused while information is missing, and the gaps are shown', async () => {
        await page.selectOption('[data-testid=transition-to]', 'SCREENING');
        await page.fill('[data-testid=transition-form] textarea[name=reason]', 'Initial screening started');
        await page.click('[data-testid=transition-form] button[type=submit]');
        await page.waitForFunction(() => /Screening/.test(document.querySelector('#app .page-head .badge')?.textContent || ''));
        const historyText = await page.textContent('[data-testid=opp-history]');
        await page.selectOption('[data-testid=transition-to]', 'READY_FOR_QUALIFICATION');
        await page.fill('[data-testid=transition-form] textarea[name=reason]', 'Trying too early');
        await page.click('[data-testid=transition-form] button[type=submit]');
        await page.waitForSelector('[data-role=form-error]:not([hidden])');
        await shot(page, 'wp3-03b-refused-not-ready');
        const err = await formError(page);
        const o = (await api(devToken, 'GET', `/api/di/opportunities/${S.oppId}`)).body;
        return { pass: /Initial screening started/.test(historyText) && /information required before qualification\. Missing: APN, Ownership, Lot area \(sq ft\), Zoning, Current use, Acquisition basis/i.test(err) && o.status === 'SCREENING',
          detail: { err, status: o.status } };
      });

      await t('DEVOS-UI3-SITE-001', 'Stage 4 — invalid site facts are refused in the form and nothing is saved', async () => {
        await open(page, `/intelligence/properties/${S.propId}?edit=facts`);
        await page.selectOption('[data-testid=status-zoning]', 'KNOWN');
        await page.selectOption('[data-testid=status-lot_area_sqft]', 'KNOWN');
        await page.fill('[data-testid=value-lot_area_sqft]', 'about an acre');
        await page.click('[data-testid=facts-form] button[type=submit]');
        await page.waitForSelector('[data-role=form-error]:not([hidden])');
        const err = await formError(page);
        const site = (await api(devToken, 'GET', `/api/di/properties/${S.propId}/site-intelligence`)).body;
        return { pass: /Zoning is Known but has no value/.test(err) && /Lot area \(sq ft\) must be a number/.test(err) && Object.keys(site.facts).length === 0, detail: { err, saved: Object.keys(site.facts) } };
      });

      await t('DEVOS-UI3-SITE-002', 'Stage 4 — Gate 0 site facts are recorded with typed values, explicit status and provenance (version 1)', async () => {
        const set = async (key, status, value) => {
          await page.selectOption(`[data-testid=status-${key}]`, status);
          await page.fill(`[data-testid=value-${key}]`, value || '');
        };
        await set('apn', 'KNOWN', '7280-012-034');
        await set('ownership', 'KNOWN', 'Harbor Holdings LLC');
        await set('lot_area_sqft', 'KNOWN', '43,560');
        await set('zoning', 'KNOWN', 'R4');
        await set('current_use', 'KNOWN', 'Surface parking');
        await set('acquisition_basis', 'KNOWN', '$6,250,000');
        await set('flood_zone', 'NOT_APPLICABLE', '');
        await page.selectOption('[data-testid=facts-form] select[name=sourceType]', 'PUBLIC_RECORD');
        await page.fill('[data-testid=facts-form] input[name=sourceReference]', 'Title report 2025-03');
        await page.click('[data-testid=facts-form] button[type=submit]');
        await ready(page, `^/intelligence/properties/${S.propId}$`);
        const facts = (await api(devToken, 'GET', `/api/di/properties/${S.propId}/site-intelligence`)).body.facts;
        const ok = facts.lot_area_sqft?.value === 43560 && typeof facts.acquisition_basis?.value === 'number' && facts.acquisition_basis.value === 6250000 &&
          facts.zoning?.value === 'R4' && facts.flood_zone?.status === 'NOT_APPLICABLE' && facts.flood_zone.value === null &&
          Object.values(facts).every(f => f.version === 1 && f.provenance.sourceType === 'PUBLIC_RECORD' && f.provenance.sourceReference === 'Title report 2025-03');
        await shot(page, 'wp3-04-site-intelligence');
        const zoningCell = await page.textContent('[data-fact=zoning]');
        return { pass: ok && Object.keys(facts).length === 7 && /R4/.test(zoningCell), detail: { keys: Object.keys(facts), lot: facts.lot_area_sqft?.value, basis: facts.acquisition_basis?.value } };
      });

      await t('DEVOS-UI3-SITE-003', 'Changing a fact creates a new version; unchanged facts keep theirs; history shows both versions', async () => {
        await open(page, `/intelligence/properties/${S.propId}?edit=facts`);
        await page.fill('[data-testid=value-zoning]', 'R5');
        await page.click('[data-testid=facts-form] button[type=submit]');
        await ready(page, `^/intelligence/properties/${S.propId}$`);
        const facts = (await api(devToken, 'GET', `/api/di/properties/${S.propId}/site-intelligence`)).body.facts;
        await open(page, `/intelligence/properties/${S.propId}?history=1`);
        const historyRows = await page.locator('h3.sub-h + .table-wrap tbody tr').count();
        return { pass: facts.zoning.version === 2 && facts.zoning.value === 'R5' && facts.apn.version === 1 && facts.lot_area_sqft.version === 1 && historyRows === 8,
          detail: { zoning: facts.zoning.version, apn: facts.apn.version, historyRows } };
      });

      await t('DEVOS-UI3-READY-001', 'Readiness — with Gate 0 complete the opportunity reports ready and moves to READY_FOR_QUALIFICATION', async () => {
        await open(page, `/intelligence/opportunities/${S.oppId}`);
        const readyText = await page.textContent('[data-testid=readiness] .readiness-status');
        await page.selectOption('[data-testid=transition-to]', 'READY_FOR_QUALIFICATION');
        await page.fill('[data-testid=transition-form] textarea[name=reason]', 'Gate 0 information complete');
        await page.click('[data-testid=transition-form] button[type=submit]');
        await page.waitForFunction(() => /Ready for Qualification/.test(document.querySelector('#app .page-head .badge')?.textContent || ''));
        await shot(page, 'wp3-05-ready-for-qualification');
        const h = (await api(devToken, 'GET', `/api/di/opportunities/${S.oppId}/history`)).body;
        return { pass: /Ready for qualification/i.test(readyText) && h.map(x => x.toStatus).join() === 'NEW,SCREENING,READY_FOR_QUALIFICATION', detail: { readyText, history: h.map(x => x.toStatus) } };
      });

      await t('DEVOS-UI3-OPP-002', 'Opportunity details can be edited; the lifecycle status cannot be changed by editing', async () => {
        await page.click('[data-testid=edit-opportunity]');
        await page.waitForSelector('[data-testid=opportunity-update]');
        await page.fill('[data-testid=opportunity-update] input[name=name]', `${S.oppName} (revised)`);
        await page.click('[data-testid=opportunity-update] button[type=submit]');
        await ready(page, `^/intelligence/opportunities/${S.oppId}$`);
        const o = (await api(devToken, 'GET', `/api/di/opportunities/${S.oppId}`)).body;
        return { pass: o.name === `${S.oppName} (revised)` && o.status === 'READY_FOR_QUALIFICATION', detail: { name: o.name, status: o.status } };
      });

      await t('DEVOS-UI3-PIPE-001', 'Pipeline lists the opportunity with its status and property, and filters by status', async () => {
        await open(page, '/intelligence/opportunities?status=READY_FOR_QUALIFICATION');
        await shot(page, 'wp3-06-pipeline');
        const rows = await page.locator('[data-testid=opportunity-link]').allTextContents();
        const propertyCell = await page.locator(`tr:has-text("${S.oppName}") a.cell-link-dim`).textContent();
        await open(page, '/intelligence/opportunities?status=DECLINED');
        const declined = await page.locator('[data-testid=opportunity-link]').count();
        return { pass: rows.some(r => r.includes(S.oppName)) && propertyCell === S.propName && declined === 0, detail: { rows, propertyCell, declined } };
      });

      await t('DEVOS-UI3-FIND-001', 'Findings — evaluation runs from the UI; a finding is acknowledged, a resolve without a note is refused, then resolved with a note', async () => {
        await open(page, '/intelligence/findings');
        await page.click('[data-testid=run-evaluation]');
        await page.waitForSelector('[data-testid=finding]');
        await shot(page, 'wp3-07-findings');
        const before = await page.locator('[data-testid=finding]').count();
        const first = page.locator('[data-testid=finding]').first();
        const title = await first.locator('.finding-title').textContent();
        await first.locator('input[name=note]').fill('Reviewed with the project team');
        await first.locator('button[value=acknowledge]').click();
        await page.waitForFunction(t => [...document.querySelectorAll('[data-testid=finding]')].some(el => el.textContent.includes(t) && /Acknowledged/.test(el.textContent)), title);
        const target = page.locator('[data-testid=finding]', { hasText: title }).first();
        await target.locator('button[value=resolve]').click();
        await page.waitForSelector('[data-role=form-error]:not([hidden])');
        const err = await formError(page);
        await target.locator('input[name=note]').fill('Contract executed off-platform; recorded');
        await target.locator('button[value=resolve]').click();
        await page.waitForFunction(t => ![...document.querySelectorAll('[data-testid=finding] .finding-title')].some(el => el.textContent === t), title);
        await open(page, '/intelligence/findings?state=RESOLVED');
        const resolved = await page.locator('[data-testid=finding]', { hasText: title }).count();
        return { pass: before > 0 && /note is required/i.test(err) && resolved === 1, detail: { before, title, err, resolved } };
      });

      await t('DEVOS-UI3-SEC-001', 'A viewer can read the pipeline, property facts and findings but gets no create, edit, lifecycle or fact-entry controls', async () => {
        const v = await newPage();
        await signIn(v, { email: viewerEmail, password: 'viewer-pass-1' });
        await open(v, '/intelligence/opportunities');
        const newOpp = await v.locator('[data-testid=new-opportunity]').count();
        const listed = await v.locator('[data-testid=opportunity-link]').count();
        await open(v, `/intelligence/opportunities/${S.oppId}`);
        const transition = await v.locator('[data-testid=transition-form]').count();
        const edit = await v.locator('[data-testid=edit-opportunity]').count();
        await open(v, `/intelligence/properties/${S.propId}`);
        const editFacts = await v.locator('[data-testid=edit-facts]').count();
        const factRows = await v.locator('[data-fact]').count();
        await open(v, '/intelligence/relationships');
        const relForm = await v.locator('[data-testid=relationship-form]').count();
        await v.context().close();
        return { pass: newOpp === 0 && listed > 0 && transition === 0 && edit === 0 && editFacts === 0 && factRows === 22 && relForm === 0,
          detail: { newOpp, listed, transition, edit, editFacts, factRows, relForm } };
      });

      await t('DEVOS-UI3-SEC-002', 'Tenant isolation — another organization sees none of this intelligence, and direct links to it are not found', async () => {
        const a = await newPage();
        await signIn(a, ADMIN);
        await a.selectOption('[data-testid=org-select]', 'ui3-beta');
        await a.waitForSelector('.toast:has-text("Switched to UI3 Beta Holdings")');
        await open(a, '/intelligence/opportunities');
        const listed = await a.locator('[data-testid=opportunity-link]').count();
        await open(a, '/intelligence/properties');
        const props = await a.locator('[data-testid=property-link]').count();
        await open(a, `/intelligence/opportunities/${S.oppId}`);
        const oppMsg = await a.textContent('.error-state').catch(() => '');
        await open(a, `/intelligence/properties/${S.propId}`);
        const propMsg = await a.textContent('.error-state').catch(() => '');
        const leaked = (await a.content()).includes(S.propName);
        await a.context().close();
        return { pass: listed === 0 && props === 0 && /not found/i.test(oppMsg) && /not found/i.test(propMsg) && !leaked, detail: { listed, props, leaked } };
      });

      await t('DEVOS-UI3-SEC-003', 'Zero CSP violations and zero uncaught page errors across the WP3 run', async () => (
        { pass: cspViolations.length === 0 && pageErrors.length === 0, detail: { cspViolations: cspViolations.slice(0, 3), pageErrors: pageErrors.slice(0, 3) } }
      ));
    } finally {
      await browser.close();
    }
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;
  console.log(`\nDEVOS-UI WP3: ${passedCount} PASSED, ${failedCount} FAILED (Total: ${results.length})`);
  return { passedCount, failedCount, total: results.length, results };
}

module.exports = { runUIWP3Suite };
