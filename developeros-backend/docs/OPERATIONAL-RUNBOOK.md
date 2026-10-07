# DeveloperOS Operational Runbook: Persistence & Database Operations

## 1. Clean Startup
To start DeveloperOS with persistent PostgreSQL backend:

```bash
# 1. Ensure dependencies are installed
npm install

# 2. Configure environment (in .env)
# DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres
# PORT=3000
# NODE_ENV=production

# 3. Start server
npm start
```
On boot, `server.js` verifies PostgreSQL connectivity and executes pending migrations automatically.

## 2. Migration Execution
Migrations are executed transactionally via `db/migrate.js`:

```bash
node db/migrate.js
```
The migration runner inspects `db/migrations/`, cross-references against `schema_migrations`, and applies unapplied scripts within a database transaction.

## 3. Database Seeding & Reset
To reset and seed the database to the authoritative canonical baseline:

```bash
node db/seed.js
```
This truncates all tables cleanly via `CASCADE` and re-inserts all 75 canonical records from `tests/fixtures/canonical-v1-fixture.json`.

## 4. Test Suite Execution
Execute automated test suites:

```bash
# Run all gated test suites (Regression, Golden Path, Security Debt, EF-1 Acceptance)
npm test

# Run individual test suites
npm run test:regression   # Runs DEVOS-V1-REGRESSION (55 tests)
npm run test:golden       # Runs DEVOS-GOLDEN-001 (11 steps)
npm run test:security     # Runs DEVOS-SEC-KNOWN-DEBT (3 debt markers)
npm run test:ef1          # Runs DEVOS-EF-1 ACCEPTANCE (13 acceptance tests)
```

## 5. Troubleshooting
- **PostgreSQL Port 5432 In Use**: If an external PostgreSQL service is already listening on 5432, specify `DATABASE_URL` in `.env` to point to the active instance.
- **Encoding Issues**: If non-ASCII characters fail on Windows, ensure the cluster is initialized with `-E UTF8 --locale=C`.
- **Stale Process / Connection Pool**: When stopping the server programmatically, call `closePool()` from `db/pool.js` and `server.closeAllConnections()` to prevent lingering socket handles.
