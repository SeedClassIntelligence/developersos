# DEVOS-DI-2 — Policy & Gate Engine: Acceptance Contract (revision 2, for review)

**Status:** specification for the DI-2 RED gate, amended after the founder's CONDITIONAL GO review (see §10). **Implementation is not authorized.**
**Revision 2 amendments:**
- **A1:** NOT_APPLICABLE requires criterion-level permission.
- **A2:** TYPE_MISMATCH applies to historical values; new writes are validated.
- **A3:** versioned location evidence.
- **A4:** historical Gate 0, separated from the run precondition.

Revision 1 (`93d8ea5`) and its RED evidence are preserved unchanged.
**Builds on:** DI-1 (accepted and frozen). DI-1 files are pinned by digest and DI-2 must not modify them.
**Executable form:** `tests/devos-di2-acceptance.test.js` and the fixtures it names. If this document and a test disagree, that's a contract defect: report it, don't resolve it silently.
**Decisions requiring founder confirmation are marked ⚑.**

---

## 1. Purpose and boundary

DI-2 lets each tenant express its **own** development policy and apply it deterministically to an Opportunity that has passed Gate 0 (DI-1 information sufficiency), producing a **policy screening outcome**:

`GO` · `CONDITIONAL_GO` · `WATCH` · `HOLD` · `NO_GO` · `INFORMATION_REQUIRED`

- **Policy is tenant data, never platform law.** The platform ships no policy, no default thresholds and no KG rule. A tenant without a published policy cannot be qualified (409); there is no platform fallback.
- **A qualification is a screening result, not an investment decision.** It carries `authority: "POLICY_SCREEN"`. It never approves, commits, underwrites, changes the Opportunity's lifecycle status, or creates a Project.
- **Missing information never becomes NO_GO.** Only a hard veto that fails on *known* facts can produce NO_GO.
- **Out of scope:** underwriting, Sources & Uses, LIHTC, debt sizing, developer economics, scenarios, rescue analysis, due-diligence programs, investment-committee approval or override, Opportunity → Project promotion, ML/LLM/predictive scoring.

## 2. Domain model

| Concept | Meaning |
|---|---|
| **Policy Profile** | A tenant's named policy, for example "Affordable Infill Policy". A tenant may have several; at most one is the **default**. |
| **Policy Version** | An immutable, numbered version of a profile's criteria. `DRAFT` → `PUBLISHED` → `RETIRED`. Only `PUBLISHED` versions qualify. Publishing fixes a SHA-256 `contentHash` over the canonical criteria. |
| **Criterion** | One test: `{key, label, kind, subject, operator, operand, rationale, allowNotApplicable}`. |
| **Candidate Attributes** | Versioned facts about the proposed development (the "Development Candidate"), with provenance and KNOWN/UNKNOWN/NOT_APPLICABLE status, following the DI-1 site-fact pattern. |
| **Location Evidence** (A3) | Versioned, append-only snapshots of a Property's location (`city`, `region`, `postalCode`, `country`) with provenance, kept in a DI-2 table. The frozen DI-1 `di_properties` record is neither read for qualification nor modified. |
| **Qualification** | An append-only record: one opportunity, one policy version, an explicit `asOf`, the per-criterion results with the exact input versions observed (including the location-evidence record), and the outcome. |

### 2.1 Candidate attribute vocabulary
| Key | Type |
|---|---|
| `proposed_units` | integer ≥ 0 |
| `affordable_units` | integer ≥ 0 |
| `proposed_stories` | integer ≥ 0 |
| `product_type` | string |
| `development_type` | string |
| `target_population` | string |

- Unknown keys → 400.
- Wrong type for a `KNOWN` value → 400. This includes numeric strings such as `"150"` for an integer key (A2).
- Status rules are the same as DI-1: `KNOWN` requires a value; `UNKNOWN` and `NOT_APPLICABLE` require `null`.
- Provenance rules are the same as DI-1 (`SYSTEM_DERIVED` is reserved).
- **A2 — write validation vs historical values.**
  - Every new write through the API is type-validated and rejected with 400.
  - The database does not constrain the JSON type of a stored `value`, so values written before validation existed, or loaded by a historical import, stay representable and auditable.
  - Evaluation never trusts the stored type. A stored value the operator cannot apply to evaluates to `UNKNOWN` (`TYPE_MISMATCH`) and so to `INFORMATION_REQUIRED` (§3).
  - The same applies to DI-1 site facts read by DI-2.

