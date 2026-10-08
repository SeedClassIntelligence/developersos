# DEVOS — Product Completion Assessment

**Date:** 2026-10-08
**Basis:**
- Direct inspection of the repository at `claude/nice-fermat-5jwzsr` @ `2e7adb9`: code, migrations, routes, repositories, frontend, tests, CI and deployment files.
- Test evidence from the full gate run on an empty PostgreSQL 18 cluster, and from GitHub Actions runs #12 and #13.

**Not done:** I did not drive the user interface in a browser for this assessment. The UI findings come from reading the frontend source. They are specific and line-referenced, and they are not ambiguous.

---

## 0. Direct answer

**Where we are.** DeveloperOS has a **secure, well-tested multi-tenant backend foundation** and a **prototype frontend that is not connected to it in any operable way**.
- The backend is real:
  - PostgreSQL with migration-driven schema;
  - tenant isolation enforced in both the API and the database;
  - RBAC;
  - a cryptographically verifiable audit ledger;
  - execution APIs (projects, tasks, contracts, permits, capital, messages, documents);
  - the first Development Intelligence layer (relationships, properties, opportunities, versioned site facts, readiness, findings).
- 245 accepted tests pass from an empty database.
- **However:**
  - A real development organization **cannot use the product today.**
  - There is no login screen.
  - The UI silently logs in as a hard-coded KG demo user.
  - It shows mock data when the API fails.
  - Almost every create/edit action is an `alert('connect to …')` stub.
  - None of the Development Intelligence capability has a screen.
  - A new tenant can only be created with SQL.
  - Of the ten stages of the core workflow, **zero are operable end to end through the application**. Three stages (Qualification, Underwriting, Governed Decision) and the Opportunity → Project bridge do not exist at all.

**What remains.** Ten work packages (§5):
- Make the frontend real.
- Make onboarding real.
- Put the DI workflow on screen.
- Build Qualification, Underwriting, Governed Decision and Project Authorization.
- Wire Execution and Portfolio to live data.
- Make it deployable.
- Onboard KG Development as Tenant 001 through the product, as tenant data.

**The plan.** Build along the workflow critical path (frontend foundation → DI screens → Qualification → Underwriting → Decision/Authorization → Portfolio). Onboarding, Execution wiring and production readiness run in parallel with it. Every work package ships as a usable screen on live data, with regression, tenant-isolation and audit tests carried forward. The next three deliverables are in §7.

---

## 1. Authoritative codebase

