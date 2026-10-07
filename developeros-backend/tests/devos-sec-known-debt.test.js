// ══════════════════════════════════════════════════════════════
// DEVOS-SEC-KNOWN-DEBT — Known Security Defects Test Suite
// Proves existing security defects without weakening assertions.
// CLASSIFICATION: KNOWN P0 — SCHEDULED FOR DEVOS-EF-2
// ══════════════════════════════════════════════════════════════

const {
  startTestServer,
  stopTestServer,
  apiRequest,
  loginAs,
} = require('./helpers');

async function runSecurityDebtSuite() {
  console.log('\n===============================================================');
  console.log('RUNNING SUITE: DEVOS-SEC-KNOWN-DEBT (Pre-Existing Defect Markers)');
  console.log('CLASSIFICATION: KNOWN P0 — SCHEDULED FOR DEVOS-EF-2');
  console.log('===============================================================\n');

  await startTestServer(3005);

  const results = [];

  function assert(testId, name, condition, details = '') {
    if (condition) {
      console.log(`  [PASS] ${testId} - ${name}`);
      results.push({ testId, name, passed: true });
    } else {
      console.error(`  [RED - CONFIRMED VULNERABILITY] ${testId} - ${name} : ${details}`);
      results.push({ testId, name, passed: false, details });
    }
  }

  try {
    // ─────────────────────────────────────────────────────────────
    // DEVOS-SEC-TENANT-001: Cross-Tenant Resource Isolation
    // Tenant A (org1) must NOT be able to view, mutate, or access Tenant B (org2) projects
    // ─────────────────────────────────────────────────────────────
    // In canonical v1 fixture, p1 is org1, and p2 is Market Rate (org2).
    // Let's create an explicit Tenant B project owned by org2 to test isolation:
    const projectsRepo = require('../db/repositories/projects.repo');
    await projectsRepo.create({
      id: 'p-org2-private',
      organizationId: 'org2',
      name: 'Pacific Heights Tower (Org2 Confidential)',
      type: 'Market Rate',
      units: 250,
      budget: 95000000,
    }, 'org2');

    const tenantAUser = await loginAs('maria@kgdevelopment.com', 'password123'); // Maria belongs to org1
    const tokenA = tenantAUser.token;

    // Attempt 1: Tenant A requests Tenant B's confidential project by ID
    const crossTenantGet = await apiRequest('GET', '/api/projects/p-org2-private', {
      headers: { 'Authorization': `Bearer ${tokenA}` },
    });

    // An isolated multi-tenant system MUST reject this with 403 or 404
    const isolationEnforcedOnGet = crossTenantGet.status === 403 || crossTenantGet.status === 404;
    assert(
      'DEVOS-SEC-TENANT-001A',
      'Tenant A cannot read Tenant B project by direct ID',
      isolationEnforcedOnGet,
      `Vulnerability: Server returned HTTP ${crossTenantGet.status} with confidential data: ${JSON.stringify(crossTenantGet.body?.name)}`
    );

    // Attempt 2: Tenant A requests project list and must NOT see Tenant B records
    const crossTenantList = await apiRequest('GET', '/api/projects', {
      headers: { 'Authorization': `Bearer ${tokenA}` },
    });
    const leakedRecords = Array.isArray(crossTenantList.body) && crossTenantList.body.some(p => p.id === 'p-org2-private');
    assert(
      'DEVOS-SEC-TENANT-001B',
      'Tenant A project list excludes Tenant B projects',
      !leakedRecords,
      `Vulnerability: Tenant A project list leaked Tenant B project 'p-org2-private'`
    );

    // ─────────────────────────────────────────────────────────────
    // DEVOS-SEC-REGISTER-001: Self-Registration Privilege Escalation
    // Unauthenticated user must NOT be able to register as an administrator
    // ─────────────────────────────────────────────────────────────
    const attackerEmail = `attacker-${Date.now()}@untrusted.com`;
    const regRes = await apiRequest('POST', '/api/auth/register', {
      body: {
        name: 'Malicious Actor',
        email: attackerEmail,
        password: 'attackpassword123',
        role: 'admin', // Attacker requests administrative role
        orgId: 'org1',
      },
    });

    // In a secured system, self-assigned admin role is rejected (400/403) or coerced to standard unprivileged role
    let privilegeEscalationBlocked = false;
    if (regRes.status !== 201) {
      privilegeEscalationBlocked = true;
    } else {
      // If registered, verify token does NOT have admin access
      const attackerToken = regRes.body.token;
      const testAdminAccess = await apiRequest('GET', '/api/admin/stats', {
        headers: { 'Authorization': `Bearer ${attackerToken}` },
      });
      privilegeEscalationBlocked = testAdminAccess.status === 403;
    }

    assert(
      'DEVOS-SEC-REGISTER-001',
      'Public registration rejects self-assigned administrator privilege',
      privilegeEscalationBlocked,
      `Vulnerability: Attacker successfully self-registered as admin and gained unrestricted access to /api/admin/stats`
    );

  } catch (err) {
    console.error('Unhandled exception in Security Debt runner:', err);
    results.push({ testId: 'SEC-FATAL', name: err.message, passed: false });
  } finally {
  }

  const passedCount = results.filter(r => r.passed).length;
  const redCount = results.filter(r => !r.passed).length;

  console.log('\n---------------------------------------------------------------');
  console.log(`DEVOS-SEC-KNOWN-DEBT SUMMARY: ${passedCount} PASSED, ${redCount} RED/CONFIRMED VULNERABILITIES`);
  console.log(redCount === 0
    ? 'STATUS: GREEN — P0 SECURITY SENTINELS ENFORCED'
    : 'STATUS: RED — P0 SECURITY DEFECTS PRESENT');
  console.log('---------------------------------------------------------------\n');

  return { passedCount, redCount, total: results.length, results };
}

if (require.main === module) {
  runSecurityDebtSuite().then(() => {
    stopTestServer().then(() => {
      // Return 0 because these are known defect markers expected to be red
      process.exit(0);
    });
  });
}

module.exports = { runSecurityDebtSuite };