### 2.2 Criterion grammar
| Field | Values |
|---|---|
| `key` | `^[a-z0-9_.-]{1,64}$`, unique within a version |
| `kind` | `HARD_VETO`, `HOLD`, `WATCH`, `CONDITION` |
| `subject` | `site.<DI-1 fact key>`, `candidate.<attribute key>`, `property.city`, `property.region`, `property.postal_code`, `property.country` |
| `operator` | `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `between` (inclusive) |
| `operand` | `in`/`not_in`: non-empty array of strings or numbers; `between`: `[min, max]` numbers with min ≤ max; `gt`/`gte`/`lt`/`lte`: a number; `eq`/`neq`: string or number |
| `allowNotApplicable` (A1) | boolean, optional, default `false`. It is the explicit permission for a `NOT_APPLICABLE` input to satisfy this criterion. It is stored, returned on every criterion, and part of the published content hash (§6). |

- A version holds 1–100 criteria.
- `label` is required.
- Any violation → 400.

## 3. Deterministic evaluation ⚑

**Inputs at `asOf`:**
- For site facts, candidate attributes and location evidence, the version with the greatest `version` whose `recorded_at ≤ asOf`. Later edits never change an earlier `asOf`'s result.
- **A3 — location:**
  - `property.city|region|postal_code|country` read the location-evidence version effective at `asOf`.
  - There is **no fallback** to the current DI-1 Property fields.
  - No evidence at `asOf` → `UNKNOWN` (`MISSING`).
  - Evidence whose field is `null` → `UNKNOWN` (`UNKNOWN`).
  - The evidence `id`, `version` and `recordedAt` used are persisted in the qualification's `inputs.locationEvidence` (`null` when none applied).

**Per-criterion result:**
| Observed | Result |
|---|---|
| absent, or `UNKNOWN` | `UNKNOWN` (`reason: "MISSING"` or `"UNKNOWN"`) |
| `NOT_APPLICABLE`, criterion has `allowNotApplicable: true` (A1) | `NOT_APPLICABLE`, which counts as satisfied |
| `NOT_APPLICABLE`, criterion has `allowNotApplicable: false` (A1) | `UNKNOWN` (`reason: "NOT_APPLICABLE_NOT_PERMITTED"`) ⚑ |
| `KNOWN` but the operator can't apply (e.g. `gte` on a string, including a legacy stored `"150"`) | `UNKNOWN` (`reason: "TYPE_MISMATCH"`) |
| `KNOWN` | `PASS` or `FAIL` by operator |

**A4 — two separate Gate-0 checks:**
- **Run precondition** (permission to run, *current* state). The Opportunity's current lifecycle status must be `READY_FOR_QUALIFICATION`, otherwise 409 and nothing is evaluated (§7). It is a safeguard on running a screen now. It is **not** evidence of readiness at `asOf`. It is reported as `runPrecondition: {lifecycleStatus, satisfied}`.
- **Historical Gate 0** (evidence at `asOf`):
  - It applies the DI-1 readiness requirements (`intelligence/readiness.js`, unchanged) to the **site-fact versions in force at `asOf`**. It is never inferred from the present status.
  - It is reported as `gate0: {basis: "SITE_FACTS_AS_OF", asOf, status, missing}`.
  - The two opportunity-level requirements (`opportunity.property`, `opportunity.concept`) read the Opportunity record, which DI-1 does not version (⚑ §10).

**Outcome (first rule that applies):**
1. Historical Gate 0 at `asOf` is not `READY_FOR_QUALIFICATION` → `INFORMATION_REQUIRED`
2. any `HARD_VETO` = `FAIL` → `NO_GO` ⚑ *(a veto proven by known facts is decisive even if other facts are unknown)*
3. any criterion = `UNKNOWN` → `INFORMATION_REQUIRED`
4. any `HOLD` = `FAIL` → `HOLD`
5. any `WATCH` = `FAIL` → `WATCH`
6. any `CONDITION` = `FAIL` → `CONDITIONAL_GO` (the failed conditions are listed)
7. otherwise → `GO`

Precedence ⚑: `NO_GO` > `INFORMATION_REQUIRED` > `HOLD` > `WATCH` > `CONDITIONAL_GO` > `GO`.

The same opportunity, policy version and `asOf` produce a **deep-equal** result. Time enters only through the explicit `asOf`.

## 4. Relational schema (migration-driven, after `007`)

Column names are part of the contract (tests probe database integrity directly). Additional nullable or defaulted columns are allowed.

| Table | Required columns |
|---|---|
| `di_policy_profiles` | `id`, `organization_id`, `name`, `description`, `is_default`, `created_by`, `created_at`, `updated_at` |
| `di_policy_versions` | `id`, `organization_id`, `profile_id`, `version`, `state` (`DRAFT`/`PUBLISHED`/`RETIRED`), `content_hash`, `created_by`, `created_at`, `published_by`, `published_at`, `retired_at` |
| `di_policy_criteria` | `id`, `organization_id`, `policy_version_id`, `position`, `criterion_key`, `label`, `kind`, `subject`, `operator`, `operand` (JSONB), `rationale`, `allow_not_applicable` (BOOLEAN NOT NULL DEFAULT FALSE, A1) |
| `di_candidate_attributes` | `id`, `organization_id`, `opportunity_id`, `attribute_key`, `value` (JSONB), `value_status`, `version`, `source_type`, `source_reference`, `recorded_by`, `recorded_at` |
| `di_qualifications` | `id`, `organization_id`, `opportunity_id`, `policy_version_id`, `policy_content_hash`, `as_of`, `outcome`, `criteria_results` (JSONB), `inputs` (JSONB; includes `locationEvidence: {id, version, recordedAt} \| null`), `evaluated_by`, `evaluated_at`, `supersedes` |
| `di_location_evidence` (A3) | `id`, `organization_id`, `property_id`, `version`, `city`, `region`, `postal_code`, `country`, `source_type`, `source_reference`, `recorded_by`, `recorded_at` |

**Integrity (database-enforced):**
- Every table: `organization_id NOT NULL` with an FK to `organizations`, and an index led by `organization_id`.
- Same-tenant composite foreign keys (`23503` on violation): version → profile; criterion → version; candidate attribute → opportunity (DI-1); qualification → opportunity; qualification → policy version; `supersedes` → qualification; location evidence → property (DI-1, `(organization_id, property_id) → di_properties (organization_id, id)`, A3).
- `UNIQUE (property_id, version)` on location evidence.
- At most one default profile per organization (`23505`).
- `UNIQUE (profile_id, version)`; `UNIQUE (policy_version_id, criterion_key)`.
- `CHECK` vocabularies: version `state`; criterion `kind` and `operator`; attribute key and `value_status`; qualification `outcome` (the six values only).
- **Published content is immutable:**
  - any `INSERT`/`UPDATE`/`DELETE` of `di_policy_criteria` for a version whose state is not `DRAFT` is rejected (this includes `allow_not_applicable`);
  - a version's `profile_id`, `version` and `content_hash` cannot change once `PUBLISHED`;
  - the only permitted state change after publish is `PUBLISHED → RETIRED`.
- **Qualifications, candidate-attribute versions and location-evidence versions are append-only** for every principal: `UPDATE`/`DELETE` rejected.
- Every DI-2 table carries the EF-3 `devos_audit_capture` trigger. EF-3 and DI-1 files are **not modified**.

## 5. Permissions (EF-2)

| Permission | org-admin | developer | viewer | platform-admin |
|---|---|---|---|---|
| `policies:read` | ✓ | ✓ | ✓ | — |
| `policies:manage` ⚑ | ✓ | — | — | — |
| `qualifications:read` | ✓ | ✓ | ✓ | — |
| `qualifications:run` | ✓ | ✓ | — | — |

Candidate attributes reuse DI-1 `opportunities:read` / `opportunities:update`. Location evidence (A3) reuses DI-1 `properties:read` / `properties:update`.

⚑ Policy authorship is restricted to organization administrators: tenant-controlled, not developer-controlled. Platform-admin holds no DI-2 authority.

Status codes: missing permission **403**; foreign or unknown id **404**; forged organization header **403**; unauthenticated **401**; invalid body **400**; lifecycle conflict **409**.

## 6. HTTP API (`/api/di`, JSON, camelCase; server-generated ids)

| Method & path | Permission | Behavior |
|---|---|---|
| `GET /policies` | policies:read | own profiles |
| `POST /policies` | policies:manage | `{name, description?, isDefault?}` → 201 |
| `GET /policies/:id` | policies:read | |
| `PATCH /policies/:id` | policies:manage | `{name?, description?, isDefault?}`; making one default clears the previous default |
| `GET /policies/:id/versions` | policies:read | ascending `version` |
| `POST /policies/:id/versions` | policies:manage | `{criteria}` → 201 `DRAFT` at the next version number; 409 if a DRAFT already exists |
| `GET /policy-versions/:vid` | policies:read | `{id, profileId, organizationId, version, state, contentHash, criteria:[…], createdAt, publishedAt, publishedBy, retiredAt}` |
| `PUT /policy-versions/:vid` | policies:manage | replace criteria; `DRAFT` only, else 409 |
| `POST /policy-versions/:vid/publish` | policies:manage | `DRAFT → PUBLISHED`; sets `contentHash`, `publishedBy`, `publishedAt`; else 409 |
| `POST /policy-versions/:vid/retire` | policies:manage | `PUBLISHED → RETIRED`; else 409 |
| `GET /opportunities/:id/candidate-attributes` | opportunities:read | `{opportunityId, attributes:{key:{value,status,version,provenance}}}` |
| `PUT /opportunities/:id/candidate-attributes` | opportunities:update | `{attributes:{key:{value,status,provenance}}}`; a new version per changed key |
| `GET /opportunities/:id/candidate-attributes/history` | opportunities:read | `[{key,value,status,version,provenance}]` |
| `GET /properties/:id/location-evidence` (A3) | properties:read | `{propertyId, evidence: {id, version, city, region, postalCode, country, provenance:{sourceType, sourceReference, recordedBy, recordedAt}} \| null}` (latest version) |
| `PUT /properties/:id/location-evidence` (A3) | properties:update | `{city?, region?, postalCode?, country?, provenance}` → 200 with the new version (always a new version). At least one field; each field a string or `null`; provenance required; `SYSTEM_DERIVED` rejected; otherwise 400 |
| `GET /properties/:id/location-evidence/history` (A3) | properties:read | evidence versions, ascending `version` |
| `POST /opportunities/:id/qualify` | qualifications:run | `{asOf, policyVersionId?, dryRun?}` (§7) |
| `GET /opportunities/:id/qualifications` | qualifications:read | oldest first |
| `GET /qualifications/:qid` | qualifications:read | |

`contentHash` = lowercase hex SHA-256 of the UTF-8 JSON array of criteria, ordered by `position`, each as `{"allowNotApplicable","key","kind","label","operand","operator","rationale","subject"}` with keys in that order (`rationale` is `null` when absent; `allowNotApplicable` is `true` or `false`, never absent — A1). Two versions that differ only in a NOT_APPLICABLE permission therefore have different hashes.

## 7. Qualification

`POST /api/di/opportunities/:id/qualify`:
- `asOf` is required (an ISO-8601 instant) → otherwise 400.
- Policy: `policyVersionId` if given; otherwise the **highest PUBLISHED version of the tenant's default profile**.
  - none available → **409** (no platform fallback);
  - given version is `DRAFT` or `RETIRED` → **409**;
  - foreign or unknown → **404**.
- Run precondition (A4): the opportunity's current status must be `READY_FOR_QUALIFICATION` → otherwise **409** `{error, status}`. Historical Gate 0 is evaluated separately at `asOf` (§3).
- Response shape:
  ```
  { id?, organizationId, opportunityId, policyProfileId, policyVersionId, policyVersion, policyContentHash, asOf,
    outcome, authority: "POLICY_SCREEN",
    runPrecondition: {lifecycleStatus, satisfied},
    gate0: {basis: "SITE_FACTS_AS_OF", asOf, status, missing},
    criteria: [{key, kind, subject, operator, operand, allowNotApplicable, observed: {value, status, version} | null, result, reason?}],
    inputs: {locationEvidence: {id, version, recordedAt} | null, ...},
    conditions: [keys of failed CONDITION criteria],
    evaluatedBy?, evaluatedAt?, supersedes? }
  ```
- `dryRun: true` → 200 with no `id`; nothing persisted.
- Otherwise → 201, persisted append-only. `supersedes` is the opportunity's previous qualification id, if any.
- A qualification **never** changes the Opportunity's status, never creates a Project, and exposes no approval, commitment or investment field. Request-body fields such as `outcome`, `criteria`, `organizationId` or `authority` are ignored.

## 8. Oracle

`tests/fixtures/di2-qualification-oracle.json` defines:
- two tenant policies: **alpha**, a KG-like proving-ground policy with a 125-unit hard veto, and **beta**, a different tenant with a 40-unit threshold;
- opportunities with versioned facts and attributes recorded at fixed past instants;
- the expected outcome and per-criterion results, derived by hand from §3.

It includes the cross-tenant proof: identical facts produce `NO_GO` under alpha's policy and `GO` under beta's. That proves the threshold is tenant configuration, not platform law.

Revision 2 cases:
- **A1:** `dq-a-o16`, flood zone `NOT_APPLICABLE` on a hard veto without permission → `INFORMATION_REQUIRED`. Alpha's `entitlement` criterion now carries `allowNotApplicable: true`, so `dq-a-o10` stays `GO`.
- **A2:** `dq-a-o17`, legacy stored `"150"` → `TYPE_MISMATCH`.
- **A3:** `dq-a-o18`, region CA → NV over time; `dq-a-o19`, no evidence → `MISSING`. Every current `di_properties.region` is the sentinel `ZZ`, so any fallback to current Property fields changes an outcome.
- **A4:** `dq-a-o20`, zoning first recorded after the `asOf`, so Gate 0 is `INFORMATION_REQUIRED` at 2025-02-01 and `READY` at 2025-04-01 while the current status is READY throughout.

## 9. Out of scope (DI-2)

Underwriting; Sources & Uses; LIHTC; debt sizing; developer economics; scenario modeling; rescue analysis; due-diligence programs; investment-committee approval or override of outcomes; Opportunity → Project promotion; automatic lifecycle changes from outcomes (for example auto-decline on NO_GO); ML, LLM or predictive scoring; platform-default policies.

## 10. Revision history and open points

| Rev | Commit | Change |
|---|---|---|
| 1 | `93d8ea5` | Initial contract and RED gate: 46 tests, 42 RED / 4 GREEN predicted and observed. Evidence `docs/evidence/di2-red-gate-run.txt`, preserved. |
| 2 | this revision | Founder review CONDITIONAL GO. Decisions 1, 2, 5, 6, 7 and 8 approved as written. Decision 4 approved with validation (A2). Decision 3 modified (A1). Decision 9 rejected and replaced (A3). Readiness clarified (A4). RED gate: 52 tests, 48 RED / 4 GREEN predicted. Evidence `docs/evidence/di2-red-gate-run-r2.txt`. |

**Rulings applied:**
- **A1 (decision 3, modified).** NOT_APPLICABLE no longer satisfies a criterion automatically. Each criterion carries `allowNotApplicable`, default `false`, which is stored, immutable after publish and inside the content hash.
- **A2 (decision 4, approved with validation).** Historical or imported malformed values evaluate to `TYPE_MISMATCH` → `INFORMATION_REQUIRED`. Every new API write is type-validated (400), including numeric strings.
- **A3 (decision 9, rejected; replaced).** Qualification reads DI-2 location evidence effective at `asOf`, never the current Property fields, and persists the evidence id and version it used. The DI-1 Property schema is unchanged.
- **A4 (readiness clarification).** The current-status precondition is kept as a run safeguard and labeled `runPrecondition`. Gate 0 at `asOf` is computed from the site-fact versions then in force and labeled `gate0` with `basis: "SITE_FACTS_AS_OF"`.

**Open points for confirmation ⚑:**
1. **A1 reason code and scope.** A non-permitted NOT_APPLICABLE is reported as `UNKNOWN` / `NOT_APPLICABLE_NOT_PERMITTED`, so the outcome is `INFORMATION_REQUIRED`, not `NO_GO`, consistent with "missing information never becomes NO_GO". The permission rule applies to **every** criterion kind, not only `HARD_VETO`. That is the conservative reading.
2. **A2 enforcement point.** Write validation is enforced at the API, and the database deliberately does not constrain the JSON type of stored values. If the type were enforced in the database, `TYPE_MISMATCH` would become unreachable for DI-2 candidate attributes.
3. **A3 granularity.** Location evidence is a whole-address snapshot per version, not per-field versions. A `null` field means `UNKNOWN`, and a location field cannot be marked `NOT_APPLICABLE`.
4. **A4 opportunity-level requirements.** Historical Gate 0 is fully versioned for the six site-fact requirements. `opportunity.property` and `opportunity.concept` come from the Opportunity record, which DI-1 does not version and which is frozen. Versioning them would need either a DI-2 snapshot (like A3) or a DI-1 change.
