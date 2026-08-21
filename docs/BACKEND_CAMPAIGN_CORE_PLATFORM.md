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
| G | Remote/staging readiness | Owner action required — live provider smokes only | Commits `93028c8`, `4a3f05f`; CI `32530680815` and `32537271598` fully green. The owner configured Resend, approved Bird, and confirmed that the staging Auth message arrived in Gmail Spam from `Orthodox Routes` with subject `Confirm your Orthodox Routes sign-in`; delivery is confirmed and Spam placement is tracked separately. The repository contains the fail-closed Bird Messages adapter, attempt-targeted service-role worker bridge, application integration, strict environment contract, migration/security tests, and staging email verifier. The ninth migration has matching history, zero browser worker grants, two service-role grants, and a repeated green remote Core smoke with complete fixture cleanup. The fresh explicit email link/session smoke and real Bird SMS delivery remain pending; no Bird key is injected |
| H | Fresh final Core Platform audit | Live provider smoke delta pending | Commits `b5be089`, `6d502ef`, `e3e0e12`, `93028c8`, `4a3f05f`; CI `32418725132`, `32419971689`, `32420628949`, `32530680815`, and `32537271598` green. The provider delta passed 301 tests, focused adapter/action coverage, lint, production build, dependency audit, clean replay, representative upgrade, Auth/account/phone/draft/transport/agreement suites, migration parity, grants review, secret scan, and remote Core smoke. Complete only the fresh email link/session smoke, actual SMS delivery, and final audit addendum. Maps and quality matching remain untouched |

**Current continuation:** obtain a fresh staging Auth link and complete explicit confirmation, SSR persistence, and local sign-out without exposing its token. Do not reconfigure SMTP: delivery is confirmed and Spam placement is a separate deliverability issue. Inject the exact Bird server configuration through Render without exposing the key, verify actual SMS delivery without logging phone or OTP, repeat the H audit delta, and require final green CI. Do not start Maps or quality matching.

For every completed checkpoint, replace its status with `Complete` and record commit SHA plus final green CI run. Update **Current continuation** to the next unfinished scope. Do not record synthetic research, pending CI as green, or external verification that did not occur.

## Dependencies and external gates

- Phone delivery stays behind the application adapter boundary. Bird is owner-approved for staging delivery through the current Messages API; Bird Verify is explicitly excluded and the application remains the OTP authority.
- Local fakes and privileged test fixtures must be isolated from application-accessible production paths.
- The isolated Supabase staging project, HTTPS deployment, migration application, and remote Core smoke are complete. Resend SMTP and real Gmail delivery are confirmed; Spam placement remains a deliverability issue, not an SMTP failure. The Bird account/billing/Italy sender are owner-configured. Fresh email-link completion, Bird key injection, and actual SMS delivery remain owner-controlled.
- Final production Terms/Privacy copy belongs to a later roadmap phase. Core enforcement uses the existing versioned legal-document boundary without inventing production legal text.
- Later Maps work supplies exact coordinate/route and approximate-public geography. Core uses only the smallest compatible non-map representation and does not introduce a competing map architecture.

### Minimum owner action required to resume

1. Request a fresh link at the staging `/auth` page, open the message from Spam, use the visible confirmation action, reload once to confirm the session persists, then use local sign-out. Do not paste or expose the confirmation URL/token.
2. Inject `BIRD_API_KEY`, `BIRD_API_BASE_URL=https://<key-region>.platform.bird.com`, and `BIRD_SMS_SENDER=OrthoRoutes` into the staging Render service. `<key-region>` must exactly match the `bk_<region>_...` key prefix. The key must be entered directly in the secret manager and never pasted into chat, logs, screenshots, or repository files. No production project or production data may be exposed.

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
