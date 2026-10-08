# DeveloperOS Operational Runbook: Persistence & Database Operations

Production deployment and day-2 operations: sections 6–11. Deployment
walkthroughs (compose and bare host): [`../README.md`](../README.md).

> **Fresh production stacks have no users.** After the first migration, create
> the first platform administrator with `scripts/bootstrap-platform-admin.js`
> (owner credentials; see the README). That administrator provisions tenant
> organizations from the **Organizations** page. Without SMTP, operators issue
> password-reset links with `node scripts/password-reset-link.js <email>`.
> Never run `npm run db:seed` in production.

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
- **Embedded engine scope**: `db/pg-engine.js` starts the embedded engine (devDependency `embedded-postgres`) only when the URL host is loopback (`127.0.0.1`, `localhost`, `::1`) **and** `NODE_ENV` is not `production` (`DEVOS_EMBEDDED_PG=false` disables it everywhere). In production, or with a remote/compose host such as `db:5432`, the process connects only to the configured database and exits with the connection error (e.g. `ECONNREFUSED`) if it is unreachable.
- **Embedded engine as root**: `initdb` drops to the `postgres` OS user; pre-create the data dir with `mkdir .pgdata && chown postgres .pgdata` (or set `PG_DATA_DIR`).
- **"Refusing to run with privileged database role"**: `DATABASE_URL` points at the owner/superuser. Use the dedicated runtime role.
- **Encoding Issues**: If non-ASCII characters fail on Windows, ensure the cluster is initialized with `-E UTF8 --locale=C`.
- **Stale Process / Connection Pool**: When stopping the server programmatically, call `closePool()` from `db/pool.js` and `server.closeAllConnections()` to prevent lingering socket handles.

## 6. Production Deploy (compose)
All commands from `developeros-backend/`. Shorthand used below:
```bash
DC="docker compose -f deploy/compose.yaml --env-file deploy/.env.production"
```
1. `cp deploy/.env.production.example deploy/.env.production`, paste the output of
   `node scripts/generate-secrets.js`, set `FRONTEND_URL`, `chmod 600`. Store the file
   (at minimum `AUDIT_SIGNING_KEY` and the DB passwords) in a secrets manager.
2. `$DC up -d --build --wait` — `db` becomes healthy, `migrate` applies all migrations
   as the owner and provisions the runtime role, then `app` starts as the runtime role.
3. Verify: `$DC ps -a` (migrate `Exited (0)`, app/db `healthy`),
   `curl -fsS http://127.0.0.1:3000/health`, and
   `$DC run --rm --no-deps -e NODE_ENV=production app node scripts/verify-database.js`
   (runtime-role guard, no pending migrations, audit-ledger verification; read-only).

Credential separation: only `migrate` receives the owner URL; `app` receives only
`DATABASE_URL` (runtime role), `JWT_SECRET`, `AUDIT_SIGNING_KEY`,
`AUDIT_TRUSTED_PUBLIC_KEYS`, `FRONTEND_URL`, `TRUST_PROXY`. The db port is never
published; the app port is published on `DEVOS_HTTP_BIND` (default `127.0.0.1`).
The app writes its access log to the `applogs` volume (`/app/logs/access.log`);
errors go to `$DC logs app`.

## 7. Upgrade (migrate, then restart)
```bash
git pull                                  # or check out the release tag
deploy/backup.sh                          # always back up before migrating
$DC build
$DC up -d --wait                          # re-runs migrate (idempotent); app is recreated only after it exits 0
$DC logs --no-log-prefix migrate          # "[MIGRATE] Migration complete. Applied N new migration(s)."
```
If `migrate` fails, `app` is not recreated and the previous container keeps serving;
fix the cause and re-run. If an already-running old app sees a newer schema it keeps
running, but a restarted app refuses to start while any migration is pending
(`pending migrations (...); run npm run db:migrate`). Rollback = restore the
pre-upgrade backup (section 9) and redeploy the previous image; migrations are
forward-only.

Bare host: `systemctl start developeros-migrate && systemctl restart developeros`.

## 8. Backup
```bash
deploy/backup.sh                          # -> deploy/backups/developeros-<UTC>.dump/.counts.tsv/.sha256
BACKUP_DATABASE_URL=postgresql://owner:pw@host:5432/developeros deploy/backup.sh /srv/backups   # external DB, pg_dump 18 client
```
- `pg_dump -Fc` of the application database, taken from one exported snapshot; the
  `.counts.tsv` holds the exact row count of every table **in that same snapshot**, so
  the restore drill can check completeness exactly even while the app is writing.
- Default mode runs `pg_dump`/`psql` inside the `db` container (version always matches
  the server); no password leaves the container.
- Schedule it (cron/systemd timer), copy the three files off the host (object storage
  with retention / WORM), and alert on non-zero exit.

