# DEVOS-DI1 — RED Gate Report

**Phase:** DEVOS-DI-1 Development Intelligence Foundation, **RED gate only**. DI-1 is not implemented.
**Date:** 2026-10-07
**Repository baseline:** `main` @ `ca69d64` (EF-3 accepted). The branch `claude/nice-fermat-5jwzsr` sits on `1b4115f` (EF-3 freeze docs), and the RED gate commit follows it.
**Specification:** `docs/DEVOS-DI1-ACCEPTANCE-CONTRACT.md`
**Status:** stopped at the RED gate, awaiting independent review. Implementation is not authorized.

---

## 1. Aggregate result

| Gate | Result |
|---|---|
| 0. Clean-DB gate | 5/5 GREEN |
| 1. V1 regression | 55/55 GREEN |
| 2. Golden Path | 15/15 GREEN |
| 3. P0 security sentinels | 3/3 GREEN |
| 4. EF-1 | 13/13 GREEN |
| 5. EF-2 | 29/29 GREEN |
| 6. Security Golden Path | 15/15 GREEN |
| 7. EF-3 (original 11 + adversarial 27) | 38/38 GREEN |
| **Protected aggregate** | **173/173 GREEN, no regression** |
| **8. DEVOS-DI-1 acceptance** | **66 tests: 63 RED, 3 GREEN** |

- **Prediction vs actual:** before the first run I recorded an expected state and reason for all 66 tests (`tests/fixtures/di1-red-baseline.json`). Predicted 63 RED / 3 GREEN; actual 63 RED / 3 GREEN; **0 mismatches**.
- **Unexpected GREEN:** none.
- **Unexpected regression:** none.
- **One sub-assertion differed from the pre-run inventory** (§7.3). The test's state was unaffected, the inventory claim was wrong, and it has been corrected and disclosed.

Test classes: A. Structural: 14, B. Behavioral: 27, Permanent sentinel: 9, C. Adversarial: 9, D. Integration: 7.

Raw evidence: `docs/evidence/di1-red-gate-run.txt`.

### Baseline lock (CI)

Gate 8 does not fail the build for being RED. It fails the build if **any test differs from its recorded baseline state**: an unexpected GREEN, an unexpected RED, or a test missing from either side. That keeps `main` and CI green while the RED state is locked. During implementation, each test is flipped to `GREEN` in the baseline as its capability lands, so every flip is a visible, reviewable diff.

---

## 2. What each state means

| State | Count | Meaning |
|---|---|---|
| GREEN, existing capability | 3 | Behavior that already satisfies the contract and must not regress: `AUDIT-002` (EF-3 chains verify), `EF3-FROZEN-001` (EF-3 byte-identical to the accepted release), `LEGACY-001` (four working legacy rules) |
| RED, known defect | 3 | `TENANT-CAPITAL-001`, `TENANT-PARTNER-001`, `ADV-EXECREF-001`: the existing code does the wrong thing today |
| RED, missing capability | 60 | DI-1 schema, registry, `/api/di` endpoints and permissions don't exist yet |

**No artificial RED.** Every negative assertion carries a positive precondition (the resource exists, the owner can read it, the list endpoint returns 200). For example, a 404 on a foreign ID only passes once the owner gets a 200 on the same ID, so a test can't turn GREEN just because an endpoint is missing. Database probes require the exact SQLSTATE (`23503`, `23505`, `23514`), and run a same-tenant control insert in the same transaction.

---

## 3. Complete test manifest (actual vs predicted)

