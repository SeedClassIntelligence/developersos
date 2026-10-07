# DEVOS-EF-3 — Remediation Evidence Report

**Date:** 2026-10-07
**Branch:** `claude/nice-fermat-5jwzsr` (base `main` @ `fdcd5b6`)
**Authorization:** EF-3 REMEDIATION ONLY. No subsequent phase has been started.
**Disposition requested:** independent inspection. This report does not self-accept EF-3.

| Canonical state | |
|---|---|
| EF-0 | ACCEPTED |
| EF-1 | ACCEPTED |
| EF-2 | ACCEPTED |
| EF-3 | NO-GO → **remediated, awaiting independent acceptance** |

---

## 1. Result summary

| Gate | Before remediation | After remediation |
|---|---|---|
| 0. DEVOS-CLEAN-DB GATE (new) | — (no such gate; the shared test DB persisted between runs) | **5/5** |
| 1. DEVOS-V1-REGRESSION | 55/55 | **55/55** |
| 2. DEVOS-GOLDEN-001 | 15/15 | **15/15** |
| 3. DEVOS-SEC-KNOWN-DEBT (P0 sentinels) | 3/3 | **3/3** |
| 4. DEVOS-EF-1 ACCEPTANCE | 13/13 | **13/13** |
| 5. DEVOS-EF-2 ACCEPTANCE | 29/29 | **29/29** |
| 6. DEVOS-GOLDEN-SEC-001 | 15/15 | **15/15** |
| 7a. EF-3 original acceptance | 11/11 | **11/11** |
| 7b. EF-3 adversarial regression (new) | **2/13** (RED) | **27/27** |
| **Aggregate** | — | **173/173** |

- RED baseline, run against the unremediated ledger on a freshly created database: `docs/evidence/ef3-red-baseline.txt` (committed in `b94dd9c` *before* any remediation code).
- GREEN aggregate, from an empty PostgreSQL cluster (`rm -rf .pgdata` → `initdb` → migrations → seed → gate): `docs/evidence/gate-local-green.txt`.
- GitHub Actions: see §13.

No P0 condition remains open (§14 lists the remaining non-P0 limitations).

---

## 2. The five defects: RED reproduction → remediation → GREEN

Every RED result below comes from `docs/evidence/ef3-red-baseline.txt`, the same test IDs run against `b579a24`.

| Defect | Permanent tests | RED evidence (unremediated) | Remediation | GREEN |
|---|---|---|---|---|
| **EF3-D1** Ledger privilege / append-only bypass (P0) | `D1-ROLE-001`, `D1-UPDATE-001`, `D1-DELETE-001`, `D1-TRUNCATE-001`, `D1-TRIGGER-001`, `D1-REPLICA-001`, `D1-FORGE-001` | Runtime role was `postgres`: `rolsuper`, `rolcreaterole`, `rolcreatedb`, `rolreplication`, `rolbypassrls`, `owns_ledger` all **true**. TRUNCATE **succeeded** (rolled back). Trigger disable/drop/replace all **ALLOWED**. `session_replication_role=replica` UPDATE **succeeded**. Forged INSERT **succeeded**. (UPDATE/DELETE were already rejected by the trigger, while it was enabled.) | Owner/runtime role separation; ledger writes only via SECURITY DEFINER functions; runtime role gets SELECT only on ledger tables; TRUNCATE statement triggers; startup guard refuses privileged runtime roles (§3) | 7/7 |
| **EF3-D2** Product verification did not recompute hashes (P0) | `D2-TAMPER-001`, `D2-TAMPER-002` | Content tamper (`budget` → 999999999) and actor tamper: `/api/audit/verify` returned `{"valid":true}` | `/api/audit/verify` recomputes every event's hash with the ledger's own SQL function and reports a classified failure (§5) | 2/2 |
| **EF3-D3** Tail deletion undetectable (P0) | `D3-MIDDLE-001`, `D3-TAIL-001` | Tail delete: `{"valid":true,"count":6}`. Middle delete was detected only as an unclassified linkage break | Per-org `chain_seq` + protected chain head; signed checkpoints and external receipts (§6, §7) | 2/2 |
| **EF3-D4** Timezone-dependent hashing (P1) | `D4-TIMEZONE-001` | An event written from an `Asia/Tokyo` session was invalid when recomputed under UTC; **every** event was invalid under Chicago/Kolkata/Chatham. The product verifier didn't recompute hashes at all (`hashesVerified` absent) | hash_version 2 canonical serialization with a UTC timestamp (§4) | 1/1 |
| **EF3-D5** Untrusted `X-Request-Id` broke audited writes (P2) | `D5-REQUESTID-001` | 500-char header → **HTTP 500**, project not created. Malformed header stored verbatim | Header accepted only if it matches `^[A-Za-z0-9._-]{1,64}$`; otherwise a server UUID is used and echoed in the response (§9) | 1/1 |

