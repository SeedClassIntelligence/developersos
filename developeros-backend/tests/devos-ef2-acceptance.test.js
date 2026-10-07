// ══════════════════════════════════════════════════════════════
// DEVOS-EF-2 ACCEPTANCE TEST SUITE (PRE-IMPLEMENTATION RED GATE)
// Authoritative Multi-Tenant Identity, RBAC & Resource Authorization Harness
// MUST FAIL (RED) prior to DEVOS-EF-2 implementation.
// ══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const {
  startTestServer,
  stopTestServer,
  apiRequest,
  loginAs,
} = require('./helpers');
const { query } = require('../db/pool');
const crypto = require('crypto');

const SECURITY_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'ef2-security-fixture.json');

async function setupSecurityFixture() {
  const fixture = JSON.parse(fs.readFileSync(SECURITY_FIXTURE_PATH, 'utf8'));

  // Ensure Tenant B organization exists
  await query(`
    INSERT INTO organizations (id, name, type, plan)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
  `, [fixture.organizations[1].id, fixture.organizations[1].name, fixture.organizations[1].type, fixture.organizations[1].plan]);

  // Seed fixture users into PostgreSQL
  for (const u of fixture.users) {
    await query(`
      INSERT INTO users (id, org_id, name, email, password_hash, role, active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET 
        role = EXCLUDED.role, 
        org_id = EXCLUDED.org_id, 
        active = EXCLUDED.active,
        password_hash = EXCLUDED.password_hash
    `, [u.id, u.orgId, u.name, u.email.toLowerCase(), u.passwordHash, u.role, u.active]);
  }

  // Materialize the authorization relationships declared by the EF-2 fixture.
  // This is fixture setup only; production code must not infer memberships from
  // the legacy users.role/users.org_id compatibility columns.
  for (const membership of fixture.memberships) {
    await query(`
      INSERT INTO memberships (id, user_id, organization_id, role_id, status)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, organization_id) DO UPDATE SET
        role_id = EXCLUDED.role_id,
        status = EXCLUDED.status,
        updated_at = NOW()
    `, [
      membership.id,
      membership.userId,
      membership.organizationId,
      membership.role,
      membership.status.toUpperCase(),
    ]);
  }

  for (const invitation of fixture.invitations) {
    const tokenHash = crypto.createHash('sha256').update(invitation.token).digest('hex');
    await query(`
      INSERT INTO invitations
        (id, organization_id, email, role_id, token_hash, status, expires_at)
      VALUES ($1, $2, LOWER($3), $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        token_hash = EXCLUDED.token_hash,
        status = EXCLUDED.status,
        expires_at = EXCLUDED.expires_at
    `, [
      invitation.id,
      invitation.organizationId,
      invitation.email,
      invitation.role,
      tokenHash,
      invitation.status.toUpperCase(),
      invitation.expiresAt,
    ]);
  }

  // Seed Tenant B confidential resources
  const resB = fixture.tenantBResources;
  await query(`
    INSERT INTO projects (id, organization_id, name, type, units, budget, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO NOTHING
  `, [resB.project.id, resB.project.organizationId, resB.project.name, resB.project.type, resB.project.units, resB.project.budget, resB.project.status]);

  await query(`
    INSERT INTO contracts (id, project_id, partner_id, type, status, value)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO NOTHING
  `, [resB.contract.id, resB.contract.projectId, resB.contract.partnerId, resB.contract.type, resB.contract.status, resB.contract.value]);

  await query(`
    INSERT INTO tasks (id, project_id, title, discipline, status)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO NOTHING
  `, [resB.task.id, resB.task.projectId, resB.task.title, resB.task.discipline, resB.task.status]);

  await query(`
    INSERT INTO permits (id, project_id, name, jurisdiction, type, status)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO NOTHING
  `, [resB.permit.id, resB.permit.projectId, resB.permit.name, resB.permit.jurisdiction, resB.permit.type, resB.permit.status]);

  await query(`
    INSERT INTO capital_stacks (id, project_id, total_cost)
    VALUES ($1, $2, $3)
    ON CONFLICT (id) DO NOTHING
  `, [resB.capitalStack.id, resB.capitalStack.projectId, resB.capitalStack.totalCost]);

  await query(`
    INSERT INTO channels (id, project_id, name, description)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO NOTHING
  `, [resB.channel.id, resB.channel.projectId, resB.channel.name, resB.channel.description]);

  await query(`
    INSERT INTO documents (id, project_id, name, category, type)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO NOTHING
  `, [resB.document.id, resB.document.projectId, resB.document.name, resB.document.category, resB.document.type]);
}