**Audit ledger and `AUDIT_SIGNING_KEY` are backed up together.** The ledger
(`audit_events`, `audit_chain_heads`, `audit_checkpoints`) is in the dump; the signing
key is deliberately *not* in the database. Stored checkpoints and external receipts
only verify with the key that signed them (or its public key in
`AUDIT_TRUSTED_PUBLIC_KEYS`). Restoring a dump with a different key makes every chain
with checkpoints fail verification with `CHECKPOINT_UNTRUSTED_KEY`. Therefore:
- keep the env file / secrets-manager entry with `AUDIT_SIGNING_KEY` in a backup that is
  retained at least as long as the dumps (separate storage and access control from the
  dumps; the key is a signing secret);
- after rotating the key, keep the retired public key in `AUDIT_TRUSTED_PUBLIC_KEYS`
  for as long as any backup or receipt signed with it is retained.

## 9. Restore drill (and real restore)
```bash
deploy/restore-drill.sh                   # newest dump in deploy/backups
deploy/restore-drill.sh /srv/backups/developeros-20261008T135010Z.dump
```
The drill never touches production: it starts a throwaway `POSTGRES_IMAGE` container
(no network, tmpfs), creates the runtime role, `pg_restore --exit-on-error`, compares
every table's row count with the backup's `.counts.tsv`, then runs
`scripts/verify-database.js` from the app image **as the runtime role** against the
restored copy: runtime-role guard, `schema_migrations` complete, runtime reads, and full
audit-ledger verification with the env file's `AUDIT_SIGNING_KEY`. It prints
`[DRILL] PASSED` and exits 0 only if everything passed, and removes the container.
Run it after every schedule change and at least monthly; keep the output as evidence.

Real restore into the compose stack (destroys current data):
```bash
$DC stop app
$DC exec -T db dropdb -U devos_owner --force developeros
$DC exec -T db createdb -U devos_owner developeros
$DC exec -T db pg_restore --exit-on-error -U devos_owner -d developeros < deploy/backups/<file>.dump
$DC up -d --wait                          # migrate re-applies runtime grants; app starts
```
The runtime role is cluster-global and survives `dropdb`; on a new cluster the
`migrate` run recreates it before the app starts (restore first, then `up`). Use the
`AUDIT_SIGNING_KEY` that was active when the backup was taken (or list it as trusted).

## 10. Secret rotation
| Secret | Procedure |
|---|---|
| Runtime DB password (`DEVOS_RUNTIME_PASSWORD`) | Set the new value in the env file, then `$DC run --rm -e DEVOS_SYNC_RUNTIME_PASSWORD=true migrate` (migrate runs `ALTER ROLE ... PASSWORD` from `DATABASE_URL`), then `$DC up -d --wait app`. The old app keeps its open connections until it is recreated. Bare host: same with `DEVOS_SYNC_RUNTIME_PASSWORD=true` in the migrate environment for one run. |
| Owner DB password (`POSTGRES_OWNER_PASSWORD`) | `$DC exec db psql -U devos_owner -d developeros -c "ALTER ROLE devos_owner PASSWORD '<new>'"`, then update the env file. (The `db` container only reads `POSTGRES_PASSWORD` when initialising an empty volume.) |
| `JWT_SECRET` | Update the env file, `$DC up -d --wait app`. All sessions are invalidated; users sign in again. |
| `AUDIT_SIGNING_KEY` | Before rotating, record the current public key from `GET /api/audit/signing-key` and append it to `AUDIT_TRUSTED_PUBLIC_KEYS`; set the new key; `$DC up -d --wait app`; back up the new env file (section 8). |

`scripts/rotate-db-credentials.js` is a one-off for the local **embedded** development
cluster (it moves the embedded engine's port and rewrites `.env`). It is not a
production tool and does not apply to the compose or bare-host deployments.

## 11. TLS and reverse proxy
The app speaks plain HTTP and must sit behind TLS termination (nginx, Caddy, HAProxy,
or a cloud load balancer). Helmet already sends `Strict-Transport-Security`
(1 year, includeSubDomains, preload) and a CSP with `upgrade-insecure-requests`, so the
site must be served over HTTPS only — HSTS is cached by browsers for a year.
- Keep the app port on loopback (`DEVOS_HTTP_BIND=127.0.0.1`) or a private network and
  proxy `https://<domain>/` → `http://127.0.0.1:3000/` (the app serves both UI and API).
- Set `TRUST_PROXY` to the number of proxy hops (compose default `1`) so rate limiting
  sees real client IPs from `X-Forwarded-For`; the proxy must overwrite, not append to,
  untrusted `X-Forwarded-For`. Leave it empty only if the app is exposed directly.
- Set `FRONTEND_URL` to the public `https://` origin (CORS allow-list).
- Minimal nginx server block:
```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name developeros.example.com;
    ssl_certificate     /etc/letsencrypt/live/developeros.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/developeros.example.com/privkey.pem;
    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
server { listen 80; server_name developeros.example.com; return 301 https://$host$request_uri; }
```
