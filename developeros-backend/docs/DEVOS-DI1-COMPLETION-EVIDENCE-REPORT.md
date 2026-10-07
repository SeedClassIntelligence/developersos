# DEVOS-DI-1 — Completion Evidence Report

**Phase:** DEVOS-DI-1 Development Intelligence Foundation, implementation
**Date:** 2026-10-07
**Branch:** `claude/nice-fermat-5jwzsr`. Base: accepted RED gate `31e6f0f` (on `main` @ `ca69d64` + EF-3 freeze docs `1b4115f`).
**Controlling specification:** `docs/DEVOS-DI1-ACCEPTANCE-CONTRACT.md` (unchanged since `31e6f0f`)
**Status:** implementation complete, **awaiting independent acceptance**. DI-2 not started.

---

## 1. Result

| Gate | RED gate (`31e6f0f`) | Now |
|---|---|---|
| 0. Clean-DB gate | 5/5 | **5/5** |
| 1. V1 regression | 55/55 | **55/55** |
| 2. Golden Path | 15/15 | **15/15** |
| 3. P0 security sentinels | 3/3 | **3/3** |
| 4. EF-1 | 13/13 | **13/13** |
| 5. EF-2 | 29/29 | **29/29** |
| 6. Security Golden Path | 15/15 | **15/15** |
| 7. EF-3 (11 original + 27 adversarial) | 38/38 | **38/38** |
| **8. DEVOS-DI-1 acceptance** | 3/66 (63 expected RED) | **66/66** |
| **Aggregate** | — | **239/239** |

- No skipped tests, no expected RED remaining, no unexpected state, no regression.
- Run from an **empty PostgreSQL cluster**: `rm -rf .pgdata` → `initdb` → migrations `001`–`006` → runtime-role provisioning → seed → all suites. See `docs/evidence/di1-completion-gate-run.txt`.

**Test-contract integrity.** `git diff 31e6f0f -- tests docs/DEVOS-DI1-ACCEPTANCE-CONTRACT.md` touches exactly two files:
- `tests/fixtures/di1-red-baseline.json`: 63 entries flipped RED → GREEN, each with its original RED reason kept in `redBaselineReason`;
- `tests/runner.js`: the gate-8 label.

No test, fixture, oracle, inventory or contract text changed. The flips were generated from a real run that recorded each test GREEN, not edited in bulk. A test that was expected GREEN and ran RED would have aborted the update as a regression.

---

## 2. Schema and migrations (`db/migrations/006_development_intelligence.sql`)

Seven tables, exactly as the contract specifies: `di_relationships`, `di_properties`, `di_opportunities`, `di_opportunity_status_history`, `di_site_facts`, `intelligence_findings`, `intelligence_finding_events`.

### Tenant integrity, enforced by the database
| Reference | Constraint |
|---|---|
| every table → organization | `organization_id NOT NULL REFERENCES organizations(id)`, plus an index led by `organization_id` |
| opportunity → property | composite FK `(organization_id, property_id) → di_properties(organization_id, id)` |
| opportunity → relationship | composite FK `(organization_id, relationship_id) → di_relationships(organization_id, id)` |
| opportunity → responsible user | composite FK `(responsible_user_id, organization_id) → memberships(user_id, organization_id)`: the responsible party must be a member of the same tenant |
| status history → opportunity | composite FK `(organization_id, opportunity_id) → di_opportunities` |
| site fact → property | composite FK `(organization_id, property_id) → di_properties` |
| finding event → finding | composite FK `(organization_id, finding_id) → intelligence_findings` |
| finding → prior finding (`recurrence_of`) | composite FK `(organization_id, recurrence_of) → intelligence_findings` |

Other constraints:
- Opportunity status `CHECK` allows the seven DI-1 states only, so GO/NO-GO/HOLD → `23514`.
- Site facts:
  - the fact-key vocabulary is a `CHECK`;
  - `value_status ∈ {KNOWN, UNKNOWN, NOT_APPLICABLE}`;
  - `KNOWN ⇔ value present`, so unknown can never carry a manufactured value;
  - `UNIQUE (property_id, fact_key, version)`.
