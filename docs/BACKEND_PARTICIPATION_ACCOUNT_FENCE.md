# Participation and account lifecycle serialization

## Implemented boundary

Migration `20261020150000_participation_account_fence.sql` adds an unexposed
`app.require_mutating_actor(boolean)` helper. The explicit inventory of 36 existing
positive-participation entry points uses it in exactly the former guard position,
including conditional acceptance branches. It locks the actor's account `FOR SHARE`
until transaction end, then rechecks the existing eligibility and, for transport,
effective external-channel rules in a fresh statement after any wait.

An ordinary non-key account-status update conflicts with this lock. If restriction
commits first, the waiting participation action sees current ineligibility and
refuses atomically. If participation has passed the fence first, the status writer
waits until that transaction commits or rolls back. No operation is retroactively
undone. The helper bounds its dependency lock wait at five seconds and grants no
execution to ordinary or service roles. This is not a new product eligibility rule.

The migration changes no public signature, existing ACL, security-definer flag,
conditional decline path, business state, notification, or idempotency behavior.
The original read helpers remain `STABLE` and do not lock rows. Read-only projections,
existing agreement access/cancellation, and restricted self-export are not tightened.
Private contacts, phone reservations, preferences, and agreement snapshots are not
rewritten. Threat-specific access closure is not implemented by this fence.

## Why a separate write guard

[PostgREST transaction access modes](https://docs.postgrest.org/en/stable/references/transactions.html)
make even POST calls to `STABLE` functions read-only. Adding row locks to the shared
read helper would break those projections. [PostgreSQL function snapshot rules](https://www.postgresql.org/docs/17/xfunc-volatility.html)
require a separate statement in a volatile helper to obtain fresh eligibility facts
after a competing writer finishes. The narrow migration-only rewrite preserves all
remaining function bodies and fails closed on unexpected inventory/body shapes.

## Verification and remaining work

`scripts/verify-participation-account-fence.mjs` runs within the existing disposable
church-administration suite. It uses a real eligible synthetic actor with optional
ride channels disabled, verifies a valid rolled-back `api.create_church` baseline,
and observes actual database lock waits in both status-update/RPC orders. The status
writer uses an ordinary UPDATE, not an artificially stronger lock: this distinguishes
the fence from incidental foreign-key key-share locking. All synthetic church and
membership writes are rolled back. Read-only current eligibility and restricted
self-export, helper grants, the remaining direct-guard inventory, and actual migration
replay/definition/ACL stability are checked as well.

This is authorization preparation, not a deployed owner restriction/restoration
interface. Reviewed owner commands, durable case/audit, deletion orchestration,
threat-specific measures, existing listing moderation, and real operator provisioning
remain separate work. No production access or new operational setting is enabled.
