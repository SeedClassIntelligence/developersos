const {
  startTestServer,
  stopTestServer,
  apiRequest,
  loginAs,
} = require('./helpers');
const { query } = require('../db/pool');
const { setupSecurityFixture } = require('./devos-ef2-acceptance.test');

async function runGoldenSecurityPath() {
  console.log('\n===============================================================');
  console.log('RUNNING SCENARIO: DEVOS-GOLDEN-SEC-001 (Adversarial Authorization)');
  console.log('===============================================================\n');
  await startTestServer(3005, true);
  await setupSecurityFixture();

  const results = [];
  const assert = (id, description, condition, details = '') => {
    const passed = Boolean(condition);
    console[passed ? 'log' : 'error'](`  [${passed ? 'PASS' : 'FAIL'}] ${id}: ${description}${passed ? '' : ` : ${details}`}`);
    results.push({ stepId: id, description, passed, details: passed ? undefined : details });
  };

  try {
    const devA = await loginAs('dev-a@tenant-a.com', 'password123');
    const adminA = await loginAs('admin-a@tenant-a.com', 'password123');
    const viewerA = await loginAs('viewer-a@tenant-a.com', 'password123');
    const multi = await loginAs('multi-user@cross-org.com', 'password123');
    const a = { Authorization: `Bearer ${devA.token}` };

    const list = await apiRequest('GET', '/api/projects', { headers: a });
    assert('SEC-01-LIST', 'Tenant A list excludes Tenant B resources',
      list.status === 200 && !list.body.some(p => p.id === 'p-org2-confidential'));

    const direct = await apiRequest('GET', '/api/projects/p-org2-confidential', { headers: a });
    assert('SEC-02-DIRECT', 'Guessed foreign project ID is concealed', direct.status === 404);

    const before = await query('SELECT name FROM projects WHERE id = $1', ['p-org2-confidential']);
    const mutation = await apiRequest('PUT', '/api/projects/p-org2-confidential', {
      headers: a, body: { name: 'Attacker renamed this' },
    });
    const after = await query('SELECT name FROM projects WHERE id = $1', ['p-org2-confidential']);
    assert('SEC-03-MUTATE', 'Foreign mutation is denied and durable state is unchanged',
      mutation.status === 404 && before.rows[0].name === after.rows[0].name);

    const child = await apiRequest('POST', '/api/tasks', {
      headers: a, body: { projectId: 'p-org2-confidential', title: 'Injected child' },
    });
    assert('SEC-04-PARENT', 'Foreign parent-ID injection is denied', child.status === 404);

    const spoof = await apiRequest('GET', '/api/projects', {
      headers: { ...a, 'X-Organization-Id': 'org2' },
    });
    assert('SEC-05-CONTEXT-SPOOF', 'Organization-context spoofing without membership is denied', spoof.status === 403);

    const switchB = await apiRequest('POST', '/api/auth/switch-context', {
      headers: { Authorization: `Bearer ${multi.token}` }, body: { organizationId: 'org2' },
    });
    const bProjects = await apiRequest('GET', '/api/projects', {
      headers: { Authorization: `Bearer ${switchB.body.token}` },
    });
    assert('SEC-06-CONTEXT-SWITCH', 'Valid context switch applies only the selected membership',
      switchB.status === 200 && switchB.body.roleId === 'viewer' && bProjects.body.every(p => p.organizationId === 'org2'));

    await query(`UPDATE memberships SET status = 'REVOKED', updated_at = NOW() WHERE user_id = 'u-dev-a' AND organization_id = 'org1'`);
    const revoked = await apiRequest('GET', '/api/projects', { headers: a });
    assert('SEC-07-REVOKE-AFTER-AUTH', 'Existing JWT loses authority after membership revocation', revoked.status === 403);
    await query(`UPDATE memberships SET status = 'ACTIVE', updated_at = NOW() WHERE user_id = 'u-dev-a' AND organization_id = 'org1'`);

    await query(`UPDATE memberships SET role_id = 'viewer', updated_at = NOW() WHERE user_id = 'u-dev-a' AND organization_id = 'org1'`);
    const downgraded = await apiRequest('POST', '/api/tasks', {
      headers: a, body: { projectId: 'p1', title: 'Denied after downgrade' },
    });
    assert('SEC-08-DOWNGRADE-AFTER-AUTH', 'Existing JWT immediately receives downgraded permissions', downgraded.status === 403);
    await query(`UPDATE memberships SET role_id = 'developer', updated_at = NOW() WHERE user_id = 'u-dev-a' AND organization_id = 'org1'`);

    await query(`UPDATE users SET active = false WHERE id = 'u-dev-a'`);
    const disabled = await apiRequest('GET', '/api/projects', { headers: a });
    assert('SEC-09-DISABLE-AFTER-AUTH', 'Existing JWT cannot act after identity disablement', disabled.status === 401);
    await query(`UPDATE users SET active = true WHERE id = 'u-dev-a'`);

    const registration = await apiRequest('POST', '/api/auth/register', {
      body: { name: 'Attacker', email: `attacker-${Date.now()}@test.com`, password: 'Password123!', role: 'platform-admin', orgId: 'org2', permissions: ['*'] },
    });
    assert('SEC-10-REGISTRATION', 'Registration payload cannot create authority', registration.status === 403);

    const rebind = await apiRequest('PUT', '/api/projects/p1', {
      headers: a, body: { organizationId: 'org2', role: 'org-admin', permissions: ['*'] },
    });
    const owner = await query(`SELECT organization_id FROM projects WHERE id = 'p1'`);
    assert('SEC-11-MASS-ASSIGN', 'Authority and ownership fields cannot be mass-assigned',
      rebind.status === 200 && owner.rows[0].organization_id === 'org1');

    const tenantAdminPlatform = await apiRequest('GET', '/api/admin/stats', {
      headers: { Authorization: `Bearer ${adminA.token}` },
    });
    assert('SEC-12-ADMIN-SCOPE', 'Tenant administrator has no platform-admin authority', tenantAdminPlatform.status === 403);

    const viewerMutation = await apiRequest('PATCH', '/api/tasks/t1/status', {
      headers: { Authorization: `Bearer ${viewerA.token}` }, body: { status: 'complete' },
    });
    assert('SEC-13-VIEWER', 'Read-only member cannot mutate its own tenant', viewerMutation.status === 403);

    const invitation = await apiRequest('POST', '/api/invitations', {
      headers: { Authorization: `Bearer ${adminA.token}` },
      body: { email: `security-invite-${Date.now()}@test.com`, role: 'developer' },
    });
    const tampered = await apiRequest('POST', '/api/invitations/accept', {
      body: { token: `${invitation.body.token}tampered`, password: 'Password123!' },
    });
    const manipulated = await apiRequest('POST', '/api/invitations/accept', {
      body: { token: invitation.body.token, password: 'Password123!', role: 'org-admin', organizationId: 'org2' },
    });
    const accepted = await apiRequest('POST', '/api/invitations/accept', {
      body: { token: invitation.body.token, password: 'Password123!' },
    });
    const replay = await apiRequest('POST', '/api/invitations/accept', {
      body: { token: invitation.body.token, password: 'Password123!' },
    });
    assert('SEC-14-INVITATION', 'Invitation resists tampering, authority substitution, wrong-org use, and replay',
      tampered.status === 400 && manipulated.status === 400 && accepted.status === 201 && replay.status === 400);

    const foreignChannel = await apiRequest('GET', '/api/messages/channels/ch-org2-confidential/messages', { headers: a });
    const foreignCapital = await apiRequest('GET', '/api/capital/p-org2-confidential', { headers: a });
    const foreignDocument = await apiRequest('DELETE', '/api/documents/doc-org2-confidential', { headers: a });
    const documentStillExists = await query(`SELECT 1 FROM documents WHERE id = 'doc-org2-confidential'`);
    const foreignTaskDel = await apiRequest('DELETE', '/api/tasks/t-org2-confidential', { headers: a });
    const taskStillExists = await query(`SELECT 1 FROM tasks WHERE id = 't-org2-confidential'`);
    const foreignContractDel = await apiRequest('DELETE', '/api/contracts/c-org2-confidential', { headers: a });
    const contractStillExists = await query(`SELECT 1 FROM contracts WHERE id = 'c-org2-confidential'`);
    assert('SEC-15-DERIVED-OWNERSHIP', 'Derived ownership blocks channel, capital, document, task, and contract bypasses',
      foreignChannel.status === 404 &&
      foreignCapital.status === 404 &&
      foreignDocument.status === 404 &&
      documentStillExists.rowCount === 1 &&
      foreignTaskDel.status === 404 &&
      taskStillExists.rowCount === 1 &&
      foreignContractDel.status === 404 &&
      contractStillExists.rowCount === 1);
  } catch (err) {
    results.push({ stepId: 'SEC-FATAL', description: err.message, passed: false, details: err.stack });
    console.error('Unhandled exception in Golden Security Path:', err);
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;
  console.log('\n---------------------------------------------------------------');
  console.log(`DEVOS-GOLDEN-SEC-001 SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (Total: ${results.length})`);
  console.log('---------------------------------------------------------------\n');
  return { passedCount, failedCount, total: results.length, results };
}

if (require.main === module) {
  runGoldenSecurityPath().then(({ failedCount }) => stopTestServer().then(() => process.exit(failedCount ? 1 : 0)));
}

module.exports = { runGoldenSecurityPath };
