// ══════════════════════════════════════════════════════════════
// DEVOS-EF-3 ADVERSARIAL REGRESSION — permanent ledger attack tests
//
// Every test here attacks a guarantee the audit ledger claims. Attacks run
// through the real application runtime pool (the role DeveloperOS serves
// traffic with) or, where a test models a privileged attacker, through an
// owner/privileged connection. Verification is always the product's own
// verification service/API — tests never substitute their own verifier.
// ══════════════════════════════════════════════════════════════

const { Client } = require('pg');
const crypto = require('crypto');
const { apiRequest, loginAs } = require('./helpers');
const { query, getPool } = require('../db/pool');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function privilegedUrl() {
  if (process.env.MIGRATION_DATABASE_URL) return process.env.MIGRATION_DATABASE_URL;
  const u = new URL(process.env.ADMIN_DATABASE_URL);
  u.pathname = new URL(process.env.DATABASE_URL).pathname;
  return u.toString();
}

async function withPrivileged(fn) {
  const client = new Client({ connectionString: privilegedUrl() });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

async function withRuntime(fn) {
  const client = await (await getPool()).connect();
  try { return await fn(client); } finally { client.release(); }
}

// Runs an attack as the runtime role inside a transaction that is always
// rolled back, so a successful attack never damages the shared test ledger.
async function runtimeAttack(statements) {
  return withRuntime(async client => {
    await client.query('BEGIN');
    try {
      for (const [sql, params] of statements) await client.query(sql, params);
      return { rejected: false };
    } catch (err) {
      return { rejected: true, message: err.message };
    } finally {
      await client.query('ROLLBACK').catch(() => {});
    }
  });
}

// Privileged tamper: disables the append-only trigger, mutates, re-enables.
async function privilegedTamper(sql, params) {
  return withPrivileged(async client => {
    await client.query('BEGIN');
    try {
      await client.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
      const result = await client.query(sql, params);
      await client.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  });
}

let hasChainSeq = null;
async function chainOrder() {
  if (hasChainSeq === null) {
    const { rowCount } = await query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_events' AND column_name = 'chain_seq'`);
    hasChainSeq = rowCount === 1;
  }
  return hasChainSeq ? 'chain_seq' : 'occurred_at, id';
}

async function chainEvents(organizationId) {
  const order = await chainOrder();
  const { rows } = await query(`SELECT * FROM audit_events WHERE organization_id = $1 ORDER BY ${order}`, [organizationId]);
  return rows;
}

// Isolated tenant with its own chain, so destructive tamper tests never touch
// another tenant's evidence. Built through the runtime role and the real API.
async function createSandboxTenant(label, projectCount = 4) {
  const suffix = `${label}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`.toLowerCase();
  const organizationId = `sbx-${suffix}`.slice(0, 60);
  const userId = `u-${suffix}`.slice(0, 60);
  const email = `${suffix}@ef3.test`;
  const { rows: [admin] } = await query(`SELECT password_hash FROM users WHERE email = 'admin@developeros.com'`);
  await query(`INSERT INTO organizations (id, name, type, plan) VALUES ($1, $2, 'developer', 'enterprise')`, [organizationId, `Sandbox ${label}`]);
  await query(`INSERT INTO users (id, org_id, name, email, password_hash, role, active) VALUES ($1, $2, $3, $4, $5, 'developer', TRUE)`,
    [userId, organizationId, `Sandbox ${label}`, email, admin.password_hash]);
  await query(`INSERT INTO memberships (id, user_id, organization_id, role_id, status) VALUES ($1, $2, $3, 'org-admin', 'ACTIVE')`,
    [`m-${suffix}`.slice(0, 60), userId, organizationId]);
  const session = await loginAs(email);
  const headers = { Authorization: `Bearer ${session.token}`, 'X-Organization-Id': organizationId };
  const projectIds = [];
  for (let i = 0; i < projectCount; i++) {
    const id = `${organizationId}-p${i}`;
    const res = await apiRequest('POST', '/api/projects', { headers, body: { id, name: `Sandbox Project ${i}`, type: 'audit-test', units: 1, budget: 100 + i } });
    if (res.status !== 201) throw new Error(`sandbox project create failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
    projectIds.push(id);
  }
  return { organizationId, userId, headers, projectIds };
}

async function projectInsertEvent(organizationId, projectId) {
  const { rows } = await query(`SELECT * FROM audit_events WHERE organization_id = $1 AND entity_type = 'projects' AND entity_id = $2 AND action = 'INSERT'`, [organizationId, projectId]);
  return rows[0];
}

async function apiVerify(tenant, body) {
  return body
    ? apiRequest('POST', '/api/audit/verify', { headers: tenant.headers, body })
    : apiRequest('GET', '/api/audit/verify', { headers: tenant.headers });
}

// Recomputes stored digests with the ledger's own hashing for each stored
// hash version. Before remediation the only algorithm is the v1 formula.
async function ledgerRecomputeInvalid(client, organizationId) {
  const { rowCount: hasFn } = await client.query(`SELECT 1 FROM pg_proc WHERE proname = 'devos_audit_event_hash'`);
  const sql = hasFn
    ? `SELECT COUNT(*)::int AS invalid FROM audit_events e WHERE e.organization_id = $1 AND e.hash_version >= 2 AND e.event_hash <> devos_audit_event_hash(e)`
    : `SELECT COUNT(*)::int AS invalid FROM audit_events e WHERE e.organization_id = $1 AND e.event_hash <> encode(digest(concat_ws('|',
        e.id::text, e.occurred_at::text, COALESCE(e.organization_id,''), COALESCE(e.actor_user_id,''),
        COALESCE(e.request_id,''), e.action, e.entity_type, e.entity_id,
        COALESCE(e.before_state::text,''), COALESCE(e.after_state::text,''), COALESCE(e.previous_hash,'')), 'sha256'), 'hex')`;
  return (await client.query(sql, [organizationId])).rows[0].invalid;
}

async function runEF3AdversarialTests(record) {
  console.log('\n--- EF-3 ADVERSARIAL REGRESSION (EF3-D1 … EF3-D5) ---');
  const newest = async () => (await query(`SELECT id FROM audit_events ORDER BY occurred_at DESC LIMIT 1`)).rows[0].id;

  // ── EF3-D1: ledger privilege / append-only bypass ─────────────────────────
  const role = await withRuntime(async client => (await client.query(`
    SELECT current_user AS role, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
           pg_has_role(current_user, c.relowner, 'USAGE') AS owns_ledger
    FROM pg_roles r, pg_class c WHERE r.rolname = current_user AND c.oid = 'public.audit_events'::regclass`)).rows[0]);
  record('DEVOS-EF3-D1-ROLE-001', 'Runtime database role is not superuser, not ledger owner, and holds no role-admin/replication/RLS-bypass attributes',
    !role.rolsuper && !role.owns_ledger && !role.rolcreaterole && !role.rolcreatedb && !role.rolreplication && !role.rolbypassrls,
    JSON.stringify(role));

  const target = await newest();
  const upd = await runtimeAttack([[`UPDATE audit_events SET action = 'FORGED' WHERE id = $1`, [target]]]);
  record('DEVOS-EF3-D1-UPDATE-001', 'Runtime role cannot UPDATE audit_events', upd.rejected, upd.message || 'UPDATE succeeded');

  const del = await runtimeAttack([[`DELETE FROM audit_events WHERE id = $1`, [target]]]);
  record('DEVOS-EF3-D1-DELETE-001', 'Runtime role cannot DELETE from audit_events', del.rejected, del.message || 'DELETE succeeded');

  const trunc = await runtimeAttack([[`TRUNCATE audit_events`]]);
  record('DEVOS-EF3-D1-TRUNCATE-001', 'Runtime role cannot TRUNCATE audit_events', trunc.rejected, trunc.message || 'TRUNCATE succeeded (rolled back)');

  const disable = await runtimeAttack([
    ['ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only'],
    [`UPDATE audit_events SET action = 'FORGED' WHERE id = $1`, [target]],
  ]);
  const drop = await runtimeAttack([['DROP TRIGGER audit_events_append_only ON audit_events']]);
  const replace = await runtimeAttack([[`CREATE OR REPLACE FUNCTION devos_block_audit_mutation() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql`]]);
  record('DEVOS-EF3-D1-TRIGGER-001', 'Runtime role cannot disable, drop, or replace the ledger protection trigger',
    disable.rejected && drop.rejected && replace.rejected,
    `disable: ${disable.message || 'ALLOWED'}; drop: ${drop.message || 'ALLOWED'}; replace: ${replace.message || 'ALLOWED'}`);

  const replica = await runtimeAttack([
    [`SET LOCAL session_replication_role = replica`],
    [`UPDATE audit_events SET action = 'FORGED' WHERE id = $1`, [target]],
  ]);
  record('DEVOS-EF3-D1-REPLICA-001', 'Runtime role cannot suppress triggers via session_replication_role', replica.rejected, replica.message || 'replica-mode UPDATE succeeded');

  const forge = await runtimeAttack([[`INSERT INTO audit_events (organization_id, action, entity_type, entity_id, event_hash) VALUES ('org1', 'INSERT', 'projects', 'forged', $1)`, [crypto.randomBytes(32).toString('hex')]]]);
  record('DEVOS-EF3-D1-FORGE-001', 'Runtime role cannot insert forged audit events directly', forge.rejected, forge.message || 'forged INSERT succeeded');

  // ── EF3-D2: product verification must cryptographically verify ──────────
  {
    const tenant = await createSandboxTenant('d2');
    const victim = await projectInsertEvent(tenant.organizationId, tenant.projectIds[1]);
    await privilegedTamper(`UPDATE audit_events SET after_state = jsonb_set(after_state, '{budget}', '"999999999"') WHERE id = $1`, [victim.id]);
    const res = await apiVerify(tenant);
    const body = JSON.stringify(res.body);
    record('DEVOS-EF3-D2-TAMPER-001', 'Product /api/audit/verify detects content tampering when the stored hash is left unchanged',
      res.status === 200 && res.body.valid === false && res.body.failure?.reason === 'HASH_MISMATCH' && res.body.failure?.eventId === victim.id && !body.includes('999999999'),
      body);
  }
  {
    const tenant = await createSandboxTenant('d2m');
    const victim = await projectInsertEvent(tenant.organizationId, tenant.projectIds[2]);
    await privilegedTamper(`UPDATE audit_events SET actor_user_id = 'someone-else' WHERE id = $1`, [victim.id]);
    const res = await apiVerify(tenant);
    record('DEVOS-EF3-D2-TAMPER-002', 'Product verification detects tampering of attribution metadata (actor)',
      res.status === 200 && res.body.valid === false && res.body.failure?.reason === 'HASH_MISMATCH' && res.body.failure?.eventId === victim.id,
      JSON.stringify(res.body));
  }

  // ── EF3-D3: deletion detection (middle + tail) ────────────────────────────
  {
    const tenant = await createSandboxTenant('d3m');
    const victim = await projectInsertEvent(tenant.organizationId, tenant.projectIds[1]);
    await privilegedTamper('DELETE FROM audit_events WHERE id = $1', [victim.id]);
    const res = await apiVerify(tenant);
    record('DEVOS-EF3-D3-MIDDLE-001', 'Product verification detects deletion of a middle event as a sequence gap',
      res.status === 200 && res.body.valid === false && res.body.failure?.reason === 'SEQUENCE_GAP',
      JSON.stringify(res.body));
  }
  {
    const tenant = await createSandboxTenant('d3t');
    const events = await chainEvents(tenant.organizationId);
    const tail = events[events.length - 1];
    await privilegedTamper('DELETE FROM audit_events WHERE id = $1', [tail.id]);
    const res = await apiVerify(tenant);
    record('DEVOS-EF3-D3-TAIL-001', 'Product verification detects deletion of the newest event (tail truncation)',
      res.status === 200 && res.body.valid === false && res.body.failure?.reason === 'TAIL_TRUNCATED',
      JSON.stringify(res.body));
  }

  // ── EF3-D4: timezone-independent hashing ──────────────────────────────────
  {
    const tenant = await createSandboxTenant('d4', 2);
    // An event committed by a session in a non-UTC timezone.
    await withRuntime(async client => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL TimeZone = 'Asia/Tokyo'`);
      await client.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, 'Tokyo session evidence')`, [`${tenant.organizationId}-tokyo`, tenant.organizationId]);
      await client.query('COMMIT');
    });
    const { verify } = require('../db/repositories/audit.repo');
    const zones = ['UTC', 'America/Chicago', 'Asia/Kolkata', 'Pacific/Chatham'];
    const outcomes = [];
    for (const zone of zones) {
      outcomes.push(await withRuntime(async client => {
        await client.query(`SET TimeZone = '${zone}'`);
        await client.query(`SET DateStyle = '${zone === 'UTC' ? 'ISO, MDY' : 'SQL, DMY'}'`);
        try {
          const result = await verify(tenant.organizationId, { client });
          const invalid = await ledgerRecomputeInvalid(client, tenant.organizationId);
          return { zone, valid: result.valid, hashesVerified: result.hashesVerified, count: result.count, head: result.headHash, invalid };
        } finally {
          await client.query('RESET TimeZone');
          await client.query('RESET DateStyle');
        }
      }));
    }
    const consistent = outcomes.every(o => o.valid === true && o.invalid === 0 && o.count > 0 && o.hashesVerified === o.count && o.head === outcomes[0].head);
    record('DEVOS-EF3-D4-TIMEZONE-001', 'Ledger hashes recompute and verify identically from UTC, America/Chicago, Asia/Kolkata and Pacific/Chatham sessions',
      consistent, JSON.stringify(outcomes));
  }

  // ── EF3-D5: untrusted X-Request-Id ───────────────────────────────────────
  {
    const admin = await loginAs('admin@developeros.com');
    const cases = [
      { label: 'oversized', header: 'A'.repeat(500), preserved: false },
      { label: 'malformed', header: 'bad id; DROP TABLE audit_events', preserved: false },
      { label: 'valid', header: 'ef3-corr.ID_01', preserved: true },
    ];
    const outcomes = [];
    for (const c of cases) {
      const id = `ef3-reqid-${c.label}-${Date.now()}`;
      const res = await apiRequest('POST', '/api/projects', {
        headers: { Authorization: `Bearer ${admin.token}`, 'X-Request-Id': c.header },
        body: { id, name: `Request ID ${c.label}`, type: 'audit-test' },
      });
      const event = res.status === 201 ? await projectInsertEvent('org1', id) : null;
      const echoed = res.headers['x-request-id'];
      const ok = res.status === 201 && !!event && REQUEST_ID_PATTERN.test(event.request_id || '') &&
        echoed === event.request_id && (c.preserved ? event.request_id === c.header : event.request_id !== c.header);
      outcomes.push({ label: c.label, status: res.status, recorded: event?.request_id, echoed, ok });
    }
    record('DEVOS-EF3-D5-REQUESTID-001', 'Oversized/malformed X-Request-Id is replaced server-side and never breaks an audited write; valid IDs are preserved',
      outcomes.every(o => o.ok), JSON.stringify(outcomes));
  }
}

module.exports = {
  runEF3AdversarialTests,
  // shared with later adversarial sections
  withPrivileged, withRuntime, runtimeAttack, privilegedTamper, createSandboxTenant, projectInsertEvent, chainEvents, apiVerify,
};