The adversarial tests attack through the **real runtime pool** (`db/pool.js`) or, where they model a privileged attacker, through the owner connection. Verification is always the **product's** own `/api/audit/verify` or `audit.repo.verify`. No test substitutes its own verifier.

---

## 3. Database role and privilege architecture

| Role | Configured by | Attributes | Owns | Ledger privileges |
|---|---|---|---|---|
| Migration / owner | `MIGRATION_DATABASE_URL` | any (CI/tests: `postgres` superuser; production: dedicated owner, ideally non-superuser with CREATEROLE) | all tables, ledger functions and triggers | full (as owner) |
| Runtime | `DATABASE_URL` | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` | **nothing** | `SELECT` on `audit_events`, `audit_chain_heads`, `audit_checkpoints`, `schema_migrations`; `EXECUTE` on `devos_audit_record_checkpoint` only |

**Actual runtime role in the gate and CI:** `devos_app_test`. The harness provisions it every run with a random per-run password, using the same provisioning code as production (`provisionRuntimeRole` in `db/migrate.js`, then `devos_apply_runtime_grants`). Production example: `devos_app` (`.env.example`).

**Mechanics**
- `db/migrate.js` runs every migration as the owner under an advisory lock. Then it creates the runtime LOGIN role if missing, strips its privileged attributes (when the owner is a superuser), and calls `devos_apply_runtime_grants(role)`. That function grants DML on business tables, SELECT on ledger tables and migration history, and nothing else. It runs on every migrate, so tables added later are covered. It refuses `runtime == owner`.
- The capture trigger `devos_capture_audit_event` and `devos_audit_record_checkpoint` are **SECURITY DEFINER** (owner) with `SET search_path = public, pg_temp`. `devos_audit_append` has `EXECUTE` revoked from PUBLIC, so the runtime role cannot call it directly.
- **Startup guard** (`assertUnprivilegedRuntimeRole` in `db/pool.js`, run on the pool's first connection): it refuses to hand out connections if the runtime role is a superuser, has CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS, is a member of the ledger owner, or holds INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER on any ledger table. `server.js` now listens **only after** this guard, the pending-migrations check, and signing-key load succeed. Previously it began listening before migrations finished.
- `server.js` no longer runs migrations. The API process never holds owner credentials.
- The seeder runs as the owner (it TRUNCATEs business tables, which the runtime role cannot).

### Attack results as the actual runtime role (`devos_app_test`)

| Attack | Result |
|---|---|
| `UPDATE audit_events …` | `permission denied for table audit_events` |
| `DELETE FROM audit_events …` | `permission denied for table audit_events` |
| `TRUNCATE audit_events` | `permission denied for table audit_events` |
| `ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only` | `must be owner of table audit_events` |
| `DROP TRIGGER …` / `CREATE OR REPLACE FUNCTION devos_block_audit_mutation …` | rejected (ownership / no CREATE on schema) |
| `SET LOCAL session_replication_role = replica` | `permission denied to set parameter "session_replication_role"` |
| `INSERT INTO audit_events …` (forged event) | `permission denied for table audit_events` |
| `UPDATE audit_chain_heads …` / `DELETE FROM audit_checkpoints …` | `permission denied for table …` |
| `SELECT devos_audit_append(…)` (forge through the append path) | `permission denied for function devos_audit_append` |
| `SELECT devos_apply_runtime_grants(…)` (self-escalation) | `permission denied for function devos_apply_runtime_grants` |
| `TRUNCATE projects CASCADE` (unaudited mass delete) | `permission denied for table projects` |
| `CREATE FUNCTION public.x() …` | `permission denied for schema public` |

**Owner-level defense in depth** (`DEVOS-EF3-OWNER-001`): with protections enabled, even the owner cannot TRUNCATE any ledger table, cannot UPDATE events, and cannot roll back or delete chain heads. Doing any of that requires deliberately disabling a trigger, and the attacks in §6 and §7 cover that case.

**Server refusal, observed manually:**
- `DATABASE_URL` set to the `postgres` superuser → `[DB] FATAL: runtime not ready — refusing to serve traffic: Refusing to run with privileged database role "postgres": rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, owns ledger tables, holds write/TRUNCATE/TRIGGER privilege on ledger tables…`, exit 1, nothing served.
- Production without `AUDIT_SIGNING_KEY` → refused, exit 1.
- Production path (`npm run db:migrate` as owner, then `npm start` as `devos_app_smoke`) → migrate created and granted the role, `/health` returned 200, and an oversized `X-Request-Id` came back as a server UUID.

---

## 4. Canonical hash serialization (hash_version 2)

One function per version, used by **both** the write path and verification:

| Version | Function | Used by |
|---|---|---|
| 2 | `devos_audit_hash_v2(…)` | `devos_audit_append` (every new event) and `devos_audit_event_hash(e)` (verification) |
| 1 | `devos_audit_hash_v1(e)` | legacy verification only. New v1 events are rejected (`DEVOS-EF3-HASHVER-001`) |

The removed JS `calculateHash` was dead code and inconsistent with the database algorithm. No hash implementation remains in JavaScript.

**v2 contract.** `event_hash = hex(SHA-256(UTF-8(canonical_json(doc))))`, where `doc` is:

```
{ "hash_version": 2, "id", "chain_seq", "occurred_at", "organization_id", "actor_user_id",
  "request_id", "action", "entity_type", "entity_id", "before_state", "after_state", "previous_hash" }
