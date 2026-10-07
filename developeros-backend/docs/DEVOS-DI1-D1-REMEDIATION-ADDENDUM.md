# DEVOS-DI1-D1 — Remediation Evidence Addendum

**Finding:** DI1-D1 (P1). `tasks.partner_id` and `contracts.partner_id` permitted cross-tenant Partner references inside PostgreSQL; only the API refused them.
**Classification:** a newly discovered **EF-2 data-integrity defect exposed by DI-1**. The frozen EF-2 fixture preserved invalid data: Tenant B's contract referenced Tenant A's partner `part1`.
**Scope:** surgical. One fixture correction and one migration. EF-2 is not otherwise reopened, and DI-1 is not redesigned.
**Status:** remediated, awaiting independent acceptance of DI-1.

## 1. Result

| Gate | Before (`bdb9f6d`) | After |
|---|---|---|
| 0–7 protected (clean-DB, V1, Golden, P0, EF-1, EF-2, Security Golden, EF-3) | 173/173 | **173/173** |
| 8. DI-1 acceptance | 66/66 | **66/66** |
| 9. DEVOS-DI1-D1 (new, database boundary) | **0/6** (RED, committed first in `9e38259`) | **6/6** |
| **Aggregate** | — | **245/245** |

All runs started from an empty PostgreSQL cluster with migrations `001`–`007`. Evidence:
- RED: `docs/evidence/di1-d1-red-baseline.txt`
- GREEN: `docs/evidence/di1-d1-gate-run.txt`

## 2. EF-2 fixture correction (required items 1, 2, 8)

- `tests/fixtures/ef2-security-fixture.json`:
  - adds `tenantBResources.partner` = `part-org2-confidential` (organization `org2`);
  - Tenant B's contract now references it instead of `part1` (org1).
- `tests/devos-ef2-acceptance.test.js`: the setup inserts that partner before the contract. **That is the only change.** No assertion, expected status or test step was modified, and every EF-2 test keeps its intent. Tenant B's contract is still a confidential foreign resource that Tenant A must not list, read or mutate.
- EF-2 remains **29/29**, and the Security Golden Path **15/15**.

## 3. Relational enforcement (required items 3, 4): `007_execution_partner_tenant_integrity.sql`

This is a composite-FK architecture, the same as DI-1:

| Table | Constraint | Effect |
|---|---|---|
| `projects` | `UNIQUE (id, organization_id)` | project tenant key |
| `partners` | `UNIQUE (id, org_id)` | partner tenant key |
| `tasks`, `contracts` | new `organization_id NOT NULL`, backfilled from the project | explicit tenant column |
| `tasks`, `contracts` | `(project_id, organization_id) → projects (id, organization_id) ON UPDATE CASCADE` | the tenant column must equal the project's tenant, so it **cannot be forged** |
| `tasks`, `contracts` | `(partner_id, organization_id) → partners (id, org_id) ON DELETE SET NULL (partner_id)` | **a partner must belong to the same tenant** |

- **The trigger only derives the value.** A `BEFORE INSERT` trigger fills `organization_id` from the project when it's omitted, so existing insert statements in repositories, the seeder and the tests are unchanged. Integrity comes from the foreign keys, not the trigger: a supplied value that disagrees with the project fails `*_project_same_tenant`.
- **Moving a project across tenants** cascades to its rows and is rejected while any still references the old tenant's partner.
- **Upgrading a database that already holds invalid rows:** the migration refuses, naming every offending task and contract, and rolls back. It never silently clears or rewrites a partner reference. Verified: an upgrade over a seeded cross-tenant contract `bad-c` failed with `DI1-D1: cross-tenant partner references must be corrected before this migration (contracts: bad-c; tasks: none)`; `007` was not recorded and the row was untouched.

## 4. Adversarial database tests (required item 5): `tests/devos-di1-d1-partner-integrity.test.js`

Each probe:
- runs as the **actual runtime role**;
- runs a same-tenant control first in the same transaction;
- requires **SQLSTATE `23503`**;
- is always rolled back.

| Test | RED (before) | GREEN (after), constraint that fired |
|---|---|---|
| `DB-TASK-001`: insert a task with a foreign partner | accepted | `tasks_partner_same_tenant` |
| `DB-CONTRACT-001`: insert a contract with a foreign partner | accepted | `contracts_partner_same_tenant` |
| `DB-UPDATE-001`: re-point an existing task or contract at a foreign partner | accepted | `tasks_partner_same_tenant`, `contracts_partner_same_tenant` |
| `DB-FORGE-001`: set the row's tenant to the partner's tenant | column absent (42703) | `tasks_project_same_tenant`, `contracts_project_same_tenant` |
| `DB-MOVE-001`: move a project to another tenant while its task uses the old tenant's partner | accepted | `tasks_partner_same_tenant` (through the cascade) |
| `EF2-FIXTURE-001`: Tenant B's contract partner belongs to Tenant B | `part1` (org1) | `part-org2-confidential` (org2) |

## 5. API behavior retained (required item 6)

The same attack through HTTP still returns the established concealed **404**, so application and relational enforcement now both hold:
- `DEVOS-DI1-ADV-EXECREF-001`: foreign `partnerId` on task create/update and on contract create, and a foreign `contractId`, all → 404;
- `DEVOS-DI1-TENANT-PARTNER-001`: the API refuses the reference. The test's direct-SQL plant attempt now reports `23503` from the database, and no foreign partner identity appears in alerts or findings.

## 6. Files changed (vs `bdb9f6d`)

**Added**
- `db/migrations/007_execution_partner_tenant_integrity.sql`
- `tests/devos-di1-d1-partner-integrity.test.js`
- `docs/DEVOS-DI1-D1-REMEDIATION-ADDENDUM.md`
- `docs/evidence/di1-d1-red-baseline.txt`, `docs/evidence/di1-d1-gate-run.txt`

**Modified**
- `tests/fixtures/ef2-security-fixture.json`: Tenant B partner
- `tests/devos-ef2-acceptance.test.js`: setup inserts that partner; no assertion changes
- `tests/runner.js`: gate 9
- `docs/DEVOS-DI1-COMPLETION-EVIDENCE-REPORT.md`: limitation 1 closed
- `docs/DEVOS-MASTER-GATE-INVENTORY.md`

**Unchanged:** the EF-3 files (`EF3-FROZEN-001` GREEN), the DI-1 implementation, the DI-1 tests, oracle and contract.

## 7. Stop gate

DI1-D1 is remediated and pushed. **Work has stopped.** DI-1 awaits independent acceptance, and DI-2 has not begun.
