# Complaint target context

## Implemented read boundary

`api.complaint_target_context(p_target_type text, p_target_id uuid)` accepts a public object UUID, derives the actor from the authenticated context when present, and returns either null or exactly:

- `schema_version: 1`;
- `target_type`;
- `target_id` (the same validated public UUID);
- `categories` (stable technical codes, not UI copy).

Anonymous and authenticated callers may read context; service-role execution and ordinary direct table access are not granted. No caller-supplied actor parameter is accepted. Unknown, unsupported, or inaccessible references all return null.

| Target | Existing visibility used | IA V2 §45.5 categories |
| --- | --- | --- |
| `church` | Published church only | `incorrect_information`, `duplicate`, `not_orthodox_or_missing`, `rights_infringement`, `dangerous_or_illegal`, `other` |
| `passenger_request` | Published-church future active/partial request with remaining need, or the author's own non-draft/non-verification record until 30 days after its arrival | `public_private_details`, `paid_transport`, `spam_or_fraud`, `harassment_or_danger`, `false_ride_information`, `other` |
| `driver_occurrence` | Published-church future active offer with available capacity, or the author's own non-draft/non-verification record until 30 days after its arrival | Same listing categories |
| `ride_agreement` | Participant-only agreement/history reference until 30 days after the accepted snapshot's scheduled arrival, including cancellation within that window | `no_show`, `dangerous_behavior`, `unwanted_contact`, `money_or_fraud`, `other` |

No arbitrary account/profile lookup is added. A complaint about a participant can refer to the visible ride or agreement context rather than exposing an account identifier. A photo/text rights complaint uses its church context.

## Privacy and limits

The query never selects contacts, exact/approximate locations, names, notes, or full condition snapshots. It reads only the accepted snapshot's scheduled time to enforce IA V2 §15.1/§15.3. The 30-day reporting deadline is independent of archival status, contact visibility, and lifecycle cleanup; stored past-due rows cannot extend it. Legal/authority requests outside that interface window remain available through the separate service-email path. A restricted participant retains in-window context without a new phone, external notification channel, or current Terms requirement. Hidden churches do not become public through this function; in-window own listings and participant agreements remain independently accessible.

This function creates no complaint, email verification, delivery, moderation action, audit row, or retention obligation. It must not be presented as successful submission. A later intake must revalidate authority or bind a previously authorized target in a protected guest-verification flow; the browser preview is never write authorization. Guest email verification, stored protected cases, anti-abuse limits, working owner recipient, safe-reference-only emails, decision audit, legal retention, and the production form are still required.

Synthetic My Trips integration verifies all four target kinds, exact categories/shape, anonymous/outsider refusal for private history, completed/cancelled in-window references, 31-day history refusal, just-before/at-30-day boundaries for both listing kinds and both agreement participants before cleanup, hidden-page boundaries, restricted-account access, actor-spoof refusal, service-role denial, hardened stable definer configuration, and actual-migration reapplication without definition/ACL drift.