- Findings: partial unique index `(organization_id, rule_id, condition_key) WHERE state <> 'RESOLVED'`, so there's no duplicate active finding (`23505`).
- History durability: `BEFORE DELETE` triggers on the four history tables reject deletion by any principal (runtime included), and `BEFORE UPDATE` triggers make status history, site facts and finding events append-only.

The `devos_apply_runtime_grants` function already gives the runtime role DML on new tables at every migrate, and DI-1 does not modify it.

Database tests passing: `SCHEMA-001`…`012`. Each cross-tenant probe gets the exact SQLSTATE, and the same-tenant control insert succeeds.

---

## 3. Permissions (EF-2 architecture)

The migration adds 16 permissions:
- `relationships:read/create/update`
- `properties:read/create/update`
- `opportunities:read/create/update/transition`
- `site_intelligence:read/update`
- `findings:read/evaluate/acknowledge/resolve`

| Role | DI permissions |
|---|---|
| org-admin, developer | all 16 |
| viewer | the 5 `:read` permissions |
| platform-admin | **none**. Tenant DI access requires membership and permission (accepted decision 6) |

There's no second mechanism: routes use `requirePermission`, and the router is mounted behind `protect` + `resolveOrganizationContext`.

Verified by:
- `AUTHZ-001`: 25 endpoints × viewer and developer, exactly as the matrix says;
- `AUTHZ-002`: 401 unauthenticated;
- `AUTHZ-003`: the role mapping matches exactly; platform-admin has none;
- `ADV-FORGE-ORG-001`: a forged header gets 403, and an `organizationId` in the body is ignored.

---

## 4. API implementation (`routes/di.js`, mounted at `/api/di`)

Each route checks in the same order: permission (403), then tenant-scoped existence (404), then validation (400), then lifecycle rules (409). The data layer (`db/repositories/di.repo.js`, `findings.repo.js`) filters every statement by `organization_id`, so a foreign record and a missing one look identical.

- IDs are server-generated UUIDs. `id`, `organizationId`, `status`, `recordedBy`, `recordedAt`, `createdAt` and `updatedAt` are never read from a request body (`ADV-MASS-001`, `OPP-001`).
- `PATCH /opportunities/:id` does not accept `status`: lifecycle changes go through `/transition` only (`ADV-MASS-001`, `OPP-005`).
- Body references (`propertyId`, `relationshipId`, `responsibleUserId`) to another tenant's records, or to non-members, return 404 (`ADV-REF-001`). The composite FKs in §2 enforce the same rule underneath.

---

## 5. Opportunity lifecycle

- **Create always yields `NEW`** and records a history row (`null → NEW`).
- Transitions follow the contract table exactly:
  - disallowed → 409, status unchanged;
  - a non-lifecycle target (GO, NO-GO, NO_GO, HOLD, WATCH, CONDITIONAL_GO, CONDITIONAL GO) → **400**;
  - `→ READY_FOR_QUALIFICATION` requires readiness `READY_FOR_QUALIFICATION`, otherwise 409 `{error, missing}`;
  - DECLINED, WITHDRAWN and EXPIRED are terminal.
- Every accepted transition writes a status-history row (actor and reason) in the same transaction as the status change, under a `FOR UPDATE` row lock.
- Tests: `OPP-001`…`005`, `ADV-LIFECYCLE-001` (the viewer cannot transition).

**Opportunity creation does not create a Project.** No DI code path writes to `projects`; a scan of every DI-1 file for `INSERT INTO/UPDATE/DELETE FROM projects` finds none. `di_opportunities` has no project reference. `OPPORTUNITY-NOT-PROJECT-001` takes a fingerprint of the `projects` table (count + md5 over id/name/phase) before and after creating a property and an opportunity, recording site facts, transitioning, and running a persisted evaluation. The fingerprints are identical. There is no promotion endpoint.

---

## 6. Information readiness (`intelligence/readiness.js`)

