# Backend Campaign — Core Multi-User Platform

- **Status:** final release verification
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
| G | Remote/staging readiness | Complete | Commits `93028c8`, `4a3f05f`, `1676fa0`; CI `32530680815`, `32537271598`, and `32537582044` fully green. The owner confirmed real Gmail delivery, explicit visible sign-in, SSR persistence after refresh, and current-device sign-out; Spam placement remains a separate deliverability issue. Render accepted the owner-injected Bird configuration without exposing it. A real application-owned SMS smoke recorded two distinct validated Bird acknowledgements for sequential same-account attempts, safely superseded and cleared the first, delivered the second to the handset, and verified it only after the application-generated OTP was entered. No active, unrelated, cross-account, failed, expired, or transient delivery state remained, and all synthetic fixtures were removed |
| H | Fresh final Core Platform audit | Final release validation in progress | Commits `b5be089`, `6d502ef`, `e3e0e12`, `93028c8`, `4a3f05f`, `1676fa0`; CI `32418725132`, `32419971689`, `32420628949`, `32530680815`, `32537271598`, and `32537582044` green. The final delta has passed 23 focused provider/action tests, the current 321-test suite, lint, production build, dependency audit, clean nine-migration replay, representative upgrade, Auth/account/phone/draft/transport/agreement suites, local and remote migration parity, grants/RLS/actor-boundary review, repository/history/log secret scans, readiness, and a guarded remote Core smoke with full cleanup. Provider acceptance was proved distinct from application OTP verification and eligibility. The only remaining action is the final documentation release, push, and fully green CI; Maps and quality matching remain untouched |

**Current continuation:** publish the truthful provider-smoke record, repeat the affected and complete release checks on the current `main`, push the final campaign record, and require every GitHub Actions job to finish green. Do not reconfigure SMTP for Spam placement and do not start Maps or quality matching.

For every completed checkpoint, replace its status with `Complete` and record commit SHA plus final green CI run. Update **Current continuation** to the next unfinished scope. Do not record synthetic research, pending CI as green, or external verification that did not occur.

## Dependencies and external gates

- Phone delivery stays behind the application adapter boundary. Bird is owner-approved for staging delivery through the current Messages API; Bird Verify is explicitly excluded and the application remains the OTP authority.
- Local fakes and privileged test fixtures must be isolated from application-accessible production paths.
- The isolated Supabase staging project, HTTPS deployment, migration application, remote Core smoke, explicit email-link/session/sign-out smoke, and real application-owned SMS verification smoke are complete. Resend SMTP and real Gmail delivery are confirmed; Spam placement remains a deliverability issue, not an SMTP failure. Bird account/billing/Italy sender and runtime secrets remain owner-controlled and outside the repository.
- Final production Terms/Privacy copy belongs to a later roadmap phase. Core enforcement uses the existing versioned legal-document boundary without inventing production legal text.
- Later Maps work supplies exact coordinate/route and approximate-public geography. Core uses only the smallest compatible non-map representation and does not introduce a competing map architecture.

### Completed owner-controlled smokes

The owner completed the minimum external actions without exposing any confirmation URL, OTP, phone number, provider key, cookie, or token to the repository or Codex output: the explicit email-link/session/sign-out flow passed, the Bird values were injected through Render, the SMS arrived, and application-owned phone verification succeeded. The exact environment contract and evidence boundary are recorded in `docs/CORE_STAGING_READINESS.md`.

## Stopping conditions

The campaign may stop only for:

1. a genuine unresolved product decision after all authority and independent work are exhausted;
2. the minimum owner-controlled external action genuinely required next;
3. a human manual test that remains necessary after automated and available browser verification;
4. successful completion of the entire campaign.

Checkpoint completion, commits, pushes, green CI, ordinary technical uncertainty, and task-related failures are not stopping conditions.

## Final completion criteria

Completion requires repository evidence that phone verification and eligibility cannot be client-forged; contextual registration safely resumes an explicit final review without auto-publication; Core transport state is durable, multi-user, actor-authorized, migration-backed, idempotent, and concurrency-safe; capacity and cancellation are exact-once; contacts are disclosed only to authorized participants and revoked under approved rules; anonymous and private shapes are separated; relevant browser trust is retired; local and staging-ready environment contracts are documented; clean and representative upgrade migrations, automated and browser/E2E tests, security/privacy audit, documentation, commits, pushes, and every required CI job are green; and no Maps/quality-matching or later roadmap phase has started.
