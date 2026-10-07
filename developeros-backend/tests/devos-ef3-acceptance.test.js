const { startTestServer, stopTestServer, apiRequest, loginAs } = require('./helpers');
const { query, transaction } = require('../db/pool');
const { runEF3AdversarialTests } = require('./devos-ef3-adversarial.test');

async function runEF3AcceptanceSuite() {
  console.log('\nDEVOS-EF-3 ACCEPTANCE — AUDIT LEDGER & COMPLIANCE TRAIL');
  await startTestServer(3005, true);
  const results = [];
  const record = (id, description, passed, detail = '') => {
    results.push({ id, description, passed, detail });
    console.log(`${passed ? '[PASS]' : '[FAIL]'} ${id}: ${description}${detail && !passed ? ` — ${detail}` : ''}`);
  };

  const admin = await loginAs('admin@developeros.com');
  const developer = await loginAs('maria@kgdevelopment.com');
  const adminHeaders = { Authorization: `Bearer ${admin.token}` };
  const developerHeaders = { Authorization: `Bearer ${developer.token}` };
  const projectId = `ef3-${Date.now()}`;

  const create = await apiRequest('POST', '/api/projects', {
    headers: adminHeaders,
    body: { id: projectId, name: 'EF-3 Evidence Project', type: 'audit-test', units: 2, budget: 1000 },
  });

  const createdEvent = await query(`SELECT * FROM audit_events WHERE entity_type = 'projects' AND entity_id = $1 AND action = 'INSERT' ORDER BY occurred_at DESC LIMIT 1`, [projectId]);
  record('DEVOS-EF3-ATOMIC-001', 'Successful business mutation commits audit evidence in the same database operation',
    create.status === 201 && createdEvent.rowCount === 1, `HTTP ${create.status}; events ${createdEvent.rowCount}`);

  const event = createdEvent.rows[0];
  record('DEVOS-EF3-ACTOR-001', 'Audit evidence records current actor, organization, request, entity and operation',
    event?.actor_user_id === admin.user.id && event?.organization_id === 'org1' && event?.request_id && event?.entity_id === projectId,
    JSON.stringify(event || {}));

  const foreignProjectId = `ef3-foreign-${Date.now()}`;
  await query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, 'org2', 'Foreign Audit Evidence')`, [foreignProjectId]);
  const list = await apiRequest('GET', '/api/audit?limit=500', { headers: adminHeaders });
  const listed = Array.isArray(list.body) && list.body.some(row => row.entity_id === projectId);
  const foreignLeaked = Array.isArray(list.body) && list.body.some(row => row.entity_id === foreignProjectId || row.organization_id === 'org2');
  record('DEVOS-EF3-READ-001', 'Authorized organization administrator can read only the active tenant ledger', list.status === 200 && listed,
    `HTTP ${list.status}`);
  record('DEVOS-EF3-TENANT-001', 'Tenant ledger never discloses another organization audit event', list.status === 200 && !foreignLeaked,
    `foreign event leaked: ${foreignLeaked}`);

  const denied = await apiRequest('GET', '/api/audit', { headers: developerHeaders });
  record('DEVOS-EF3-AUTHZ-001', 'Caller without audit:read cannot inspect compliance evidence', denied.status === 403, `HTTP ${denied.status}`);

  const verify = await apiRequest('GET', '/api/audit/verify', { headers: adminHeaders });
  record('DEVOS-EF3-CHAIN-001', 'Tenant audit chain linkage verifies successfully', verify.status === 200 && verify.body.valid === true && verify.body.count > 0,
    JSON.stringify(verify.body));

  const concurrentIds = Array.from({ length: 6 }, (_, i) => `ef3-concurrent-${Date.now()}-${i}`);
  const concurrentResponses = await Promise.all(concurrentIds.map((id, i) => apiRequest('POST', '/api/projects', {
    headers: adminHeaders,
    body: { id, name: `Concurrent Evidence ${i}`, type: 'audit-test' },
  })));
  const verifyAfterConcurrency = await apiRequest('GET', '/api/audit/verify', { headers: adminHeaders });
  const concurrentEvents = await query(`SELECT COUNT(*)::int AS count FROM audit_events WHERE entity_type = 'projects' AND entity_id = ANY($1)`, [concurrentIds]);
  record('DEVOS-EF3-CONCURRENCY-001', 'Concurrent tenant mutations serialize into one valid hash chain without losing events',
    concurrentResponses.every(response => response.status === 201) && concurrentEvents.rows[0].count === concurrentIds.length && verifyAfterConcurrency.body.valid === true,
    `HTTP ${concurrentResponses.map(response => response.status).join(',')}; events ${concurrentEvents.rows[0].count}`);

  let mutationBlocked = false;
  try { await query('UPDATE audit_events SET action = $1 WHERE id = $2', ['FORGED', event.id]); } catch (err) { mutationBlocked = /append-only/.test(err.message); }
  record('DEVOS-EF3-APPEND-001', 'Committed audit evidence cannot be updated or deleted through the application database role', mutationBlocked);

  const rollbackId = `ef3-rollback-${Date.now()}`;
  try {
    await transaction(async client => {
      await client.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, 'org1', 'Rollback Evidence')`, [rollbackId]);
      throw new Error('forced rollback');
    });
  } catch (err) {}
  const rollbackRows = await query(`SELECT COUNT(*)::int AS count FROM audit_events WHERE entity_type = 'projects' AND entity_id = $1`, [rollbackId]);
  const rollbackProject = await query('SELECT id FROM projects WHERE id = $1', [rollbackId]);
  record('DEVOS-EF3-ROLLBACK-001', 'Failed transaction leaves neither business state nor orphan audit evidence',
    rollbackProject.rowCount === 0 && rollbackRows.rows[0].count === 0);

  const password = await apiRequest('POST', '/api/auth/change-password', {
    headers: adminHeaders,
    body: { currentPassword: 'password123', newPassword: 'password123' },
  });
  const userAudit = await query(`SELECT before_state, after_state FROM audit_events WHERE entity_type = 'users' AND entity_id = $1 ORDER BY occurred_at DESC LIMIT 1`, [admin.user.id]);
  const serialized = JSON.stringify(userAudit.rows[0] || {});
  record('DEVOS-EF3-SECRET-001', 'Audit snapshots redact password and invitation token hashes',
    password.status === 200 && !serialized.includes('password_hash') && !serialized.includes('token_hash'), serialized);

  const digestCheck = await query(`
    SELECT COUNT(*)::int AS invalid FROM audit_events e
    WHERE e.organization_id = 'org1' AND e.event_hash <> encode(digest(concat_ws('|',
      e.id::text, e.occurred_at::text, COALESCE(e.organization_id,''), COALESCE(e.actor_user_id,''),
      COALESCE(e.request_id,''), e.action, e.entity_type, e.entity_id,
      COALESCE(e.before_state::text,''), COALESCE(e.after_state::text,''), COALESCE(e.previous_hash,'')), 'sha256'), 'hex')
  `);
  record('DEVOS-EF3-HASH-001', 'Stored event hashes recompute from canonical event fields', digestCheck.rows[0].invalid === 0,
    `${digestCheck.rows[0].invalid} invalid hashes`);

  const originalCount = results.length;
  await runEF3AdversarialTests(record);

  const passedCount = results.filter(r => r.passed).length;
  const redCount = results.length - passedCount;
  const original = results.slice(0, originalCount);
  const adversarial = results.slice(originalCount);
  const breakdown = {
    original: { passed: original.filter(r => r.passed).length, total: original.length },
    adversarial: { passed: adversarial.filter(r => r.passed).length, total: adversarial.length },
  };
  console.log(`DEVOS-EF-3 ORIGINAL ACCEPTANCE: ${breakdown.original.passed}/${breakdown.original.total} PASSED`);
  console.log(`DEVOS-EF-3 ADVERSARIAL REGRESSION: ${breakdown.adversarial.passed}/${breakdown.adversarial.total} PASSED`);
  console.log(`DEVOS-EF-3 ACCEPTANCE SUMMARY: ${passedCount}/${results.length} PASSED`);
  return { passedCount, redCount, failedCount: redCount, total: results.length, results, breakdown };
}

if (require.main === module) runEF3AcceptanceSuite().then(r => stopTestServer().then(() => process.exit(r.failedCount ? 1 : 0)));
module.exports = { runEF3AcceptanceSuite };