```

- `occurred_at` = `to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, which is independent of the session `TimeZone`, `DateStyle`, and locale (only `TM`-prefixed patterns are locale-dependent, and none are used).
- `canonical_json`: object keys sorted by code point (`COLLATE "C"`), no whitespace, arrays in order, scalars in jsonb text form. SQL NULL becomes JSON `null`.
- One structured document replaces v1's `|`-joined string, which was ambiguous whenever a field contained `|`.
- Bytes are taken with explicit `convert_to(…, 'UTF8')`, so the digest doesn't depend on the database encoding.

**Timezone evidence** (`D4-TIMEZONE-001`): an event was written from an `Asia/Tokyo` session. The product verifier was then run from `UTC`/ISO, `America/Chicago`/SQL-DMY, `Asia/Kolkata` (+05:30)/SQL-DMY and `Pacific/Chatham` (+12:45)/SQL-DMY sessions. Every run returned `valid`, with `hashesVerified == count`, 0 invalid digests, and an identical head hash. `HASHVER-002` additionally verifies a mixed v1/v2 ledger from an `Asia/Kathmandu` (+05:45) session.

### Hash-version behavior and the genesis boundary

Migration `005` does **not** rewrite historical evidence:
- `hash_version` is added as a catalog-only default of 1 (no row rewrite, no UPDATE triggers fire). `chain_seq` stays NULL for v1 rows.
- For each organization with v1 history, a v2 **GENESIS** event is appended (`action='GENESIS'`, `entity_type='audit_ledger'`, `request_id='migration-005'`). Its payload attests `legacy_event_count`, `legacy_head_hash`, and the `legacy_timezone`/`legacy_datestyle` the v1 digests depend on. Its `previous_hash` is the legacy head.
- Verification recomputes the v1 segment with those settings pinned (`SET LOCAL` inside the verifying transaction), checks v1 linkage, then requires the segment to match the genesis attestation exactly. Deleting, adding, or editing legacy events is detected (`LEGACY_HASH_MISMATCH`, `LEGACY_PREDECESSOR_MISMATCH`, `LEGACY_COUNT_MISMATCH`, `LEGACY_UNATTESTED`).

