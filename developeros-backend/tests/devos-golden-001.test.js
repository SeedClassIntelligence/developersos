// ══════════════════════════════════════════════════════════════
// DEVOS-GOLDEN-001 — End-to-End Reference Scenario Test
// Proves the complete KG Development project execution workflow
// ══════════════════════════════════════════════════════════════

const {
  startTestServer,
  stopTestServer,
  apiRequest,
  loginAs,
} = require('./helpers');

async function runGoldenPath() {
  console.log('\n===============================================================');
  console.log('RUNNING SCENARIO: DEVOS-GOLDEN-001 (Project Execution Workflow)');
  console.log('===============================================================\n');

  await startTestServer(3005);

  const results = [];

  function assert(stepId, description, condition, details = '') {
    if (condition) {
      console.log(`  [PASS] ${stepId}: ${description}`);
      results.push({ stepId, description, passed: true });
    } else {
      console.error(`  [FAIL] ${stepId}: ${description} : ${details}`);
      results.push({ stepId, description, passed: false, details });
    }
  }

  try {
    // Security-foundation prelude: provision a legitimate organization user
    // through the same membership architecture that guards the business flow.
    const adminAuth = await loginAs('admin@developeros.com', 'password123');
    const adminHeaders = { 'Authorization': `Bearer ${adminAuth.token}` };
    const invitedEmail = `golden-user-${Date.now()}@kgdevelopment.com`;
    const invitation = await apiRequest('POST', '/api/invitations', {
      headers: adminHeaders,
      body: { email: invitedEmail, role: 'viewer' },
    });
    assert('STEP-0A-INVITE', 'Organization administrator issues a scoped invitation',
      invitation.status === 201 && invitation.body.roleId === 'viewer' && !!invitation.body.token);

    const accepted = await apiRequest('POST', '/api/invitations/accept', {
      body: { token: invitation.body.token, password: 'GoldenPathPassword123!' },
    });
    assert('STEP-0B-ACCEPT', 'Invited user accepts the authorized membership',
      accepted.status === 201 && accepted.body.organizationId === 'org1' && accepted.body.roleId === 'viewer');

    const invitedAuth = await loginAs(invitedEmail, 'GoldenPathPassword123!');
    const invitedContext = await apiRequest('GET', '/api/auth/context', {
      headers: { 'Authorization': `Bearer ${invitedAuth.token}` },
    });
    assert('STEP-0C-CONTEXT', 'New identity resolves its active organization membership',
      invitedContext.status === 200 && invitedContext.body.organizationId === 'org1' && invitedContext.body.roleId === 'viewer');

    const invitedProjects = await apiRequest('GET', '/api/projects', {
      headers: { 'Authorization': `Bearer ${invitedAuth.token}` },
    });
    assert('STEP-0D-AUTHORIZED-READ', 'New read-only member can perform its legitimate tenant-scoped work',
      invitedProjects.status === 200 && Array.isArray(invitedProjects.body) && invitedProjects.body.length > 0);

    // Step 1: Authenticate as Developer Lead
    const auth = await loginAs('maria@kgdevelopment.com', 'password123');
    assert('STEP-1-AUTH', 'Authenticate developer lead Maria Rodriguez', 
      auth.user.email === 'maria@kgdevelopment.com' && !!auth.token);
    const token = auth.token;
    const authHeaders = { 'Authorization': `Bearer ${token}` };

    // Step 2: Load Project p1 (Westside Housing Phase II)
    const proj = await apiRequest('GET', '/api/projects/p1', { headers: authHeaders });
    assert('STEP-2-PROJ', 'Load active project p1 (Westside Housing Phase II)', 
      proj.status === 200 && proj.body.id === 'p1' && proj.body.units === 120 && proj.body.budget === 24200000);

    // Step 3: Load Tasks for project
    const tasks = await apiRequest('GET', '/api/tasks?projectId=p1', { headers: authHeaders });
    assert('STEP-3-TASKS', 'Load 12 initial SOW tasks for project p1', 
      tasks.status === 200 && tasks.body.length === 12);

    // Step 4: Inspect blocked dependency
    // t7 is blocked on deps ['t1', 't2']
    const t7 = tasks.body.find(t => t.id === 't7');
    const t1 = tasks.body.find(t => t.id === 't1');
    assert('STEP-4-INSPECT-DEPS', 'Inspect blocked task t7 and missing contract dependency on t1', 
      t7.status === 'blocked' && t7.deps.includes('t1') && t1.contractId === null);

    // Step 5: Assign and Execute required Contract
    // Associate contract c7 with t1
    await apiRequest('PUT', '/api/tasks/t1', {
      headers: authHeaders,
      body: { contractId: 'c7', status: 'blocked' },
    });
    // Execute contract c7
    const execRes = await apiRequest('POST', '/api/contracts/c7/execute', { headers: authHeaders });
    assert('STEP-5-EXECUTE-CONTRACT', 'Execute Landscape Architecture contract c7', 
      execRes.status === 200 && execRes.body.status === 'executed' && !!execRes.body.executedDate);

    // Step 6: Verify dependent task state change
    const t1After = await apiRequest('GET', '/api/tasks/t1', { headers: authHeaders });
    assert('STEP-6-VERIFY-UNBLOCK', 'Task t1 transitions from blocked to not-started upon contract execution', 
      t1After.body.status === 'not-started');

    // Step 7: Update Permit and Correction status
    const corUpdate = await apiRequest('PATCH', '/api/permits/pm3/corrections/cor1', {
      headers: authHeaders,
      body: { status: 'complete' },
    });
    const permUpdate = await apiRequest('PATCH', '/api/permits/pm3/status', {
      headers: authHeaders,
      body: { status: 'under-review' },
    });
    assert('STEP-7-PERMITS', 'Resolve permit correction item cor1 and advance permit status to under-review', 
      corUpdate.status === 200 && corUpdate.body.status === 'complete' && 
      permUpdate.status === 200 && permUpdate.body.status === 'under-review');

    // Step 8: Read Capital Stack and reconcile sources
    const cap = await apiRequest('GET', '/api/capital/p1', { headers: authHeaders });
    const totalSources = cap.body.sources.reduce((sum, s) => sum + s.amount, 0);
    assert('STEP-8-CAPITAL', 'Verify $24.2M capital stack sources reconcile with project cost', 
      cap.status === 200 && cap.body.totalCost === 24200000 && totalSources === cap.body.totalCost);

    // Step 9: Send collaboration coordination message
    const msg = await apiRequest('POST', '/api/messages/channels/ch1/messages', {
      headers: authHeaders,
      body: {
        senderName: 'Maria Rodriguez',
        role: 'developer',
        text: 'Coordination update: Landscape contract executed and drainage calcs submitted.',
      },
    });
    assert('STEP-9-MESSAGE', 'Broadcast SOW coordination message to project channel', 
      msg.status === 201 && msg.body.channelId === 'ch1' && msg.body.senderName === 'Maria Rodriguez');

    // Step 10: Read project document repository
    const docs = await apiRequest('GET', '/api/documents?projectId=p1', { headers: authHeaders });
    assert('STEP-10-DOCUMENTS', 'Retrieve project document repository containing 5 core records', 
      docs.status === 200 && docs.body.length === 5);

    // Step 11: Generate Deterministic Risk Alerts
    const alerts = await apiRequest('GET', '/api/alerts?projectId=p1', { headers: authHeaders });
    assert('STEP-11-ALERTS', 'Generate deterministic risk alerts reflecting real-time project state', 
      alerts.status === 200 && Array.isArray(alerts.body) && alerts.body.length > 0);

  } catch (err) {
    console.error('Unhandled exception in Golden Path:', err);
    results.push({ stepId: 'GOLDEN-FATAL', description: err.message, passed: false });
  } finally {
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  console.log('\n---------------------------------------------------------------');
  console.log(`DEVOS-GOLDEN-001 SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (Total: ${results.length})`);
  console.log('---------------------------------------------------------------\n');

  return { passedCount, failedCount, total: results.length, results };
}

if (require.main === module) {
  runGoldenPath().then(({ failedCount }) => {
    stopTestServer().then(() => {
      process.exit(failedCount > 0 ? 1 : 0);
    });
  });
}

module.exports = { runGoldenPath };
