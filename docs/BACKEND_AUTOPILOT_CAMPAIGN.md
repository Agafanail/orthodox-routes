# Backend Autopilot Campaign

- **Mode:** Backend Campaign
- **Starting commit:** `3afa340363d5a9678ae7ba338eefa65ef0725992`
- **Scope:** all remaining approved backend work required for the first public version
- **Production access:** excluded

## Checkpoints

| Checkpoint | Scope | Status | Evidence |
| --- | --- | --- | --- |
| 0 | Protect `main` with PR-only changes, strict required CI, no force push or deletion, and zero required approvals | Complete | GitHub branch protection verified on 19 September 2026 |
| 1 | Campaign recovery state and non-destructive current staging smoke | Complete | PR #8; commit `31436a3`; CI `35443915447` green; remote staging smoke passed with exact cleanup |
| 2 | Agreement change proposal/answer workflow and remaining My Trips backend | Complete | PR #9; merge `24f70fa`; CI `35445507498` green |
| 3 | Durable notifications, preferences, email/Web Push contracts, delivery outbox, and provider-independent workers | Complete | PR #10 merge `6beca9c`, CI `35708503854`; PR #11 merge `103be11`, CI `35711039875`; PR #12 merge `a890245`, CI `35713885218` |
| 4 | Profile/account operations required by the approved personal area | Decision gate | PR #13 merge `7e3e8bb`, CI `37229664994`; PR #14 merge `4c4bf23`, CI `37230861925`; email recovery awaits the approved protective delay; deletion is checkpoint 7 |
| 5 | Church creation, deduplication, equal administration, schedules, exceptions, cancellation, and archival | In progress | PR #15 merge `84349ca`, CI `37275264884`; PR #16 merge `ee6c2de`, CI `38260954869`; PR #17 merge `de08238`, CI `38261795981`; PR #18 merge `eef6022`, CI `38263557320`; PR #19 merge `2a0a3d9`, CI `38269546263`; PR #20 merge `f7019ec`, CI `38369019230`; PR #21 merge `e33e18d`, CI `38372163933`; PR #22 merge `d96ac6b`, CI `38374554868`; PR #23 merge `e61c45a`, CI `38417222760`; PR #24 merge `eff85e9`, CI `38421552090`; PR #25 merge `8a0e315`, CI `38423776272`; PR #26 merge `092f2fd`, CI `38426228904`; PR #27 merge `ecadac1`, CI `38535876480`; PR #28 merge `0e5d74e`, CI `38539501734`; series editing and final archival remain |
| 6 | Stored dynamic-content translations and provider-independent translation jobs | In progress | PR #29 merge `e3dc89a`, CI `38541776937`; PR #30 merge `95b376f`, CI `38580405642`; PR #31 merge `c6bdde8`, CI `38585558644`; PR #32 merge `353f717`, CI `38711577503`; PR #33 merge `91554fd`, CI `38718128060`; localized catalog search is PR #34; provider activation remains |
| 7 | Complaints, personal blocking, account deletion, retention, protected support/owner operations, and audit | Planned | Roadmap phase 8 backend |
| 8 | Minimal privacy-safe product analytics | Planned | Approved aggregate events only; no advertising trackers |
| 9 | Backend cutover audit, multi-user/browser E2E expansion, migration upgrades, and final staging/main verification | Planned | Roadmap phases 9 and 11 backend |

## Current checkpoint