`DEVOS-EF3-HASHVER-002`/`003` build a real pre-remediation database: migrations 001–004, v1 evidence written, then upgrade. They prove the v1 rows are byte-identical after the upgrade, genesis links to the legacy head, the chain continues at `chain_seq 2`, the mixed ledger verifies (`hashVersions {1:4, 2:2}`), and a tampered legacy event is caught.

---

## 5. Product cryptographic verification

`GET /api/audit/verify` (and `POST` with receipts) calls `audit.repo.verify`. It runs on one `REPEATABLE READ READ ONLY` snapshot, so concurrent appends can't cause false head mismatches. For each event in `chain_seq` order it checks:

1. Hash version is supported → else `UNSUPPORTED_HASH_VERSION`
2. Sequence continuity → `SEQUENCE_DUPLICATE` / `SEQUENCE_GAP`
3. Recomputed hash equals the stored hash → `HASH_MISMATCH`
4. `previous_hash` equals the predecessor (or the legacy head for position 1) → `PREDECESSOR_MISMATCH` / `GENESIS_MISMATCH`

It then checks the chain head (`TAIL_TRUNCATED`, `HEAD_BEHIND_CHAIN`, `HEAD_MISMATCH`, `HEAD_MISSING`), every stored checkpoint, and every supplied receipt (§7).

**Response** (sensitive event content is never included):

```json
{ "valid": false, "organizationId": "…", "count": 7, "hashesVerified": 1,
  "hashVersions": { "1": 0, "2": 7 }, "headSeq": 7, "headHash": "…", "legacy": null,
  "checkpoints": { "stored": 0, "receipts": 0, "verified": 0 },
  "failure": { "reason": "HASH_MISMATCH", "chainSeq": 2, "eventId": "…",
               "detail": "stored hash does not match the recomputed canonical hash" } }
```

`D2-TAMPER-001` also asserts the tampered value (`999999999`) does not appear anywhere in the verification response.

**Mutation check.** I disabled each check in turn and re-ran EF-3:
- Removing the hash comparison fails `D2-TAMPER-001/002`.
- Removing the head check fails `D3-TAIL-001`.
- Removing the gap check fails `D3-MIDDLE-001`.
- Ignoring receipts fails `RECEIPT-001/002`.

So each test is load-bearing.

---

## 6. Sequence integrity and concurrency

- `audit_events.chain_seq BIGINT`, plus `CHECK ((hash_version=1 AND chain_seq IS NULL) OR (hash_version>=2 AND chain_seq>=1))`.
- `UNIQUE INDEX audit_events_chain_position ON (organization_id, chain_seq) NULLS NOT DISTINCT WHERE chain_seq IS NOT NULL`. The platform chain (NULL organization) is covered too, which is why PostgreSQL ≥ 15 is required.
- **Position allocation:** `devos_audit_append` locks the organization's `audit_chain_heads` row (`SELECT … FOR UPDATE`), takes `last_seq + 1`, appends, and advances the head in the same transaction. This replaces the timestamp-ordered advisory-lock scheme. Ordering is by sequence, never by clock.
- The head guard trigger allows a head to advance **by exactly one position**, and only to a position held by an existing event with the same hash. Heads cannot be deleted. All ledger tables reject TRUNCATE.

| Test | Proves |
|---|---|
| `SEQ-001` | The database rejects a second event at an existing `(organization_id, chain_seq)` |
| `SEQ-002` | An attacker who rewrites `previous_hash` **and recomputes the event's hash** with the real algorithm is still caught (`PREDECESSOR_MISMATCH`) |
| `D3-MIDDLE-001` | A deleted middle event is reported as `SEQUENCE_GAP` |
| `CONCURRENCY-001` (original) | 6 concurrent writers → valid chain |
| `CONCURRENCY-002` | 20 concurrent API writers to one tenant → positions exactly `1..N`, no duplicates, head = N, chain valid |

---

## 7. Tail-deletion detection, checkpoints, and threat model

There are three layers. Each one is stated with exactly what it does and does not protect against.

