# DEVOS-DI2 — RED Gate Report

**Phase:** DEVOS-DI-2 Policy & Gate Engine, **RED gate only**. DI-2 is not implemented.
**Baseline:** branch `claude/nice-fermat-5jwzsr` @ `7e46306` (DI-1 accepted and frozen). **DI-1 is not yet merged to `main`** (`main` is at `ca69d64`, EF-3).
**Specification:** `docs/DEVOS-DI2-ACCEPTANCE-CONTRACT.md` (decisions requiring confirmation are marked ⚑)
**Status:** stopped at the RED gate, awaiting review. Implementation is not authorized.

## 1. Aggregate

| Gate | Result |
|---|---|
| 0–7 protected (clean-DB, V1, Golden, P0, EF-1, EF-2, Security Golden, EF-3) | 173/173 GREEN |
| 8. DI-1 acceptance | 66/66 GREEN |
| 9. DI1-D1 partner integrity | 6/6 GREEN |
| **Accepted aggregate** | **245/245 GREEN, no regression** |
| **10. DEVOS-DI-2 acceptance** | **46 tests: 42 RED, 4 GREEN** |

- **Prediction vs actual:** before the first run I recorded the expected state and reason for every test (`tests/fixtures/di2-red-baseline.json`). Predicted 42 RED / 4 GREEN; actual 42 RED / 4 GREEN; **0 mismatches**. No unexpected GREEN, no regression.
- **Every RED is a missing capability:** DI-2 tables absent, `/api/di` policy and qualification endpoints 404, or a stated precondition. None comes from a test fault.
- **The 4 GREEN are permanent guards for things that already hold:**
  - `DI2-DI1-FROZEN-001`: DI-1 digests pinned;
  - `DI2-EF3-FROZEN-001`: EF-3 digests pinned;
  - `DI2-AUDIT-002`: EF-3 chains verify;
  - `DI2-BOUNDARY-001`: no promote, underwriting, committee or override surface exists, and the opportunity is readable as a precondition.
- **Baseline lock:** gate 10 passes CI only while every test matches its recorded state, the same mechanism as DI-1.

Evidence: `docs/evidence/di2-red-gate-run.txt`.

## 2. What DI-2 is specified to do (contract summary)

- **Tenant policy profiles** with immutable numbered **versions** (`DRAFT → PUBLISHED → RETIRED`). Publishing fixes a SHA-256 content hash, and only org-admins author policy ⚑.
- **Criteria** of four kinds (`HARD_VETO`, `HOLD`, `WATCH`, `CONDITION`) over DI-1 site facts, new versioned **candidate attributes** (`proposed_units`, `development_type`, …) and property location, using nine operators.
- **Deterministic qualification:** inputs are the versions recorded at or before an explicit `asOf`, and the same inputs produce deep-equal output. Outcome precedence ⚑: `NO_GO` (a hard veto failing on a *known* fact) > `INFORMATION_REQUIRED` > `HOLD` > `WATCH` > `CONDITIONAL_GO` > `GO`. Gate 0 (DI-1 readiness) is a precondition and is re-checked at `asOf`.
- **Missing information never becomes NO_GO.** `UNKNOWN`, `MISSING` and `TYPE_MISMATCH` inputs yield `INFORMATION_REQUIRED` unless a known veto already fails.
- **Qualifications are append-only screening records** (`authority: "POLICY_SCREEN"`) pinned to policy version and content hash, with a `supersedes` chain. They never change opportunity status, never create Projects, and expose no approval or investment field.
- **No platform policy:** a tenant without a published policy gets 409. No thresholds live in platform code.

## 3. Oracle (`tests/fixtures/di2-qualification-oracle.json`)

Sixteen evaluations across two tenants, derived by hand from contract §3:

| Case | Expected |
|---|---|
| all pass | GO |
| 90 units < 125 | NO_GO |
| flood AE | NO_GO |
| discretionary entitlement pending | HOLD |
| outside market | WATCH |
| industrial zoning | CONDITIONAL_GO |
| HOLD + WATCH + CONDITION together | HOLD (precedence) |
| flood UNKNOWN | INFORMATION_REQUIRED |
| known veto + unknown flood | NO_GO |
| entitlement NOT_APPLICABLE | GO |
| non-numeric lot area | INFORMATION_REQUIRED (`TYPE_MISMATCH`) |
| flood never recorded | INFORMATION_REQUIRED (`MISSING`) |
| zoning regressed to UNKNOWN | INFORMATION_REQUIRED with Gate 0 report |
| opportunity in SCREENING | 409 |
| same opportunity @2025-02-01 vs @2025-04-01 | GO (150 units, v1) vs NO_GO (90 units, v2) |
| **identical 90-unit facts under Beta's 40-unit policy** | GO |

The last case proves the threshold is **tenant configuration, not platform law**.