| # | Test | Class | Claim | Expected | Actual | Why |
|---|---|---|---|---|---|---|
| 1 | `DEVOS-DI1-SCHEMA-001` | A. Structural | All seven DI-1 tables exist (migration-driven) | RED | **RED** | MISSING CAPABILITY |
| 2 | `DEVOS-DI1-SCHEMA-002` | A. Structural | Every DI table has organization_id NOT NULL with a foreign key to organizations | RED | **RED** | MISSING CAPABILITY |
| 3 | `DEVOS-DI1-SCHEMA-003` | A. Structural | Database rejects an opportunity referencing another organization's property (control: same-tenant property accepted) | RED | **RED** | MISSING CAPABILITY |
| 4 | `DEVOS-DI1-SCHEMA-004` | A. Structural | Database rejects an opportunity referencing another organization's relationship | RED | **RED** | MISSING CAPABILITY |
| 5 | `DEVOS-DI1-SCHEMA-005` | A. Structural | Database rejects a site fact attached to another organization's property | RED | **RED** | MISSING CAPABILITY |
| 6 | `DEVOS-DI1-SCHEMA-006` | A. Structural | Database rejects status history pointing at another organization's opportunity | RED | **RED** | MISSING CAPABILITY |
| 7 | `DEVOS-DI1-SCHEMA-007` | A. Structural | Database restricts opportunity status to the DI-1 lifecycle (GO/NO-GO rejected; NEW accepted) | RED | **RED** | MISSING CAPABILITY |
| 8 | `DEVOS-DI1-SCHEMA-008` | A. Structural | Database allows at most one active finding per (organization, rule, condition); a RESOLVED predecessor does not block | RED | **RED** | MISSING CAPABILITY |
| 9 | `DEVOS-DI1-SCHEMA-009` | A. Structural | Database rejects a finding event pointing at another organization's finding | RED | **RED** | MISSING CAPABILITY |
| 10 | `DEVOS-DI1-SCHEMA-010` | A. Structural | Every DI table has an index led by organization_id and carries the EF-3 capture trigger | RED | **RED** | MISSING CAPABILITY |
| 11 | `DEVOS-DI1-SCHEMA-011` | A. Structural | History is durable: the runtime role cannot DELETE status history, site facts, findings or finding events | RED | **RED** | MISSING CAPABILITY |
| 12 | `DEVOS-DI1-SCHEMA-012` | A. Structural | All sixteen DI permissions exist in the EF-2 permission catalog | RED | **RED** | MISSING CAPABILITY |
| 13 | `DEVOS-DI1-REGISTRY-001` | A. Structural | Machine-readable rule registry exists with a complete, well-typed entry per rule | RED | **RED** | MISSING CAPABILITY |
| 14 | `DEVOS-DI1-REGISTRY-002` | A. Structural | Registry inventories all six legacy rules plus the DI information rule, and GET /api/di/rules serves the same registry | RED | **RED** | MISSING CAPABILITY |
| 15 | `DEVOS-DI1-REL-001` | B. Behavioral | Create relationship: free-text type, provenance recorded with server-assigned recorder and time | RED | **RED** | MISSING CAPABILITY |
| 16 | `DEVOS-DI1-REL-002` | B. Behavioral | Update relationship; list and direct read return the persisted change | RED | **RED** | MISSING CAPABILITY |
| 17 | `DEVOS-DI1-PROP-001` | B. Behavioral | Create property with address and provenance; it does not create a Project | RED | **RED** | MISSING CAPABILITY |
| 18 | `DEVOS-DI1-PROP-002` | B. Behavioral | Update property; direct read returns the change | RED | **RED** | MISSING CAPABILITY |
| 19 | `DEVOS-DI1-OPP-001` | B. Behavioral | Create opportunity: always starts NEW, links property/relationship/responsible member, server-owned fields cannot be supplied | RED | **RED** | MISSING CAPABILITY |
| 20 | `DEVOS-DI1-OPP-002` | B. Behavioral | Valid lifecycle path NEW → SCREENING → INFORMATION_REQUIRED → SCREENING is recorded in history with actor and reason | RED | **RED** | MISSING CAPABILITY |
| 21 | `DEVOS-DI1-OPP-003` | B. Behavioral | Disallowed transitions return 409 and leave status unchanged (NEW → READY_FOR_QUALIFICATION; READY with missing information) | RED | **RED** | MISSING CAPABILITY |
| 22 | `DEVOS-DI1-OPP-004` | B. Behavioral | Decision vocabulary (GO, NO-GO, HOLD, WATCH, CONDITIONAL GO) is rejected with 400 as a lifecycle target | RED | **RED** | MISSING CAPABILITY |
| 23 | `DEVOS-DI1-OPP-005` | B. Behavioral | Terminal states DECLINED, WITHDRAWN and EXPIRED are reachable and immutable | RED | **RED** | MISSING CAPABILITY |
| 24 | `DEVOS-DI1-SITE-001` | B. Behavioral | Site intelligence persists KNOWN, UNKNOWN and NOT_APPLICABLE distinctly; absent facts stay absent | RED | **RED** | MISSING CAPABILITY |
| 25 | `DEVOS-DI1-SITE-002` | B. Behavioral | Changing a fact creates a new version; the prior version is preserved in history | RED | **RED** | MISSING CAPABILITY |
| 26 | `DEVOS-DI1-SITE-003` | B. Behavioral | Invalid facts are rejected: unknown key, KNOWN without value, UNKNOWN with a manufactured value | RED | **RED** | MISSING CAPABILITY |
| 27 | `DEVOS-DI1-PROV-001` | B. Behavioral | Provenance is required and typed; SYSTEM_DERIVED cannot be claimed by a user; recorder cannot be spoofed | RED | **RED** | MISSING CAPABILITY |
| 28 | `DEVOS-DI1-READY-001` | B. Behavioral | Readiness reports INFORMATION_REQUIRED with the exact missing requirement keys | RED | **RED** | MISSING CAPABILITY |
| 29 | `DEVOS-DI1-READY-002` | B. Behavioral | UNKNOWN does not satisfy a requirement; NOT_APPLICABLE does; completing information yields READY_FOR_QUALIFICATION and permits the transition | RED | **RED** | MISSING CAPABILITY |
| 30 | `DEVOS-DI1-INFORMATION-001` | Permanent sentinel | Incomplete information produces INFORMATION_REQUIRED — never NO-GO, a decision field, or a terminal state | RED | **RED** | MISSING CAPABILITY |
| 31 | `DEVOS-DI1-OPPORTUNITY-NOT-PROJECT-001` | Permanent sentinel | Creating, enriching, transitioning and evaluating an Opportunity never creates or changes a Project | RED | **RED** | MISSING CAPABILITY |
| 32 | `DEVOS-DI1-EVAL-001` | B. Behavioral | asOf is required and validated (missing or malformed → 400); a valid asOf succeeds | RED | **RED** | MISSING CAPABILITY |
| 33 | `DEVOS-DI1-EVAL-002` | B. Behavioral | Alpha @ 2025-02-01: every expected finding appears with the correct rule, severity, type and exact source records | RED | **RED** | MISSING CAPABILITY |
| 34 | `DEVOS-DI1-EVAL-003` | B. Behavioral | Alpha @ 2025-02-01: no unexpected or explicitly forbidden finding appears (negative oracle) | RED | **RED** | MISSING CAPABILITY |
| 35 | `DEVOS-DI1-EVAL-004` | B. Behavioral | Time comes only from asOf: alpha @ 2025-02-20 and @ 2025-01-01 match their oracles (the real clock would make both capital sources overdue) | RED | **RED** | MISSING CAPABILITY |
| 36 | `DEVOS-DI1-EVAL-005` | B. Behavioral | Every finding carries ruleId, ruleVersion (= registry), organization, severity, type, explanation, sources, asOf and conditionKey | RED | **RED** | MISSING CAPABILITY |
| 37 | `DEVOS-DI1-DETERMINISM-001` | Permanent sentinel | Same state + same asOf = same findings (deep-equal across repeated evaluations and across sessions) | RED | **RED** | MISSING CAPABILITY |
| 38 | `DEVOS-DI1-TENANT-CAPITAL-001` | Permanent sentinel | Capital intelligence is tenant scoped: the tenant's own pending capital deadlines are surfaced (legacy /api/alerts and findings), foreign capital is not | RED | **RED** | KNOWN DEFECT |
| 39 | `DEVOS-DI1-FIND-001` | B. Behavioral | Persisted evaluation stores the oracle findings as OPEN with ids, first-detection time and full fields | RED | **RED** | MISSING CAPABILITY |
| 40 | `DEVOS-DI1-FIND-002` | B. Behavioral | Re-evaluating unchanged state creates no duplicates and keeps the same finding ids | RED | **RED** | MISSING CAPABILITY |
| 41 | `DEVOS-DI1-FIND-003` | B. Behavioral | A condition that persists keeps its finding while severity follows asOf (src1 warning → critical, same id) | RED | **RED** | MISSING CAPABILITY |
| 42 | `DEVOS-DI1-FIND-004` | B. Behavioral | A condition that disappears resolves its finding (CONDITION_CLEARED) without deleting it | RED | **RED** | MISSING CAPABILITY |
| 43 | `DEVOS-DI1-FIND-005` | B. Behavioral | A resolved condition that reappears opens a NEW finding linked to its predecessor; the predecessor stays RESOLVED | RED | **RED** | MISSING CAPABILITY |
| 44 | `DEVOS-DI1-FIND-006` | B. Behavioral | A finding from an older rule version is superseded (SUPERSEDED_BY_RULE_VERSION) and replaced at the registry version | RED | **RED** | MISSING CAPABILITY |
| 45 | `DEVOS-DI1-FINDING-LIFECYCLE-001` | Permanent sentinel | Acknowledge → resolve is durable, history-preserving, attributed and EF-3 audited | RED | **RED** | MISSING CAPABILITY |
| 46 | `DEVOS-DI1-FIND-007` | B. Behavioral | Invalid lifecycle moves are refused: acknowledging/resolving a RESOLVED finding → 409; body cannot rewrite sources, severity or rule | RED | **RED** | MISSING CAPABILITY |
| 47 | `DEVOS-DI1-TRACE-001` | Permanent sentinel | Every finding traces to existing records of the same organization | RED | **RED** | MISSING CAPABILITY |
| 48 | `DEVOS-DI1-CROSS-TENANT-001` | Permanent sentinel | Foreign tenant information cannot affect another tenant's findings (dry-run oracle, persisted state, lists, direct reads, alerts) | RED | **RED** | MISSING CAPABILITY |
| 49 | `DEVOS-DI1-ADV-LIST-001` | C. Adversarial | Lists never include another tenant's relationships, properties, opportunities or findings | RED | **RED** | MISSING CAPABILITY |
| 50 | `DEVOS-DI1-ADV-DIRECT-001` | C. Adversarial | Direct reads of another tenant's records return 404 (relationship, property, site intelligence, opportunity, readiness, history, finding) | RED | **RED** | MISSING CAPABILITY |
| 51 | `DEVOS-DI1-ADV-MUTATE-001` | C. Adversarial | Mutations against another tenant's records return 404 and leave them unchanged | RED | **RED** | MISSING CAPABILITY |
| 52 | `DEVOS-DI1-ADV-REF-001` | C. Adversarial | Foreign references in request bodies are refused with 404: property, relationship, responsible user | RED | **RED** | MISSING CAPABILITY |
| 53 | `DEVOS-DI1-ADV-FORGE-ORG-001` | C. Adversarial | Forged organization context is refused: foreign X-Organization-Id → 403; organizationId in the body is ignored | RED | **RED** | MISSING CAPABILITY |
| 54 | `DEVOS-DI1-ADV-MASS-001` | C. Adversarial | Mass assignment on update cannot change id, organization, status, provenance recorder or timestamps | RED | **RED** | MISSING CAPABILITY |
| 55 | `DEVOS-DI1-ADV-LIFECYCLE-001` | C. Adversarial | Unauthorized lifecycle actions are refused: viewer cannot transition, acknowledge, resolve or evaluate | RED | **RED** | MISSING CAPABILITY |
| 56 | `DEVOS-DI1-ADV-SPOOF-001` | C. Adversarial | Findings cannot be created or forged by clients: POST /api/di/findings is not allowed and creates nothing | RED | **RED** | MISSING CAPABILITY |
| 57 | `DEVOS-DI1-TENANT-PARTNER-001` | Permanent sentinel | Partner intelligence is tenant scoped: no foreign partner identity ever reaches a tenant's alerts or findings | RED | **RED** | KNOWN DEFECT |
| 58 | `DEVOS-DI1-ADV-EXECREF-001` | C. Adversarial | Intelligence inputs cannot be spoofed with foreign execution records: tasks and contracts cannot reference another tenant's partner or contract (404, not 201/500) | RED | **RED** | KNOWN DEFECT |
| 59 | `DEVOS-DI1-AUTHZ-001` | D. Integration | Authorization matrix: each role gets exactly its permitted DI operations (viewer: reads 2xx, writes 403); developer: all 2xx | RED | **RED** | MISSING CAPABILITY |
| 60 | `DEVOS-DI1-AUTHZ-002` | D. Integration | Unauthenticated requests to DI endpoints return 401 | RED | **RED** | MISSING CAPABILITY |
| 61 | `DEVOS-DI1-AUTHZ-003` | D. Integration | Role → DI permission mapping matches the matrix exactly; platform-admin holds no DI permission | RED | **RED** | MISSING CAPABILITY |
| 62 | `DEVOS-DI1-AUDIT-001` | Permanent sentinel | Representative DI-1 mutations are captured by the EF-3 ledger with actor and organization | RED | **RED** | MISSING CAPABILITY |
| 63 | `DEVOS-DI1-AUDIT-002` | D. Integration | EF-3 chains of every DI tenant still verify cryptographically after all DI-1 activity | GREEN | **GREEN** | EXISTING CAPABILITY |
| 64 | `DEVOS-DI1-EF3-FROZEN-001` | D. Integration | Frozen EF-3 artifacts are byte-identical to the accepted EF-3 release | GREEN | **GREEN** | EXISTING CAPABILITY |
| 65 | `DEVOS-DI1-LEGACY-001` | D. Integration | Legacy /api/alerts keeps producing the existing rule outputs for the canonical tenant (missing-contract, blocked-tasks, permit-corrections, gc-contract) | GREEN | **GREEN** | EXISTING CAPABILITY |
| 66 | `DEVOS-DI1-LEGACY-002` | D. Integration | Rule parity: every legacy alert for the canonical tenant has a corresponding finding from its registry rule citing the same record | RED | **RED** | MISSING CAPABILITY |