**Layer 1: chain head (`audit_chain_heads`).**
The head records each chain's last position and hash. `D3-TAIL-001` deletes the newest event and verification reports `TAIL_TRUNCATED`.
- *Protects against:* removal of events by any path that does not also rewrite the head. That includes the runtime role (which cannot delete at all), restoring `audit_events` alone from an older backup, and naive owner-level deletes.
- *Does not protect against:* an owner/superuser who also disables `audit_chain_heads_guard` and rolls the head back. The head lives in the same database.

**Layer 2: signed checkpoints (`audit_checkpoints`).**
`POST /api/audit/checkpoints` signs the current head with **Ed25519**, using a key that exists only in the application environment (`AUDIT_SIGNING_KEY`), never in PostgreSQL. It records the result through `devos_audit_record_checkpoint`.
- The runtime role can only record a checkpoint that points at a real v2 event and is not behind an earlier checkpoint. It cannot update, delete or truncate checkpoints (`CHECKPOINT-003`). The table is append-only and TRUNCATE-guarded.
- `CHECKPOINT-002`: a privileged attacker deletes the checkpointed tail **and** rolls the head back. The stored signed checkpoint exposes it (`TAIL_TRUNCATED`, source `checkpoint`).
- *Does not protect against:* an attacker who also deletes the checkpoint rows. They are in the same database.

**Layer 3: external receipts. This is the independent trust anchor.**
The checkpoint response *is* a receipt:

```json
{ "type": "devos.audit.checkpoint", "version": 1, "organizationId", "chainSeq", "eventHash",
  "hashVersion", "issuedAt", "keyId", "signature" }
```

- `signature` = hex Ed25519 over `JSON.stringify` of the first eight fields in exactly that order. `keyId` = the first 32 hex characters of the SHA-256 of the public key's SPKI DER.
- Anyone can verify a receipt offline with the public key from `GET /api/audit/signing-key`. `CHECKPOINT-001` does this with plain Node crypto, independently of product code.
- `POST /api/audit/verify {receipts:[…]}` checks retained receipts against the current ledger.
- **`RECEIPT-001`:** the attacker deletes the tail, rolls back the head, **and deletes every stored checkpoint**. Database-internal verification is now self-consistent and reports valid; that is the honest limit of any in-database mechanism. The externally held receipt still proves the truncation (`TAIL_TRUNCATED`, source `receipt`).
- `RECEIPT-002`: altered receipts (`CHECKPOINT_SIGNATURE_INVALID`), receipts self-signed by an attacker's key (`CHECKPOINT_UNTRUSTED_KEY`; only deployment-trusted keys count, never a key named inside the receipt), and another tenant's receipts (`RECEIPT_ORGANIZATION_MISMATCH`) are all rejected, while a genuine receipt verifies.

**Threat model, stated plainly**

| Adversary | Can they remove or alter evidence undetected? |
|---|---|
| Compromised API / runtime DB role | **No.** No write path to the ledger exists (§3). |
| Owner/superuser who disables triggers and edits rows or deletes middle events | **No.** Hash, sequence, and predecessor checks catch it (§5, §6). |
| Owner/superuser who deletes tail events | **No** unless they also rewrite the head; then **no** unless they also delete the stored checkpoints. |
| Full database compromise (rewrites events, head, and checkpoints consistently) | Detectable **only for positions covered by a receipt held outside DeveloperOS.** Positions written after the most recent externally retained receipt are **not** provably complete. |
| Holder of `AUDIT_SIGNING_KEY` **plus** full database control | Can forge new checkpoints. Earlier receipts held externally still bind earlier positions. |

The independent trust boundary is real only to the extent that receipts are retained outside this system, by the tenant, an auditor, or WORM storage. DeveloperOS does not yet push receipts to an external witness automatically (§14).

---

## 8. Clean-database gate (item 8)

- **Reconciled fix:** `b579a24` (`tests/test-env.js`, admin connection to the `postgres` maintenance DB). I reviewed its diff: one file, no unrelated changes. It already sits on this branch, and its behavior is preserved inside the rewritten `test-env.js`.
- **Permanent behavior:** every gate run now **drops and recreates** `<db>_test`, then: migrations as owner → runtime role provisioning → canonical seed → all suites. During this remediation I found that the old harness reused a persistent test database. A tampered row left by an earlier probe made `DEVOS-EF3-HASH-001` fail on an unrelated run. Gate results can no longer depend on leftover state.
- **New gate 0 `DEVOS-CLEAN-DB GATE` (5/5)** asserts:
  - the DB was recreated with **0 tables**;
  - migrations and seed complete without manual steps;
  - all migration files are recorded;
  - runtime connections use a non-superuser role distinct from the migration role;
  - the canonical fixture is complete.

  Setting `DEVOS_REUSE_TEST_DB=true` makes this gate fail by design.
