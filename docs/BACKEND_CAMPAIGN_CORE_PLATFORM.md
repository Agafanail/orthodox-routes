# Backend Campaign — Core Multi-User Platform

- **Status:** owner action required (Stop 2)
- **Mode:** Backend Campaign
- **Campaign unit of completion:** the entire remaining approved Core multi-user platform phase
- **Starting commit:** `919226ad6d8a50388a36934db25b6c27852d25d6` (`Clarify verified phone uniqueness`)
- **Starting CI:** GitHub Actions run `31833946421`, fully green
- **Branch:** `main`

## Goal and authority

Complete the remaining Core multi-user platform as one continuous, checkpointed backend campaign. Product Scope V1 controls product purpose and first-version boundaries; IA V2 controls behavior, journeys, permissions, visibility, and states; Backend and Integration Architecture V1 controls architecture and trust boundaries; Target Data Model V1 controls logical data responsibilities; current code, tests, and `README.md` describe implementation facts.

The campaign starts after the existing local database, passwordless verified-email Auth, and Account & Eligibility Foundation. Checkpoints are recoverable engineering boundaries, not stopping conditions. After each checkpoint, Codex commits, pushes, waits for all CI jobs, records the result here, and immediately continues in the same task.

## Approved boundary

Included:

- application-owned phone verification and provider-independent SMS boundaries;
- contextual registration and protected incomplete-action drafts;
- server-owned passenger requests, driver one-time offers, regular series and date-specific occurrences;
- responses, agreements, immutable accepted conditions, capacity, cancellation, and restoration rules;
- actor-derived ownership and authorization;
- safe anonymous/account/participant response shapes and protected contact disclosure;
- application cutover from browser-owned Core transport state;
- version-controlled local and staging-ready configuration, migrations, tests, documentation, and CI.

Explicitly excluded:

- Maps, Places/Geocoding, Google Routes, map UI, PostGIS route-quality logic, detour-quality algorithms, and quality-match suggestions;
- broad My Trips, notification delivery/Web Push, PWA, church administration, localization, translation, legal drafting, complaints/support/analytics, public launch, and full production UI redesign phases;
- production access, production migrations, production data, or provider secrets in the repository or Codex conversation;
- importing browser-local transport records as trusted backend data.

## Checkpoints and continuation state

| Checkpoint | Scope | Status | Evidence |
| --- | --- | --- | --- |
| A | Campaign protocol and durable implementation plan | Complete | Commits `e36f15b`, `6364797`; CI `31879226949` and rerun `31879539830` green |
| B | Phone verification foundation | Complete | Commit `1391288`; CI `31880347230` green, including clean replay and phone boundary tests |
| C | Contextual registration and account completion | Complete | Commits `66722e0`, `67db6e6`, `182c776`; CI `31881253603`, `32401683278`, and `32418023006` green; protected resume, verified-email claim, account/adult/Terms/phone gates, explicit final review, and separate explicit publication/response verified locally, including an anonymous browser return-and-send flow |
| D | Server-owned multi-user transport domain | Complete | Commit `5b2b563`; CI `32404233548` green; source entities, eligibility/ownership, safe projections, regular occurrences, and tests; stops before Maps/quality matching |
| E | Ownership, confirmation, agreements, capacity, cancellation, disclosure | Complete | Commit `18d749a`; CI `32407136829` green; both response directions, immutable snapshots, atomic confirmation/capacity, exact-once cancellation/restoration, lifecycle, disclosure, concurrency and privacy tests |
| F | Core application integration and browser-state cutover | Complete | Commits `182c776`, `1632ade`, `02c9977`, `b5be089`; CI `32418023006` and `32418725132` green; configured RPC-only board, contextual actions/responses, agreements, capacity, cancellation/restoration, disclosure, and isolated passenger/driver/unrelated multi-session browser verification complete without a configured-backend `localStorage` fallback |
| G | Remote/staging readiness | Owner action required — external delivery only | Commit `93028c8`; CI `32530680815` green. The isolated `orthodox-routes-staging` project and HTTPS Render deployment carry all eight migrations with matching history, `api`-only exposure, the exact Auth redirect, HTTP 200 readiness, and a guarded synthetic remote Auth/API/web smoke that cleaned up every fixture. Real email-link and SMS delivery remain unverified because no approved sender/provider account or protected provider credentials are available |
| H | Fresh final Core Platform audit | Repository and staging audits complete; provider delivery delta pending | Commits `b5be089`, `6d502ef`, `e3e0e12`, `93028c8`; CI `32418725132`, `32419971689`, `32420628949`, and `32530680815` green. Clean and representative replay, 289 tests, lint/build, dependency audit, grants/RLS/actor-boundary/secret review, multi-session browser evidence, remote multi-user/privacy/capacity/disclosure smoke, migration parity, HTTPS readiness, and no campaign Maps/quality-matching work verified. Remote advisors produced only 41 expected executable-`SECURITY DEFINER` API warnings and no other warning type; repeat only real email/SMS delivery and the resulting audit delta |

