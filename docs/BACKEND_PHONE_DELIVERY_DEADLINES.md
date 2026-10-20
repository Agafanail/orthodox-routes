# Phone delivery and verification deadlines

This technical hardening keeps the existing application-owned OTP policy, Bird adapter, immutable six-language/legacy bodies, attempt idempotency, recent-authenticated phone replacement, and authoritative code verification. No provider, credential, deployment policy, ordinary UI flow, or production operation is activated.

## Restricted delivery

Migration `20261020110000_phone_delivery_deadlines.sql` adds `lease_until` only to transient, ungranted `ops.phone_verification_delivery`. The targeted helper locks delivery then attempt, samples the database clock after both waits, and freezes a deadline bounded by the configured lease duration and code expiry. Live leases cannot be reclaimed. Expired/terminal attempts cannot return delivery material; actual code expiry clears the remaining code/digest. The legacy targeted four/six-column bridges remain compatible, and the ungranted batch helper keeps its shape and bounded legacy completion fallback.

The new service-only `api.phone_worker_claim_delivery_v3(attempt, lease)` returns one JSON object or null, including frozen template metadata, `evaluated_at`, and `lease_until`. Application timing uses relative database durations minus the entire monotonic claim latency, not synchronized clocks. It rejects a different attempt, malformed/expired/short timing, or more than the existing configured structural five-minute lease ceiling before sending. No OTP, phone, provider reference, or exception enters the returned outcome statistics.

Claim/completion waits and the default privileged client are bounded to five seconds; provider waiting is bounded to twelve seconds in addition to Bird's independent ten-second transport/body bound. At least twenty seconds must remain before dispatch. Missing adapter configuration retains existing fail-closed completion/code-clear behavior when a valid lease can be obtained. There is no automatic RPC/provider retry on an uncertain outcome.

Completion locks delivery then attempt and checks the actual clock after both waits. An expired lease cannot report success/failure or delete another worker's code. Code expiry still marks the queued attempt expired and clears transient material. A valid failure retains the existing terminal-failure/code-clear policy; a valid acceptance does not verify a phone. Only a subsequent authenticated code verification can change the binding.

## Authenticated verification

`api.verify_phone_code` locks the caller's protected contact before the attempt, matching request/supersession lock order, and evaluates expiry after both locks. Its existing binding subtransaction also checks expiry after a potentially blocking unique verified-phone index update. If that wait consumes the code lifetime, the tentative binding is rolled back, the attempt is expired/cleared, and no successful binding audit/notification is emitted. Existing wrong-code limits, unique-phone refusal, purpose distinctions, contact history, eligibility, and success notifications remain unchanged. Lock waits are bounded to five seconds.

## Verification and rollout

No-network worker tests cover both clock-skew directions, conservative claim-latency subtraction, unrelated/malformed/short leases, missing configuration, and abort-ignoring claim/send/completion. Disposable PostgreSQL tests exercise real concurrent claims, completion rollback, both delivery/attempt waits across lease expiry, claim/completion code expiry, authenticated contact/attempt/index waits with unchanged binding and absent success audit, deadline clamping, and actual migration/ACL replay. Existing local-auth and browser flows remain required regression evidence. Without local Docker, these SQL assertions require mandatory CI; fixtures are not real provider/handset acceptance.

Apply the additive migration before the application; a missing v3 bridge fails closed. Coordinate/drain older workers before rollout. A bounded wait does not prove remote cancellation, rollback, exactly-once SMS, or hosting capacity. Provider/device acceptance, owner-approved operational values, and production rollout remain separate gates.
