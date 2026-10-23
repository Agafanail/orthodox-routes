# Target-bound complaint mailbox verification

## Implemented contract

`api.verify_complaint_email_draft_v2(uuid, text)` requires both the expected draft UUID
and its current independent email capability before locking/updating any draft. A
future confirmation handler must use this operation: calling the token-only API and
then comparing the returned UUID would detect a mismatch only after another draft
had already changed.

Null/unknown/mismatched draft references, malformed/unknown capabilities, the resume
capability and a mail-worker-superseded proof return null without changing either
draft or mail metadata. Only service role may execute this fixed API. Anonymous and
authenticated application sessions receive no new write/table access; forced RLS,
empty definer search path and five-second lock waits remain intact.

The exact matching row is locked and its clock sampled afterwards. Crossing expiry
while waiting expires/clears only that draft through the existing shared cleanup;
token rotation during the wait is rechecked by the row predicate and cannot verify
with an old capability. Verification remains idempotent with one original verified
time and only draft UUID/status/expiry in the result. No reporter, mailbox, description,
target contents, contact, hash or credential is returned.

The original service-only `verify_complaint_email_draft(text)` signature and ACL remain
compatible. It resolves a candidate UUID and delegates to v2, which checks the current
target/proof together under lock. There is one implementation of the transition;
lookup alone cannot establish proof. Original expiry/reporting limits, mail-token
rotation, message/link format and completion rules are unchanged.

## Verification and boundaries

The existing disposable My Trips suite invokes
`scripts/verify-complaint-targeted-email-proof.mjs` after exact prior complaint-fixture
cleanup. It verifies ordinary-role denial, actual worker token rotation, byte-for-byte
mismatch refusal on two drafts, rollback, concurrent verification, original-time replay,
legacy compatibility, mail closure, actual lock waits across expiry/token rotation,
unchanged account/contact source data, and actual migration definition/ACL replay.
All created rows use exact fresh synthetic request UUIDs and are removed in finally.
The tests make no real provider send and are not mailbox-ownership proof outside that
synthetic fixture.

The separate [explicit verification boundary](BACKEND_COMPLAINT_EMAIL_VERIFICATION.md)
now composes an unregistered same-origin POST controller, independent dormant attempt
budgets and this v2 primitive. It remains inactive pending real trusted proxy/browser
wiring and approved operational settings.

This is an inactive protected primitive, not a public confirmation route, complaint
receipt, Auth sign-in, account-contact change, owner delivery or retention decision.
The future browser handler still needs explicit POST confirmation rather than token
consumption on GET/link-scanner visits, strict same-origin/body handling, an independently
trusted network boundary and configured per-flow abuse limits, no token in query/logs,
safe result parsing and actual browser/mailbox/provider acceptance. Its displayed
reference must be the same UUID passed to v2. No operational setting, public grant,
production connection or provider is activated by this migration.
