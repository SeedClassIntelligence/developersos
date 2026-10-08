# DeveloperOS — Deployment Guide

DeveloperOS is one Node.js 22 service (Express API + the static UI in `public/`)
backed by PostgreSQL 18. This guide covers production deployment. Day-2
operations (upgrade, backup, restore drill, secret rotation, TLS) are in
[`docs/OPERATIONAL-RUNBOOK.md`](docs/OPERATIONAL-RUNBOOK.md).

> **No users exist on a fresh deployment.** Create the first platform
> administrator once, with the schema-owner credentials, after migrations:
>
> ```bash
> # compose: run inside the one-shot migrate service (it holds the owner URL)
> docker compose -f deploy/compose.yaml --env-file deploy/.env.production run --rm \
>   -e BOOTSTRAP_ADMIN_PASSWORD='<12+ chars>' migrate \
>   node scripts/bootstrap-platform-admin.js --email ops@example.com --name "Ops Admin"
> # bare host: MIGRATION_DATABASE_URL set in .env
> node scripts/bootstrap-platform-admin.js --email ops@example.com --name "Ops Admin"
> ```
>
> Sign in as that administrator, open **Organizations**, and create each tenant
> organization with its first administrator's email. The invitation is emailed
> when SMTP is configured; otherwise copy the link shown and send it securely.
> Production never runs `npm run db:seed` (it is a destructive, test-only
> fixture loader and refuses non-`*_test` databases).

## How it fits together

