# Protected complaint-preparation maintenance

`POST /api/internal/complaint-maintenance` is a fixed server-only bridge for the existing logical expiry APIs. It redacts expired **unsubmitted** complaint drafts and removes expired preparation/verification attempt windows. It never receives a complaint, sends mail, chooses a received-case/audit retention period, deletes an account or changes notification preferences.

## Authorization and activation

The route is unavailable without `COMPLAINT_MAINTENANCE_SECRET`. This is a bounded printable server-only secret of 32–256 characters, distinct from both notification and translation worker secrets. An exact bearer comparison uses the existing constant-time helper. Browser sessions, service keys in request bodies, forwarded headers and other worker secrets confer no authority. Missing/invalid credentials cause no privileged client or cleanup work. Every response is private/no-store and no-referrer; no secret, recipient, row ID or diagnostic error is returned.

The environment example leaves the value empty. Adding this route neither configures an environment nor creates a Cron job. The owner must provision a dedicated random secret in protected server/scheduler secret storage and review the database-owned schedule before activation. Never put the secret in URLs, public environment values, analytics or logs. Codex neither receives production credentials nor configures production scheduling.

## Fixed bounded work

The authenticated route ignores and cancels any request body. It runs these existing service-only operations sequentially:

1. `expire_complaint_email_drafts(50)` uses existing expiry/row locking and clears private content and mail capabilities after their original deadline.
2. `expire_complaint_rate_buckets(100)` removes logically expired preparation counters.
3. `expire_complaint_verification_rate_buckets(100)` removes logically expired verification counters.

These are the APIs' existing structural/default batch bounds, not newly approved abuse settings or a retention policy. No caller chooses a target, operation, cutoff or batch size. The selected protected client has a five-second request limit and each step also has a five-second aborting application wait. Invalid/missing/oversized/non-integer acknowledgements and errors stop the batch. There is no automatic retry after an uncertain result and no later operation begins after an unacknowledged step.

Only fixed bounded counters are returned. HTTP 503 means unavailable configuration or a contained exception, 401 means invalid bearer, 500 means an acknowledged failed batch, and 200 means all three acknowledgements were valid. An uncertain failed step may already have committed; the worker does not falsely promise rollback. Known earlier counters remain reported. Each RPC owns its transaction, and a later authorized invocation can safely process remaining expired rows through the existing idempotent/locking rules. A whole batch is not one atomic retention transaction.

## Verification and exclusions

Tests cover missing/reused/malformed secrets, authorization before client construction, fixed operation order/limits, minimized responses, preserved partial progress, invalid counts, errors, stalled transports, abort cleanup and no implicit retry/fallback. Existing disposable SQL tests separately exercise actual draft redaction and each cleanup function's bounds, grants, RLS, locking and live-counter preservation. Synthetic runner seams are not a configured scheduler or remote operational rehearsal.

The local production build was also probed over loopback HTTP with the new secret absent: GET returned 405 and POST returned only private/no-store `503 unavailable`. This demonstrates default refusal, not real authenticated database cleanup or scheduler activation.

This adds no migration, dependency, provider, public complaint form or received-case policy. Actual environment/scheduler setup and observation of sustained cleanup throughput remain release work. Failed/terminal opaque draft metadata is not claimed to be physically removed by the existing redaction API. The unresolved received-complaint/audit retention conflict remains untouched.
