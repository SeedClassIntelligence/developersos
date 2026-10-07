# DEVOS-DI-1 — Development Intelligence Foundation: Acceptance Contract

**Status:** specification for the DI-1 RED gate. Implementation is **not authorized**.
**Authority:** DEVOS-DI-1 phase authorization (founder), 2026-10-07.
**Executable form:** `tests/devos-di1-acceptance.test.js` plus the fixtures named below. Where this document and a test disagree, that's a contract defect: report it, don't resolve it silently.

This contract fixes the observable interface (HTTP API, relational schema, permissions, rule identities) that the acceptance tests exercise. Anything not fixed here is left to the implementation.

---

## 1. Domain boundary

- Relationship → Property → Opportunity → Site Intelligence → (later) Development Candidate.
- **An Opportunity is not a Project.** No DI-1 operation creates, updates or links a row in `projects`. There is no promotion endpoint in DI-1.
- DI-1 reports **information readiness only**. The words GO, HOLD, WATCH, CONDITIONAL_GO and NO-GO are not valid DI-1 states, fields or values anywhere.

## 2. Relational schema (migration-driven, PostgreSQL)

DI-1 is delivered as new migration(s) after `005`. All tables are in `public`. Column names below are part of the contract (tests write to them directly to probe database-enforced integrity). Additional columns are allowed if they are nullable or defaulted.

| Table | Required columns |
|---|---|
| `di_relationships` | `id`, `organization_id`, `name`, `relationship_type` (free text — **not** a closed enum), `status` (`ACTIVE`/`INACTIVE`), `source_type`, `source_reference`, `recorded_by`, `created_at`, `updated_at` |
| `di_properties` | `id`, `organization_id`, `name`, `street_address`, `city`, `region`, `postal_code`, `country`, `apn`, `source_type`, `source_reference`, `recorded_by`, `created_at`, `updated_at` |
| `di_opportunities` | `id`, `organization_id`, `property_id` (nullable), `relationship_id` (nullable), `name`, `status`, `concept_description`, `responsible_user_id` (nullable), `source_type`, `source_reference`, `recorded_by`, `created_at`, `updated_at` |
| `di_opportunity_status_history` | `id`, `organization_id`, `opportunity_id`, `from_status` (nullable), `to_status`, `reason`, `changed_by`, `changed_at` |
| `di_site_facts` | `id`, `organization_id`, `property_id`, `fact_key`, `value` (JSONB, nullable), `value_status` (`KNOWN`/`UNKNOWN`/`NOT_APPLICABLE`), `version` (int ≥ 1), `source_type`, `source_reference`, `recorded_by`, `recorded_at` |
| `intelligence_findings` | `id`, `organization_id`, `rule_id`, `rule_version` (int), `condition_key`, `finding_type`, `severity` (`critical`/`warning`/`info`), `title`, `explanation`, `sources` (JSONB array of `{type,id}`), `state` (`OPEN`/`ACKNOWLEDGED`/`RESOLVED`), `as_of`, `first_detected_at`, `resolved_at`, `resolution`, `recurrence_of` |
| `intelligence_finding_events` | `id`, `organization_id`, `finding_id`, `from_state` (nullable), `to_state`, `actor_user_id` (nullable for system), `note`, `occurred_at` |

**Integrity (database-enforced, not middleware-only):**
- Every table: `organization_id NOT NULL` with a foreign key to `organizations(id)`, and an index whose leading column is `organization_id`.
- Same-tenant references are enforced by composite foreign keys or equivalent. The database must reject (SQLSTATE `23503`):
  - an opportunity whose `property_id` or `relationship_id` belongs to another organization;
  - a site fact whose `property_id` belongs to another organization;
  - a status-history row whose `opportunity_id` belongs to another organization;
  - a finding event whose `finding_id` belongs to another organization.
- `di_opportunities.status` accepts only the lifecycle states in §5 (`CHECK`).
- At most one **active** finding (`state` ≠ `RESOLVED`) per `(organization_id, rule_id, condition_key)` (SQLSTATE `23505` on violation).
- History is durable. The runtime role cannot `DELETE` from `di_opportunity_status_history`, `di_site_facts`, `intelligence_findings` or `intelligence_finding_events`.
- Every DI table carries the EF-3 capture trigger `devos_audit_capture`. EF-3 itself (`004`, `005`, `db/audit-signing.js`, `db/repositories/audit.repo.js`) is **not modified**.

## 3. Permissions (EF-2 architecture, no second mechanism)