Checkpoint 6 localized catalog search (PR #34). The Google adapter and shared budget reservation merged through PR #33. Checkpoint 5 still needs remaining series editing and final protected archival/restore; the lost-email protective delay remains a separate product decision, and account deletion remains checkpoint 7. Independent block enforcement is being prepared separately; actor-facing blocking operations are still unfinished.

## Remaining backend areas

- account/profile data operations, contact changes, export, and deletion lifecycle;
- church creation/deduplication, up to three equal administrators, schedules, exceptions, cancellation, and archival;
- stored translations for approved dynamic church/schedule content;
- complaints, personal blocking, retention, support and protected owner operations, audit logging, and minimal analytics;
- provider-independent adapters, configuration validation, backend CI, migration upgrades, and critical multi-user E2E coverage;
- final safe staging verification and backend implementation/cutover audit.

Frontend visual redesign, production infrastructure/data/secrets, production legal copy, legal review, provider billing/account actions, and manual device/browser acceptance remain outside this backend campaign.

## Gates and blockers

- **Product decision pending, not blocking independent checkpoints:** Product Scope V1 section 15.3 and IA V2 sections 14.2/48.1 require a fulfilled passenger request to wait for the passenger's explicit “search again” action after a driver cancellation. Migration `20260901090000_republish_when_the_driver_cancels.sql` instead republishes it automatically. Do not change or extend this behavior until the conflict is resolved.
- **Translation scope conflict, not blocking church content:** IA V2 section 23.4 permits requested machine translation of ride notes, while Backend Architecture section 13 prohibits sending ride comments for translation. Do not implement ride-note translation until resolved explicitly.
- Production Terms/Privacy content and legal review are owner-controlled later gates.
- Real transactional-email, Web Push, and translation-provider secrets/configuration remain owner-controlled; implement and verify provider-independent boundaries first.
- Docker is currently unavailable locally. Database replay and integration remain required in GitHub CI; linked isolated staging may be used only with synthetic fixtures and exact cleanup.

## Verification state

- `main` started at the expected merge of PR #7 and was clean.
- Required checks on protected `main`: `verify`, `database-foundation`, `local-auth`, `core-browser-e2e`.
- Checkpoint 1 remote staging smoke passed against the isolated project with exact synthetic cleanup and no broad truncation.
- PR #8 CI run `35443915447` passed `verify`, `database-foundation`, `local-auth`, and `core-browser-e2e`, including cleanup/post-steps.
- PR #9 merged as `24f70fa`; CI run `35445507498` passed all required checks after the focused agreement-change RPC suite verified authorization, idempotency, snapshot separation, and atomic capacity deltas.
- PR #10 merged as `6beca9c`; CI run `35708503854` passed all required checks after the notification suite verified protected preferences/subscriptions, effective-channel enforcement, durable leasing/retry, terminal invalidation, grants, and forced RLS.
- PR #11 merged as `103be11`; CI run `35711039875` passed all required checks after migration replay and the notification suite verified channel-filtered worker leases, provider adapters, signed minimized webhook receipts, replay deduplication, and out-of-order terminal-state protection.
- PR #12 merged as `a890245`; CI run `35713885218` passed all required checks after migration replay and integration coverage verified atomic transport-event notifications, replay-safe scheduling, safe payloads, authorization, and deduplication.
- PR #13 merged as `7e3e8bb`; CI run `37229664994` passed all required checks after migration replay and account integration verified actor-scoped profile updates and a complete privacy-safe current-data export.
- PR #14 merged as `4c4bf23`; CI run `37230861925` passed all required checks after migration replay and Local Auth integration verified recent-authenticated phone replacement, preservation of the existing binding while pending, atomic verified swap, and account notification.
- PR #15 merged as `84349ca`; CI run `37275264884` passed all required checks after migration replay, church-creation integration, representative Maps upgrade, deterministic matching, and browser regression. The privacy fix accepts canonical UUID notification references without accepting contact details; the Maps check now compares full coordinate pairs.
- PR #16 merged as `ee6c2de`; CI run `38260954869` passed all required checks after migration replay and Local Auth integration verified seven-day administrator invitations, reserved capacity, verified-email acceptance, own-place transfer, cancellation, decline, guarded exit, worker leasing, retry token rotation, fifth-attempt success, and expiry cleanup. The acceptance UI and real provider delivery remain outside this backend checkpoint.
- PR #17 merged as `de08238`; CI run `38261795981` passed all required checks after migration replay, church-content integration, and browser regression. Current administrators can edit source name/description with optimistic version checks; public descriptions remain visible only for published churches. Address/location editing remains separate because it affects deduplication and route measurements.
- PR #18 merged as `eef6022`; CI run `38263557320` passed all required checks after migration replay, one-off-service integration, and browser regression. Administrators can create future one-off services idempotently; a bounded public schedule exposes only published-church services and the last schedule-update time.
- PR #19 merged as `2a0a3d9`; CI run `38269546263` passed all required checks after migration replay, a three-participant pending-response cancellation regression, and browser regression. Future one-off services can be cancelled after an impact preview; linked ride snapshots remain unchanged, affected users are notified, and cancelled references cannot create automatic matches or new agreements.
- PR #20 merged as `f7019ec`; CI run `38369019230` passed all required checks after migration replay, archival-request integration, and browser regression. Equal administrators can request or withdraw owner-reviewed archival; the management projection shows the pending state without hiding the church or changing rides, and withdrawal remains possible if the owner temporarily hides the page.
- PR #21 merged as `e33e18d`; CI run `38372163933` passed all required checks after migration replay, address/location integration, route-worker version regression, and browser regression. A protected edit rejects normalized-address collisions, discards only that church's stale route measurements, rejects in-flight old-version results, and notifies future riders through their trips view even if the page is hidden.
- PR #22 merged as `d96ac6b`; CI run `38374554868` passed all required checks after migration replay, one-off source editing integration, and browser regression. Administrators can preview impact and edit a future service's source name/description without moving ride snapshots; shared church/service locks serialize new ride publication with the edit's recipient scan.
- PR #23 merged as `e61c45a`; CI run `38417222760` passed all required checks after migration replay, one-off rescheduling integration, and browser regression. Schedule generations preserve old ride snapshots and prevent old/new linked listings from silently matching; the public schedule exposes a changed-time marker.
- PR #24 merged as `eff85e9`; CI run `38421552090` passed all required checks after migration replay, recurring-service integration, and browser regression. Protected weekly sources materialize into a rolling 90-local-day window; replay is efficient, conflicts generate operational alerts without stalling other series, and public schedule updates are timestamped.
- PR #25 merged as `8a0e315`; CI run `38423776272` passed all required checks after migration replay, one-date recurring cancellation integration, and browser regression. A protected exception cancels only the selected future occurrence, retains existing rides and the weekly source, notifies affected participants, and excludes the cancelled date from new matches.
- PR #26 merged as `092f2fd`; CI run `38426228904` passed all required checks after migration replay, repeated one-date rescheduling integration, and browser regression. One recurring date can move repeatedly with generation-safe matching and retained ride snapshots, then be cancelled without losing exception history.
- PR #27 merged as `ecadac1`; CI run `38535876480` passed all required checks after migration replay, one-date content editing integration, and browser regression. A protected exception changes only the selected date's source text; the weekly source and ride snapshots remain unchanged while affected participants are notified.
- PR #28 merged as `0e5d74e`; CI run `38539501734` passed all required checks after migration replay, recurring-future cancellation integration, and browser regression. The selected and later weekly dates are cancelled without recreating them; earlier dates and immutable ride snapshots remain, while affected participants are notified.
- PR #29 merged as `e3dc89a`; CI run `38541776937` passed all required checks after migration replay, translation-source/read integration, and browser regression. Only approved church and concrete-service fields enter versioned translation storage; source edits stale old rows, direct table access is denied, and published-only localized reads fall back to originals.
- PR #30 merged as `95b376f`; CI run `38580405642` passed all required checks after migration replay, administrator correction integration, and browser regression. Current equal administrators can correct only approved translations with source/translation version checks and field-specific limits; a manual correction remains separate from the source and publicly visible only within the published boundary.
- PR #31 merged as `c6bdde8`; CI run `38585558644` passed all required checks after migration replay, worker lease/retry integration, and browser regression. Only current approved published text can be leased, errors retain original fallback, late results cannot overwrite manual corrections, and expired leases are bounded and reclaimed.
- PR #32 merged as `353f717`; CI run `38711577503` passed all required checks. The protected application runner uses fresh per-job leases, an abortable deadline, payload validation, and distinct worker credentials; provider activation remained disabled.
- PR #33 merged as `91554fd`; CI run `38718128060` passed all four required checks, including cleanup. The Google NMT adapter requires explicit credentials/limits and supported locations; shared budget preparation, glossary references, live deadlines, and ineligible/expired lease release are verified. Node.js 22+ is required. Real provider/staging activation remains owner-controlled.
- Dependency audit on 15 October 2026 reported existing Next.js/toolchain advisories, including `GHSA-vcvr-r3jv-pc5j`, `GHSA-cjq9-62q9-8jv4`, and cache-poisoning findings. Inspected `next/og`, remote-image allowlists, Pages Router, and root catch-all prerequisites are absent. No Google-auth subtree advisory was reported. Keep remaining applicability review and a scoped patch release in checkpoint 9; do not run broad forced audit fixes.
- The lost-email recovery flow is paused only at the approved owner/legal/security decision for the exact configurable protective delay required by Backend Architecture §8 and Target Data Model §23. Independent campaign checkpoints continue.
- No campaign checkpoint is complete until its PR is merged through all required green checks.

Update this file after every merged checkpoint with the PR, merge commit, CI run, current checkpoint, and any genuine gate.