---

## 4. Existing six-rule inventory

Machine-readable: `tests/fixtures/di1-rule-inventory.json`. Every rule maps to a registry rule; none disappears.

| Legacy | Registry rule | Current behavior | Tenant scoping | Time | Known defects |
|---|---|---|---|---|---|
| R1 | `EXEC-TASK-NO-CONTRACT` | incomplete task without contract → critical | tasks scoped; **partner names unscoped** | createdAt only | partner-name disclosure |
| R2 | `EXEC-CONTRACT-MISSING` | contract `missing` with linked tasks → critical | contracts scoped; **partner names unscoped** | createdAt only | partner-name disclosure |
| R3 | `EXEC-BLOCKED-TASKS` | **one** alert for all blocked tasks across all projects, attributed to the first project | scoped | createdAt only | **conflation**: reproduced on fixture data (alpha's `dix-a-t4` on `dix-a-p2` reported under `dix-a-p1`) |
| R4 | `EXEC-PERMIT-CORRECTIONS` | permit in `corrections` → warning with open-correction count | scoped | createdAt only | none |
| R5 | `EXEC-CAPITAL-DEADLINE` | pending source with deadline < 60 days → warning, < 30 → critical | **broken: no input at all** | **system clock decides outcome** | never fires; non-deterministic; no source ids |
| R6 | `EXEC-GC-CONTRACT-PENDING` | phase ≥ 3 project with unexecuted GC contract → warning | scoped | createdAt only | contract id not emitted |

The DI rule `DI-OPPORTUNITY-INFORMATION-REQUIRED` is new: severity **info**, never a decision.

---

## 5. Expected-findings fixture (behavioral oracle)

`tests/fixtures/di1-expected-findings.json`. It is the behavioral contract, written by hand from rule semantics and not from implementation output.

- **Tenants:**
  - `dix-alpha`: the oracle subject.
  - `dix-beta`: deliberately *poisonous*. Every rule would fire for alpha if any beta input leaked, including a pending capital source 14 days from its deadline and a distinctively named partner, "Beta Foreign Partner ZQX".
  - `dix-gamma`: a workbench tenant, created by the test, for all mutating tests, so alpha and beta are never perturbed before their oracle checks.
- **Evaluations:**
  - `ALPHA-2025-02-01`: 9 expected findings, 7 explicit negatives, and no `dix-b-` identifier anywhere.
  - `ALPHA-2025-02-20`: the capital source flips warning → critical at 23 days.
  - `ALPHA-2025-01-01`: one capital source absent at 73 days, the other critical at 14 days. Against the real clock both are overdue, so this proves time comes only from `asOf`.
  - `BETA-2025-02-01`: 6 expected findings, with no `dix-a-` identifiers.
- **Includes the capital-deadline findings the unscoped repository call currently loses**, and the per-project R3 split.
- **Independent cross-check:** the unmodified legacy `generateAlerts` was run against the same fixture data, with the clock fixed to each `asOf` and the capital input correctly scoped. It **agrees with the oracle on R1, R2, R4, R5 and R6 for all four evaluations**, severities included. R3 differs exactly as the contract intends (per-project split). See `docs/evidence/di1-red-gate-run.txt`.

---

## 6. Schema, authorization and EF-3 expectations (summary; full text in the contract)

**Schema.** Seven tables: `di_relationships`, `di_properties`, `di_opportunities`, `di_opportunity_status_history`, `di_site_facts`, `intelligence_findings`, `intelligence_finding_events`.
- `organization_id NOT NULL` with an FK to `organizations` and an organization-led index on every table.
- **Database-enforced same-tenant references** (composite FKs or equivalent, SQLSTATE `23503`): opportunity → property/relationship, site fact → property, status history → opportunity, finding event → finding.
- Lifecycle `CHECK` on opportunity status (GO/NO-GO/HOLD → `23514`).
- One active finding per `(organization_id, rule_id, condition_key)` (`23505`).
- The runtime role cannot `DELETE` any history table.
- Site facts are versioned and carry provenance per fact, with KNOWN/UNKNOWN/NOT_APPLICABLE kept distinct.

**Authorization.**
- 16 new permissions (`relationships:*`, `properties:*`, `opportunities:*` including `:transition`, `site_intelligence:*`, `findings:read/evaluate/acknowledge/resolve`), through EF-2 only.
- org-admin and developer get all of them; viewer gets reads only; **platform-admin gets none**.
- Status codes: missing permission 403, foreign or unknown ID 404, forged `X-Organization-Id` 403, unauthenticated 401.
- Matrix: `tests/fixtures/di1-authorization-matrix.json` (25 endpoints).

**EF-3 integration.**
- Every DI table carries the existing `devos_audit_capture` trigger.
- `AUDIT-001` requires ledger rows with actor and organization for relationship create/change, property create/change, opportunity lifecycle, site-fact change, and finding acknowledge/resolve.
- `AUDIT-002` requires every DI tenant's EF-3 chain to still verify.
- `EF3-FROZEN-001` pins SHA-256 digests of `004`, `005`, `audit-signing.js`, `audit.repo.js`, `routes/audit.js` and `audit-context.js` to the accepted release. If DI-1 touches EF-3, the gate goes red.

---

## 7. Known defect reproductions

### 7.1 `DEVOS-DI1-TENANT-CAPITAL-001`: capital intelligence omitted (RED, as required)
- **Precondition proven:** org1 has a pending capital source with a deadline (`cap2`, LIHTC equity, 2025-03-15).
- **Observed:** `GET /api/alerts` for org1 returns **0** capital-deadline alerts. Alert types present: missing-contract, blocked-tasks, permit-corrections, gc-contract. Alpha also gets 0, against an expectation of 2 (`dix-a-src1`, `dix-a-src4`).
- **Mechanism, verified directly:** `capitalRepo.getAll()` (as `routes/alerts.js` calls it) returns **0** rows. `capitalRepo.getAll(null, 'org1')` returns **1**. The repository filters `projects.organization_id = $1` with `$1 = NULL`.
- Not fixed.

### 7.2 `DEVOS-DI1-TENANT-PARTNER-001`: foreign partner identity disclosed (RED, as required)
- **Planted through the real API:** `POST /api/tasks` in the workbench tenant with `partnerId: "dix-b-partner1"` returned **201** (accepted).
- **Observed:** the workbench tenant's `GET /api/alerts` contains the string **"Beta Foreign Partner ZQX"**. The engine loads every tenant's partners (`partnersRepo.getAll()`, unscoped) and R1 renders the referenced partner's name.
- **Correct expectation established:** no foreign partner identity in any tenant's alerts or findings, and foreign partner references refused with 404 (`ADV-EXECREF-001`).
- Not fixed.

### 7.3 `DEVOS-DI1-ADV-EXECREF-001`: foreign execution references (RED), with a disclosed correction
- `POST/PUT /api/tasks` with a foreign `partnerId` → **201**. `POST /api/contracts` with a foreign `partnerId` → **201**. Both are accepted, which is the vector for §7.2.
- A foreign `contractId` on a task → **HTTP 500**.
- **Correction:** the pre-run inventory claimed the API *accepts* a foreign contract ID and that this suppresses the tenant's no-contract alert. The first run showed otherwise. The existing EF-1 constraint `tasks_contract_project_fkey` already rejects it at the database, so tenant integrity holds there. The real defect is that the rejection surfaces as a 500 instead of the 404 concealment response. I corrected the inventory and the baseline reason. The test's state (RED) and its assertion (404) are unchanged. The `POST /api/contracts` foreign-partner probe was added to this test after the first run, to cover R2's partner path.

---

## 8. Decisions in the contract that need reviewer confirmation

1. **Site Intelligence attaches to the Property**, not the Opportunity. Site facts describe the physical parcel and are shared by every opportunity on it. Readiness reads the opportunity's property's current facts.
2. **Readiness baseline: 8 platform-neutral requirements** (property linked, concept, APN, ownership, lot area, zoning, current use, acquisition basis). No tenant policy and no KG thresholds. DI-2 policy profiles may extend this; DI-1 doesn't.
3. **Execution-domain integrity is in DI-1 scope** only where intelligence consumes it: tasks and contracts must refuse foreign partner/contract references (404). This touches `routes/tasks.js` and `routes/contracts.js`. The contract requires API refusal; it does not require a new database constraint on `tasks.partner_id`/`contracts.partner_id`.
4. **R3 is split per project.** This changes legacy output shape for multi-project tenants and is required by traceability (§8 of the authorization).
5. **Re-evaluation semantics:**
   - a persisting condition keeps its finding, and severity follows `asOf`;
   - a cleared condition is `RESOLVED`/`CONDITION_CLEARED`;
   - a recurrence (including after a manual resolve) gets a **new** finding with `recurrenceOf`;
   - an older rule version is `SUPERSEDED_BY_RULE_VERSION`.
6. **Platform-admin holds no DI permission.**
7. **Server-generated IDs**; client-supplied IDs are ignored.
8. `/api/alerts` stays as a compatibility endpoint. The contract doesn't mandate whether it's backed by findings, only that its outputs don't regress (`LEGACY-001`) and agree with findings (`LEGACY-002`).

---

## 9. Phase-boundary discipline

- **Implementation code changed:** none. `routes/`, `db/`, `middleware/` and migrations are untouched (`git diff` vs `1b4115f` touches only `tests/`, `docs/` and `package.json` scripts).
- **Known defects:** reproduced and left in place.
- **Out of scope and absent:** no GO/HOLD/WATCH/CONDITIONAL GO/NO-GO state; no KG thresholds (no 125-unit rule; KG appears only as tenant test data in the canonical fixture); no underwriting, LIHTC, scoring, ML or LLM; no Opportunity → Project promotion. `OPPORTUNITY-NOT-PROJECT-001` and `INFORMATION-001` guard the boundary permanently.
- **EF-3:** byte-identical to the accepted release, and pinned by test.

## 10. Files

**Added**
- `docs/DEVOS-DI1-ACCEPTANCE-CONTRACT.md`
- `docs/DEVOS-DI1-RED-GATE-REPORT.md`
- `docs/evidence/di1-red-gate-run.txt`
- `tests/devos-di1-acceptance.test.js`
- `tests/fixtures/di1-expected-findings.json`
- `tests/fixtures/di1-authorization-matrix.json`
- `tests/fixtures/di1-rule-inventory.json`
- `tests/fixtures/di1-red-baseline.json`

**Modified**
- `tests/runner.js` (gate 8 and the baseline lock)
- `package.json` (`test:di1`)
- `docs/DEVOS-MASTER-GATE-INVENTORY.md`

## 11. Stop gate

The DI-1 acceptance suite and RED evidence exist and are pushed. **Work has stopped.** DI-1 implementation and DI-2 have not begun.