One function, `assess()`, computes readiness, and all three consumers call it: the readiness endpoint, the `→ READY_FOR_QUALIFICATION` transition check, and the `DI-OPPORTUNITY-INFORMATION-REQUIRED` rule. The requirement set is the accepted platform-neutral baseline:
- `opportunity.property`
- `opportunity.concept`
- `site.apn`, `site.ownership`, `site.lot_area_sqft`, `site.zoning`, `site.current_use`, `site.acquisition_basis`

A requirement is satisfied only by a current fact with status `KNOWN` or `NOT_APPLICABLE`. `UNKNOWN` and absent facts never satisfy one.

**INFORMATION_REQUIRED does not mean NO-GO.** Readiness returns `INFORMATION_REQUIRED` or `READY_FOR_QUALIFICATION` only, with no decision field. Missing information never moves an opportunity to a terminal state. The DI finding is severity **info**, and its explanation states "Missing information is not a negative determination about the opportunity." `INFORMATION-001` checks all of this on a sparse opportunity: the readiness response, the evaluated finding and the opportunity record are scanned for `NO-GO`, `"decision"` and `CONDITIONAL`, and none are found. Tests: `READY-001`, `READY-002`, `INFORMATION-001`.

---

## 7. Provenance

- Relationships, properties and opportunities carry `source_type`, `source_reference`, `recorded_by` and `created_at`.
- **Each site fact version** carries its own provenance (`source_type`, `source_reference`, `recorded_by`, `recorded_at`).
- User-supplied `sourceType` must be `USER_ENTRY`, `PUBLIC_RECORD`, `DOCUMENT` or `CONNECTED_SYSTEM`. `SYSTEM_DERIVED` is refused with 400: it's reserved for the system.
- A missing or unknown source type returns 400.
- `recordedBy` is always the authenticated user and `recordedAt` is always server time; spoofed values are ignored (`PROV-001`).

Site Intelligence belongs to the **Property aggregate** (accepted decision 1). `PUT /properties/:id/site-intelligence`:
- validates every fact before writing any (all-or-nothing);
- writes a **new version** only for facts that actually changed, under a per-property advisory lock so version numbers stay contiguous;
- keeps every prior version (`SITE-001`…`003`).

---

## 8. Rule registry (`intelligence/rule-registry.json`)

Seven ACTIVE rules, each with `ruleId`, `version`, `title`, `status`, `legacyAlertRule`, `findingType`, `inputDomains`, `sourceTypes`, `severityPolicy` and `timeDependent`. `GET /api/di/rules` serves the same document. The engine **refuses to load** if the registry and the rule implementations disagree (`assertRegistryConsistency`). Tests: `REGISTRY-001`, `REGISTRY-002`.

### The six legacy rules, reconciled (none disappeared)
| Legacy | Rule | Reconciliation |
|---|---|---|
| R1 | `EXEC-TASK-NO-CONTRACT` | same condition; partner names resolved from the evaluating tenant only; source `[task]` |
| R2 | `EXEC-CONTRACT-MISSING` | same condition; tenant-scoped partner names; source `[contract]` |
| R3 | `EXEC-BLOCKED-TASKS` | **one finding per project** (accepted decision 4); sources `[project, …its blocked tasks]` |
| R4 | `EXEC-PERMIT-CORRECTIONS` | same condition; sources `[permit, …open corrections]` |
| R5 | `EXEC-CAPITAL-DEADLINE` | tenant-scoped inputs; `days = round((deadline − asOf)/1 day)` with **asOf only**; sources `[capital_stack, capital_source]` |
| R6 | `EXEC-GC-CONTRACT-PENDING` | same condition (first unexecuted GC contract by id); sources `[project, contract]` |

New: `DI-OPPORTUNITY-INFORMATION-REQUIRED` (info), for opportunities in NEW, SCREENING or INFORMATION_REQUIRED whose readiness is INFORMATION_REQUIRED.

`LEGACY-001`: `/api/alerts` keeps producing the existing outputs. `LEGACY-002`: every legacy alert for the canonical tenant has a corresponding registry finding citing the same record.

---

## 9. Known-defect remediation