| Piece | What it is |
|---|---|
| `MIGRATION_DATABASE_URL` | **Schema owner.** Used only by `npm run db:migrate`. Owns every table, including the audit ledger. On first run it creates the runtime role (needs CREATEROLE) and on every run re-applies the runtime role's grants. Never given to the API. |
| `DATABASE_URL` | **Runtime role** the API connects as: non-superuser, owns nothing, read-only on ledger tables. The API refuses to start if this role is privileged, if any migration is pending, or (production) if `AUDIT_SIGNING_KEY` is missing. |
| `JWT_SECRET` | Session token signing secret. Required. |
| `AUDIT_SIGNING_KEY` | Ed25519 private key (base64 PKCS#8 DER) that signs audit checkpoint receipts. Required in production. Lives only in the app environment, never in the database; **back it up with the database backups.** |
| `NODE_ENV=production`, `HOST` | `HOST` defaults to `127.0.0.1` in production. The container image sets `HOST=0.0.0.0`. |

Production connects only to the database in its URLs. The embedded PostgreSQL
engine (`embedded-postgres`, a devDependency) is a local dev/test convenience:
it is used only when the URL host is loopback **and** `NODE_ENV` is not
`production`, and it is not installed in the production image.

## Path A — Docker Compose (recommended)

Files: `Dockerfile`, `deploy/compose.yaml`, `deploy/.env.production.example`.
The stack has three services:

- `db` — PostgreSQL 18 (`POSTGRES_IMAGE`, default `postgres:18`), data in the
  `pgdata` volume. Its port is **not** published to the host.
- `migrate` — one-shot, same app image, runs `npm run db:migrate` with the owner
  URL, then exits 0.
- `app` — the API/UI as the runtime role only; starts after `migrate` has
  completed successfully. Runs as the non-root `node` user, read-only root
  filesystem, all capabilities dropped. Published on `127.0.0.1:3000` by default
  for a reverse proxy on the same host.

Requirements: Docker Engine with Compose v2.

```bash
cd developeros-backend

# 1. Configuration + secrets (deploy/.env.production is never committed)
cp deploy/.env.production.example deploy/.env.production
node scripts/generate-secrets.js     # prints JWT_SECRET, AUDIT_SIGNING_KEY, 2 DB passwords
#    paste the four lines into deploy/.env.production, set FRONTEND_URL, then:
chmod 600 deploy/.env.production
#    store a copy of the file (at least AUDIT_SIGNING_KEY) in your secrets manager

# 2. Build and start (db -> migrate -> app)
docker compose -f deploy/compose.yaml --env-file deploy/.env.production up -d --build --wait

# 3. Check
docker compose -f deploy/compose.yaml --env-file deploy/.env.production ps -a
#    migrate: Exited (0)   app: Up (healthy)   db: Up (healthy)
curl -fsS http://127.0.0.1:3000/health
#    {"status":"ok","version":"1.0.0","env":"production"}
```

No Node.js on the host? Generate secrets with the image instead:
`docker run --rm developeros:local node scripts/generate-secrets.js`
(after `docker compose ... build`).

Building behind a TLS-intercepting egress proxy: pass the proxy and its CA as
a build secret (it is not stored in the image):
`docker build --secret id=npm_ca,src=/path/ca.crt --build-arg HTTPS_PROXY=http://proxy:port -t developeros:local .`
To use a registry mirror for the base images, set `NODE_IMAGE` and
`POSTGRES_IMAGE` in the env file (e.g. `mirror.gcr.io/library/node:22-bookworm-slim`,
`mirror.gcr.io/library/postgres:18`).

Then put the app behind TLS (see the runbook, "TLS and reverse proxy") and set
up backups (`deploy/backup.sh`) and restore drills (`deploy/restore-drill.sh`).

### Using an external / managed PostgreSQL 18

Remove the `db` service (and the `depends_on: db` entries) from a copy of
`deploy/compose.yaml`, point the two URLs at your server, and create the
owner role yourself. The owner needs to own the database and either
CREATEROLE (so the first migrate creates the runtime role) or a DBA creates
the runtime LOGIN role beforehand with
`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. Use
`BACKUP_DATABASE_URL` with `deploy/backup.sh` (needs a `pg_dump` 18 client).

## Path B — bare host (systemd, no containers)

Requirements: Node.js 22, PostgreSQL 18 reachable from the host, a reverse
proxy for TLS.

```bash
# As root: service user and code
useradd --system --home /opt/developeros --shell /usr/sbin/nologin developeros
git clone <repo> /opt/developeros/src            # or copy a release
cd /opt/developeros/src/developeros-backend
npm ci --omit=dev                                # production deps only
mkdir -p logs && chown developeros: logs         # access log (NODE_ENV=production)

# Database: an owner role that owns the database and may create roles
sudo -u postgres psql -c "CREATE ROLE devos_owner LOGIN CREATEROLE PASSWORD '<owner-password>'"
sudo -u postgres psql -c "CREATE DATABASE developeros OWNER devos_owner"
```

Write two environment files (mode 600, owned by root), so the API process
never sees the owner credentials:

`/etc/developeros/migrate.env`
```
NODE_ENV=production
MIGRATION_DATABASE_URL=postgresql://devos_owner:<owner-password>@127.0.0.1:5432/developeros
DATABASE_URL=postgresql://devos_app:<runtime-password>@127.0.0.1:5432/developeros
```

`/etc/developeros/app.env`
```
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://devos_app:<runtime-password>@127.0.0.1:5432/developeros
JWT_SECRET=<from scripts/generate-secrets.js>
AUDIT_SIGNING_KEY=<from scripts/generate-secrets.js>
FRONTEND_URL=https://developeros.example.com
TRUST_PROXY=1
```

Migrations run as a one-shot unit with the owner environment; the API unit
gets only the runtime environment.

`/etc/systemd/system/developeros-migrate.service`
```ini
[Unit]
Description=DeveloperOS database migrations (schema owner)
After=network-online.target postgresql.service

[Service]
Type=oneshot
User=developeros
WorkingDirectory=/opt/developeros/src/developeros-backend
EnvironmentFile=/etc/developeros/migrate.env
ExecStart=/usr/bin/node db/migrate.js
```

`/etc/systemd/system/developeros.service`
```ini
[Unit]
Description=DeveloperOS API
After=network-online.target postgresql.service

[Service]
User=developeros
WorkingDirectory=/opt/developeros/src/developeros-backend
EnvironmentFile=/etc/developeros/app.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/developeros/src/developeros-backend/logs
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl start developeros-migrate      # check: journalctl -u developeros-migrate
systemctl enable --now developeros
curl -fsS http://127.0.0.1:3000/health
```

Do not run the app from a `.env` that also contains `MIGRATION_DATABASE_URL`;
keeping the files separate is what keeps owner credentials out of the API
process.

## Local development

```bash
npm ci                       # includes devDependencies (embedded-postgres, nodemon)
cp .env.example .env         # set NODE_ENV=development, loopback URLs, JWT_SECRET
npm run db:migrate           # starts an embedded PostgreSQL if nothing listens on the URL's port
npm run dev
```

`npm run check` validates JavaScript syntax. `npm run test:gate` is the
authoritative gate (it recreates `<db>_test`; see the runbook).

## API surface

`GET /health` (public), `/api/auth/*`, `/api/invitations/*`, and the
tenant-scoped resources `/api/projects`, `/tasks`, `/contracts`, `/permits`,
`/capital`, `/messages`, `/documents`, `/alerts`, `/team`, `/audit`, plus
`/api/admin` for administrators. All tenant routes require a bearer token and
an organization context. The UI is served from `/`.
