# DeveloperOS Architecture Notes: Persistence Foundation (DEVOS-EF-1)

## 1. PostgreSQL Architecture & Engine Setup
DeveloperOS utilizes a native PostgreSQL 18.4 relational database engine. In containerized and managed environments, standard PostgreSQL connection parameters are injected via `DATABASE_URL` (format: `postgresql://<user>:<password>@<host>:<port>/<dbname>`). In localized and developer test environments, an embedded PostgreSQL binary engine (`embedded-postgres` v18.4) automatically initializes a persistent, UTF-8 encoded cluster in the `.pgdata/` directory and binds to port 5432.

### Connection Pooling (`db/pool.js`)
- Employs `pg.Pool` with connection limits (max: 20, idleTimeout: 30s, connectionTimeout: 5s).
- Exports parameterized `query(text, params)` helper preventing SQL injection across all routes.
- Exports atomic `transaction(async (client) => { ... })` wrapper ensuring strict transaction isolation (`BEGIN`, `COMMIT`, `ROLLBACK`).

## 2. Migration Runner (`db/migrate.js`)
- Relational schema is version-controlled via SQL files in `db/migrations/`.
- Tracks execution in an authoritative `schema_migrations` ledger table (`version VARCHAR PRIMARY KEY, applied_at TIMESTAMPTZ`).
- Migration runs atomically inside a database transaction: if any DDL statement fails, the migration rolls back cleanly.
- Current migration: `001_initial_schema.sql` creates all 15 relational tables, foreign key constraints, indexes, and precision types.

## 3. Dedicated Repository Architecture (`db/repositories/`)
Application routes do not execute ad-hoc SQL or manipulate in-memory data structures. All database interactions are mediated by a dedicated repository layer:
- `auth.repo.js`: Authentication queries, user lookup by email, password updates, eliminates the previous split in-memory store in `routes/auth.js`.
- `projects.repo.js`: Project CRUD with tenant ownership and camelCase/snake_case mapping.
- `tasks.repo.js`: Task CRUD, filtering by project/discipline/status, and relational `task_dependencies`.
- `contracts.repo.js`: Contract lifecycle, including atomic execution + task unblocking.
- `permits.repo.js`: Permits and relational `permit_corrections`, preserving nested JSON response contracts.
- `capital.repo.js`: Capital stack and normalized `capital_sources`, enforcing `numeric(15,2)` precision.
- `messages.repo.js`: Channel metadata and message history.
- `documents.repo.js`: Categorized document records.
- `team.repo.js`: Team member directory.
- `partners.repo.js`: External partner directory.
- `admin.repo.js`: Aggregated platform metrics computed in real-time via PostgreSQL SQL queries (`COUNT`, `SUM`, `AVG`).

## 4. Transaction Boundaries & Atomicity
- **Contract Execution & SOW Task Unblocking**: Handled in `contracts.repo.js` -> `execute(contractId)`. The transaction marks the contract as executed and unblocks all linked tasks (`status = 'not-started'`). If any task update fails, the entire transaction rolls back (`ROLLBACK`), preventing partially executed state.
- **Capital Stack Normalization**: `capital.repo.js` -> `save(projectId, data)` operates in a single transaction that updates the capital stack header and replaces/synchronizes child capital sources atomically.

## 5. Tenant Ownership Model
- Tenant-owned resources (`projects`, `partners`, `team_members`, `users`) include authoritative `organization_id` foreign keys referencing `organizations(id)`.
- Secondary tenant resources (`tasks`, `contracts`, `permits`, `capital_stacks`, `channels`, `documents`) reference `project_id`, establishing clean hierarchical ownership to `projects(id)`.
- *Note*: Adding `organization_id` establishes the relational schema foundation for EF-2; full tenant-isolation enforcement at the API middleware level is scheduled for EF-2.

## 6. Identifier Strategy
- Legacy identifiers (`p1`, `t1`, `c1`, `pm1`, `cs1`, `ch1`, `org1`) are preserved for full backward compatibility with the existing SPA and integration test suites.
- Newly created records generate deterministic or prefixed UUID identifiers (e.g., `p<uuid>`, `t<uuid>`) mapped to `VARCHAR(64)` primary keys.
- Transition path to pure UUIDv4 is preserved without breaking frontend contracts.

## 7. Known Limitations & Technical Debt
- Server-side tenant isolation enforcement (verifying `req.user.orgId === resource.organizationId`) remains pending for DEVOS-EF-2.
- Centralized schema input validation across all HTTP route parameters remains pending for EF-2.
