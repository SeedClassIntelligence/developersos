# DEVOS — Product Completion Tracker

This is the single source of truth for product status. It is updated at every work-package milestone.
- Assessment and definitions: `docs/DEVOS-PRODUCT-COMPLETION-ASSESSMENT.md`.
- Gate history: `docs/DEVOS-MASTER-GATE-INVENTORY.md`.

**Last updated:** 2026-11-17
**Baseline:** `main` @ `d3bf37e` (WP1, WP2, WP3 and WP9 container work merged via PR #4)
**Working line:** `claude/nice-fermat-5jwzsr`
**Regression gate:** 314/314 GREEN (245 accepted + 69 new: 19 WP1 UI, 15 WP3 UI, 17 WP2 access, 18 WP7 execution), DI-2 locked at baseline

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

- **WP7 Execution & collaboration wiring (2026-11-17):**
  - Tasks: create, edit (discipline, due date, partner, contract, dependencies), status and delete from the board.
  - Contracts: add, edit and execute (tasks blocked on the contract unblock), and delete.
  - Permits: add and change status; correction items can be added and completed.
  - Capital: editor for total cost and sources, with the funding gap shown.
  - Messages: send and create channels.
  - Documents: real file storage — upload, download and delete.
  - A partner directory, and project profile editing (phase, status, progress).
  - Proven by 18 API and browser tests (gate 14).
  - Defects fixed along the way:
    - **Security — message impersonation:** the sender name and role came from the request, so any member could post as anyone. The sender is now the signed-in member (stored as `sender_user_id`).
    - **Integrity — cross-tenant task dependencies:** a task could depend on another organization's task. This is now refused at the API and by a database trigger (migration 009).
    - **No validation on execution writes:** any status string and client-chosen ids were accepted. Writes are now validated, ids are server-generated, and capital shares are derived server-side.
    - **Capital sources reordered** on every save; they now keep their entered order.
    - **Router race (from WP1/WP2):** a slower earlier page, such as sign-in, could overwrite the page navigated to last, such as an invitation link. Found from an intermittent test failure and reproduced deterministically; covered by UI-UX-002.
    - **Session restore race:** a navigation during session restore could bounce a signed-in user to sign-in.
    - **Backups:** now include stored documents. The restore drill verifies every stored file's SHA-256, and a tampered archive fails the drill.
  - Documents use a typed allowlist with file-signature checks (no HTML/SVG/scripts), a 25 MB limit, SHA-256 recorded at upload, and attachment-only downloads with `nosniff` and a sandbox CSP. They are stored per organization/project on the compose `documents` volume. Verified in containers: the app's root filesystem is read-only and files survive container recreation.

## Underway
- **WP4 Qualification (DI-2):** next on the critical path. It is implementation work against the existing 52-test contract, and starts once the four open points in assessment §8.1 are confirmed (or the recommended defaults are accepted).

## Blocked / awaiting founder
| Item | Waiting on |
|---|---|
| WP4 Qualification | Confirmation of the 4 DI-2 open points (assessment §8.1), or acceptance of the defaults |
| WP5 Underwriting | V1 metric set (§8.2) |
| WP6 Decision | V1 decision authority (§8.3) |
| WP9 Deploy | Deployment target (§8.4) |
| WP2 Email | Email provider choice (§8.5). The code works with any SMTP provider; this is a configuration decision only |
| Project creation | WP7 deliberately adds no "new project" screen: under the V1 model, projects are created by an approved decision (WP6). Before WP10, decide how KG's existing active projects enter the system: a one-time import, or an admin "register existing project" path |

## Next, in order
| WP | Package | Status | User-operable? |
|---|---|---|---|
| WP1 | Frontend foundation (real auth, remove mock data/credentials) | **Done** | Yes: sign-in, org switch, live read views |
| WP3 | Development Intelligence screens | **Done** | Yes: stages 1–4 in the UI |
| WP4 | Qualification (DI-2) + screens | Queued; needs §8.1 | — |
| WP5 | Underwriting V1 | Queued; needs §8.2 | — |
| WP6 | Governed Decision & Project Authorization | Queued; needs §8.3 | — |
| WP2 | Tenant provisioning & onboarding | **Done** | Yes: provisioning, invitations, members, reset, audit |
| WP7 | Execution & collaboration wiring, document storage | **Done** | Yes: execution edited in the UI; documents stored |
| WP8 | Portfolio monitoring | Budget/permit rollups can start now; the pipeline funnel needs WP6 | — |
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
| Execution | ✓ | ✓ (tasks, contracts, permits, capital, messages, documents, partners) |
| Portfolio Monitoring | partial | live portfolio + risk alerts (rollups in WP8) |

## Deferred cosmetic items (frozen code; fix at next authorized DI-1 change)
- The DI-1 findings engine's explanation text for an overdue capital deadline reads "-573 days from …". The title is correct ("deadline passed 573 days ago").
