# DEVOS — Product Completion Tracker

This is the single source of truth for product status. It is updated at every work-package milestone.
- Assessment and definitions: `docs/DEVOS-PRODUCT-COMPLETION-ASSESSMENT.md`.
- Gate history: `docs/DEVOS-MASTER-GATE-INVENTORY.md`.

**Last updated:** 2026-10-08
**Baseline:** `main` @ `03cc446` (accepted foundation, DI-2 spec and assessment merged via PR #3)
**Working line:** `claude/nice-fermat-5jwzsr`
**Regression gate:** 295/295 GREEN (245 accepted + 50 new: 18 WP1 UI, 15 WP3 UI, 17 WP2 access), DI-2 locked at baseline

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

- **WP3 Development Intelligence screens (2026-10-08):**
  - Workflow stages 1–4 are operable end to end in the application:
    - **Relationships:** create, with provenance; activate/deactivate.
    - **Properties:** create and edit, with address, APN and provenance.
    - **Opportunities:** create from the pipeline or from a property; edit; lifecycle transitions with a required reason and a history timeline.
    - **Site intelligence:** an editor for all 22 facts with KNOWN/UNKNOWN/NOT_APPLICABLE status, typed numeric values and provenance, plus version history.
    - **Gate 0 readiness panel**, with a server-refused move to READY that shows the missing items by name.
    - **Findings:** evaluate, acknowledge, resolve with a note, and filter by state.
  - Viewers get read-only screens.
  - Runs on the frozen DI-1 API with no backend change.
  - Proven by 15 browser tests (gate 12), cross-checked against the API.

- **WP2 Tenant provisioning & onboarding (2026-10-08):**
  - Platform administrators create organizations and invite the first administrator. A CLI bootstraps the first platform administrator.
  - Members directory with role changes and deactivation, scoped to the organization and effective immediately. Self-lockout is blocked, and an organization can never be left without an administrator, even under concurrent changes.
  - Invitations: list, revoke, duplicate refusal, and email delivery (any SMTP provider) with a copy-link fallback.
  - Self-service password reset by email, with an operator link fallback.
  - Audit trail viewer with in-app chain verification.
  - Proven by 17 API and browser tests (gate 13).
- **WP9 Production readiness, provider-neutral part (2026-10-08):**
  - Non-root, read-only container image.
  - Compose stack (database, one-shot migrate, app) with owner and runtime credentials separated.
  - Secret generator; backup and verified restore drill (with the audit signing key); rewritten README and runbook.
  - Fixed production defect: the app tried to start an embedded PostgreSQL instead of connecting to the configured database.
  - Verified in containers here, from an empty database:
    - migrations 001–008;
    - bootstrap of the first platform administrator;
    - a tenant provisioned in the UI;
    - the first administrator signing in, recording a property and an opportunity, and inviting a developer.
  - **Remaining for WP9:** choosing a deployment target (§8.4), TLS/hosting, monitoring and alerting, and a staging environment.

## Underway
- **WP4 Qualification (DI-2):** next on the critical path. It is implementation work against the existing 52-test contract, and starts once the four open points in assessment §8.1 are confirmed (or the recommended defaults are accepted).

## Blocked / awaiting founder
| Item | Waiting on |
|---|---|
| Merge PR #2 to `main` | Founder merge |
| WP4 Qualification | Confirmation of the 4 DI-2 open points (assessment §8.1), or acceptance of the defaults |
| WP5 Underwriting | V1 metric set (§8.2) |
| WP6 Decision | V1 decision authority (§8.3) |
| WP9 Deploy | Deployment target (§8.4) |
| WP2 Email | Email provider choice (§8.5). The code works with any SMTP provider; this is a configuration decision only |

## Next, in order
| WP | Package | Status | User-operable? |
|---|---|---|---|
| WP1 | Frontend foundation (real auth, remove mock data/credentials) | **Done** | Yes: sign-in, org switch, live read views |
| WP3 | Development Intelligence screens | **Done** | Yes: stages 1–4 in the UI |
| WP4 | Qualification (DI-2) + screens | Queued; needs §8.1 | — |
| WP5 | Underwriting V1 | Queued; needs §8.2 | — |
| WP6 | Governed Decision & Project Authorization | Queued; needs §8.3 | — |
| WP2 | Tenant provisioning & onboarding | **Done** | Yes: provisioning, invitations, members, reset, audit |
| WP7 | Execution & collaboration wiring, document storage | Parallel lane B | — |
| WP8 | Portfolio monitoring | After WP6/WP7 | — |
| WP9 | Production readiness | Container/ops **done**; hosting needs §8.4 | Deployable (compose) |
| WP10 | Tenant 001 (KG Development) go-live | Final | — |

## Workflow operability (target: all ✓ for V1)
| Stage | Backend | UI |
|---|---|---|
| Relationship sourcing | ✓ | ✓ |
| Property | ✓ | ✓ |
| Opportunity | ✓ | ✓ |
| Site Intelligence | ✓ | ✓ (with readiness and findings) |
| Qualification | spec only | ✗ |
| Underwriting | ✗ | ✗ |
| Governed Decision | ✗ | ✗ |
| Project Authorization | ✗ | ✗ |
| Execution | ✓ | live read views (edits arrive in WP7) |
| Portfolio Monitoring | partial | live portfolio + risk alerts (rollups in WP8) |

## Deferred cosmetic items (frozen code; fix at next authorized DI-1 change)
- The DI-1 findings engine's explanation text for an overdue capital deadline reads "-573 days from …". The title is correct ("deadline passed 573 days ago").
