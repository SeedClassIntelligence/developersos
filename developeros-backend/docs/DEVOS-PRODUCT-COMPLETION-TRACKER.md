# DEVOS — Product Completion Tracker

This is the single source of truth for product status. It is updated at every work-package milestone.
- Assessment and definitions: `docs/DEVOS-PRODUCT-COMPLETION-ASSESSMENT.md`.
- Gate history: `docs/DEVOS-MASTER-GATE-INVENTORY.md`.

**Last updated:** 2026-10-08
**Baseline:** `main` @ `ca69d64` + [PR #2](https://github.com/SeedClassIntelligence/developersos/pull/2) (DI-1 + DI1-D1, green, awaiting merge)
**Working line:** `claude/nice-fermat-5jwzsr`
**Regression gate:** 263/263 GREEN (245 accepted backend + 18 UI browser tests), DI-2 locked at baseline

## Finished (accepted, tested, backend only unless stated)
- **EF-1:** PostgreSQL persistence and migrations
- **EF-2:** RBAC, organization membership/context, invitation-only access, tenant isolation
- **EF-3:** verifiable audit ledger (hash chain v2, signed checkpoints, role separation)
- **DI-1:** relationships, properties, opportunities, versioned site facts, readiness, findings engine (API)
- **DI1-D1:** database-enforced same-tenant partner references for tasks/contracts
- **DI-2 specification:** contract revision 2 + 52-test acceptance suite (no implementation)
- **WP1 Frontend foundation (2026-10-08):**
  - Real sign-in and sign-out, session restore and expiry handling, invitation acceptance screen, organization switcher.
  - Mock data, auto-login and embedded KG credentials removed.
  - Every page renders live API data for the selected project, with visible error states and retry; there is no placeholder fallback.
  - Escaped rendering by construction, and a strict script CSP (`script-src 'self'`).
  - Proven by 18 browser tests (gate 11) in headless Chromium, which also run in CI.
  - Defects fixed along the way:
    - The previous UI could not get past its landing page when served by the API: CSP `script-src-attr 'none'` blocked every inline handler.
    - Same-origin requests were refused by CORS unless `FRONTEND_URL` listed the serving host.
    - Overdue capital deadlines were reported as "expires in -573 days".

## Underway
- **WP9 Production readiness:** the provider-neutral part (container image, compose stack, production start sequence, runbook).
- **WP3 Development Intelligence screens:** next on the critical path.

## Blocked / awaiting founder
| Item | Waiting on |
|---|---|
| Merge PR #2 to `main` | Founder merge |
| WP4 Qualification | Confirmation of the 4 DI-2 open points (assessment §8.1), or acceptance of the defaults |
| WP5 Underwriting | V1 metric set (§8.2) |
| WP6 Decision | V1 decision authority (§8.3) |
| WP9 Deploy | Deployment target (§8.4) |
| WP2 Email | Email provider (§8.5) |

## Next, in order
| WP | Package | Status | User-operable? |
|---|---|---|---|
| WP1 | Frontend foundation (real auth, remove mock data/credentials) | **Done** | Yes: sign-in, org switch, live read views |
| WP3 | Development Intelligence screens | **Next** | — |
| WP4 | Qualification (DI-2) + screens | Queued; needs §8.1 | — |
| WP5 | Underwriting V1 | Queued; needs §8.2 | — |
| WP6 | Governed Decision & Project Authorization | Queued; needs §8.3 | — |
| WP2 | Tenant provisioning & onboarding | Parallel lane B | — |
| WP7 | Execution & collaboration wiring, document storage | Parallel lane B | — |
| WP8 | Portfolio monitoring | After WP6/WP7 | — |
| WP9 | Production readiness | Parallel lane C (start now) | — |
| WP10 | Tenant 001 (KG Development) go-live | Final | — |

## Workflow operability (target: all ✓ for V1)
| Stage | Backend | UI |
|---|---|---|
| Relationship sourcing | ✓ | ✗ |
| Property | ✓ | ✗ |
| Opportunity | ✓ | ✗ |
| Site Intelligence | ✓ | ✗ |
| Qualification | spec only | ✗ |
| Underwriting | ✗ | ✗ |
| Governed Decision | ✗ | ✗ |
| Project Authorization | ✗ | ✗ |
| Execution | ✓ | live read views (edits arrive in WP7) |
| Portfolio Monitoring | partial | live portfolio + risk alerts (rollups in WP8) |
