# DeveloperOS Operational Runbook: Persistence & Database Operations

## 1. Clean Startup
DeveloperOS uses two PostgreSQL roles (EF-3 remediation). The API never runs
as the schema owner and never migrates schema on boot.

| Variable | Role | Used by |
|---|---|---|
| `MIGRATION_DATABASE_URL` | schema owner; owns all tables incl. the audit ledger | `npm run db:migrate`, `npm run db:seed` (test DBs only) |
| `DATABASE_URL` | runtime role: non-superuser, owns nothing, read-only on ledger tables | the API (`npm start`) |
| `AUDIT_SIGNING_KEY` | Ed25519 private key (base64 PKCS#8 DER) for checkpoint receipts | the API; **required in production** |

```bash
# 1. Install locked dependencies
npm ci

# 2. Configure .env (see .env.example for every variable)

# 3. Apply migrations as the owner. On first run this creates the runtime
#    LOGIN role named in DATABASE_URL (owner needs CREATEROLE; otherwise a DBA
#    creates it first) and grants it exactly the runtime privileges.
npm run db:migrate

# 4. Start the API as the runtime role
npm start
```

Before listening, `server.js` refuses to start (exit 1, nothing served) if:
- the `DATABASE_URL` role is a superuser, has CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS,
  owns or can write/TRUNCATE/TRIGGER any ledger table;
- any migration in `db/migrations/` is not applied;
- `NODE_ENV=production` and `AUDIT_SIGNING_KEY` is missing or not Ed25519.

## 2. Migration Execution
```bash
npm run db:migrate        # node db/migrate.js, as MIGRATION_DATABASE_URL
```
The runner takes an advisory lock, applies unapplied files from `db/migrations/` in one
transaction, records them in `schema_migrations`, then re-applies runtime grants
(`devos_apply_runtime_grants`) so tables added by later migrations are covered.

**Upgrading an EF-3 (hash_version 1) ledger:** `005_audit_ledger_v2.sql` does not rewrite
historical events. For each organization with v1 history it appends a v2 `GENESIS` event
that attests the legacy segment (event count, head hash, and the session `TimeZone`/`DateStyle`
the v1 digests depend on) and links to the legacy head. Verification checks the legacy
segment under those pinned settings, then the v2 chain.

## 3. Audit Ledger Operations
- `GET /api/audit/verify`: full cryptographic verification of the active organization's chain.
- `POST /api/audit/checkpoints`: issue a signed checkpoint receipt for the current head.
  **Store receipts outside DeveloperOS** (tenant/auditor storage, WORM bucket). They are
  the only evidence that survives a full database compromise.
- `POST /api/audit/verify` with `{ "receipts": [...] }`: verify and also check retained receipts.
- `GET /api/audit/signing-key`: public key and key id for offline receipt verification.
- **Key rotation:** set the new `AUDIT_SIGNING_KEY` and add the retired public key (from
  `/api/audit/signing-key` before rotating) to `AUDIT_TRUSTED_PUBLIC_KEYS`, or earlier
  checkpoints will fail verification with `CHECKPOINT_UNTRUSTED_KEY`.

## 3a. Database Seeding & Reset (test databases only)
```bash
npm run db:seed
```
Runs as the owner role, refuses any database not named `*_test` (unless
`ALLOW_DESTRUCTIVE_SEED=true`), truncates business tables, and re-inserts the canonical
fixture from `tests/fixtures/canonical-v1-fixture.json`. Ledger tables are never truncated.

## 4. Test Suite Execution
```bash
npm run test:gate        # syntax check + every suite; the authoritative gate (also run by CI)
npm run test:clean-db    # empty-database bootstrap gate only
npm run test:ef3         # EF-3 original (11) + adversarial (27)
```
Every gate run **drops and recreates** `<db>_test`, applies all migrations as the owner,
provisions a dedicated runtime role (`devos_app_test`, random password per run), seeds,
and runs the API and runtime-path tests as that role. Only `MIGRATION_DATABASE_URL`
(owner credentials) is required. Set `DEVOS_REUSE_TEST_DB=true` to skip the recreate
for local iteration; the clean-DB gate then reports FAILED by design.

CI: `.github/workflows/developeros-gate.yml` runs `npm run test:gate` against an empty
`postgres:18` service container on every push/PR touching `developeros-backend/`.

## 5. Troubleshooting
- **PostgreSQL Port 5432 In Use**: If an external PostgreSQL service is already listening on 5432, point `MIGRATION_DATABASE_URL`/`DATABASE_URL` at it; the embedded engine is only started when nothing listens.
- **Embedded engine as root**: `initdb` drops to the `postgres` OS user; pre-create the data dir with `mkdir .pgdata && chown postgres .pgdata` (or set `PG_DATA_DIR`).
- **"Refusing to run with privileged database role"**: `DATABASE_URL` points at the owner/superuser. Use the dedicated runtime role.
- **Encoding Issues**: If non-ASCII characters fail on Windows, ensure the cluster is initialized with `-E UTF8 --locale=C`.
- **Stale Process / Connection Pool**: When stopping the server programmatically, call `closePool()` from `db/pool.js` and `server.closeAllConnections()` to prevent lingering socket handles.