**Independent cross-check:** a literal reference implementation of contract §3, run against the oracle's records, agrees on all 16 evaluations (outcomes, per-criterion results, reasons, conditions, Gate 0 reports and `asOf` version selection). The output is in the evidence file.

## 4. Complete manifest (predicted vs actual)

| Test | Class | Claim | Predicted | Actual | Why |
|---|---|---|---|---|---|
| `DEVOS-DI2-SCHEMA-001` | Structural | All five DI-2 tables exist via a migration after 007 | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-SCHEMA-002` | Structural | Every DI-2 table: organization_id NOT NULL + FK to organizations, organization-led index, EF-3 capture trigger | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-SCHEMA-003` | Structural | Database rejects a policy version under another tenant's profile (23503; same-tenant control accepted) | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-SCHEMA-004` | Structural | Database rejects a criterion attached to another tenant's policy version | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-SCHEMA-005` | Structural | Database rejects a candidate attribute on another tenant's opportunity | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-SCHEMA-006` | Structural | Database rejects a qualification binding another tenant's policy version | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-SCHEMA-007` | Structural | Database allows at most one default profile per organization (23505); another organization's default is unaffected | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-SCHEMA-008` | Structural | Database vocabularies: version state, criterion kind/operator and qualification outcome reject unknown values (23514) | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-SCHEMA-009` | Structural | Published policy content is immutable in the database (criteria insert/update/delete, hash, revert to DRAFT); PUBLISHED → RETIRED allowed | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-SCHEMA-010` | Structural | Qualifications and candidate-attribute versions are append-only for the runtime role (UPDATE/DELETE rejected) | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-SCHEMA-011` | Structural | DI-2 permissions exist and the role mapping matches the matrix exactly (platform-admin none; policy authorship admin-only) | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-DI1-FROZEN-001` | Structural | Frozen DI-1 artifacts are byte-identical to the accepted DI-1 release | GREEN | **GREEN** | EXISTING / FREEZE GUARD |
| `DEVOS-DI2-EF3-FROZEN-001` | Structural | Frozen EF-3 artifacts are byte-identical to the accepted EF-3 release | GREEN | **GREEN** | EXISTING / FREEZE GUARD |
| `DEVOS-DI2-POL-001` | Behavioral | Organization admin creates a policy profile; list and direct read return it | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-POL-002` | Behavioral | At most one default profile: marking a second profile default clears the first | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-POL-003` | Behavioral | Creating a version yields DRAFT v1 without a content hash; a second concurrent DRAFT is refused (409) | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-POL-004` | Behavioral | Invalid criteria are rejected (400): kind, subject, operator, operand shape, duplicate key, empty set, missing label, numeric operator with text | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-POL-005` | Behavioral | Publishing fixes the content hash (contract formula) and author; a published version cannot be edited or re-published (409) | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-POL-006` | Behavioral | Versioning: v2 is created and published alongside v1, v1 stays byte-identical; retiring v1 works once (then 409) | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-CAND-001` | Behavioral | Candidate attributes persist KNOWN/UNKNOWN/NOT_APPLICABLE with provenance recorded by the caller | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-CAND-002` | Behavioral | Changing an attribute writes a new version; prior versions remain in history | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-CAND-003` | Behavioral | Invalid attributes are rejected (400): unknown key, non-integer or negative units, KNOWN without value, UNKNOWN with value, SYSTEM_DERIVED | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-QUAL-001` | Behavioral | asOf is required and validated (missing or malformed → 400); a valid asOf succeeds | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-QUAL-002` | Behavioral | Alpha oracle: 13 opportunities produce the exact expected outcome, per-criterion results, reasons, conditions and Gate 0 report | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-QUAL-003` | Behavioral | Gate 0 lifecycle precondition: an opportunity not READY_FOR_QUALIFICATION cannot be qualified (409) and is unchanged | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-QUAL-004` | Behavioral | asOf selects input versions: the same opportunity is GO at 2025-02-01 (150 units, v1) and NO_GO at 2025-04-01 (90 units, v2) | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-QUAL-005` | Behavioral | Persisted qualification: 201 with id, POLICY_SCREEN authority, pinned version and content hash, evaluator; readable by id and listed | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-QUAL-006` | Behavioral | Re-qualifying creates a new record that supersedes the previous one; the previous record is unchanged | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-QUAL-007` | Behavioral | Policy pinning: an explicit published version is honored; the default is the highest PUBLISHED version of the default profile (a newer DRAFT is ignored); a DRAFT version → 409 | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-QUAL-008` | Behavioral | A RETIRED version cannot be used for a new qualification (409) | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-QUAL-009` | Behavioral | Qualification never changes the opportunity's lifecycle, never creates a Project, and exposes no approval/investment field | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-DETERMINISM-001` | Sentinel | Same opportunity + policy version + asOf = deep-equal qualification, across calls and users | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-TENANT-POLICY-001` | Sentinel | Policy is tenant configuration, not platform law: identical facts are NO_GO under Alpha's policy and GO under Beta's | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-INFORMATION-001` | Sentinel | Missing or unusable information yields INFORMATION_REQUIRED, never NO_GO; every NO_GO cites a failed HARD_VETO on a KNOWN value | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-IMMUTABLE-POLICY-001` | Sentinel | A qualification stays bound to the exact policy content it used, after new versions are published and the old one retired | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-NO-PLATFORM-POLICY-001` | Sentinel | No platform policy: a tenant without a published policy cannot be qualified (409); platform code embeds no tenant thresholds | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-ADV-001` | Adversarial | Cross-tenant reads are concealed: policies, versions, qualifications and candidate attributes of another tenant → 404 / absent from lists | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-ADV-002` | Adversarial | Cross-tenant mutations → 404 and nothing changes: profile, version edit/publish/retire, candidate attributes | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-ADV-003` | Adversarial | Cross-tenant qualification is refused: another tenant's policy version or opportunity → 404 | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-ADV-004` | Adversarial | Authority: developers cannot author/publish/retire policy; viewers cannot qualify or edit attributes; both can read | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-ADV-005` | Adversarial | Mass assignment is ignored: a client cannot set outcome, authority, organization or criteria results on qualify, nor state/hash on a version | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-ADV-006` | Adversarial | Forged organization context → 403; unauthenticated → 401 on every DI-2 endpoint | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-AUTHZ-001` | Integration | Authorization matrix: viewer and developer get exactly their permitted DI-2 operations (2xx) and 403 otherwise | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-AUDIT-001` | Sentinel | EF-3 captures policy authorship, publication, retirement, candidate attributes and qualifications with actor and organization | RED | **RED** | MISSING CAPABILITY |
| `DEVOS-DI2-AUDIT-002` | Integration | EF-3 chains of every DI-2 tenant verify cryptographically after all DI-2 activity | GREEN | **GREEN** | EXISTING CAPABILITY |
| `DEVOS-DI2-BOUNDARY-001` | Integration | Phase boundary guard: no promotion, underwriting, investment-committee or auto-decline surface exists | GREEN | **GREEN** | BOUNDARY GUARD |

## 5. Decisions requiring founder confirmation (⚑)

1. **Outcome precedence:** NO_GO > INFORMATION_REQUIRED > HOLD > WATCH > CONDITIONAL_GO > GO.
2. **A hard veto that fails on a known fact is decisive** even when other facts are unknown (oracle `dq-a-o9`). The alternative is to always report INFORMATION_REQUIRED until every fact is known.
3. **NOT_APPLICABLE satisfies a criterion.**
4. **A non-numeric value under a numeric operator is `UNKNOWN` (`TYPE_MISMATCH`)**, not FAIL.
5. **Only org-admins author, publish and retire policy;** developers can read policy and run qualifications.
6. **The default policy** is the highest PUBLISHED version of the tenant's single default profile, and there is no platform fallback.
7. **Qualification doesn't change the opportunity lifecycle** (no auto-decline on NO_GO), and DI-1's lifecycle is not modified.
8. **Candidate attributes** (`proposed_units`, `affordable_units`, `proposed_stories`, `product_type`, `development_type`, `target_population`) are a new versioned DI-2 aggregate rather than columns on the frozen DI-1 opportunity table.
9. **Property location is not versioned** in DI-1, so `property.*` criteria read current values. That is a stated limitation on `asOf` determinism for location criteria only.

## 6. Phase-boundary discipline

- **Implementation code changed:** none. `routes/`, `db/`, `intelligence/`, `middleware/` and migrations are untouched since `7e46306`.
- DI-1 and EF-3 are pinned by digest and GREEN.
- **Absent:** underwriting, Sources & Uses, LIHTC, debt, economics, scenarios, rescue, due diligence, investment committee, promotion, ML and LLM.

## 7. Files

**Added**
- `docs/DEVOS-DI2-ACCEPTANCE-CONTRACT.md`
- `docs/DEVOS-DI2-RED-GATE-REPORT.md`
- `docs/evidence/di2-red-gate-run.txt`
- `tests/devos-di2-acceptance.test.js`
- `tests/fixtures/di2-qualification-oracle.json`
- `tests/fixtures/di2-authorization-matrix.json`
- `tests/fixtures/di2-red-baseline.json`

**Modified**
- `tests/runner.js`: gate 10, and the baseline comparison generalized
- `package.json`: `test:di2`
- `docs/DEVOS-MASTER-GATE-INVENTORY.md`

## 8. Stop gate

The DI-2 contract, acceptance suite and RED evidence exist and are pushed. **Work has stopped.** DI-2 implementation is not authorized.