**Capital (`TENANT-CAPITAL-001`).**
- `routes/alerts.js` now calls `capitalRepo.getAll(null, req.organizationId)`. The findings engine reads capital with an organization-scoped join (`capital_sources → capital_stacks → projects.organization_id = $1`).
- Results: org1's `cap2` capital-deadline alert now appears (it was 0 before). Alpha has exactly 2 capital alerts, both on its own project. Alpha's findings cite exactly `dix-a-src1` and `dix-a-src4`.

**Partner / execution references (`TENANT-PARTNER-001`, `ADV-EXECREF-001`), accepted decision 3.**
1. `partnersRepo.getAll(organizationId)` now **requires** an organization and filters by `org_id`. The findings engine resolves partner names only within the evaluating tenant.
2. The new `middleware/references.js` sits on `POST/PUT /api/tasks` and `POST/PUT /api/contracts`. A foreign or unknown `partnerId` or `contractId` → **404**. This also normalizes the foreign-contract database rejection, which used to surface as **500**, to the 404 concealment response. A same-tenant contract from a different project → 400, where it used to be a 500 from the FK.
3. Defense in depth: the legacy `partnerName()` fallback used to print the raw partner ID when the partner wasn't in the list. Mutation M5 (§12) showed the ID could leak through it. It now renders "an unlisted partner".

Result: a foreign `partnerId` is refused (404); a foreign `contractId` is refused (404, was 500); a contract with a foreign partner is refused (404). No foreign partner identity appears in any tenant's alerts or findings.

---

## 10. Determinism, the oracle, and persistence

**Determinism (`DETERMINISM-001`, `EVAL-001`, `EVAL-004`, `EVAL-005`).**
- Rules read time only from `asOf`, a strict ISO-8601 instant. A missing or malformed value returns 400.
- Computed findings contain no generated IDs or wall-clock timestamps, and are sorted by `conditionKey`.
- The same state and `asOf` produce **deep-equal** output across calls and across users.
- `asOf` 2025-01-01 and 2025-02-20 reproduce their oracles even though the real clock (2026) would make both capital sources overdue.

**Expected-findings oracle.** `EVAL-002` (positives), `EVAL-003` (negatives), `EVAL-004` (other `asOf` values) and `CROSS-TENANT-001` (beta) pass. Alpha produces exactly the 9 expected findings, with correct rule, version, severity, type and exact sources, plus none of the 7 forbidden ones and no `dix-b-` identifier. The same holds at both other `asOf` dates, and beta matches its 6. **The oracle was not modified.**

**Persisted evaluation** (`FIND-001`…`007`, contract §8). This runs in one transaction under a per-organization advisory lock:

| Situation | Behavior (test) |
|---|---|
| condition persists | same finding id, no duplicate; severity follows `asOf` (`FIND-002`, `FIND-003`: src1 warning → critical, same id) |
| condition disappears | `RESOLVED`, `resolution = CONDITION_CLEARED`; row and history kept (`FIND-004`) |
| condition recurs after resolution | **new** OPEN finding, `recurrenceOf` = the prior resolved id; the prior record is never reopened or rewritten (`FIND-005`; accepted decision 5) |
| finding from an older rule version | `RESOLVED`, `SUPERSEDED_BY_RULE_VERSION`; new OPEN finding at the registry version (`FIND-006`) |

**Manual lifecycle.**
- OPEN → ACKNOWLEDGED → RESOLVED (resolution `MANUAL`), and OPEN → RESOLVED. A RESOLVED finding cannot be moved again (409).
- Bodies cannot change `sources`, `severity`, `ruleId`, `ruleVersion` or `organizationId` (`FIND-007`).
- Every state change writes an `intelligence_finding_events` row with the actor (`FINDING-LIFECYCLE-001`).
- Clients cannot create findings: `POST /api/di/findings` is not routed (`ADV-SPOOF-001`).

**Traceability (`TRACE-001`).** Every source of every finding, in all three tenants, resolves to an existing record of the **same organization**.

---

## 11. Cross-tenant adversarial results