| Permission | org-admin | developer | viewer | platform-admin |
|---|---|---|---|---|
| `relationships:read` | ✓ | ✓ | ✓ | — |
| `relationships:create`, `relationships:update` | ✓ | ✓ | — | — |
| `properties:read` | ✓ | ✓ | ✓ | — |
| `properties:create`, `properties:update` | ✓ | ✓ | — | — |
| `opportunities:read` | ✓ | ✓ | ✓ | — |
| `opportunities:create`, `opportunities:update`, `opportunities:transition` | ✓ | ✓ | — | — |
| `site_intelligence:read` | ✓ | ✓ | ✓ | — |
| `site_intelligence:update` | ✓ | ✓ | — | — |
| `findings:read` | ✓ | ✓ | ✓ | — |
| `findings:evaluate`, `findings:acknowledge`, `findings:resolve` | ✓ | ✓ | — | — |

Platform-admin holds **no** DI permission: platform administration stays separate from organization authority. Every route is mounted behind `protect` + `resolveOrganizationContext`. A missing permission returns **403**. A foreign or nonexistent resource ID returns **404** (EF-2 concealment). A forged `X-Organization-Id` returns **403**. An unauthenticated request returns **401**.

The machine-readable form is `tests/fixtures/di1-authorization-matrix.json`.

## 4. HTTP API (JSON, camelCase)

Base path `/api/di`. All IDs are **server-generated**. The client-supplied `id`, `organizationId`, `status`, `recordedBy`, `recordedAt`, `createdAt` and `updatedAt` are ignored (mass assignment).

**Provenance object** (request): `{ "sourceType": "...", "sourceReference": "..." }`. The response adds `recordedBy` (the authenticated user) and `recordedAt` (server time).

`sourceType` ∈ `USER_ENTRY`, `PUBLIC_RECORD`, `DOCUMENT`, `CONNECTED_SYSTEM`, `SYSTEM_DERIVED`. `SYSTEM_DERIVED` is reserved for the system: a user request carrying it returns **400**. A missing or unknown `sourceType` returns **400**.

| Method & path | Permission | Notes |
|---|---|---|
| `GET /api/di/relationships` | relationships:read | own organization only |
| `POST /api/di/relationships` | relationships:create | body `{name, relationshipType, provenance}` → 201 |
| `GET /api/di/relationships/:id` | relationships:read | |
| `PATCH /api/di/relationships/:id` | relationships:update | `{name?, relationshipType?, status?}` |
| `GET/POST /api/di/properties`, `GET/PATCH /api/di/properties/:id` | properties:* | body `{name, address:{street,city,region,postalCode,country}, apn?, provenance}` |
| `GET /api/di/properties/:id/site-intelligence` | site_intelligence:read | `{propertyId, facts:{key:{value,status,version,provenance}}}`: current version of each fact |
| `PUT /api/di/properties/:id/site-intelligence` | site_intelligence:update | `{facts:{key:{value,status,provenance}}}`. Each changed fact gets a **new version**; earlier versions are kept |
| `GET /api/di/properties/:id/site-intelligence/history` | site_intelligence:read | every version of every fact |
| `GET/POST /api/di/opportunities`, `GET/PATCH /api/di/opportunities/:id` | opportunities:* | body `{name, propertyId?, relationshipId?, responsibleUserId?, concept:{description}, provenance}`. `PATCH` cannot change `status` |
| `POST /api/di/opportunities/:id/transition` | opportunities:transition | `{to, reason}` (§5) |
| `GET /api/di/opportunities/:id/history` | opportunities:read | status history, oldest first |
| `GET /api/di/opportunities/:id/readiness` | opportunities:read | §6 |
| `GET /api/di/rules` | findings:read | the rule registry (§7) |
| `POST /api/di/evaluate` | findings:evaluate | `{asOf, dryRun?}` (§8) |
| `GET /api/di/findings?state=OPEN\|ACKNOWLEDGED\|RESOLVED\|ACTIVE` | findings:read | |
| `GET /api/di/findings/:id`, `GET /api/di/findings/:id/history` | findings:read | |
| `POST /api/di/findings/:id/acknowledge` | findings:acknowledge | `{note?}` |
| `POST /api/di/findings/:id/resolve` | findings:resolve | `{note}` |

**Response shapes** (fields the tests read; more fields are allowed):

| Resource | Fields |
|---|---|
| Relationship | `id`, `organizationId`, `name`, `relationshipType`, `status`, `provenance{sourceType,sourceReference,recordedBy,recordedAt}`, `createdAt`, `updatedAt` |
| Property | `id`, `organizationId`, `name`, `address{street,city,region,postalCode,country}`, `apn`, `provenance{…}`, `createdAt`, `updatedAt` |
| Opportunity | `id`, `organizationId`, `name`, `propertyId`, `relationshipId`, `responsibleUserId`, `status`, `concept{description}`, `provenance{…}`, `createdAt`, `updatedAt` |
| Status history entry | `fromStatus`, `toStatus`, `reason`, `changedBy`, `changedAt` (oldest first) |
| Site intelligence (current) | `{ propertyId, facts: { <key>: { value, status, version, provenance{…} } } }` (absent facts are omitted) |
| Site intelligence history entry | `key`, `value`, `status`, `version`, `provenance{…}` |
| Finding | §8 fields |
| Finding history entry | `fromState`, `toState`, `actorUserId`, `note`, `occurredAt` (oldest first; the first entry has `toState: "OPEN"`) |
| Transition refused for missing information | 409 `{ error, missing: [keys] }` |

