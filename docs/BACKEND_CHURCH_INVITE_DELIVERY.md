# Bounded church invitation delivery

The existing invitation worker now leases one job at a time with a fresh lease key, instead of allowing later jobs to consume a batch lease while earlier mail is sent. It retains the selected Resend transport, exact six-language message/link, dispatch-ID idempotency, invitation lifetime, five-attempt policy, backoff, explicit resend, and verified-recipient acceptance rules. It remains reachable only through the existing secret-protected internal runner; no new endpoint, schedule, provider setup, operational activation, or public invitation acceptance UI is added.

## Deadline and privacy contract

Migration `20261019140000_church_invite_delivery_deadlines.sql` adds authoritative evaluation time and lease deadline to the existing JSON claim without changing its signature or service-only ACL. A lease is clamped to the invitation expiry. The application requires these fields, validates recipient/opaque IDs/token/public church metadata, uses relative database durations after subtracting the full monotonic claim round trip, and leaves a conservative twenty-second send/completion window. Clock skew cannot extend a lease. Missing timing fails closed rather than falling back to worker wall time.

Claim and completion waits are bounded to five seconds; the default protected client also aborts its HTTP requests at five seconds. Provider waits are bounded to twelve seconds, while the selected Resend adapter independently enforces its ten-second transport/body limit. Adapter failures/unknown acknowledgement produce only the existing temporary outcome. A sent result needs a strict UUID acknowledgement; PostgreSQL also refuses arbitrary non-null provider references and null outcomes. No raw errors, email/token/message, or arbitrary provider body is logged, returned in statistics, or copied into completion.

Completion locks the invitation before its mail, matching acceptance/resend/cancellation/expiry order. It samples database time only after both row waits and rechecks current dispatch, lease, pending state, and both deadlines. A cancelled, accepted, expired, replaced, or stale lease cannot be acknowledged. Atomic update/backoff/token-clearing rules are unchanged; late failures roll back the entire completion.

The configured application origin must be credential-free HTTPS without path/query/fragment before any claim. Invitation proof stays in the fragment of the existing internal invitation path; no user-controlled return URL is accepted. HTML still escapes the public church name. This worker does not grant membership or authenticate a recipient.

## Recovery and release

A request timeout does not prove that a remote write or mail was cancelled. There is no automatic replay of an uncertain RPC; the existing lease/backoff/dispatch idempotency and current-state completion checks govern recovery. A nearly expired lease is left for the existing expiry/claim recovery path, not sent with a known short-lived link. Cancellation cannot retract an email already sent; the existing invitation/token boundary still controls acceptance.

Apply the reviewed additive migration before deploying the timing-aware application runner. Older application workers can continue using the additive claim but do not gain the new application-side timing checks; coordinate/drain them during the owner-controlled rollout. No remote rollout, operational limits, real mailbox/provider acceptance, or production migration is verified by local fixtures.

## Verification

Focused tests cover unsafe origin refusal before I/O, strict metadata, both clock-skew directions/latency, sequential single claims/fresh keys, missing/extra claims, nearly expired links, bounded uncooperative claim/send/completion, contained failures, and unchanged escaped fragment mail. Required disposable PostgreSQL integration exercises clamped timings, malformed completion refusal, injected late-error rollback, actual mail and invitation row-lock waits across expiry, existing acceptance/cancellation/retry paths, and actual migration definition/ACL replay. Exact synthetic invitation cleanup belongs to the existing church fixture teardown; no unrelated or remote data is removed. Docker is unavailable locally, so actual SQL proof must pass in CI before merge.
