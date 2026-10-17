# Complaint mailbox-proof delivery

## Inactive boundary

This provider-independent worker sends only the email-confirmation step for an unsubmitted complaint draft. It does not create/receive a complaint, deliver anything to the owner, authenticate an account, change contacts, or choose received-case retention. No endpoint, scheduler, public form, or production configuration activates it.

The existing private draft row owns a small delivery state machine, behind the same forced RLS and revoked table grants. Service-only `complaint_proof_mail_claim(uuid)` claims one row using `FOR UPDATE SKIP LOCKED`; `complaint_proof_mail_complete(uuid, uuid, text)` accepts only the current job/lease and a fixed outcome. Both are hardened definers with five-second lock waits. Ordinary callers cannot claim recipient/proof material or complete a delivery.

## Capability lifecycle

Every claim creates a fresh random 256-bit email capability and opaque attempt ID. Only the SHA-256 capability hash remains in PostgreSQL; the clear capability exists only in the privileged claim response and the outgoing confirmation link. The resume secret remains independent. Rotating delivery proof does not change the original preparation fingerprint, so an original identical prepare retry remains safe and does not enqueue another mail.

Claims last at most 45 seconds, shortened to draft expiry. A failed/abandoned attempt is recoverable under a new job ID and capability, invalidating the previous link. This can produce an older unusable email after an uncertain delivery; the future confirmation screen must explain expired/replaced links and offer a new explicit submission without claiming receipt. There is no public resend endpoint or extension of the original 15-minute/reporting deadline.

There are at most five attempts, with technical backoff from 30 seconds to four minutes. The fifth temporary/permanent failure is terminal; an abandoned fifth lease becomes failed during a later bounded claim sweep. A failed/unknown acknowledgement does not revoke a last capability that may already have reached the mailbox. A valid proof can still verify before the original draft expiry. Verified drafts never receive another claim; completion of an already claimed verified row closes delivery metadata. Expiry redacts draft input/proofs and clears all lease/job material. Attempt counts and non-personal queue times are not received-complaint retention.

## Application runner and email

Claims include an authoritative database evaluation timestamp. The worker validates the maximum lease/draft durations against that instant, then translates them into local deadlines after conservatively subtracting the entire monotonic RPC round trip. Database/worker wall-clock skew therefore neither consumes valid attempts nor extends the server lease.

The shared Resend adapter now rejects redirects, omits ambient credentials, limits acknowledgement bodies to 16 KiB, and bounds both fetch and body consumption to ten seconds with abort/stream cleanup. The existing durable idempotency prefix, wire message, successful UUID acknowledgement, and fixed retry classification remain unchanged for ordinary notifications and invitations.

`processComplaintProofMail` reuses the selected Resend adapter but claims one lease at a time, never an expiring batch. It validates IDs, recipient, language, capability, attempts, and deadlines; uses fresh per-claim lease IDs; bounds claim/completion waits to five seconds and provider waits to twelve seconds; and refuses to send when fewer than fifteen seconds remain. A timeout does not prove external cancellation: a late request can still complete, so lease ownership and capability rotation provide recovery rather than an exactly-once mail claim. The provider idempotency key is the opaque attempt ID, never a recipient/capability. No provider reference, response/error body, private payload, or email content is persisted in completion or returned statistics.

The versioned prepared message has English, Russian, Italian, Romanian, Ukrainian, and German text. It says email confirmation is needed to continue, not that a report was received; no response time is promised. It contains no complaint body/category, target contents, names, location, account contact snapshots, or owner address. The recipient is used solely as the provider destination.

The reserved link belongs to the approved `/{lang}/report/{target-reference}` family. Its path uses the opaque short-lived draft reference, not target contents; the email capability is only in `#email-proof=...`, never a query parameter. The future browser confirmation route is **not implemented** here. Before activation it must consume the fragment privately, remove it from browser history, and require an explicit action before proof verification/atomic case handoff. A GET/link scanner must not consume proof or show complaint success. The renderer requires a credential-free HTTPS application origin without a path/query/fragment; no provider redirect or user-supplied return URL is accepted.

## Activation and verification gaps

Public input/session validation, Turnstile, approved operational rate limits, safe trusted preparation, explicit browser confirmation, atomic received-case handoff, working owner recipient and safe-reference delivery, approved retention, cleanup scheduling, provider tracking settings, real staging mailbox/Resend proof, and human language acceptance remain required. Never connect this worker before its destination route and mandatory protections exist. Ordinary ride email preference flags do not control this explicitly requested mailbox-proof message.

Unit tests use fake clients/transports only. Local-container integration covers ordinary-role denial, concurrent single claims, rollback, proof rotation, unchanged prepare retries, stale/wrong completion, backoff, abandoned leases, fifth-attempt exhaustion, verification/delivery separation, sensitive expiry cleanup, and hardened grants. Tests clean only their exact synthetic request keys. CI, not an unavailable local Docker engine, supplies database execution evidence.
