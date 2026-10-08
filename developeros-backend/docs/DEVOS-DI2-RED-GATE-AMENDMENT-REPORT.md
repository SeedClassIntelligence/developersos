# DEVOS-DI2 — RED Gate Amendment Report (revision 2)

**Phase:** DEVOS-DI-2 Policy & Gate Engine. This is a **contract-and-RED-gate amendment only**. DI-2 is not implemented and implementation is not authorized.
**Authority:** founder review of the revision-1 RED gate (`93d8ea5`): **CONDITIONAL GO**. The review authorized amending the contract, oracle, affected tests, predicted baseline and evidence for three corrections and one readiness clarification, then rerunning the full gate and stopping.
**Preserved unchanged:** `docs/DEVOS-DI2-RED-GATE-REPORT.md` and `docs/evidence/di2-red-gate-run.txt`. Both are byte-identical to `93d8ea5`. Revision-1 baseline entries keep their original expected state and reason; amended entries carry an added `amendment` note.
**Frozen foundation untouched:** no DI-1 or EF-3 file changed (`DEVOS-DI2-DI1-FROZEN-001` and `DEVOS-DI2-EF3-FROZEN-001` are GREEN). No implementation code was added: no migration, route, repository or engine.

## 1. Aggregate

| Gate | Result |
|---|---|
| 0–7 protected (clean-DB, V1, Golden, P0, EF-1, EF-2, Security Golden, EF-3) | 173/173 GREEN |
| 8. DI-1 acceptance | 66/66 GREEN |
| 9. DI1-D1 partner integrity | 6/6 GREEN |
| **Accepted aggregate** | **245/245 GREEN, no regression** |
| **10. DEVOS-DI-2 acceptance (revision 2)** | **52 tests: 48 RED, 4 GREEN; LOCKED, 0 mismatches** |

- The **prediction** was written to `tests/fixtures/di2-red-baseline.json` (`revision: 2`) before the first revision-2 run: 48 RED / 4 GREEN. The actual result was 48 RED / 4 GREEN, with no unexpected GREEN, no unexpected RED and no test left unrun.
- **Every RED is a missing capability:** DI-2 tables absent (`42P01`), `/api/di` policy, qualification, candidate-attribute or location-evidence endpoints returning 404, or a precondition that depends on them. None comes from a test fault. The fixture's DI-1 records load, and DI-1's readiness endpoint already reports `dq-a-o20` as `READY_FOR_QUALIFICATION`, the positive precondition for GATE0-001.
- **The 4 GREEN guards are unchanged:**
  - `DI1-FROZEN-001`
  - `EF3-FROZEN-001`
  - `AUDIT-002`
  - `BOUNDARY-001`

Evidence: `docs/evidence/di2-red-gate-run-r2.txt`, a full run from an empty PostgreSQL 18 cluster.

## 2. Rulings and amendments

| Decision | Ruling | Amendment |
|---|---|---|
| 1 Precedence | Approved | unchanged |
| 2 Known hard veto decisive despite unknowns | Approved | unchanged |
| 3 NOT_APPLICABLE satisfies | **Modified** | **A1** |
| 4 TYPE_MISMATCH → UNKNOWN | **Approved with validation** | **A2** |
| 5 Org-admin-only authorship | Approved | unchanged |
| 6 Default = latest published, no fallback | Approved | unchanged |
| 7 No auto-decline on NO_GO | Approved | unchanged |
| 8 Separate versioned candidate attributes | Approved | unchanged |
| 9 Current location for historical asOf | **Rejected** | **A3** |
| Readiness clarification | Directed | **A4** |

### A1 — NOT_APPLICABLE requires criterion-level permission
- Every criterion carries `allowNotApplicable`, a boolean defaulting to `false`. It is stored as `di_policy_criteria.allow_not_applicable`, returned on every criterion, and inside the canonical content hash: `{"allowNotApplicable","key","kind","label","operand","operator","rationale","subject"}`. Two versions differing only in the permission hash differently. Once published it is immutable like the rest of the criterion content.
- A `NOT_APPLICABLE` input without permission evaluates to `UNKNOWN` with reason `NOT_APPLICABLE_NOT_PERMITTED`, giving `INFORMATION_REQUIRED`. It never becomes `NO_GO`, because the input is not a known failing fact.
- A non-boolean value → 400.
- Oracle:
  - Alpha's `entitlement` HOLD criterion now permits NOT_APPLICABLE, so `dq-a-o10` stays `GO`.
  - New `dq-a-o16`: flood zone `NOT_APPLICABLE` on the `no_flood` hard veto, which does not permit it → `INFORMATION_REQUIRED`.

### A2 — TYPE_MISMATCH for historical values; validation for new writes
- Every new API write is type-validated (400). CAND-003 adds the numeric string `"150"`.
- The database does not constrain a stored value's JSON type, so historical or imported values stay representable. Evaluation never trusts the stored type: such a value gives `TYPE_MISMATCH` and so `INFORMATION_REQUIRED`.
- Oracle: new `dq-a-o17`, with `proposed_units` stored as `"150"` by SQL to stand in for a historical import.
- TYPE-001 proves both halves on the same opportunity: the identical value is refused on write (400, stored version unchanged) and evaluates to `TYPE_MISMATCH` when already stored.

### A3 — Versioned location evidence; no fallback to current Property fields
- New DI-2 table `di_location_evidence`: `(id, organization_id, property_id, version, city, region, postal_code, country, provenance…)`.
  - Same-tenant composite FK to `di_properties (organization_id, id)`.
  - `UNIQUE (property_id, version)`.
  - Append-only.
  - Carries the EF-3 capture trigger.
