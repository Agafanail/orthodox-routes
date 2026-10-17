# Complaint email-proof drafts

## Scope

This inactive database contract prepares unsubmitted complaint input and records possession of an independent mailbox token. It does not create `ops.complaint`, accept/deliver a complaint, authenticate an account, alter account contacts, moderate material, or choose legal retention. No public form or route calls it yet.

The previous ordinary `api.complaint_target_context(text, uuid)` delegates unchanged rules to an ungranted shared `app.resolve_complaint_target` helper. Ordinary callers still cannot supply an actor. The full existing anonymous/participant/history/deadline regression remains required.

## Storage and access

`private.complaint_email_draft` has forced RLS and no direct table grant for anonymous, authenticated, or service roles. Its service-only RPCs are:

- `prepare_complaint_email_draft`: validate a known target/category and bounded text/email/language, bind two independent server-generated 256-bit secrets, and return only draft UUID, state, and expiry;
- `verify_complaint_email_draft`: accept only the email capability, not the pre-email resume capability; record `email_verified` once and return only a minimal receipt;
- `expire_complaint_email_drafts`: process at most 100 due rows per call with row locking/skip-locked behavior and return a count.

All three have hardened definer search paths and five-second lock waits. Input is limited to 4,000 description characters and a normalized 254-character reply email, without control characters except description line breaks. These are defensive storage bounds, not public-form or operational activation. Category families and language codes are constrained in both preparation and storage.

The trusted server must derive the reporter account from verified session claims, or null for a guest; it must never forward a browser-provided actor identifier or use mailbox proof to log someone in. The service credential is the existing protected application-server boundary, not an ordinary-user credential or an owner-operation role. Application roles cannot call these writes directly, and the shared actor-parameterized helper/export helper are ungranted.

## Capabilities, retries, and deadlines

Only capability hashes are stored, never clear resume/email tokens. Tokens must differ. A request key plus the matching resume proof and canonical input fingerprint provides retry safety; a changed email, body, reporter, or email proof cannot reuse that request. Concurrent preparation returns the same row. Concurrent/duplicate verification retains its original verification time.

The technical draft lifetime is at most 15 minutes and is shortened to the originally authorized target's 30-day post-ride reporting deadline. A previously visible target may close during that short email step; the draft binds the earlier authorized reference without revealing any later private material. The stored expiry cannot extend the reporting window. A church draft has only the technical deadline.

Verification samples time once after acquiring the draft row lock. That same instant governs expiry and the recorded verification time, so crossing the wall-clock deadline between statements cannot create an inconsistent verified row. A request that waits on a lock until after expiry receives an expired receipt instead.

Expiry clears recipient, description, category/language, target and reporter linkage, both proof hashes, input fingerprint, and verification time for pending and verified drafts. Only non-personal draft/request UUIDs, state, and lifecycle times remain. Expired keys/proofs cannot revive input. This is unsubmitted-data cleanup, not the unresolved legal policy for received complaints, decisions, audit, or legal holds. Account deletion cascades only these unsubmitted linked drafts.

Own account export adds `complaint_email_drafts`, selecting only that account's unexpired input and safe lifecycle fields. Guest and other reporters' input, both secrets/hashes, and logically expired payloads remain excluded even before cleanup. This is an explicit own-data export, not a public preview or prefetch.

## Required integration before activation

- Add trusted server-side input handling, target/session validation, challenge verification, and rate limits before privileged preparation. Direct Data API writes must not bypass them.
- Generate both secrets on the server. Never return the email token in a form response, browser-readable cookie, or draft preview; deliver it only through the verified-mail path.
- The separate inactive [mailbox-proof worker](BACKEND_COMPLAINT_PROOF_MAIL.md) rotates a fresh token on each bounded protected delivery lease, keeping only its hash. Public resend and real mailbox/provider verification remain unfinished; no open token can be recovered from storage.
- Use an explicit confirmation action rather than consuming a token on GET/link-scanner visits; do not log query/fragment/capability material.
- Atomically hand off valid proof to a received case and safe-reference-only owner/reporter delivery, subject to working recipient/provider configuration and approved retention. Do not show a successful complaint receipt for `pending_email` or `email_verified` alone.
- Add reviewed cleanup scheduling. The bounded expiry RPC exists, but no scheduler is activated by this migration.

Real SMTP/mailbox verification, owner receipt, public/browser flow, anti-abuse policy, complaint decisions/audit, and legal retention remain unfinished. No production setting or provider is activated.

## Verification

The local-container My Trips integration exercises service-only grants, shared ordinary target behavior, guest/private-target refusal, distinct capabilities, input validation, one-row concurrent preparation, changed-input refusal, rollback and one-time verification, strict safe receipts, deadline clamping, closure after authorized binding, own-export isolation, pending/verified redaction, lazy/worker expiry, identity/contact immutability, forced RLS, and exact fixture-key cleanup. Historical target-migration replay restores the current shared-rule wrapper atomically rather than downgrading later implementation. Full required CI supplies real SQL proof when the local Docker engine is unavailable.
