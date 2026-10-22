# Inactive complaint preparation broker

`src/lib/complaints/preparation.ts` composes the existing attempt-budget, Turnstile, and service-only email-draft contracts. It is a Node/server-only prerequisite, not a route, form, complaint submission, mailbox confirmation, owner receipt, or activation. No environment fallback constructs a privileged client or enables a provider.

## Trust and order

The factory requires an explicit protected client, dedicated rate secret, and the selected server Turnstile verifier. The future HTTP boundary must derive the reporter from verified session claims (or explicitly null for a guest), obtain one address from the verified hosting/proxy boundary, enforce same-origin/CSRF and request-body limits, and retain a server-generated retry intent securely. Never copy a browser-provided actor, network address, verdict, or capability into trusted arguments. A valid UUID is structural validation, not authentication; the broker deliberately does not implement sessions or proxy trust.

The [inactive HTTP intake reader](BACKEND_COMPLAINT_HTTP_INTAKE.md) supplies exact-origin POST/JSON metadata checks and bounded private body parsing. Its output is still untrusted input for this broker, not identity or a complaint receipt. The [unwired SSR reporter seam](BACKEND_COMPLAINT_REPORTER.md) verifies project-cookie identity through Auth and checks existing account existence without a participation gate. Deployment binding of verified hosting/proxy context, actual framework cookies, and real route registration remain unfinished.

The [unregistered preparation HTTP composition](BACKEND_COMPLAINT_PREPARATION_HTTP.md) now enforces cookie acknowledgement before broker work, with per-form/reporter-bound retry state and exact clear/tighten paths. Its explicit network/cookie/reporter/broker dependencies have no deployment fallback; actual route/framework/proxy registration and combined acceptance remain unfinished.

The accepted untrusted payload contains exactly target type/public UUID, category, bounded description, reply mailbox, supported language, and a challenge token. Extra authority-bearing fields fail before external I/O. The database remains authoritative for target visibility, participant access, category membership, and the original reporting deadline. No phone, age, Terms, or optional ride-channel gate is added to reporting.

After validation, the broker snapshots values and consumes the global/network/mailbox attempt budget before spending an external challenge request. Only an explicit `allowed` budget followed by `verified` for the server-selected `complaint_submit` action can reach privileged draft preparation. Missing policy, invalid configuration, malformed acknowledgements, exceptions, unknown verdicts, and deadlines fail closed. Budget, challenge, and preparation each have a five-second bound; challenge/write signals are aborted and timers cleared even when dependencies ignore cancellation. There is no automatic retry or cached challenge verdict. A late challenge cannot trigger preparation after refusal.

## Retry state and safe results

`createComplaintPreparationIntent` uses a random UUID and two independent random 256-bit capabilities. This is protected server retry state, not a form response or an arbitrary client-supplied intent. Never put its email capability in a browser-readable cookie, URL/query, log, or response. The [inactive encrypted retry codec](BACKEND_COMPLAINT_RETRY_STATE.md) provides bounded reporter/purpose-bound serialization without complaint content; the future HTTP boundary still must integrate secure cookie/session retention and clearing. The separate resume proof cannot establish mailbox ownership. The existing mail worker rotates the actual outgoing proof; this broker does not send it.

An explicit retry retains the same intent and canonical input for existing database idempotency but consumes another attempt budget and requires a fresh provider-accepted challenge. A timeout may already have committed the draft; it is not proof of rollback. A changed payload under the same intent is refused by the database, not silently substituted. Discard retry state no later than its draft deadline; do not start a new operational retention policy here.

The only successful-shaped result contains draft UUID, state (`pending_email`, `email_verified`, or `expired`), and database expiry. It never says `received` or exposes recipient, text, target, actor, capability/hash, provider response, or error detail. Extra fields in a privileged receipt are refused rather than forwarded. Email proof is not an authenticated account and a verified draft is not a received complaint.

## Verification and activation gaps

No-network tests exercise ordering, HMAC-only budgets, guests/session-derived actor propagation, payload/authority refusal, immutable snapshots, fail-closed dependencies, strict receipts, explicit retry identity, private failure containment, and abort-ignoring deadlines. Existing required disposable SQL integration separately verifies the real budget and target/draft/lease contracts; this slice adds no migration or claim of a real combined provider/browser flow.

The HTTP/session/proxy/cookie-integration boundary, real widget/domain/provider setup, approved operational limits, explicit link confirmation, received cases, working owner recipient, approved retention, cleanup scheduling, and browser/human verification remain unfinished. Do not expose or activate this broker before those mandatory boundaries exist. Ordinary users still cannot call the protected writes directly.