- The DI-1 Property schema is unchanged.
- Endpoints `GET|PUT /api/di/properties/:id/location-evidence` and `GET …/history`, under DI-1 `properties:read` / `properties:update`.
- `property.*` subjects read the evidence version effective at `asOf`:
  - no evidence → `UNKNOWN` (`MISSING`);
  - a `null` field → `UNKNOWN` (`UNKNOWN`).
- Every qualification persists `inputs.locationEvidence = {id, version, recordedAt}`, or `null` when no evidence applied. LOC-002 checks this in the API response and directly in `di_qualifications.inputs`.
- **Fallback trap:** every fixture Property's current `region` is the sentinel `ZZ`. A product that reads current Property fields would turn every alpha `market` result into `FAIL` (a WATCH) and break the oracle.
- Oracle:
  - New `dq-a-o18`: region CA (v1, 2025-01-01) → NV (v2, 2025-03-01); `GO` at 2025-02-01, `WATCH` at 2025-04-01.
  - New `dq-a-o19`: no evidence → `INFORMATION_REQUIRED` (`MISSING`).

### A4 — Historical Gate 0, separated from the run precondition
- **`runPrecondition: {lifecycleStatus, satisfied}`:** the current-status check (`READY_FOR_QUALIFICATION`, otherwise 409) is kept as a permission-to-run safeguard and labeled as such.
- **`gate0: {basis: "SITE_FACTS_AS_OF", asOf, status, missing}`:** the DI-1 readiness requirements (frozen `readiness.js`) applied to the site-fact versions in force at `asOf`, never inferred from present status.
- Oracle: new `dq-a-o20`. It is currently READY according to DI-1 readiness, but zoning was first recorded on 2025-03-01:
  - at 2025-02-01, Gate 0 is `INFORMATION_REQUIRED` with missing `["site.zoning"]` and the run precondition is satisfied;
  - at 2025-04-01, Gate 0 is READY and the outcome is `GO`.

## 3. Test changes (46 → 52)

**Added, all predicted and observed RED:**

| ID | Amendment | Proves |
|---|---|---|
| `DEVOS-DI2-SCHEMA-012` | A3 | DB rejects location evidence on another tenant's property (`23503`, same-tenant control) |
| `DEVOS-DI2-POL-007` | A1 | `allowNotApplicable` defaults false, round-trips, and changes the published content hash |
| `DEVOS-DI2-LOC-001` | A3 | Location-evidence API: versions, provenance, history, 400s; DI-1 Property record unchanged |
| `DEVOS-DI2-LOC-002` | A3 | `asOf` selects location evidence; the exact evidence id and version are persisted; none → `null` |
| `DEVOS-DI2-TYPE-001` | A2 | The same malformed value is refused on write and is `TYPE_MISMATCH` when historical |
| `DEVOS-DI2-GATE0-001` | A4 | Gate 0 from site-fact versions at `asOf`, reported separately from `runPrecondition` |

**Amended, expected state unchanged:**

| Amendment | Tests |
|---|---|
| A3 table set and append-only | SCHEMA-001, SCHEMA-002, SCHEMA-010 |
| A1 immutability of the permission | SCHEMA-009 |
| A1 validation | POL-004 |
| A1 hash formula | POL-005, POL-006, QUAL-005, IMMUTABLE-POLICY-001 |
| A2 validation | CAND-003 |
| Oracle cases o16, o17, o19 | QUAL-002, INFORMATION-001 |
| A3 location-evidence fixture | TENANT-POLICY-001 |
| A3 cross-tenant and authorization | ADV-001, ADV-002, ADV-006, AUTHZ-001 (matrix +3 endpoints) |
| A3 audit capture | AUDIT-001 |

Each amended entry is annotated in the baseline.

## 4. Oracle cross-check

I updated the independent reference evaluator, a literal implementation of contract §3 revision 2 over versioned records (`recordedAt`, `version`), and ran it against the amended oracle. It agrees with **all 23 evaluations**: 18 single-`asOf` cases plus 5 `asOf` series points. It also agrees with the tenant-configurability proof.

The new cases discriminate between revisions. Under revision-1 rules:
- `dq-a-o16` would be `GO`;
- `dq-a-o19` would be `WATCH`, because the current region is `ZZ`;
- `dq-a-o18` would be `WATCH` at both instants.

## 5. Open points for confirmation ⚑ (contract §10)

1. **A1 reason code and scope.** A non-permitted NOT_APPLICABLE is reported as `UNKNOWN` / `NOT_APPLICABLE_NOT_PERMITTED`, so the outcome is `INFORMATION_REQUIRED`. The rule applies to every criterion kind, not only `HARD_VETO`.
2. **A2 enforcement point.** Type validation is enforced at the API. The database deliberately does not constrain the JSON type of stored values; doing so would make `TYPE_MISMATCH` unreachable for DI-2 attributes.
3. **A3 granularity.** Location evidence is a whole-address snapshot per version, and a `null` field means `UNKNOWN`. There is no per-field NOT_APPLICABLE for location.
4. **A4 residual.** `opportunity.property` and `opportunity.concept`, the two non-site Gate-0 requirements, read the Opportunity record, which DI-1 does not version and which is frozen. Making them historical would need a DI-2 snapshot or a DI-1 change.

## 6. Status

**Stopped after the full-gate rerun.** DI-2 implementation is not authorized. The DI-1 + DI1-D1 foundation is on its own branch and pull request, and contains no DI-2 material.