| Test | Result |
|---|---|
| `CROSS-TENANT-001` | beta evaluation leaves alpha's persisted findings unchanged; alpha's oracle holds; beta's finding gets 404 from alpha; no beta identifier in alpha findings or alerts |
| `ADV-LIST-001` | no foreign relationships, properties, opportunities or findings in lists (beta sees its own) |
| `ADV-DIRECT-001` | foreign relationship, property, site intelligence, opportunity, readiness, history and finding → 404 (the owner gets 200) |
| `ADV-MUTATE-001` | foreign PATCH, PUT, transition, acknowledge and resolve → 404, and beta's records are unchanged |
| `ADV-REF-001` | foreign property, relationship and responsible user in a body → 404 |
| `ADV-FORGE-ORG-001` | forged `X-Organization-Id` → 403; body `organizationId` ignored |
| `ADV-MASS-001` / `ADV-LIFECYCLE-001` / `ADV-SPOOF-001` | mass assignment ignored; the viewer cannot transition, acknowledge, resolve or evaluate; findings can't be forged |
| `TENANT-CAPITAL-001`, `TENANT-PARTNER-001`, `ADV-EXECREF-001` | remediated (§9) |
| `SCHEMA-003`…`009` | cross-tenant references rejected **by the database** (`23503`) |

---

## 12. Mutation testing

Before flipping the baseline, I deliberately broke each guarantee and re-ran the DI-1 suite, restoring the code after each run:

| Mutation | Tests that went RED |
|---|---|
| M1: `/api/alerts` capital call back to unscoped | `TENANT-CAPITAL-001` |
| M2: capital rule reads the system clock instead of `asOf` | `EVAL-002`, `EVAL-004`, `FIND-001`, `FIND-003`, `FIND-004`, `FIND-005`, `CROSS-TENANT-001` |
| M3: blocked tasks conflated across projects | `EVAL-002`, `EVAL-003`, `EVAL-004`, `DETERMINISM-001`, `FIND-001`, `CROSS-TENANT-001` |
| M4: recurrence reopens the old finding | `FIND-005`, `FIND-006` |
| M5: foreign partner references accepted | `TENANT-PARTNER-001`, `ADV-EXECREF-001`. This mutation also exposed the raw-ID fallback fixed in §9 |

---

## 13. EF-3 integration

- EF-3 is **used, not modified**. All seven DI tables carry the existing `devos_audit_capture` trigger (`SCHEMA-010`).
- DI mutations go through the runtime pool's audit context, so ledger events carry actor and organization.
- `AUDIT-001`: ledger rows with actor and organization exist for relationship create/update, property create/update, opportunity lifecycle (history INSERT + opportunity UPDATE), site-fact INSERT, and finding acknowledge/resolve (finding UPDATE + event INSERT).
- `AUDIT-002`: the EF-3 chains of alpha, beta and gamma still verify cryptographically after all DI activity.
- `EF3-FROZEN-001`: `004`, `005`, `audit-signing.js`, `audit.repo.js`, `routes/audit.js` and `audit-context.js` are byte-identical to the accepted EF-3 release. `db/pool.js` and `db/migrate.js` are also unchanged since `ca69d64`.
- **No EF-3 defect was found.**

---

## 14. Phase-boundary evidence

I scanned every DI-1 file (`intelligence/`, `routes/di.js`, `di.repo.js`, `findings.repo.js`, migration `006`, `middleware/references.js`):

| Check | Result |
|---|---|
| KG policy, thresholds, economics (`KG`, `125`, LIHTC, underwriting, Sources & Uses, debt sizing, IRR, NOI) | **none** |
| Decision vocabulary (GO/NO-GO/HOLD/WATCH/CONDITIONAL GO) | only in one sentence that denies it: the registry description says "none makes a GO/NO-GO or other policy determination". No state, field, value or rule |
| ML / LLM / predictive / external calls (`openai`, `anthropic`, `llm`, `predict`, `score`, HTTP clients) | only the engine comment that denies it ("No machine learning, no LLM calls, no scoring, no policy decisions") |
| Writes to `projects` | **none** |