List endpoints return a JSON array. Acknowledging an `ACKNOWLEDGED` finding is undefined in DI-1 and not tested.

There is **no** endpoint that creates a finding from client input. `POST /api/di/findings` is not allowed.

References in a request body (`propertyId`, `relationshipId`, `responsibleUserId`) to another organization's records, or to non-members, return **404**. The same applies to task/contract references to another organization's partner or contract (§9).

## 5. Opportunity lifecycle

States: `NEW`, `SCREENING`, `INFORMATION_REQUIRED`, `READY_FOR_QUALIFICATION` (active); `DECLINED`, `WITHDRAWN`, `EXPIRED` (terminal).

| From | Allowed `to` |
|---|---|
| (create) | `NEW` only, whatever the request says |
| `NEW` | `SCREENING`, `DECLINED`, `WITHDRAWN` |
| `SCREENING` | `INFORMATION_REQUIRED`, `READY_FOR_QUALIFICATION`\*, `DECLINED`, `WITHDRAWN`, `EXPIRED` |
| `INFORMATION_REQUIRED` | `SCREENING`, `READY_FOR_QUALIFICATION`\*, `DECLINED`, `WITHDRAWN`, `EXPIRED` |
| `READY_FOR_QUALIFICATION` | `INFORMATION_REQUIRED`, `DECLINED`, `WITHDRAWN`, `EXPIRED` |
| `DECLINED`, `WITHDRAWN`, `EXPIRED` | none |

\* Only when readiness (§6) is `READY_FOR_QUALIFICATION`. Otherwise the request returns **409** with the `missing` list, and the status is unchanged.

- A disallowed transition returns **409**, status unchanged.
- An unknown target returns **400**. That includes `GO`, `NO-GO`, `NO_GO`, `HOLD`, `WATCH`, `CONDITIONAL_GO` and `CONDITIONAL GO`.
- Every accepted transition writes a status-history row with actor and reason.
- The system never moves an opportunity to a terminal state because information is missing.

## 6. Information sufficiency (Gate 0 foundation)

`GET /api/di/opportunities/:id/readiness` →
`{ "opportunityId", "status": "INFORMATION_REQUIRED" | "READY_FOR_QUALIFICATION", "requirements": [{"key","satisfied"}], "missing": [keys] }`

The platform baseline requirement set is platform-neutral, has no tenant policy, and has no KG thresholds:

| Key | Satisfied when |
|---|---|
| `opportunity.property` | the opportunity references a property |
| `opportunity.concept` | `concept.description` is non-empty |
| `site.apn`, `site.ownership`, `site.lot_area_sqft`, `site.zoning`, `site.current_use`, `site.acquisition_basis` | the property's current fact has status `KNOWN` or `NOT_APPLICABLE` |

`UNKNOWN` and absent facts are **not** satisfied. Missing information yields `INFORMATION_REQUIRED`, never a decision or a terminal state. The response carries no GO/NO-GO-type field.

**Site fact vocabulary** (unknown keys return 400): `apn`, `ownership`, `lot_area_sqft`, `acquisition_basis`, `acquisition_structure`, `current_use`, `zoning`, `future_land_use`, `overlays`, `density_du_per_acre`, `far`, `height_limit_ft`, `setbacks`, `parking`, `utilities`, `access`, `easements`, `flood_zone`, `environmental`, `demolition`, `entitlement_path`, `known_constraints`.

- `KNOWN` requires a non-null value.
- `UNKNOWN` requires a null value. The system never manufactures a value.
- `NOT_APPLICABLE` requires a null value.
- A violation returns **400**.

## 7. Rule registry

Machine-readable file: `intelligence/rule-registry.json` (backend root). `GET /api/di/rules` returns the same rules.

```json
{ "registryVersion": 1, "rules": [ { "ruleId", "version", "title", "status": "ACTIVE|DEPRECATED",
  "legacyAlertRule": "R1..R6|null", "findingType", "inputDomains": [..], "severityPolicy": {..},
  "timeDependent": true|false, "sourceTypes": [..] } ] }
```