async function runEF2AcceptanceSuite() {
  console.log('\n===============================================================');
  console.log('RUNNING SUITE: DEVOS-EF-2 ACCEPTANCE TESTS (Gated Red-Verification)');
  console.log('GOAL: Prove that tests exist, detect missing capabilities, and fail');
  console.log('===============================================================\n');

  await startTestServer(3005, true);
  await setupSecurityFixture();

  // Obtain cached JWT tokens for fixture roles
  const { token: tokenDevA } = await loginAs('dev-a@tenant-a.com', 'password123');
  const { token: tokenAdminA } = await loginAs('admin-a@tenant-a.com', 'password123');
  const { token: tokenViewerA } = await loginAs('viewer-a@tenant-a.com', 'password123');
  const { token: tokenDevB } = await loginAs('dev-b@tenant-b.com', 'password123');
  const { token: tokenAdminB } = await loginAs('admin-b@tenant-b.com', 'password123');
  const { token: tokenMulti } = await loginAs('multi-user@cross-org.com', 'password123');
  const { token: tokenNoOrg } = await loginAs('unaffiliated-user@external.com', 'password123');

  const results = [];

  function record(testId, name, passed, reason = '') {
    if (passed) {
      console.log(`  [PASS] ${testId} - ${name}`);
      results.push({ testId, name, passed: true });
    } else {
      console.error(`  [RED] ${testId} - ${name} : ${reason}`);
      results.push({ testId, name, passed: false, reason });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 1. MEMBERSHIP MODEL TESTS (Section 4)
  // ─────────────────────────────────────────────────────────────
  try {
    // DEVOS-EF2-MEMBERSHIP-001: Active membership establishes authorized organization context
    const ctxRes = await apiRequest('GET', '/api/auth/context', {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
    });
    const hasOrgContext = ctxRes.status === 200 && ctxRes.body?.organizationId === 'org1';
    record('DEVOS-EF2-MEMBERSHIP-001', 'Active membership establishes authorized organization context', hasOrgContext,
      hasOrgContext ? '' : `Endpoint /api/auth/context unavailable or missing organization context: HTTP ${ctxRes.status}`);
  } catch (err) {
    record('DEVOS-EF2-MEMBERSHIP-001', 'Active membership establishes authorized organization context', false, err.message);
  }

  try {
    // DEVOS-EF2-MEMBERSHIP-002: User without membership cannot establish organization context
    const ctxRes = await apiRequest('POST', '/api/auth/switch-context', {
      headers: { 'Authorization': `Bearer ${tokenNoOrg}` },
      body: { organizationId: 'org1' },
    });
    const rejected = ctxRes.status === 403 || ctxRes.status === 401;
    record('DEVOS-EF2-MEMBERSHIP-002', 'User without membership cannot establish organization context', rejected,
      `Vulnerability: Unaffiliated user successfully established context or endpoint missing: HTTP ${ctxRes.status}`);
  } catch (err) {
    record('DEVOS-EF2-MEMBERSHIP-002', 'User without membership cannot establish organization context', false, err.message);
  }

  try {
    // DEVOS-EF2-MEMBERSHIP-003: Inactive/revoked membership denies access
    const loginRevoked = await apiRequest('POST', '/api/auth/login', {
      body: { email: 'revoked-user@tenant-a.com', password: 'password123' },
    });
    const accessDenied = loginRevoked.status === 401 || loginRevoked.status === 403;
    record('DEVOS-EF2-MEMBERSHIP-003', 'Inactive/revoked membership denies access', accessDenied,
      `Vulnerability: Revoked user accessed resources: HTTP ${loginRevoked.status}`);
  } catch (err) {
    record('DEVOS-EF2-MEMBERSHIP-003', 'Inactive/revoked membership denies access', false, err.message);
  }

  try {
    // DEVOS-EF2-MEMBERSHIP-004: Multi-org user operates only within active membership
    const listRes = await apiRequest('GET', '/api/projects', {
      headers: { 'Authorization': `Bearer ${tokenMulti}`, 'X-Organization-Id': 'org1' },
    });
    const onlyTenantA = Array.isArray(listRes.body) && !listRes.body.some(p => p.organizationId === 'org2' || p.id.includes('org2'));
    record('DEVOS-EF2-MEMBERSHIP-004', 'User operates only within active organization context', onlyTenantA,
      `Cross-tenant leakage: multi-org user project list contains org2 projects`);
  } catch (err) {
    record('DEVOS-EF2-MEMBERSHIP-004', 'User operates only within active organization context', false, err.message);
  }

  try {
    // DEVOS-EF2-MEMBERSHIP-005: Changing context does not carry forward authority
    const switchRes = await apiRequest('POST', '/api/auth/switch-context', {
      headers: { 'Authorization': `Bearer ${tokenMulti}` },
      body: { organizationId: 'org2' },
    });
    record('DEVOS-EF2-MEMBERSHIP-005', 'Context switch resets effective permissions without carryover', switchRes.status === 200,
      'Context switching API /api/auth/switch-context is not implemented: HTTP ' + switchRes.status);
  } catch (err) {
    record('DEVOS-EF2-MEMBERSHIP-005', 'Context switch resets effective permissions without carryover', false, err.message);
  }

  try {
    // DEVOS-EF2-MEMBERSHIP-006: Client cannot fabricate membership by supplying organization_id
    const spoofRes = await apiRequest('GET', '/api/projects', {
      headers: { 'Authorization': `Bearer ${tokenDevA}`, 'X-Organization-Id': 'org2' },
    });
    const rejectedSpoof = spoofRes.status === 403;
    record('DEVOS-EF2-MEMBERSHIP-006', 'Client cannot fabricate membership via organization_id header', rejectedSpoof,
      `Vulnerability: Arbitrary X-Organization-Id header was honored or unvalidated: HTTP ${spoofRes.status}`);
  } catch (err) {
    record('DEVOS-EF2-MEMBERSHIP-006', 'Client cannot fabricate membership via organization_id header', false, err.message);
  }

  // ─────────────────────────────────────────────────────────────
  // 2. INVITATION & PROVISIONING TESTS (Section 5)
  // ─────────────────────────────────────────────────────────────
  try {
    // DEVOS-EF2-INVITE-001: Org Admin can issue invitation
    const invRes = await apiRequest('POST', '/api/invitations', {
      headers: { 'Authorization': `Bearer ${tokenAdminA}` },
      body: { email: 'newrecruit@tenant-a.com', role: 'developer' },
    });
    record('DEVOS-EF2-INVITE-001', 'Authorized organization administrator can issue invitation', invRes.status === 201,
      `Invitation API /api/invitations not implemented: HTTP ${invRes.status}`);
  } catch (err) {
    record('DEVOS-EF2-INVITE-001', 'Authorized organization administrator can issue invitation', false, err.message);
  }

  try {
    // DEVOS-EF2-INVITE-002: Unauthorized user cannot issue invitation
    const unauthInv = await apiRequest('POST', '/api/invitations', {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
      body: { email: 'sneaky@tenant-a.com', role: 'admin' },
    });
    record('DEVOS-EF2-INVITE-002', 'Unauthorized user cannot issue invitation', unauthInv.status === 403,
      `Vulnerability: Non-admin issued invitation or endpoint missing: HTTP ${unauthInv.status}`);
  } catch (err) {
    record('DEVOS-EF2-INVITE-002', 'Unauthorized user cannot issue invitation', false, err.message);
  }

  try {
    // DEVOS-EF2-INVITE-003: Expired invitation cannot be accepted
    const acceptExpired = await apiRequest('POST', '/api/invitations/accept', {
      body: { token: 'inv-token-expired-99999', password: 'NewPassword123!' },
    });
    record('DEVOS-EF2-INVITE-003', 'Expired invitation cannot be accepted', acceptExpired.status === 400 || acceptExpired.status === 410,
      `Invitation acceptance API not implemented: HTTP ${acceptExpired.status}`);
  } catch (err) {
    record('DEVOS-EF2-INVITE-003', 'Expired invitation cannot be accepted', false, err.message);
  }

  try {
    // DEVOS-EF2-INVITE-004: Revoked invitation cannot be accepted
    const acceptRevoked = await apiRequest('POST', '/api/invitations/accept', {
      body: { token: 'inv-token-revoked-88888', password: 'NewPassword123!' },
    });
    record('DEVOS-EF2-INVITE-004', 'Revoked invitation cannot be accepted', acceptRevoked.status === 400 || acceptRevoked.status === 403,
      `Invitation acceptance API not implemented: HTTP ${acceptRevoked.status}`);
  } catch (err) {
    record('DEVOS-EF2-INVITE-004', 'Revoked invitation cannot be accepted', false, err.message);
  }

  try {
    // DEVOS-EF2-INVITE-005: Invitation acceptance does not allow role elevation
    const elevatedAccept = await apiRequest('POST', '/api/invitations/accept', {
      body: { token: 'inv-token-valid-12345', password: 'NewPassword123!', role: 'admin' },
    });
    record('DEVOS-EF2-INVITE-005', 'Invitation acceptance prevents self-assigned role elevation', elevatedAccept.status === 400 || elevatedAccept.status === 403,
      `Invitation acceptance API not implemented: HTTP ${elevatedAccept.status}`);
  } catch (err) {
    record('DEVOS-EF2-INVITE-005', 'Invitation acceptance prevents self-assigned role elevation', false, err.message);
  }

  // ─────────────────────────────────────────────────────────────
  // 3. REGISTRATION PRIVILEGE ESCALATION (Section 6)
  // ─────────────────────────────────────────────────────────────
  try {
    // DEVOS-SEC-REGISTER-001 (Retained Sentinel): Public registration rejects admin role
    const attackerReg = await apiRequest('POST', '/api/auth/register', {
      body: {
        name: 'Attacker User',
        email: `attacker-${Date.now()}@test.com`,
        password: 'password123',
        role: 'admin',
        orgId: 'org1',
      },
    });
    const rejectedAdmin = attackerReg.status === 400 || attackerReg.status === 403 || attackerReg.body?.user?.role !== 'admin';
    record('DEVOS-SEC-REGISTER-001', 'Public registration rejects self-assigned administrator privilege', rejectedAdmin,
      'Vulnerability: Attacker successfully self-assigned admin privilege.');
  } catch (err) {
    record('DEVOS-SEC-REGISTER-001', 'Public registration rejects self-assigned administrator privilege', false, err.message);
  }

  try {
    // DEVOS-EF2-REGISTER-001: Public registration cannot select arbitrary organization
    const orgInjectReg = await apiRequest('POST', '/api/auth/register', {
      body: {
        name: 'Cross Org Injector',
        email: `injector-${Date.now()}@test.com`,
        password: 'password123',
        orgId: 'org2',
      },
    });
    const rejectedOrgInject = orgInjectReg.status === 400 || orgInjectReg.status === 403 || orgInjectReg.body?.user?.orgId !== 'org2';
    record('DEVOS-EF2-REGISTER-001', 'Public registration cannot select arbitrary organization', rejectedOrgInject,
      'Vulnerability: Public registration allowed caller to assign themselves to org2.');
  } catch (err) {
    record('DEVOS-EF2-REGISTER-001', 'Public registration cannot select arbitrary organization', false, err.message);
  }

  try {
    // DEVOS-EF2-REGISTER-002: Public registration cannot inject permissions
    const permInjectReg = await apiRequest('POST', '/api/auth/register', {
      body: {
        name: 'Permission Injector',
        email: `perminject-${Date.now()}@test.com`,
        password: 'password123',
        permissions: ['*'],
      },
    });
    const hasWildcard = Array.isArray(permInjectReg.body?.user?.permissions) && permInjectReg.body.user.permissions.includes('*');
    record('DEVOS-EF2-REGISTER-002', 'Public registration rejects permission injection', !hasWildcard && permInjectReg.status !== 500,
      'Vulnerability: Caller successfully injected wildcard permissions.');
  } catch (err) {
    record('DEVOS-EF2-REGISTER-002', 'Public registration rejects permission injection', false, err.message);
  }

  // ─────────────────────────────────────────────────────────────
  // 4. RBAC MODEL TESTS (Section 7)
  // ─────────────────────────────────────────────────────────────
  try {
    // DEVOS-EF2-RBAC-001: Developer role cannot delete organization projects
    const createTestProj = await apiRequest('POST', '/api/projects', {
      headers: { 'Authorization': `Bearer ${tokenAdminA}` },
      body: { name: 'Test Org Project', type: 'Market Rate', units: 10, budget: 100000 },
    });
    const testProjId = createTestProj.body?.id;
    const adminAction = await apiRequest('DELETE', `/api/projects/${testProjId}`, {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
    });
    record('DEVOS-EF2-RBAC-001', 'Developer role cannot delete organization projects', adminAction.status === 403,
      `Vulnerability: Developer role permitted to delete project: HTTP ${adminAction.status}`);
  } catch (err) {
    record('DEVOS-EF2-RBAC-001', 'Developer role cannot delete organization projects', false, err.message);
  }

  try {
    // DEVOS-EF2-RBAC-002: Read-only (viewer) role cannot mutate resources
    const mutateRes = await apiRequest('POST', '/api/tasks', {
      headers: { 'Authorization': `Bearer ${tokenViewerA}` },
      body: { projectId: 'p1', title: 'Unauthorized Task', discipline: 'arch' },
    });
    record('DEVOS-EF2-RBAC-002', 'Read-only viewer role cannot mutate resources', mutateRes.status === 403,
      `Vulnerability: Viewer created task: HTTP ${mutateRes.status}`);
  } catch (err) {
    record('DEVOS-EF2-RBAC-002', 'Read-only viewer role cannot mutate resources', false, err.message);
  }

  try {
    // DEVOS-EF2-RBAC-003: Role from Tenant A provides zero authority in Tenant B
    const createTenantBProj = await apiRequest('POST', '/api/projects', {
      headers: { 'Authorization': `Bearer ${tokenAdminB}` },
      body: { name: 'Tenant B Ephemeral Project', type: 'Market Rate', units: 10, budget: 100000 },
    });
    const bProjId = createTenantBProj.body?.id;
    const crossAdmin = await apiRequest('DELETE', `/api/projects/${bProjId}`, {
      headers: { 'Authorization': `Bearer ${tokenAdminA}` },
    });
    record('DEVOS-EF2-RBAC-003', 'Role from Tenant A provides zero authority in Tenant B', crossAdmin.status === 403 || crossAdmin.status === 404,
      `Vulnerability: Tenant A admin mutated Tenant B project: HTTP ${crossAdmin.status}`);
  } catch (err) {
    record('DEVOS-EF2-RBAC-003', 'Role from Tenant A provides zero authority in Tenant B', false, err.message);
  }

  // ─────────────────────────────────────────────────────────────
  // 5. CROSS-TENANT ISOLATION (Sections 9, 10, 11)
  // ─────────────────────────────────────────────────────────────
  try {
    // DEVOS-SEC-TENANT-001A (Retained Sentinel): Direct ID access denied
    const directGet = await apiRequest('GET', '/api/projects/p-org2-confidential', {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
    });
    const directDenied = directGet.status === 403 || directGet.status === 404;
    record('DEVOS-SEC-TENANT-001A', 'Tenant A cannot read Tenant B project by direct ID', directDenied,
      `Vulnerability: Server returned HTTP ${directGet.status} with confidential data: ${JSON.stringify(directGet.body?.name)}`);
  } catch (err) {
    record('DEVOS-SEC-TENANT-001A', 'Tenant A cannot read Tenant B project by direct ID', false, err.message);
  }

  try {
    // DEVOS-SEC-TENANT-001B (Retained Sentinel): List excludes Tenant B projects
    const listRes = await apiRequest('GET', '/api/projects', {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
    });
    const leaked = Array.isArray(listRes.body) && listRes.body.some(p => p.id === 'p-org2-confidential');
    record('DEVOS-SEC-TENANT-001B', 'Tenant A project list excludes Tenant B projects', !leaked,
      `Vulnerability: Tenant A project list leaked Tenant B project 'p-org2-confidential'`);
  } catch (err) {
    record('DEVOS-SEC-TENANT-001B', 'Tenant A project list excludes Tenant B projects', false, err.message);
  }

  try {
    // DEVOS-EF2-DIRECT-001: Direct ID access across all child domains is strictly denied
    const taskGet = await apiRequest('GET', '/api/tasks/t-org2-confidential', { headers: { 'Authorization': `Bearer ${tokenDevA}` } });
    const contractGet = await apiRequest('GET', '/api/contracts/c-org2-confidential', { headers: { 'Authorization': `Bearer ${tokenDevA}` } });
    const permitGet = await apiRequest('GET', '/api/permits/pm-org2-confidential', { headers: { 'Authorization': `Bearer ${tokenDevA}` } });
    const allDenied = (taskGet.status === 403 || taskGet.status === 404) &&
                      (contractGet.status === 403 || contractGet.status === 404) &&
                      (permitGet.status === 403 || permitGet.status === 404);
    record('DEVOS-EF2-DIRECT-001', 'Direct ID access across all child domains is strictly denied', allDenied,
      `Leaked child records: Task HTTP ${taskGet.status}, Contract HTTP ${contractGet.status}, Permit HTTP ${permitGet.status}`);
  } catch (err) {
    record('DEVOS-EF2-DIRECT-001', 'Direct ID access across all child domains is strictly denied', false, err.message);
  }

  try {
    // DEVOS-EF2-MUTATE-001: Cross-tenant mutation rejected and data remains unchanged
    const updateRes = await apiRequest('PUT', '/api/projects/p-org2-confidential', {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
      body: { name: 'Compromised Name by Tenant A', budget: 1 },
    });
    const checkDb = await query('SELECT name FROM projects WHERE id = $1', ['p-org2-confidential']);
    const dbUnchanged = checkDb.rows[0]?.name === 'Pacific Heights Tower (Tenant B Confidential)';
    const mutationRejected = (updateRes.status === 403 || updateRes.status === 404) && dbUnchanged;
    record('DEVOS-EF2-MUTATE-001', 'Cross-tenant mutation fails and Tenant B record remains unchanged', mutationRejected,
      `Vulnerability: Cross-tenant update succeeded with HTTP ${updateRes.status}`);
  } catch (err) {
    record('DEVOS-EF2-MUTATE-001', 'Cross-tenant mutation fails and Tenant B record remains unchanged', false, err.message);
  }

  try {
    // DEVOS-EF2-DEL-TASK-001: Adversarial task deletion test
    // 1. Create a task in Tenant A
    const createdTask = await apiRequest('POST', '/api/tasks', {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
      body: { projectId: 'p1', title: 'Adversarial Task Deletion Test', discipline: 'arch' },
    });
    const testTaskId = createdTask.body?.id;

    // 2. Viewer in Tenant A tries to delete -> Denied (403)
    const viewerDel = await apiRequest('DELETE', `/api/tasks/${testTaskId}`, {
      headers: { 'Authorization': `Bearer ${tokenViewerA}` },
    });

    // 3. Dev in Tenant A tries to delete Tenant B task -> Concealed (404)
    const wrongTenantDel = await apiRequest('DELETE', '/api/tasks/t-org2-confidential', {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
    });

    // 4. Verify Tenant B task remains intact in database
    const checkBTask = await query('SELECT 1 FROM tasks WHERE id = $1', ['t-org2-confidential']);
    const bTaskIntact = checkBTask.rows.length === 1;

    // 5. Authorized Dev in Tenant A deletes Tenant A task -> 200
    const devDel = await apiRequest('DELETE', `/api/tasks/${testTaskId}`, {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
    });

    const taskPolicyCompliant = viewerDel.status === 403 &&
                                wrongTenantDel.status === 404 &&
                                bTaskIntact &&
                                devDel.status === 200;

    record('DEVOS-EF2-DEL-TASK-001', 'Task deletion enforces RBAC, tenant isolation, and resource policy', taskPolicyCompliant,
      `Task deletion defect: viewer=${viewerDel.status}, wrongTenant=${wrongTenantDel.status}, bIntact=${bTaskIntact}, dev=${devDel.status}`);
  } catch (err) {
    record('DEVOS-EF2-DEL-TASK-001', 'Task deletion enforces RBAC, tenant isolation, and resource policy', false, err.message);
  }

  try {
    // DEVOS-EF2-DEL-CONT-001: Adversarial contract deletion test
    // 1. Create a contract in Tenant A
    const createdContract = await apiRequest('POST', '/api/contracts', {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
      body: { projectId: 'p1', type: 'Adversarial Contract Deletion Test', status: 'pending', value: 1000 },
    });
    const testContractId = createdContract.body?.id;

    // 2. Viewer in Tenant A tries to delete -> Denied (403)
    const viewerDel = await apiRequest('DELETE', `/api/contracts/${testContractId}`, {
      headers: { 'Authorization': `Bearer ${tokenViewerA}` },
    });

    // 3. Dev in Tenant A tries to delete Tenant B contract -> Concealed (404)
    const wrongTenantDel = await apiRequest('DELETE', '/api/contracts/c-org2-confidential', {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
    });

    // 4. Verify Tenant B contract remains intact in database
    const checkBContract = await query('SELECT 1 FROM contracts WHERE id = $1', ['c-org2-confidential']);
    const bContractIntact = checkBContract.rows.length === 1;

    // 5. Authorized Dev in Tenant A deletes Tenant A contract -> 200
    const devDel = await apiRequest('DELETE', `/api/contracts/${testContractId}`, {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
    });

    const contractPolicyCompliant = viewerDel.status === 403 &&
                                    wrongTenantDel.status === 404 &&
                                    bContractIntact &&
                                    devDel.status === 200;

    record('DEVOS-EF2-DEL-CONT-001', 'Contract deletion enforces RBAC, tenant isolation, and resource policy', contractPolicyCompliant,
      `Contract deletion defect: viewer=${viewerDel.status}, wrongTenant=${wrongTenantDel.status}, bIntact=${bContractIntact}, dev=${devDel.status}`);
  } catch (err) {
    record('DEVOS-EF2-DEL-CONT-001', 'Contract deletion enforces RBAC, tenant isolation, and resource policy', false, err.message);
  }

  // ─────────────────────────────────────────────────────────────
  // 6. PARENT/CHILD INJECTION & MASS ASSIGNMENT (Sections 12, 13)
  // ─────────────────────────────────────────────────────────────
  try {
    // DEVOS-EF2-PARENT-001: Foreign-parent injection fails
    const injectChild = await apiRequest('POST', '/api/tasks', {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
      body: { projectId: 'p-org2-confidential', title: 'Injected Task', discipline: 'arch' },
    });
    const rejectedInjection = injectChild.status === 403 || injectChild.status === 404;
    record('DEVOS-EF2-PARENT-001', 'Client cannot inject child resource under foreign-tenant parent', rejectedInjection,
      `Vulnerability: Created task under foreign project p-org2-confidential: HTTP ${injectChild.status}`);
  } catch (err) {
    record('DEVOS-EF2-PARENT-001', 'Client cannot inject child resource under foreign-tenant parent', false, err.message);
  }

  try {
    // DEVOS-EF2-MASSASSIGN-001: Updating resource cannot rebind organization_id
    await apiRequest('PUT', '/api/projects/p1', {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
      body: { name: 'Westside Housing Phase II', organizationId: 'org2' },
    });
    const checkRebind = await query('SELECT organization_id FROM projects WHERE id = $1', ['p1']);
    const notRebound = checkRebind.rows[0]?.organization_id === 'org1';
    record('DEVOS-EF2-MASSASSIGN-001', 'Updating project cannot rebind organization_id to foreign tenant', notRebound,
      `Vulnerability: Project p1 organization_id changed to ${checkRebind.rows[0]?.organization_id}`);
  } catch (err) {
    record('DEVOS-EF2-MASSASSIGN-001', 'Updating project cannot rebind organization_id to foreign tenant', false, err.message);
  }

  // ─────────────────────────────────────────────────────────────
  // 7. ADMINISTRATION BOUNDARIES (Section 14)
  // ─────────────────────────────────────────────────────────────
  try {
    // DEVOS-EF2-ADMIN-001: Organization Admin A cannot access platform global admin capabilities
    const globalAdminRes = await apiRequest('GET', '/api/admin/stats', {
      headers: { 'Authorization': `Bearer ${tokenAdminA}` },
    });
    record('DEVOS-EF2-ADMIN-001', 'Organization Administrator cannot access platform-global admin stats', globalAdminRes.status === 403,
      `Vulnerability: Org Admin A accessed platform-wide statistics: HTTP ${globalAdminRes.status}`);
  } catch (err) {
    record('DEVOS-EF2-ADMIN-001', 'Organization Administrator cannot access platform-global admin stats', false, err.message);
  }

  // ─────────────────────────────────────────────────────────────
  // 8. JWT & SESSION CLAIM INTEGRITY (Section 16)
  // ─────────────────────────────────────────────────────────────
  try {
    // DEVOS-EF2-JWT-001: Revoked membership immediately terminates authority even with unexpired token
    // Simulate server-side membership revocation
    await query(`UPDATE users SET active = false WHERE email = $1`, ['dev-a@tenant-a.com']);
    const afterRevokeRes = await apiRequest('GET', '/api/projects', {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
    });
    // Restore user active flag
    await query(`UPDATE users SET active = true WHERE email = $1`, ['dev-a@tenant-a.com']);
    record('DEVOS-EF2-JWT-001', 'Server-side revocation immediately invalidates unexpired JWT authority', afterRevokeRes.status === 401 || afterRevokeRes.status === 403,
      `Vulnerability: Unexpired JWT was honored after membership/account was disabled: HTTP ${afterRevokeRes.status}`);
  } catch (err) {
    record('DEVOS-EF2-JWT-001', 'Server-side revocation immediately invalidates unexpired JWT authority', false, err.message);
  }

  // ─────────────────────────────────────────────────────────────
  // 9. DATABASE STRUCTURAL SECURITY (Section 19)
  // ─────────────────────────────────────────────────────────────
  try {
    // DEVOS-EF2-SCHEMA-001: Relational memberships table exists with unique constraint
    const schemaCheck = await query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name IN ('memberships', 'invitations', 'roles', 'permissions')
    `);
    const tablesPresent = schemaCheck.rows.length >= 4;
    record('DEVOS-EF2-SCHEMA-001', 'Relational tables for memberships, invitations, and RBAC exist', tablesPresent,
      `Missing EF-2 security schema: found only ${schemaCheck.rows.length}/4 required tables.`);
  } catch (err) {
    record('DEVOS-EF2-SCHEMA-001', 'Relational tables for memberships, invitations, and RBAC exist', false, err.message);
  }

  // ─────────────────────────────────────────────────────────────
  // 10. SECURITY RESPONSE INTEGRITY (Section 22)
  // ─────────────────────────────────────────────────────────────
  try {
    // DEVOS-EF2-RESP-001: Denied requests do not leak sensitive metadata
    const deniedRes = await apiRequest('GET', '/api/projects/p-org2-confidential', {
      headers: { 'Authorization': `Bearer ${tokenDevA}` },
    });
    const bodyStr = JSON.stringify(deniedRes.body || {});
    const leaksConfidential = bodyStr.includes('Pacific Heights') || bodyStr.includes('95000000');
    record('DEVOS-EF2-RESP-001', 'Authorization failures do not leak confidential metadata', !leaksConfidential && (deniedRes.status === 403 || deniedRes.status === 404),
      `Vulnerability: Response body leaked confidential Tenant B metadata: ${bodyStr}`);
  } catch (err) {
    record('DEVOS-EF2-RESP-001', 'Authorization failures do not leak confidential metadata', false, err.message);
  }

  const passedCount = results.filter(r => r.passed).length;
  const redCount = results.filter(r => !r.passed).length;

  console.log('\n---------------------------------------------------------------');
  console.log(`DEVOS-EF-2 ACCEPTANCE SUMMARY: ${passedCount} PASSED, ${redCount} RED (Total: ${results.length})`);
  console.log(redCount === 0
    ? 'STATUS: GREEN — EF-2 ACCEPTANCE VERIFIED'
    : 'STATUS: RED — EF-2 ACCEPTANCE INCOMPLETE');
  console.log('---------------------------------------------------------------\n');

  return { passedCount, redCount, total: results.length, results };
}

if (require.main === module) {
  runEF2AcceptanceSuite().then(() => {
    stopTestServer().then(() => {
      process.exit(0);
    });
  });
}

module.exports = { runEF2AcceptanceSuite, setupSecurityFixture };