- **Strongest local proof:** `rm -rf .pgdata` (no cluster at all) → `npm run test:gate` → `initdb` → `Recreated empty test database` → 5 migrations applied → runtime grants applied to `devos_app_test` → **173/173** (`docs/evidence/gate-local-green.txt`).

---

## 9. Request-ID hardening

`db/audit-context.js`: `X-Request-Id` is accepted only if it matches `^[A-Za-z0-9._-]{1,64}$`. Otherwise a server UUID is generated. The resolved ID is echoed in the `X-Request-Id` response header and recorded in the ledger. It is never used for identity or authority.

`D5-REQUESTID-001` results:

| Header | Before | After |
|---|---|---|
| 500 characters | HTTP 500 | 201, replaced |
| `bad id; DROP TABLE audit_events` | stored verbatim | 201, replaced |
| `ef3-corr.ID_01` (valid) | — | 201, preserved |

---

## 10. GitHub Actions (item 9)

`.github/workflows/developeros-gate.yml` runs on push and pull request touching `developeros-backend/**` (or the workflow), plus manual dispatch.

1. A `postgres:18` service container, empty. A preflight step **fails the job** if any `developeros*` database already exists.
2. `npm ci` from the lockfile.
3. A per-run masked `JWT_SECRET`. The test harness generates an ephemeral signing key.
4. `npm run test:gate`: syntax check, then the clean-DB gate, then every protected suite, including all EF-3 adversarial tests.

The job has no `continue-on-error`, skips no suite, and uses no pre-populated database. The only credentials are the throwaway container's `postgres/postgres`. `permissions: contents: read`.

---

## 11. Changes to original EF-3 tests (disclosed)

The 11 original tests remain and all pass. Two assertions changed because the remediation made the old wording inaccurate, not to make them easier to pass:

- **`DEVOS-EF3-APPEND-001`**: previously required the error to match `/append-only/`. The runtime role now has no UPDATE privilege, so PostgreSQL rejects the statement *before* the trigger runs ("permission denied"). The test now accepts either rejection. An accepted UPDATE still fails it. This is a stronger control, not a weaker test.
- **`DEVOS-EF3-HASH-001`**: previously recomputed with the inline v1 formula. Events now carry `hash_version`, so the test recomputes each event with the ledger's canonical function for its version (`devos_audit_event_hash`). It still requires zero invalid digests.

---

## 12. API additions

| Endpoint | Permission | Purpose |
|---|---|---|
| `GET /api/audit/verify` | `audit:read` | Full cryptographic verification (response shape in §5) |
| `POST /api/audit/verify` | `audit:read` | Same, plus `{ receipts: [...] }` (≤100) |
| `POST /api/audit/checkpoints` | `audit:read` | Issue a signed checkpoint receipt for the current head |
| `GET /api/audit/checkpoints` | `audit:read` | Stored signed checkpoints (latest 100) |
| `GET /api/audit/signing-key` | `audit:read` | Public key, key id, and trusted key ids |
| `GET /api/audit` | `audit:read` | Now includes `hash_version` and `chain_seq`, ordered by `chain_seq`. Adds a `beforeSeq` cursor |

`DEVOS-EF3-AUTHZ-002` proves a caller without `audit:read` gets 403 on every new endpoint.

---

## 13. GitHub Actions result

See the *DeveloperOS Gate* workflow run for the head commit of `claude/nice-fermat-5jwzsr` on GitHub. The run outcome is recorded in the commit that follows this report (§15).

---

## 14. Remaining limitations and security debt (no P0 open)