Not implemented, as required: the DI-2 Policy & Gate Engine, Development Policy Profiles, GO/HOLD/WATCH/CONDITIONAL GO/NO-GO, the 125-unit KG policy, underwriting, LIHTC, Sources & Uses, debt sizing, developer economics, scenarios, rescue intelligence, due-diligence programs, investment-committee governance, and Opportunity → Project promotion.

---

## 15. Clean-database and CI

- **Clean database:** gate 0 is 5/5 from a cluster that didn't exist before the run; migrations 001–006 applied in order (`docs/evidence/di1-completion-gate-run.txt`).
- **GitHub Actions run #7:** https://github.com/SeedClassIntelligence/developersos/actions/runs/37689739937 on `e93fe5a`, conclusion **success**, on an empty `postgres:18` service (PostgreSQL 18.6). The gate fails on any baseline mismatch, so success means 239/239 with DI-1 at 66/66. The service log from the same run shows the DI-1 database protections firing server-side by name: `di_opportunities_property_same_tenant`, `di_opportunities_relationship_same_tenant`, `di_site_facts_same_tenant`, `di_status_history_same_tenant` and `intelligence_finding_events_same_tenant` (cross-tenant probes); `di_opportunities_status_check` rejecting GO, NO-GO and HOLD; `intelligence_findings_one_active`; and the four durable-history delete triggers.

---

## 16. Files changed (vs `31e6f0f`)

**Added**
- `db/migrations/006_development_intelligence.sql`
- `intelligence/rule-registry.json`, `intelligence/engine.js`, `intelligence/readiness.js`
- `db/repositories/di.repo.js`, `db/repositories/findings.repo.js`
- `routes/di.js`
- `middleware/references.js`
- `docs/DEVOS-DI1-COMPLETION-EVIDENCE-REPORT.md`, `docs/evidence/di1-completion-gate-run.txt`

**Modified**
- `server.js`: mounts `/api/di`
- `routes/alerts.js`: capital and partner scoping; generic unlisted-partner fallback
- `db/repositories/partners.repo.js`: `getAll` requires and filters by organization
- `routes/tasks.js`, `routes/contracts.js`: same-tenant reference middleware
- `tests/fixtures/di1-red-baseline.json`: 63 flips, each verified by a run
- `tests/runner.js`: gate-8 label
- `docs/DEVOS-MASTER-GATE-INVENTORY.md`

---

## 17. Remaining limitations and debt

1. ~~Execution-domain partner references were enforced at the API only.~~ **Closed by DI1-D1** (`docs/DEVOS-DI1-D1-REMEDIATION-ADDENDUM.md`). The EF-2 fixture's invalid Tenant B partner was corrected, and migration `007` enforces same-tenant partner references for `tasks` and `contracts` with composite foreign keys, so both the database and the API now refuse them.
2. **Legacy `/api/alerts` R3 still conflates projects.** The compatibility endpoint keeps its historical shape so V1 regression stays protected. The registry finding `EXEC-BLOCKED-TASKS` is per-project and authoritative.
3. **Evaluation is on demand** (`POST /api/di/evaluate`). There's no scheduler. Persisted findings reflect the most recent evaluation's `asOf`, so evaluating with an earlier `asOf` after a later one moves state "backwards". That's deterministic, and it's how `FIND-004`/`005` exercise clearing and recurrence.
4. **A kept finding's `as_of`** records the evaluation that last *changed* it, not the most recent evaluation that saw it.
5. **Rule versions are integers in the registry.** Bumping one supersedes all active findings of that rule at the next evaluation; there's no migration tooling beyond that.
6. **Readiness requirements are fixed in code** (the platform baseline). Tenant-specific requirement profiles belong to DI-2 and are absent.
7. **`acknowledge` on an already-ACKNOWLEDGED finding returns 409.** The contract leaves this undefined.

## 18. Stop gate

DI-1 implementation and evidence are complete and pushed. **Work has stopped.** DI-2 has not begun. DI-1 is not self-accepted: it awaits independent inspection of the repository, implementation, CI evidence and phase boundaries.
