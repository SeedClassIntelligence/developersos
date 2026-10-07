# DEVOS-DI-2 — Policy & Gate Engine: Acceptance Contract (DRAFT for review)

**Status:** specification for the DI-2 RED gate. **Implementation is not authorized.**
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
| **Criterion** | One test: `{key, label, kind, subject, operator, operand, rationale}`. |
| **Candidate Attributes** | Versioned facts about the proposed development (the "Development Candidate"), with provenance and KNOWN/UNKNOWN/NOT_APPLICABLE status, following the DI-1 site-fact pattern. |
| **Qualification** | An append-only record: one opportunity, one policy version, an explicit `asOf`, the per-criterion results with the exact input versions observed, and the outcome. |

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
- Wrong type for a `KNOWN` value → 400.
- Status rules are the same as DI-1: `KNOWN` requires a value; `UNKNOWN` and `NOT_APPLICABLE` require `null`.
- Provenance rules are the same as DI-1 (`SYSTEM_DERIVED` is reserved).

### 2.2 Criterion grammar
| Field | Values |
|---|---|
| `key` | `^[a-z0-9_.-]{1,64}$`, unique within a version |
| `kind` | `HARD_VETO`, `HOLD`, `WATCH`, `CONDITION` |
| `subject` | `site.<DI-1 fact key>`, `candidate.<attribute key>`, `property.city`, `property.region`, `property.postal_code`, `property.country` |
| `operator` | `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `between` (inclusive) |
| `operand` | `in`/`not_in`: non-empty array of strings or numbers; `between`: `[min, max]` numbers with min ≤ max; `gt`/`gte`/`lt`/`lte`: a number; `eq`/`neq`: string or number |

- A version holds 1–100 criteria.
- `label` is required.
- Any violation → 400.

## 3. Deterministic evaluation ⚑

**Inputs at `asOf`:**
- For site facts and candidate attributes, the version with the greatest `version` whose `recorded_at ≤ asOf`. Later edits never change an earlier `asOf`'s result.
- Property location fields use their current value (Property addresses are not versioned in DI-1; this is a stated limitation).

**Per-criterion result:**
| Observed | Result |
|---|---|
| absent, or `UNKNOWN` | `UNKNOWN` (`reason: "MISSING"` or `"UNKNOWN"`) |
| `NOT_APPLICABLE` | `NOT_APPLICABLE`, which counts as satisfied |
| `KNOWN` but the operator can't apply (e.g. `gte` on a string) | `UNKNOWN` (`reason: "TYPE_MISMATCH"`) |
| `KNOWN` | `PASS` or `FAIL` by operator |

**Outcome (first rule that applies):**
1. DI-1 readiness at `asOf` is not `READY_FOR_QUALIFICATION` → `INFORMATION_REQUIRED`
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
| `di_policy_criteria` | `id`, `organization_id`, `policy_version_id`, `position`, `criterion_key`, `label`, `kind`, `subject`, `operator`, `operand` (JSONB), `rationale` |
| `di_candidate_attributes` | `id`, `organization_id`, `opportunity_id`, `attribute_key`, `value` (JSONB), `value_status`, `version`, `source_type`, `source_reference`, `recorded_by`, `recorded_at` |
| `di_qualifications` | `id`, `organization_id`, `opportunity_id`, `policy_version_id`, `policy_content_hash`, `as_of`, `outcome`, `criteria_results` (JSONB), `inputs` (JSONB), `evaluated_by`, `evaluated_at`, `supersedes` |

**Integrity (database-enforced):**
- Every table: `organization_id NOT NULL` with an FK to `organizations`, and an index led by `organization_id`.
- Same-tenant composite foreign keys (`23503` on violation): version → profile; criterion → version; candidate attribute → opportunity (DI-1); qualification → opportunity; qualification → policy version; `supersedes` → qualification.
- At most one default profile per organization (`23505`).
- `UNIQUE (profile_id, version)`; `UNIQUE (policy_version_id, criterion_key)`.
- `CHECK` vocabularies: version `state`; criterion `kind` and `operator`; attribute key and `value_status`; qualification `outcome` (the six values only).
- **Published content is immutable:**
  - any `INSERT`/`UPDATE`/`DELETE` of `di_policy_criteria` for a version whose state is not `DRAFT` is rejected;
  - a version's `profile_id`, `version` and `content_hash` cannot change once `PUBLISHED`;
  - the only permitted state change after publish is `PUBLISHED → RETIRED`.
- **Qualifications and candidate-attribute versions are append-only** for every principal: `UPDATE`/`DELETE` rejected.
- Every DI-2 table carries the EF-3 `devos_audit_capture` trigger. EF-3 and DI-1 files are **not modified**.

## 5. Permissions (EF-2)

| Permission | org-admin | developer | viewer | platform-admin |
|---|---|---|---|---|
| `policies:read` | ✓ | ✓ | ✓ | — |
| `policies:manage` ⚑ | ✓ | — | — | — |
| `qualifications:read` | ✓ | ✓ | ✓ | — |
| `qualifications:run` | ✓ | ✓ | — | — |

Candidate attributes reuse DI-1 `opportunities:read` / `opportunities:update`.

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
| `POST /opportunities/:id/qualify` | qualifications:run | `{asOf, policyVersionId?, dryRun?}` (§7) |
| `GET /opportunities/:id/qualifications` | qualifications:read | oldest first |
| `GET /qualifications/:qid` | qualifications:read | |

`contentHash` = lowercase hex SHA-256 of the UTF-8 JSON array of criteria, ordered by `position`, each as `{"key","kind","label","operand","operator","rationale","subject"}` with keys in that order (`rationale` is `null` when absent).

## 7. Qualification

`POST /api/di/opportunities/:id/qualify`:
- `asOf` is required (an ISO-8601 instant) → otherwise 400.
- Policy: `policyVersionId` if given; otherwise the **highest PUBLISHED version of the tenant's default profile**.
  - none available → **409** (no platform fallback);
  - given version is `DRAFT` or `RETIRED` → **409**;
  - foreign or unknown → **404**.
- The opportunity must be in `READY_FOR_QUALIFICATION` → otherwise **409** `{error, status}`.
- Response shape:
  ```
  { id?, organizationId, opportunityId, policyProfileId, policyVersionId, policyVersion, policyContentHash, asOf,
    outcome, authority: "POLICY_SCREEN", gate0: {status, missing},
    criteria: [{key, kind, subject, operator, operand, observed: {value, status, version} | null, result, reason?}],
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

## 9. Out of scope (DI-2)

Underwriting; Sources & Uses; LIHTC; debt sizing; developer economics; scenario modeling; rescue analysis; due-diligence programs; investment-committee approval or override of outcomes; Opportunity → Project promotion; automatic lifecycle changes from outcomes (for example auto-decline on NO_GO); ML, LLM or predictive scoring; platform-default policies.
