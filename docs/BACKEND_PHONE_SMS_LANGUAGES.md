# Phone verification SMS language contract

## Implemented boundary

New initial-binding and protected phone-change attempts freeze SMS template version 2 and the account's existing supported preferred language (`de`, `en`, `it`, `ro`, `ru`, `uk`) in restricted attempt metadata. No phone-country inference, arbitrary message input, client-selected provider text, or new language is introduced. Later profile edits and lease reclaims cannot change that attempt's metadata or code/body. The six prepared templates contain only the brand, six-digit code, and a neutral sharing warning, with at most 70 BMP characters. They do not promise a hard-coded ten-minute lifetime; the existing configured database expiry remains authoritative and unchanged.

The Bird transport, sender, attempt UUID idempotency key, selected provider/configuration, OTP authority, verification limits, resend/cooldown policy, lease/completion behavior, and protected phone binding remain unchanged. Neither template text nor codes are logged. No real SMS, provider configuration, sender/quota decision, new dependency, or production operation is part of this change. Native-speaker/handset/provider acceptance remains a distinct release check, not a unit-test claim.

## Compatibility and privileges

Migration `20261019130000_phone_sms_languages.sql` backfills pre-existing attempts as immutable version 1/Russian. That version retains the exact historical Russian provider body for retry compatibility; it is never the default for newly created application attempts. A private trigger snapshots new metadata and refuses rewrites. It does not change ordinary attempt state transitions, code clearing, contact audit, or deletion cascades.

The existing four-column `api.phone_worker_claim_delivery` remains service-only and may claim only version 1. The original targeted claim implementation moves to an ungranted `ops` helper without changing its leasing logic. The new service-only `api.phone_worker_claim_delivery_v2` returns the same targeted data plus frozen version/language and accepts either supported version. The application worker calls only v2, validates metadata, and passes it to the version-aware renderer. Ordinary clients cannot lease codes or read attempt/template storage. Explicit unsupported/partial metadata fails closed without a guessed translation; direct legacy adapter calls without either metadata field preserve the old body.

An older deployed application cannot accidentally claim a new version-2 attempt and send a different body under the same provider idempotency key. A newer application against a database without v2 fails closed. During an owner-controlled rollout, apply the reviewed migration before enabling the corresponding application version, drain/coordinate older delivery workers, and verify queued-attempt handling. This code does not deploy itself or verify a mixed-version remote rollout. The ungranted broad database claim helper remains a local fixture/internal implementation detail, never an application delivery endpoint.

## Verification

Focused tests cover all six exact renderings, legacy body compatibility, one-code/length bounds, unsupported code/version/language refusal, explicit metadata validation, fixed attempt idempotency, and worker propagation without logging private values.

The disposable local phone integration covers normal initial-binding v2 output, all six real protected phone-change requests, language changes after request, old-worker refusal without leasing, stable code/template reclaims, immutable metadata, legacy four-column/new-worker compatibility, transient-code removal, least privilege, and actual migration replay. A rolled-back local transaction temporarily reconstructs only the previous SMS-column shape, reapplies the real migration, and proves legacy backfill without modifying original attempt data; rollback and replay preserve definitions/ACLs and frozen v2 facts. It is synthetic database proof, not real SMS delivery or production migration approval.
