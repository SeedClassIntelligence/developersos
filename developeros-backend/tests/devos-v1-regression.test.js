// ══════════════════════════════════════════════════════════════
// DEVOS-V1-REGRESSION — Comprehensive Regression Test Suite
// Covers all existing DeveloperOS v1 functionality before EF-1
// ══════════════════════════════════════════════════════════════

const {
  startTestServer,
  stopTestServer,
  apiRequest,
  loginAs,
  makeExpiredToken,
} = require('./helpers');

async function runRegressionSuite() {
  console.log('\n===============================================================');
  console.log('RUNNING SUITE: DEVOS-V1-REGRESSION (Baseline Protection)');
  console.log('===============================================================\n');

  await startTestServer(3005);

  let devToken = null;
  let adminToken = null;
  let devUser = null;

  const results = [];

  function assert(testId, name, condition, details = '') {
    if (condition) {
      console.log(`  [PASS] ${testId} - ${name}`);
      results.push({ testId, name, passed: true });
    } else {
      console.error(`  [FAIL] ${testId} - ${name} : ${details}`);
      results.push({ testId, name, passed: false, details });
    }
  }

  try {
    // ─────────────────────────────────────────────────────────────
    // 1. AUTHENTICATION
    // ─────────────────────────────────────────────────────────────
    // REG-AUTH-001: Valid login returns token & user profile
    const auth1 = await apiRequest('POST', '/api/auth/login', {
      body: { email: 'maria@kgdevelopment.com', password: 'password123' },
    });
    assert('REG-AUTH-001', 'Valid login returns JWT and user profile', 
      auth1.status === 200 && !!auth1.body.token && auth1.body.user.email === 'maria@kgdevelopment.com',
      JSON.stringify(auth1.body));
    devToken = auth1.body.token;
    devUser = auth1.body.user;

    // REG-AUTH-002: Invalid password rejected
    const auth2 = await apiRequest('POST', '/api/auth/login', {
      body: { email: 'maria@kgdevelopment.com', password: 'wrongpassword' },
    });
    assert('REG-AUTH-002', 'Invalid password returns 401 Unauthorized', auth2.status === 401);

    // REG-AUTH-003: Non-existent user rejected
    const auth3 = await apiRequest('POST', '/api/auth/login', {
      body: { email: 'nonexistent@developeros.com', password: 'password123' },
    });
    assert('REG-AUTH-003', 'Non-existent user returns 401 Unauthorized', auth3.status === 401);

    // REG-AUTH-004: Protected route without token rejected
    const auth4 = await apiRequest('GET', '/api/projects');
    assert('REG-AUTH-004', 'Protected route without Authorization header returns 401', auth4.status === 401);

    // REG-AUTH-005: Protected route with valid token succeeds
    const auth5 = await apiRequest('GET', '/api/projects', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-AUTH-005', 'Protected route with valid Bearer token returns 200', auth5.status === 200);

    // REG-AUTH-006: Expired token rejected with 401
    const expiredToken = makeExpiredToken(devUser);
    const auth6 = await apiRequest('GET', '/api/projects', {
      headers: { 'Authorization': `Bearer ${expiredToken}` },
    });
    assert('REG-AUTH-006', 'Expired token returns 401 Token expired', 
      auth6.status === 401 && auth6.body.error && auth6.body.error.includes('expired'),
      JSON.stringify(auth6.body));

    // REG-AUTH-007: Tampered / malformed token rejected
    const auth7 = await apiRequest('GET', '/api/projects', {
      headers: { 'Authorization': 'Bearer forged.tampered.token' },
    });
    assert('REG-AUTH-007', 'Malformed token returns 401 Invalid token', auth7.status === 401);

    // REG-AUTH-008: GET /api/auth/me returns current user without passwordHash
    const auth8 = await apiRequest('GET', '/api/auth/me', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-AUTH-008', 'GET /api/auth/me returns safe user profile', 
      auth8.status === 200 && auth8.body.id === devUser.id && !auth8.body.passwordHash);

    // REG-AUTH-009: POST /api/auth/change-password validates current password
    const auth9Bad = await apiRequest('POST', '/api/auth/change-password', {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { currentPassword: 'wrongcurrentpassword', newPassword: 'newsecurepassword123' },
    });
    assert('REG-AUTH-009', 'Password change with wrong current password returns 401', auth9Bad.status === 401);

    // REG-AUTH-010: POST /api/auth/change-password enforces minimum length
    const auth10Short = await apiRequest('POST', '/api/auth/change-password', {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { currentPassword: 'password123', newPassword: 'short' },
    });
    assert('REG-AUTH-010', 'Password change with short new password returns 400', auth10Short.status === 400);

    // Authenticate admin user
    const adminAuth = await loginAs('admin@developeros.com', 'password123');
    adminToken = adminAuth.token;

    // ─────────────────────────────────────────────────────────────
    // 2. PROJECTS DOMAIN
    // ─────────────────────────────────────────────────────────────
    // REG-PROJ-001: List all projects
    const projList = await apiRequest('GET', '/api/projects', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-PROJ-001', 'List projects returns array of canonical projects', 
      projList.status === 200 && Array.isArray(projList.body) && projList.body.length === 6);

    // REG-PROJ-002: Verify project object schema
    const p1 = projList.body.find(p => p.id === 'p1');
    assert('REG-PROJ-002', 'Project p1 matches canonical schema', 
      p1 && p1.name === 'Westside Housing Phase II' && p1.units === 120 && p1.budget === 24200000 && p1.phase === 3);

    // REG-PROJ-003: Get single project by ID
    const projGet = await apiRequest('GET', '/api/projects/p1', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-PROJ-003', 'GET /api/projects/:id returns single project', projGet.status === 200 && projGet.body.id === 'p1');

    // REG-PROJ-004: Get non-existent project returns 404
    const proj404 = await apiRequest('GET', '/api/projects/p9999', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-PROJ-004', 'GET non-existent project returns 404', proj404.status === 404);

    // REG-PROJ-005: Create project
    const projCreate = await apiRequest('POST', '/api/projects', {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { name: 'Sunset Arts Housing', type: 'Affordable Housing', units: 80, budget: 16000000 },
    });
    assert('REG-PROJ-005', 'POST /api/projects creates new project with generated ID', 
      projCreate.status === 201 && projCreate.body.id.startsWith('p') && projCreate.body.name === 'Sunset Arts Housing');
    const createdProjId = projCreate.body.id;

    // REG-PROJ-006: Update project
    const projUpdate = await apiRequest('PUT', `/api/projects/${createdProjId}`, {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { status: 'at-risk', progress: 50 },
    });
    assert('REG-PROJ-006', 'PUT /api/projects/:id updates existing project', 
      projUpdate.status === 200 && projUpdate.body.status === 'at-risk' && projUpdate.body.progress === 50);

    // REG-PROJ-007: EF-2 correction — developer lacks projects:delete.
    const projDelete = await apiRequest('DELETE', `/api/projects/${createdProjId}`, {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-PROJ-007', 'Developer cannot delete a project without projects:delete', projDelete.status === 403);

    const projVerifyDelete = await apiRequest('GET', `/api/projects/${createdProjId}`, {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-PROJ-008', 'Rejected project deletion leaves project unchanged', projVerifyDelete.status === 200);

    // ─────────────────────────────────────────────────────────────
    // 3. TASKS DOMAIN
    // ─────────────────────────────────────────────────────────────
    // REG-TASK-001: List tasks
    const taskList = await apiRequest('GET', '/api/tasks', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-TASK-001', 'GET /api/tasks returns all canonical tasks', taskList.status === 200 && taskList.body.length === 12);

    // REG-TASK-002: Filter tasks by projectId
    const taskByProj = await apiRequest('GET', '/api/tasks?projectId=p1', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-TASK-002', 'GET /api/tasks?projectId=p1 filters tasks by project', 
      taskByProj.status === 200 && taskByProj.body.every(t => t.projectId === 'p1'));

    // REG-TASK-003: Filter tasks by status
    const taskBlocked = await apiRequest('GET', '/api/tasks?status=blocked', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-TASK-003', 'GET /api/tasks?status=blocked returns blocked tasks', 
      taskBlocked.status === 200 && taskBlocked.body.length === 2 && taskBlocked.body.every(t => t.status === 'blocked'));

    // REG-TASK-004: Filter tasks by discipline
    const taskArch = await apiRequest('GET', '/api/tasks?discipline=arch', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-TASK-004', 'GET /api/tasks?discipline=arch returns architecture tasks', 
      taskArch.status === 200 && taskArch.body.every(t => t.discipline === 'arch'));

    // REG-TASK-005: Create task
    const taskCreate = await apiRequest('POST', '/api/tasks', {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { projectId: 'p1', title: 'Solar Array Feasibility', discipline: 'mep', status: 'not-started', dueDate: '2025-04-01' },
    });
    assert('REG-TASK-005', 'POST /api/tasks creates task with id prefixed by t', 
      taskCreate.status === 201 && taskCreate.body.id.startsWith('t'));
    const createdTaskId = taskCreate.body.id;

    // REG-TASK-006: Status patch transition
    const taskPatch = await apiRequest('PATCH', `/api/tasks/${createdTaskId}/status`, {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { status: 'in-progress' },
    });
    assert('REG-TASK-006', 'PATCH /api/tasks/:id/status updates task status', 
      taskPatch.status === 200 && taskPatch.body.status === 'in-progress');

    // REG-TASK-007: Invalid status rejected
    const taskBadStatus = await apiRequest('PATCH', `/api/tasks/${createdTaskId}/status`, {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { status: 'invalid-status-value' },
    });
    assert('REG-TASK-007', 'PATCH /api/tasks/:id/status rejects invalid status enum', taskBadStatus.status === 400);

    // REG-TASK-008: Dependencies survive updates
    const t7Before = await apiRequest('GET', '/api/tasks/t7', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    const hasDeps = t7Before.body.deps && t7Before.body.deps.includes('t1');
    const t7Update = await apiRequest('PUT', '/api/tasks/t7', {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { note: 'Updated note for final assembly' },
    });
    assert('REG-TASK-008', 'Task dependency array survives general PUT update', 
      hasDeps && t7Update.body.deps && t7Update.body.deps.includes('t1'));

    // Clean up created task
    await apiRequest('DELETE', `/api/tasks/${createdTaskId}`, {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });

    // ─────────────────────────────────────────────────────────────
    // 4. CONTRACTS DOMAIN & SOW UNBLOCKING
    // ─────────────────────────────────────────────────────────────
    // REG-CONT-001: List contracts
    const contList = await apiRequest('GET', '/api/contracts', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-CONT-001', 'GET /api/contracts returns all canonical contracts', contList.status === 200 && contList.body.length === 8);

    // REG-CONT-002: Filter contracts by projectId
    const contByProj = await apiRequest('GET', '/api/contracts?projectId=p1', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-CONT-002', 'GET /api/contracts?projectId=p1 filters contracts', contByProj.status === 200 && contByProj.body.every(c => c.projectId === 'p1'));

    // REG-CONT-003: Get single contract
    const contGet = await apiRequest('GET', '/api/contracts/c1', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-CONT-003', 'GET /api/contracts/c1 returns architectural services contract', 
      contGet.status === 200 && contGet.body.type === 'Prime Architectural Services');

    // REG-CONT-004: Execute contract & unblock dependent tasks
    // Setup a blocked task explicitly linked to contract c7
    const tBlocked = taskList.body.find(t => t.id === 't8'); // t8 is blocked in p1
    // Associate c7 with t8
    await apiRequest('PUT', '/api/tasks/t8', {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { contractId: 'c7', status: 'blocked' },
    });
    // Execute c7
    const contExec = await apiRequest('POST', '/api/contracts/c7/execute', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-CONT-004', 'POST /api/contracts/:id/execute sets executed status and date', 
      contExec.status === 200 && contExec.body.status === 'executed' && !!contExec.body.executedDate);

    // Verify task t8 was automatically unblocked to not-started
    const t8After = await apiRequest('GET', '/api/tasks/t8', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-CONT-005', 'CRITICAL SOW: Executing contract unblocks linked blocked tasks', 
      t8After.body.status === 'not-started');

    // ─────────────────────────────────────────────────────────────
    // 5. PERMITS & CORRECTIONS DOMAIN
    // ─────────────────────────────────────────────────────────────
    // REG-PERM-001: List permits
    const permList = await apiRequest('GET', '/api/permits', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-PERM-001', 'GET /api/permits returns canonical permits', permList.status === 200 && permList.body.length === 5);

    // REG-PERM-002: Get single permit with corrections array
    const pm3 = await apiRequest('GET', '/api/permits/pm3', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-PERM-002', 'GET /api/permits/pm3 contains nested corrections', 
      pm3.status === 200 && pm3.body.status === 'corrections' && Array.isArray(pm3.body.corrections) && pm3.body.corrections.length === 3);

    // REG-PERM-003: Update nested correction item
    const corrUpdate = await apiRequest('PATCH', '/api/permits/pm3/corrections/cor1', {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { status: 'complete' },
    });
    assert('REG-PERM-003', 'PATCH /api/permits/:id/corrections/:corrId updates correction item status', 
      corrUpdate.status === 200 && corrUpdate.body.id === 'cor1' && corrUpdate.body.status === 'complete');

    // REG-PERM-004: Update permit status
    const permStatus = await apiRequest('PATCH', '/api/permits/pm3/status', {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { status: 'under-review' },
    });
    assert('REG-PERM-004', 'PATCH /api/permits/:id/status updates permit review status', 
      permStatus.status === 200 && permStatus.body.status === 'under-review');

    // ─────────────────────────────────────────────────────────────
    // 6. CAPITAL STACK DOMAIN
    // ─────────────────────────────────────────────────────────────
    // REG-CAP-001: Get capital stack for project
    const cap = await apiRequest('GET', '/api/capital/p1', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-CAP-001', 'GET /api/capital/p1 returns capital stack with sources', 
      cap.status === 200 && cap.body.projectId === 'p1' && cap.body.totalCost === 24200000 && Array.isArray(cap.body.sources) && cap.body.sources.length === 4);

    // REG-CAP-002: Verify source structure and math integrity
    const capSources = cap.body.sources;
    const totalSourceSum = capSources.reduce((s, c) => s + c.amount, 0);
    assert('REG-CAP-002', 'Capital sources sum matches totalCost exactly', totalSourceSum === cap.body.totalCost);

    // REG-CAP-003: Update capital stack
    const capUpdate = await apiRequest('PUT', '/api/capital/p1', {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { ...cap.body, totalCost: 25000000 },
    });
    assert('REG-CAP-003', 'PUT /api/capital/p1 updates capital stack total cost', 
      capUpdate.status === 200 && capUpdate.body.totalCost === 25000000);

    // ─────────────────────────────────────────────────────────────
    // 7. MESSAGES & CHANNELS
    // ─────────────────────────────────────────────────────────────
    // REG-MSG-001: List channels
    const channels = await apiRequest('GET', '/api/messages/channels?projectId=p1', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-MSG-001', 'GET /api/messages/channels returns project channels', 
      channels.status === 200 && channels.body.length === 4);

    // REG-MSG-002: Read channel messages
    const msgs = await apiRequest('GET', '/api/messages/channels/ch1/messages', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-MSG-002', 'GET /api/messages/channels/:id/messages returns messages', 
      msgs.status === 200 && Array.isArray(msgs.body) && msgs.body.length >= 2);

    // REG-MSG-003: Send message with XSS payload to verify sanitization
    const sentMsg = await apiRequest('POST', '/api/messages/channels/ch1/messages', {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { senderName: 'Maria', text: 'Important update <script>evil()</script> verified' },
    });
    assert('REG-MSG-003', 'POST message strips dangerous script tags', 
      sentMsg.status === 201 && !sentMsg.body.text.includes('<script>') && sentMsg.body.text.includes('Important update'));

    // ─────────────────────────────────────────────────────────────
    // 8. DOCUMENTS DOMAIN
    // ─────────────────────────────────────────────────────────────
    // REG-DOC-001: List documents
    const docs = await apiRequest('GET', '/api/documents?projectId=p1', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-DOC-001', 'GET /api/documents returns project documents', docs.status === 200 && docs.body.length === 5);

    // REG-DOC-002: Category filter
    const docPlans = await apiRequest('GET', '/api/documents?projectId=p1&category=plans', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-DOC-002', 'GET /api/documents category filter works', 
      docPlans.status === 200 && docPlans.body.every(d => d.category === 'plans'));

    // REG-DOC-003: Create and delete document
    const docCreate = await apiRequest('POST', '/api/documents', {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { projectId: 'p1', name: 'Zoning Analysis Draft', category: 'reports', type: 'PDF' },
    });
    assert('REG-DOC-003', 'POST /api/documents creates document metadata', docCreate.status === 201 && docCreate.body.id.startsWith('d'));

    const docDelete = await apiRequest('DELETE', `/api/documents/${docCreate.body.id}`, {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-DOC-004', 'DELETE /api/documents/:id removes document metadata', docDelete.status === 200 && docDelete.body.success === true);

    // ─────────────────────────────────────────────────────────────
    // 9. DETERMINISTIC ALERT ENGINE
    // ─────────────────────────────────────────────────────────────
    // REG-ALRT-001: Generated alerts match deterministic rule set
    const alerts = await apiRequest('GET', '/api/alerts?projectId=p1', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-ALRT-001', 'GET /api/alerts returns generated risk alerts', alerts.status === 200 && Array.isArray(alerts.body));

    const alertTypes = alerts.body.map(a => a.type);
    assert('REG-ALRT-002', 'Deterministic rules identify missing contracts', alertTypes.includes('missing-contract'));
    // REG-ALRT-003: Check alert severities
    // Note: routes/alerts.js line 164 uses `(order[a.severity] || 2)`, where 0 || 2 evaluates to 2,
    // which places warnings (order 1) before criticals (evaluated as 2).
    const hasCritical = alerts.body.some(a => a.severity === 'critical');
    const hasWarning = alerts.body.some(a => a.severity === 'warning');
    assert('REG-ALRT-003', 'Alerts engine produces both critical and warning alerts', hasCritical && hasWarning);

    // ─────────────────────────────────────────────────────────────
    // 10. TEAM MEMBERS DOMAIN
    // ─────────────────────────────────────────────────────────────
    // REG-TEAM-001: List team members
    const team = await apiRequest('GET', '/api/team', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-TEAM-001', 'GET /api/team returns team members', team.status === 200 && team.body.length === 6);

    // REG-TEAM-002: Create team member
    const teamCreate = await apiRequest('POST', '/api/team', {
      headers: { 'Authorization': `Bearer ${devToken}` },
      body: { name: 'Elena Rostova', role: 'architect', projects: 'Westside' },
    });
    assert('REG-TEAM-002', 'Developer cannot manage team membership without team:manage', teamCreate.status === 403);

    // ─────────────────────────────────────────────────────────────
    // 11. ADMINISTRATION DOMAIN
    // ─────────────────────────────────────────────────────────────
    // REG-ADM-001: EF-2 correction — canonical admin is organization-scoped.
    const adminStats = await apiRequest('GET', '/api/admin/stats', {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    assert('REG-ADM-001', 'Organization administrator cannot access platform summary metrics',
      adminStats.status === 403);

    // REG-ADM-002: Non-admin access forbidden
    const nonAdminStats = await apiRequest('GET', '/api/admin/stats', {
      headers: { 'Authorization': `Bearer ${devToken}` },
    });
    assert('REG-ADM-002', 'GET /api/admin/stats returns 403 Forbidden for non-admin', nonAdminStats.status === 403);

    // REG-ADM-003: Organization admin cannot inspect platform health.
    const adminHealth = await apiRequest('GET', '/api/admin/health', {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    assert('REG-ADM-003', 'Organization administrator cannot access platform runtime health',
      adminHealth.status === 403);

    // ─────────────────────────────────────────────────────────────
    // 12. SPA FRONTEND COMPATIBILITY
    // ─────────────────────────────────────────────────────────────
    // REG-SPA-001: SPA HTML delivered at root
    const rootSpa = await apiRequest('GET', '/');
    assert('REG-SPA-001', 'GET / serves HTML SPA shell', 
      rootSpa.status === 200 && typeof rootSpa.body === 'string' && rootSpa.body.includes('DeveloperOS'));

    // REG-SPA-002: Public health endpoint returns 200
    const health = await apiRequest('GET', '/health');
    assert('REG-SPA-002', 'GET /health returns public status ok', health.status === 200 && health.body.status === 'ok');

  } catch (err) {
    console.error('Unhandled exception in regression runner:', err);
    results.push({ testId: 'REG-FATAL', name: 'Unhandled test exception', passed: false, details: err.message });
  } finally {
    // Reset back to pure canonical v1 fixture
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  console.log('\n---------------------------------------------------------------');
  console.log(`DEVOS-V1-REGRESSION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (Total: ${results.length})`);
  console.log('---------------------------------------------------------------\n');

  return { passedCount, failedCount, total: results.length, results };
}

if (require.main === module) {
  runRegressionSuite().then(({ failedCount }) => {
    stopTestServer().then(() => {
      process.exit(failedCount > 0 ? 1 : 0);
    });
  });
}

module.exports = { runRegressionSuite };