| Item | State |
|---|---|
| Repository | `SeedClassIntelligence/developersos` (single repo; backend and static frontend in `developeros-backend/`) |
| `main` | `ca69d64`: EF-1 … EF-3 (persistence, RBAC/tenancy, audit ledger) merged via PR #1 |
| Accepted, not yet on `main` | DI-1 + DI1-D1, `1b4115f..7e46306` (7 commits), in **[PR #2](https://github.com/SeedClassIntelligence/developersos/pull/2)**: CI green, mergeable, no conflicts |
| Unmerged, not accepted | DI-2 Qualification **specification and tests only** (`93d8ea5`, `2e7adb9`): contract revision 2, 52-test acceptance suite, oracle. **No DI-2 product code exists.** |
| Working branch | `claude/nice-fermat-5jwzsr` = PR #2 content + the two DI-2 spec commits |

**Resolution: one development line.**
1. **Merge PR #2.** `main` then equals the accepted foundation. This is the only founder action needed; I have not merged to `main` myself.
2. **All product work continues on `claude/nice-fermat-5jwzsr`**, which already sits on top of that foundation. Each completed work package goes to `main` through one PR.
3. `claude/nice-fermat-5jwzsr-di1-foundation` exists only to carry PR #2. It is deleted after the merge. No other branches are needed.
4. **The DI-2 spec is kept, not discarded.** It becomes the acceptance suite for the Qualification work package (WP4). It is already written and its RED baseline is locked.

**Preserved controls (not negotiable in any work package):**
- tenant isolation at API and database (composite same-tenant FKs);
- runtime/owner role separation;
- EF-3 audit ledger and signed checkpoints;
- RBAC;
- the CI gate on an empty PostgreSQL 18.

---

## 2. What is actually in the repository

| Layer | Size (lines) | Notes |
|---|---|---|
| Backend product code (`server.js`, `routes/`, `db/`, `middleware/`, `intelligence/`) | ~4,600 | Express + pg. 14 route modules, 7 migrations, 31 tables. |
| Frontend (`public/`) | ~2,300 | Vanilla JS SPA, served statically by the API. 12 page renderers. |
| Tests (`tests/`) | ~4,750 | Gates 0–10. 245 accepted tests GREEN; DI-2 52 tests locked (48 expected RED). |
| Deployment | — | GitHub Actions gate only. README describes a manual VPS + PM2 + nginx setup. No container, IaC, backup, monitoring or staging definition. |

**Reading:** test and governance code now outweighs product code. The backend is trustworthy but thin, and the frontend is a design prototype. Completion work is now mostly **product surface**: screens, workflow, and the missing middle of the lifecycle. More verification of what already exists is not where the work is.

---

## 3. Product completion by domain

Legend:
- **Implemented**: backend code exists and is tested.
- **Integrated**: connected to the other domains in the data model and workflow.
- **User-operable**: a real user can do it through the UI on live data.

| Domain | Implemented | Integrated | User-operable | Missing | Remaining work |
|---|---|---|---|---|---|
| **Development Intelligence** | **Yes (API):** relationships, properties, opportunities with lifecycle and history, versioned site facts (KNOWN/UNKNOWN/NOT_APPLICABLE, provenance), Gate-0 readiness, deterministic findings engine + rule registry, acknowledge/resolve. 25 endpoints, 66 tests. | **Partial.** Self-contained. By design an Opportunity never references a Project, and no promotion path exists. Not linked to Execution, Portfolio or Capital. | **No.** No screen for any DI entity. 0 of 25 endpoints have UI. | Qualification (spec only); Underwriting; Opportunity → Project promotion; DI screens | WP3 (UI), WP4 (Qualification), WP5 (Underwriting), WP6 (promotion) |
| **Development Governance** | **Partial:** RBAC (4 roles, granular permissions), org membership/context switching, invitations, EF-3 audit ledger with verify and signed checkpoints, opportunity lifecycle transitions, contract "execute". | **Partial.** Audit capture covers every table. Permissions are enforced on every route. | **No.** No audit view, role management or approval UI. | **The decision layer:** decision records, approvers, conditions, approval/rejection, policy screening (DI-2), evidence snapshots bound to decisions | WP4, WP6; audit/roles screens in WP2 |
| **Development Execution** | **Yes (API):** projects, tasks (dependencies, partner/contract links), contracts (execute), permits (status, corrections), capital stack (sources, amounts, deadlines). Tenant-safe since DI1-D1. | **Partial.** Projects are created standalone, not from an authorized opportunity. Capital is a flat source list with no budget/uses, so there is no budget-vs-actual. Partners table exists with **no API**. | **No (read-only at best).** The UI loads lists for project `p1` only. Every create/edit action is an `alert()` stub. Task status changes are local-only. Other projects show empty lists. | Partner management API/UI; development budget (uses) and cost tracking; draws/change orders (later); working mutations in UI | WP7 (+ budget from WP5) |
| **Development Collaboration** | **Partial (API):** channels/messages (list, send, create channel), documents (**metadata only**), team members, invitations. | **Partial.** Channels and documents are project-scoped. Nothing ties messages to tasks or decisions. | **No.** Message sending is local-only (`messages.js:120` TODO). Upload/open are stubs. There is no file storage at all. | File storage (upload/download, tenant-scoped); invitation email delivery (token is returned in the API response); notifications; external-party access model | WP2 (invites), WP7 (documents/messages) |
| **Portfolio Intelligence** | **Minimal:** rule-based alert generator (`routes/alerts.js`: missing contracts, permit delays, capital deadlines). It is not AI. There is also a projects list. | **No.** No rollup across projects, no pipeline view (opportunities → qualification → decision), no financial aggregation. | **Partial view only.** The portfolio page renders project cards from the API (or mock data). | Portfolio dashboard on live data; pipeline funnel; budget/committed/permit rollups; alert-to-action links | WP8 |
| **Platform Administration** | **Partial:** admin stats/orgs/health (read-only), platform-admin role, invitation-only registration (public registration disabled), credential rotation script. | **Partial.** | **No.** The super-admin page is mock data plus `alert()` stubs. | **Tenant provisioning (create org + first admin), currently SQL-only**; password reset; user deactivation UI; feature flags/billing (later) | WP2 |
| **Frontend and user experience** | **Prototype:** polished visual design, 12 page renderers, SPA router. | **No.** `mockData.js` loads hard-coded KG data unconditionally. The API overlay auto-logs in as `maria@kgdevelopment.com` / `password123` (`public/assets/js/api.js`), with project `p1` hard-coded and `API_BASE` defaulting to `localhost:3000`. Failures silently fall back to mock data. | **No.** The landing page "Sign In" bypasses authentication (`enterApp()`). There is no login form, invitation-acceptance screen or org switcher. The landing page advertises unbuilt features (municipal portal, LIHTC workflows, AI risk). | Real authentication flow; removal of mock data and embedded credentials; screens for DI, Qualification, Underwriting, Decision; working mutations; error/empty states | WP1, then a screen in every WP |
| **Deployment and production readiness** | **Partial:** hardened server startup (refuses privileged DB role, pending migrations or a missing signing key), helmet/CSP, CORS allow-list, rate limits, separate migration role, CI gate on PostgreSQL 18. | — | **Not deployable as a product today.** A manual VPS README exists but is out of date relative to the role separation. | Container or reproducible deploy; managed Postgres + backups + restore drill; secrets management (JWT, audit-signing key); TLS; monitoring/alerting; staging; a seed that is test-only (demo data must not reach production) | WP9 |

**Rule applied throughout:** a passing backend test is **not** counted as a finished product, and an endpoint is **not** counted as UI.

---

## 4. The end-to-end workflow: where it breaks

Target workflow: **Relationship sourcing → Property → Opportunity → Site Intelligence → Qualification → Underwriting → Governed Decision → Project Authorization → Execution → Portfolio Monitoring.**

| # | Stage | Backend | UI | Blocking gap |
|---|---|---|---|---|
| 1 | Relationship sourcing | ✓ `/api/di/relationships` | ✗ | No screen |
| 2 | Property | ✓ `/api/di/properties` | ✗ | No screen |
| 3 | Opportunity | ✓ `/api/di/opportunities` + lifecycle, history | ✗ | No screen |
| 4 | Site Intelligence | ✓ versioned facts, readiness, findings | ✗ | No screen |
| 5 | Qualification | ✗ spec + 52 tests only | ✗ | **Not built** (WP4) |
| 6 | Underwriting | ✗ nothing | ✗ | **Not built.** No budget/uses model, no metrics (WP5) |
| 7 | Governed Decision | ✗ nothing | ✗ | **Not built.** No decision records or approvals (WP6) |
| 8 | Project Authorization | ✗ no Opportunity → Project link | ✗ | **Not built.** Projects are created standalone (WP6) |
| 9 | Execution | ✓ tasks, contracts, permits, capital | ✗ stubs / read-only `p1` | UI mutations, partners API, documents storage (WP7) |
| 10 | Portfolio Monitoring | ~ rule alerts + project list | ~ cards only | Live rollups, pipeline, budget tracking (WP8) |

**Cross-cutting blockers (every stage):**
1. No real login.
2. Tenants can only be created by SQL.
3. Invitations are not delivered.
4. No deployable environment.

**KG Development stays Tenant 001, not platform behavior.**
- The backend already enforces this: the DI-2 spec forbids platform policy and scans for the 125-unit threshold or "KG" in platform code.
- The **frontend violates it**: it embeds KG credentials and KG mock data.
- WP1 removes both. WP10 onboards KG through the product, with its policy (e.g. the 125-unit hard veto) authored as tenant data.

---

## 5. Completion roadmap: work packages in dependency order

**Effort assumptions:**
- Ranges are in **senior full-stack engineer-weeks** of build + test + integration, for the scope stated.
- The stack stays as is: Express, PostgreSQL, vanilla-JS SPA.
- Lists of 10³–10⁴ rows per tenant, so no search infrastructure is needed.
- AI-assisted implementation compresses build time. The binding constraints are **founder decisions and acceptance latency**, not typing.
- No deadlines are implied.

| WP | Work package | Depends on | Effort | V1? |
|---|---|---|---|---|
| **WP1** | **Frontend foundation.** Real login/logout, session expiry, invitation acceptance screen, org switcher. Remove `mockData.js`, auto-login and embedded credentials. Same-origin API base. Error/empty/loading states. Project selection loads that project's data. Shared form/table components for the screens that follow. | — | 1.5–3 | V1 |
| **WP2** | **Tenant provisioning & onboarding.** Platform-admin creates an organization and its first org-admin. Invitation delivery (SMTP provider, plus copy-link fallback). Password reset. Member deactivation. Role assignment UI. Audit log viewer (read + verify). | WP1 (UI parts) | 1.5–3 | V1 |
| **WP3** | **Development Intelligence screens.** Relationships, properties, opportunities (lifecycle actions, history), site-intelligence editor with provenance and version history, readiness panel, findings (evaluate, acknowledge, resolve). Uses the existing frozen API; no backend change expected. | WP1 | 2–4 | V1 |
| **WP4** | **Qualification (DI-2).** Implement against the existing 52-test contract (revision 2). Screens: policy authoring/versioning (org-admin), candidate attributes, location evidence, run qualification with `asOf`, result view with per-criterion evidence. | WP3; founder confirms 4 open points (§8) | 2–4 | V1 |
| **WP5** | **Underwriting V1.** Versioned underwriting per opportunity: development budget (uses by category), sources (reusing the capital-source model), key assumptions, deterministic metrics (total development cost, cost/unit, funding gap; return metrics per §8). Exact decimal arithmetic (NUMERIC in DB, no float money). Immutable snapshots with content hash. UI. | WP4 (or WP3 if run in parallel); founder sets metric scope (§8) | 3–5 | V1 |
| **WP6** | **Governed Decision & Project Authorization.** Decision record bound to the exact qualification and underwriting snapshots (hash-pinned). Approver roles, outcomes (approve / approve-with-conditions / decline / defer), conditions. **Approval atomically creates the Project**, linked to its property/opportunity, with budget → capital stack. Fully audited. UI. | WP4, WP5 | 2–4 | V1 |
| **WP7** | **Execution & collaboration wiring.** Working create/edit/status in tasks, contracts (incl. execute), permits and corrections, capital. Partners API + UI. Document storage (S3-compatible, tenant-scoped keys, upload/download, size/type limits). Live message sending. | WP1 | 3–5 | V1 |
| **WP8** | **Portfolio monitoring.** Live dashboard: pipeline funnel (opportunities → qualified → approved), active projects by phase, budget vs committed sources, permit status, open alerts linked to the action screen. | WP6 (pipeline), WP7 | 1.5–3 | V1 |
| **WP9** | **Production readiness.** Reproducible deployment (container + compose, or equivalent). Managed PostgreSQL 18 with automated backups and a tested restore. Secrets management for JWT and audit-signing keys. TLS. Health/uptime monitoring and error alerting. Staging environment. Production seed contains no demo data. Security review of the frontend. Updated runbook. | — (start now); finalize after WP7 | 2–3 | V1 |
| **WP10** | **Tenant 001 go-live (KG Development).** Provision KG via WP2. KG authors its own policy in the product. Import its current pipeline/properties. Scripted end-to-end acceptance walkthrough of the full workflow by a KG user. | WP1–WP9 | 1–2 | V1 |

**Totals:**
- All V1 packages: **≈ 19.5–36 engineer-weeks**.
- **Critical path** (WP1 → WP3 → WP4 → WP5 → WP6 → WP8 → WP10): **≈ 13–25 engineer-weeks**.
- Everything else fits in parallel lanes.

### Critical-path blockers
1. **WP1 frontend foundation.** Every user-operable claim depends on it.
2. **WP4 open policy points.** There are four, each with a recommended default (§8). They become a blocker only if left unanswered.
3. **WP5 underwriting scope.** Which metrics define "underwritten" for V1 is a product decision (§8).
4. **WP6 decision model.** Who may approve, and whether one approver suffices for V1 (§8).

### What runs in parallel
- **Lane A (critical path):** WP1 → WP3 → WP4 → WP5 → WP6 → WP8.
- **Lane B:** WP2 after WP1's auth screens, then WP7.
- **Lane C:** WP9 from day one (infrastructure does not depend on features).
- WP5's calculation engine can be built and tested against fixtures while WP4 is underway; only its integration waits.

### Later enhancements (explicitly not V1)
- LIHTC/affordable-housing program modeling.
- Debt sizing and scenario/sensitivity analysis.
- Draws and change orders.
- Investment-committee multi-stage voting.
- Municipal/lender/consultant external portals.
- Realtime messaging and notifications.
- Feature flags and billing.
- AI/LLM assistance.
- Advanced portfolio analytics.
- Integrations (accounting, e-signature, GIS/parcel data).
- The landing page's unbuilt marketing claims stay off the page until they exist.

---

## 6. Definition of a usable V1 release

V1 is released when **all** of the following are true on a deployed production environment.

**People and access:**
1. A platform administrator creates a tenant and its first admin through the UI.
2. Users join by emailed invitation, sign in, reset passwords, and switch organizations.
3. There is no demo data or embedded credential anywhere in the shipped build.

**The workflow, through the UI on live data, by tenant users only:**
4. Record a **relationship** and a **property**, and open an **opportunity** on it.
5. Capture **site intelligence** with provenance and version history, see **readiness**, and work **findings**.
6. Author and publish a tenant **policy**, and **qualify** the opportunity at an explicit `asOf` with per-criterion evidence. Missing information never becomes NO_GO.
7. Create an **underwriting** version (budget/uses, sources, assumptions) with exact, deterministic metrics.
8. Record a **governed decision** bound to the exact qualification and underwriting versions. Approval **creates the Project**, linked to its origin.
9. **Execute**: manage tasks, partners, contracts, permits, capital sources and stored documents, and exchange messages.
10. **Monitor** the portfolio: the pipeline from opportunity to approval, and active projects' phase, budget vs committed sources, permit status and alerts.

**Integrity:**
11. Every step is tenant-isolated (API and database), permission-checked, and captured in the verifiable audit ledger.
12. The full regression gate stays GREEN in CI on an empty database.
13. Backups restore successfully in a drill.

**Proof:**
14. KG Development, as Tenant 001, completes steps 4–10 on its own data in a recorded acceptance walkthrough. A second tenant sees none of it.

---

## 7. Next three concrete deliverables

1. **WP1 — Real authentication and a live app shell.**
   - Login, logout and invitation-acceptance screens.
   - Org switcher.
   - Delete `mockData.js` usage, the auto-login and the embedded KG credentials.
   - Same-origin API base.
   - Per-project data loading.
   - Visible error states.
   - **Done when:** a seeded test user signs in through the form; every existing page renders live data for the selected project; a stopped API shows an error, not mock data; no credential string remains in `public/`; regression gate GREEN.
2. **WP3 — Development Intelligence screens on the existing API.**
   - Relationships, properties, opportunities (with lifecycle), site-intelligence editor with history, readiness, findings.
   - **Done when:** a tenant user completes stages 1–4 of §4 entirely in the UI; a second tenant cannot see any of it; DI-1 acceptance tests unchanged and GREEN.
3. **WP4 — Qualification, built to the existing DI-2 contract, plus its screens.**
   - **Done when:** the 52-test DI-2 suite is GREEN with the baseline flipped; a tenant admin authors and publishes a policy and a developer qualifies an opportunity from the UI.
   - Starts once the four open points in §8 are confirmed, or once the founder accepts the recommended defaults.

WP9 infrastructure work (deploy target, managed DB, backups) starts alongside deliverable 1 because it has no feature dependency.

---

## 8. Decisions only the founder can make (escalations)

| # | Decision | Needed by | Recommended default |
|---|---|---|---|
| 1 | DI-2 open points (contract §10): NOT_APPLICABLE permission applies to all criterion kinds; type validation at the API, not the database; location evidence as whole-address snapshots; opportunity-level Gate-0 requirements read from the current record | WP4 | Accept all four as specified |
| 2 | V1 underwriting metrics | WP5 | Total development cost, cost per unit, sources total, funding gap, and one return metric (yield-on-cost) |
| 3 | V1 decision authority | WP6 | Org-admin approves. One approver, conditions allowed, and a separate decline/defer reason are mandatory. Multi-approver IC comes later. |
| 4 | Deployment target | WP9 | Single container image + managed PostgreSQL 18 on one cloud provider, with staging and production |
| 5 | Email provider for invitations/password reset | WP2 | Any transactional SMTP provider, with a copy-link fallback |

---

## 9. Execution model (effective with this assessment)

- **Within an authorized work package:** implement → test → fix → integrate → demonstrate → continue. There is no founder stop after ordinary coding or test steps.
- **The founder reviews at work-package completion:** a demonstration on live data plus the gate result.
- **Escalate only for:** a material architectural conflict, a security defect, a policy decision, or a change to agreed scope.
- **Carried forward unconditionally:** the regression gate (all accepted suites), tenant isolation at both boundaries, the audit ledger, RBAC, and exact financial arithmetic.
- **Tests stay acceptance-driven.** New behavior gets tests written with the work; a separate RED-gate phase and approval cycle per package is no longer required. The DI-2 suite already exists and is reused as-is.
- **Status lives in one place:** `docs/DEVOS-PRODUCT-COMPLETION-TRACKER.md` (finished / underway / blocked / next). `docs/DEVOS-MASTER-GATE-INVENTORY.md` remains as gate history only.
