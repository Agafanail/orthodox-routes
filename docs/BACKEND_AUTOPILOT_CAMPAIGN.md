# Backend Autopilot Campaign

- **Mode:** Backend Campaign
- **Starting commit:** `3afa340363d5a9678ae7ba338eefa65ef0725992`
- **Scope:** all remaining approved backend work required for the first public version
- **Production access:** excluded

## Checkpoints

| Checkpoint | Scope | Status | Evidence |
| --- | --- | --- | --- |
| 0 | Protect `main` with PR-only changes, strict required CI, no force push or deletion, and zero required approvals | Complete | GitHub branch protection verified on 19 September 2026 |
| 1 | Campaign recovery state and non-destructive current staging smoke | In progress | Branch `codex/backend-campaign-foundation`; remote smoke passed locally before PR |
| 2 | Agreement change proposal/answer workflow and remaining My Trips backend | Planned | Approved agreement rules and existing My Trips projections |
| 3 | Durable notifications, preferences, email/Web Push contracts, delivery outbox, and provider-independent workers | Planned | Product Scope, IA V2, Backend Architecture V1, Target Data Model V1 |
| 4 | Profile/account operations required by the approved personal area | Planned | Name/language/contact-change/export backend; deletion is checkpoint 7 |
| 5 | Church creation, deduplication, equal administration, schedules, exceptions, cancellation, and archival | Planned | Roadmap phase 7 backend |
| 6 | Stored dynamic-content translations and provider-independent translation jobs | Planned | Six-language approved content boundary; provider action remains external |
| 7 | Complaints, personal blocking, account deletion, retention, protected support/owner operations, and audit | Planned | Roadmap phase 8 backend |
| 8 | Minimal privacy-safe product analytics | Planned | Approved aggregate events only; no advertising trackers |
| 9 | Backend cutover audit, multi-user/browser E2E expansion, migration upgrades, and final staging/main verification | Planned | Roadmap phases 9 and 11 backend |

## Current checkpoint

Checkpoint 1. The staging smoke no longer requires an empty project, no longer truncates shared staging data, accepts additive readiness fields, reuses the current staging Terms fixture, scopes cleanup to the identities created by one run, and verifies cleanup while preserving any pre-existing church fixture.

## Remaining backend areas

- authoritative agreement change proposer/responder state and atomic snapshot replacement;
- durable in-app notifications, preferences, transactional email, Web Push, outbox, retry, and delivery state;
- account/profile data operations, contact changes, export, and deletion lifecycle;
- church creation/deduplication, up to three equal administrators, schedules, exceptions, cancellation, and archival;
- stored translations for approved dynamic church/schedule content;
- complaints, personal blocking, retention, support and protected owner operations, audit logging, and minimal analytics;
- provider-independent adapters, configuration validation, backend CI, migration upgrades, and critical multi-user E2E coverage;
- final safe staging verification and backend implementation/cutover audit.

Frontend visual redesign, production infrastructure/data/secrets, production legal copy, legal review, provider billing/account actions, and manual device/browser acceptance remain outside this backend campaign.

## Gates and blockers

- **Product decision pending, not blocking independent checkpoints:** Product Scope V1 section 15.3 and IA V2 sections 14.2/48.1 require a fulfilled passenger request to wait for the passenger's explicit “search again” action after a driver cancellation. Migration `20260901090000_republish_when_the_driver_cancels.sql` instead republishes it automatically. Do not change or extend this behavior until the conflict is resolved.
- Production Terms/Privacy content and legal review are owner-controlled later gates.
- Real transactional-email, Web Push, and translation-provider secrets/configuration remain owner-controlled; implement and verify provider-independent boundaries first.
- Docker is currently unavailable locally. Database replay and integration remain required in GitHub CI; linked isolated staging may be used only with synthetic fixtures and exact cleanup.

## Verification state

- `main` started at the expected merge of PR #7 and was clean.
- Required checks on protected `main`: `verify`, `database-foundation`, `local-auth`, `core-browser-e2e`.
- Checkpoint 1 remote staging smoke passed against the isolated project with exact synthetic cleanup and no broad truncation.
- No campaign checkpoint is complete until its PR is merged through all required green checks.

Update this file after every merged checkpoint with the PR, merge commit, CI run, current checkpoint, and any genuine gate.
