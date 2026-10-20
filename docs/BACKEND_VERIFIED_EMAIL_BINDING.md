# Current verified email binding guards

Auth remains the canonical verified identity. `private.account_contact.email_normalized` is an application copy synchronized only by a protected identity-change operation, not merely by a profile edit. A different confirmed Auth email must not make that old copied address a current verified binding. This security hardening does not change or recover email, choose a protective delay, transfer an identity, or activate an email-change flow.

## Eligibility and channel boundaries

Migration `20261020130000_verified_email_binding.sql` introduces ungranted, hardened source-check helpers. Existing-account eligibility requires a confirmed Auth email to match the normalized protected contact. Mismatch reuses the existing `email_not_verified` refusal rather than adding a public field/status. A verified Auth identity without an application account retains its existing pre-account email-verification fact; account materialization/other missing factors remain separate.

An ordinary email channel is effective only for that matching binding. New notification history still commits atomically, but mismatch cannot enqueue a new email to the retained old address. Ordinary preferences, active push subscriptions, account state, phones, legal factors, contacts, and business/history rows are not rewritten. The unchanged Web Push branch and in-app history remain separate channels. Existing participant contact snapshots are not retargeted or rewritten by these guards.

## Queued delivery boundary

Legacy claim helpers retain signatures/ACL and exclude an email whose stored destination no longer matches both current source rows. Candidate refusal consumes no new dispatch attempt and does not mark a subscription invalid, retarget a job, or invent an email-change result. Existing immutable provider idempotency and terminal delivery handling remain unchanged.

The application v3 bridge additionally locks the identity/contact source after the existing outbox/delivery helper, then checks a fresh statement snapshot before returning any destination. This covers a source change committed while claim was waiting on the delivery row. A refused raced claim may retain its existing lease until expiry; the next claim still cannot dispatch stale mail. There is no automatic rewriting/cleanup of old destinations here. Protected identity-change orchestration must reconcile obsolete delivery work under its own approved rules.

Database checks cannot unsend mail already accepted externally or make a provider call atomic with a later identity change after claim commits. Preserve bounded leases, provider idempotency, and owner-coordinated rollout/draining of older application workers; do not claim exactly-once delivery or a completed recovery workflow.

## Verification and limits

Disposable local integration mutates only its synthetic Auth identity through the admin API, verifies stale eligibility/channel refusal, unchanged private contact/preferences, no new stale email destination, both legacy/v3 queued refusal, an independently stale stored destination, restoration without retargeting, and actual migration/ACL replay. A real delivery-row barrier commits a changed Auth source before claim resumes and verifies v3 returns no destination. These controlled source mutations are not real end-user email replacement or provider/mailbox acceptance. Exact synthetic notifications/jobs are removed and the original test identity is restored.

Notification deadline replay composes its actual migration with the later binding extension so a legacy replay cannot erase the current bridge guard. Required account integration independently retains verified pre-account eligibility and ordinary healthy-account behavior. Local Docker absence means SQL/concurrency proof must pass mandatory CI before merge; local syntax/lint alone is not database proof.

No dependency, new ordinary/service grant, profile UI, provider, environment/policy value, protective-delay decision, staging mutation, production migration, or production access is introduced. Protected email change/recovery, required security communications, obsolete-destination lifecycle, and real provider/owner rollout remain separate campaign work.