Required rules (the six legacy rules are inventoried in `tests/fixtures/di1-rule-inventory.json`; none may disappear):

| ruleId | legacy | findingType | sources (exact composition) | severity |
|---|---|---|---|---|
| `EXEC-TASK-NO-CONTRACT` | R1 | `missing-contract` | `[task]` | critical |
| `EXEC-CONTRACT-MISSING` | R2 | `missing-contract` | `[contract]` | critical |
| `EXEC-BLOCKED-TASKS` | R3 | `blocked-tasks` | `[project, …blocked tasks of that project]`, **one finding per project** | warning |
| `EXEC-PERMIT-CORRECTIONS` | R4 | `permit-corrections` | `[permit, …open corrections]` | warning |
| `EXEC-CAPITAL-DEADLINE` | R5 | `capital-deadline` | `[capital_stack, capital_source]` | critical if days < 30, else warning (days < 60) |
| `EXEC-GC-CONTRACT-PENDING` | R6 | `gc-contract` | `[project, contract]` | warning |
| `DI-OPPORTUNITY-INFORMATION-REQUIRED` | — | `information-required` | `[opportunity]` | info |

Rule semantics follow the legacy rules (inventory), with three explicit changes:
1. Inputs are tenant-scoped (fixes the R5 capital defect and the R1/R2 partner defect).
2. R3 emits one finding per project, not one conflated finding.
3. Time is supplied only by `asOf`.

R5: `days = round((deadline − asOf) / 1 day)`; a finding is emitted when `status = 'pending'`, the deadline is set, and `days < 60`. Overdue (negative days) is critical. The DI rule fires for opportunities in `NEW`, `SCREENING` or `INFORMATION_REQUIRED` whose readiness is `INFORMATION_REQUIRED`, and never for terminal or ready opportunities.

Source `type` vocabulary: `project`, `task`, `contract`, `permit`, `permit_correction`, `capital_stack`, `capital_source`, `partner`, `opportunity`, `property`, `relationship`.

## 8. Evaluation, determinism and finding lifecycle

`POST /api/di/evaluate {asOf, dryRun}`:
- `asOf` is required: an ISO-8601 instant. Missing or invalid returns **400**. Rules never read the system clock for outcome-affecting time.
- `dryRun: true` → `{asOf, findings:[computed]}`, persists nothing. The same state and the same `asOf` produce **deep-equal** output.
- Otherwise the evaluation persists and returns `{asOf, findings:[active after evaluation], created:[ids], resolved:[ids]}`.
- A finding (computed or persisted) exposes `ruleId`, `ruleVersion`, `organizationId`, `severity`, `findingType`, `title`, `explanation`, `sources`, `asOf`, `conditionKey` and, when persisted, `id`, `state`, `firstDetectedAt`, `resolvedAt`, `resolution` and `recurrenceOf`.
- `conditionKey` = `ruleId + "|" + sources` where sources are rendered `type:id`, sorted, and comma-joined.

Re-evaluation semantics:

| Situation | Result |
|---|---|
| Condition still present, finding OPEN/ACKNOWLEDGED | Same finding kept, state unchanged, no duplicate. Severity follows the new `asOf` |
| Condition absent, finding active | Finding becomes `RESOLVED`, `resolution = "CONDITION_CLEARED"`; row and history kept |
| Condition present again after its finding was resolved | **New** OPEN finding with `recurrenceOf` = previous finding id |
| Active finding produced by an older `ruleVersion` | Old finding `RESOLVED`, `resolution = "SUPERSEDED_BY_RULE_VERSION"`; new OPEN finding at the current version |

Manual lifecycle: `OPEN → ACKNOWLEDGED → RESOLVED`, and `OPEN → RESOLVED`. Acknowledging or resolving a `RESOLVED` finding returns **409**. Request bodies cannot change `sources`, `severity`, `ruleId`, `ruleVersion` or `organizationId`. Every state change writes an `intelligence_finding_events` row with the actor, and is captured by EF-3.

## 9. Tenant isolation of intelligence inputs

Every input a rule reads is scoped to the evaluating organization. That includes partners and capital stacks consumed by the legacy rules, and `/api/alerts`.
- Findings and alerts for organization A never contain a record identifier, name or derived value from organization B.
- A task or contract in organization A cannot reference a partner or contract of organization B. The API returns 404 for such a reference.

## 10. Out of scope (DI-1)

DI-2 policy and gates; GO/HOLD/WATCH/CONDITIONAL GO/NO-GO; tenant policy profiles; KG thresholds (including 125 units); underwriting, Sources & Uses, LIHTC, debt sizing, developer economics, scenarios, rescue analysis; due-diligence programs; investment committee; Opportunity → Project promotion; ML, LLM calls, predictive scoring and AI feasibility decisions.