**Current continuation:** all repository-owned work that is independent of an approved external delivery provider is complete, and the synthetic-only staging database/API/HTTPS board are verified. Resume this same campaign after the minimum owner-controlled delivery action below, configure the staging email sender and approved SMS provider through protected secrets, implement the provider adapter/worker if required by that selection, verify actual email-link and SMS delivery without exposing secrets or OTPs, repeat the H audit delta, and require final green CI. Do not start Maps or quality matching.

For every completed checkpoint, replace its status with `Complete` and record commit SHA plus final green CI run. Update **Current continuation** to the next unfinished scope. Do not record synthetic research, pending CI as green, or external verification that did not occur.

## Dependencies and external gates

- Phone delivery stays behind the application adapter boundary; Bird remains a candidate, not an approved paid provider.
- Local fakes and privileged test fixtures must be isolated from application-accessible production paths.
- The isolated Supabase staging project, HTTPS deployment, migration application, and remote Core smoke are complete. A real email sender/catcher and SMS provider account, billing, sender/route registration, callbacks, and protected credentials remain owner-controlled.
- Final production Terms/Privacy copy belongs to a later roadmap phase. Core enforcement uses the existing versioned legal-document boundary without inventing production legal text.
- Later Maps work supplies exact coordinate/route and approximate-public geography. Core uses only the smallest compatible non-map representation and does not introduce a competing map architecture.

### Minimum owner action required to resume

1. Approve and enable a staging email sender/catcher plus an SMS verification provider account. Bird is the architecture's first candidate but is not yet owner-approved. Complete any required billing, sender/route registration, and callback setup, then inject provider credentials only through the staging secret manager; do not paste secrets into chat. No production project or production data may be exposed.

The exact application variables and smoke sequence are recorded in `docs/CORE_STAGING_READINESS.md`. Once these resources are available, ordinary staging configuration, migration, deployment, synthetic fixtures, browser verification, defect repair, commits, pushes, and CI continue autonomously in this same campaign.

## Stopping conditions

The campaign may stop only for:

1. a genuine unresolved product decision after all authority and independent work are exhausted;
2. the minimum owner-controlled external action genuinely required next;
3. a human manual test that remains necessary after automated and available browser verification;
4. successful completion of the entire campaign.

Checkpoint completion, commits, pushes, green CI, ordinary technical uncertainty, and task-related failures are not stopping conditions.

## Final completion criteria

Completion requires repository evidence that phone verification and eligibility cannot be client-forged; contextual registration safely resumes an explicit final review without auto-publication; Core transport state is durable, multi-user, actor-authorized, migration-backed, idempotent, and concurrency-safe; capacity and cancellation are exact-once; contacts are disclosed only to authorized participants and revoked under approved rules; anonymous and private shapes are separated; relevant browser trust is retired; local and staging-ready environment contracts are documented; clean and representative upgrade migrations, automated and browser/E2E tests, security/privacy audit, documentation, commits, pushes, and every required CI job are green; and no Maps/quality-matching or later roadmap phase has started.