1. **No automatic external witness.** Tail completeness beyond the last *externally retained* receipt is not provable after a full database compromise (§7). Next step: push each checkpoint to an append-only external store (S3 Object Lock / WORM, or an RFC 3161 timestamping authority) on a schedule. **P1.**
2. **Checkpoints are on demand.** No scheduler issues them automatically yet. Until one exists, tenants or auditors must call `POST /api/audit/checkpoints` and retain the receipts. **P1.**
3. **Checkpoint poisoning.** A compromised runtime role can record a checkpoint for a real position carrying a **garbage signature**. Because checkpoints are append-only, verification of that tenant will then report `CHECKPOINT_SIGNATURE_INVALID` permanently. This is a loud integrity alarm, not silent tampering, but it is a denial-of-service lever on verification. Fix: verify the signature inside the database (would need the public key and an Ed25519 extension) or make the alarm triage-able. **P2.**
4. **Attribution is asserted by the application.** Actor, organization and request ID come from session settings the API sets. A compromised API can mis-attribute *future* events, though it cannot alter past ones. **P2.**
5. **Owner-role TRUNCATE of business tables is not audited.** Row triggers don't fire on TRUNCATE. The runtime role cannot TRUNCATE at all; only the owner (migrations, test seeder) can. **P2.**
6. **Key rotation is manual.** Retired public keys must be added to `AUDIT_TRUSTED_PUBLIC_KEYS`, or older checkpoints fail with `CHECKPOINT_UNTRUSTED_KEY`. **P3.**
7. **Platform chain** (events with no organization, e.g. pre-membership registration) is hashed, sequenced and head-tracked, but is not exposed through a verification API. **P3.**
8. **Deadlock exposure.** A single transaction that writes to two organizations' chains in opposite order to another transaction can deadlock. PostgreSQL aborts one and the API returns an error; no evidence is corrupted. **P3.**
9. **Operational requirements:** PostgreSQL ≥ 15 (`NULLS NOT DISTINCT`). `AUDIT_SIGNING_KEY` must be provisioned and backed up in production. The migration role must own the schema, and the API must never receive `MIGRATION_DATABASE_URL`.
10. **Not addressed (out of EF-3 remediation scope):** row-level security inside tenant tables, and deployment/secrets management.

---

## 15. Files changed (vs `main` @ `fdcd5b6`)

**Added**
- `.github/workflows/developeros-gate.yml`: CI gate
- `db/migrations/005_audit_ledger_v2.sql`: hash v2, `chain_seq`, heads, checkpoints, guards, genesis, runtime grants
- `db/audit-signing.js`: Ed25519 checkpoint signing and verification
- `tests/devos-ef3-adversarial.test.js`: 27 adversarial EF-3 tests
- `tests/devos-clean-db-gate.test.js`: gate 0
- `docs/DEVOS-EF3-REMEDIATION-EVIDENCE-REPORT.md`: this report
- `docs/evidence/ef3-red-baseline.txt`, `docs/evidence/gate-local-green.txt`

**Modified**
- `db/migrate.js`: owner connection, advisory lock, runtime role provisioning, `until`
- `db/pool.js`: runtime-role guard
- `db/pg-engine.js`: never bootstraps with runtime credentials
- `db/seed.js`: runs as owner
- `db/audit-context.js`: request-ID validation and echo
- `db/repositories/audit.repo.js`: full verification, checkpoints, receipts
- `routes/audit.js`: new endpoints
- `server.js`: no boot-time migration; listens only after readiness checks
- `tests/test-env.js`: role derivation, DB recreated per run, `b579a24` fix retained
- `tests/helpers.js`: awaits server readiness
- `tests/runner.js`: gate 0, EF-3 breakdown
- `tests/devos-ef3-acceptance.test.js`: adversarial hook; the two disclosed assertion updates (§11)
- `package.json`: `db:migrate`, `db:seed`, `test:clean-db`
- `.env.example`: two-role model, signing key
- `docs/OPERATIONAL-RUNBOOK.md`, `docs/DEVOS-MASTER-GATE-INVENTORY.md`, `docs/DEVOS-EF3-AUDIT-LEDGER-ACCEPTANCE.md` (superseded banner), `SECURITY.md`

---

## 16. Stop gate

EF-3 remediation is complete and pushed. **Work has stopped.** Development Intelligence and every later phase are untouched. EF-3 remains not accepted until independent inspection of this repository and its CI evidence.
