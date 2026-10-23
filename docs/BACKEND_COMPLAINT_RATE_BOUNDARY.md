# Complaint preparation attempt budgets

## Inactive scope

This is a provider-independent prerequisite for the approved complaint flow, not public intake or activation. Backend Architecture §20 requires approval of exact operational rate settings. The five new `ops.security_policy` fields are all null by default; incomplete settings are rejected by a database constraint. No approved deployment values are supplied by this slice.

`api.consume_complaint_rate_limit(network_key, mailbox_key)` is service-only and returns exactly `allowed`, `rate_limited`, or `unavailable`. Missing policy or invalid digests never permits an attempt. A result is neither complaint receipt, mailbox proof, authentication, nor an execution capability. Existing draft/mail contracts remain inactive and are not retroactively claimed to be rate-enforced public endpoints.

## Privacy and trust boundary

The Node-only helper requires an explicit server secret and a single address supplied by a verified hosting/proxy boundary. It never reads headers, cookies, account IDs, complaint content, or target references. Never pass an address from form input or an unverified forwarding header. If the trusted address is unavailable, fail closed; do not substitute an attacker-controlled header or a made-up shared identity.

IPv4, equivalent IPv6 spellings, and IPv4-mapped IPv6 forms are canonicalized. The reply mailbox follows the existing trimmed, lower-case email representation with additional control-character refusal. Separate HMAC-SHA-256 domains produce network and mailbox keys. Only these digests reach PostgreSQL; no raw IP/email, secret, complaint, or provider payload is stored in a bucket or logged. These are pseudonymous security counters, not anonymous product analytics.

Use a dedicated random server secret; do not reuse Auth, provider, or application credentials. Trust/proxy validation, secret provisioning, and an approved versioned policy are activation prerequisites. Supply a fresh policy version when changing settings or rotating the key, and review the transition instead of silently treating an old window as a new policy.

## Atomic budgets and cleanup

Each permitted preparation attempt consumes one global, network, and mailbox budget under a short shared advisory lock. Policy reads are protected against concurrent configuration writes. Database time is captured only after the lock, so a queued request cannot use a stale pre-wait deadline. Windows reset from the authoritative evaluation time after expiry. The bounds on window/count configuration are defensive database ceilings, not approved operational settings.

An exhausted dimension rolls back all three updates, including newly created rows. Global exhaustion therefore cannot accumulate arbitrary new identity keys. Unexpected errors also roll back the complete RPC. No automatic retry is made after an uncertain acknowledgement: a timeout may already have consumed an attempt. Business/draft idempotency remains separate from this attempt budget.

The trusted helper accepts only the fixed outcomes, limits the full RPC to five seconds, aborts late I/O, and returns `unavailable` on failure without copying error details. The short global serialization is intentional for the first-version cost ceiling; no high-load or real staging capacity claim is made.

`api.expire_complaint_rate_buckets(limit)` is service-only, accepts 1–100, and removes only logically expired windows under the same lock using the expiry index. Fresh counters remain. This is disposal of ephemeral attempt-window state, not a complaint/audit retention decision. No cleanup scheduler is activated here; activation must include reviewed maintenance so expired pseudonymous counters do not accumulate indefinitely.

## Verification and remaining work

The separate inactive [preparation broker](BACKEND_COMPLAINT_PREPARATION.md) now enforces this budget before its challenge and draft-write calls. It does not parse headers/sessions or expose an endpoint; the real trusted HTTP boundary and approved settings remain prerequisites.

No-network tests cover canonicalization, separate HMAC domains, missing/invalid input/configuration, raw-value exclusion, fixed outcomes, errors, abort-ignoring transports, bounded timing, and no retry. Disposable database integration restores the original security policy and removes only exact synthetic policy versions. It exercises every budget dimension, denial rollback, global key-growth refusal, one-winner concurrency, scoped equal digests, injected late failure, expiry/reset, an actual before-expiry wait across the deadline, bounded cleanup, forced RLS, grants, and hardened entry points. CI is required when local Docker is unavailable.

Public broker wiring must enforce trusted input/session/target rules, Turnstile, this attempt boundary, and draft idempotency before any privileged preparation. The separate [verification boundary](BACKEND_COMPLAINT_EMAIL_VERIFICATION.md) now supplies independent dormant global/network/draft budgets and explicit POST composition. Resend budgets, real proxy/provider/mailbox proof, approved operational settings, received cases, owner receipt/review, retention, and public UI remain separate. No provider call, new dependency, production operation, or public endpoint is introduced.
