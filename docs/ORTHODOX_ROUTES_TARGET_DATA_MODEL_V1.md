# Orthodox Routes — Target Data Model V1

- **Status:** approved
- **Date:** 6 August 2026
- **Scope:** canonical target logical model for the first complete public version
- **Physical status:** canonical logical design with the Core Account & Eligibility, application-owned Phone Verification, contextual registration through explicit publication, transport/response/agreement foundations, and configured application cutover implemented locally and deployed to an isolated synthetic-only staging project; it is not the complete executable target domain or production model. Versioned migrations materialize `app.account`, `private.account_contact`, legal-document/acceptance metadata, narrow account/eligibility RPCs, the protected phone-attempt/delivery boundary plus a targeted service-role worker bridge, protected incomplete-action drafts, separate temporary registration profiles, server-only rate buckets, canonical church/service transport references, passenger requests, driver series, date-specific occurrences, responses, immutable conditions, agreements, contact snapshots, and safe agreement history on top of the `app`, `private`, `api`, and `ops` schemas. The Bird adapter is application code, its staging key remains external and secret-manager-owned, and real staging delivery plus application-owned OTP verification are confirmed; recovery, Maps geography, production access, and remaining target entities are not implemented

## 1. Purpose and authority

This document is the canonical target logical data model selected by [Backend and Integration Architecture V1](ORTHODOX_ROUTES_BACKEND_INTEGRATION_ARCHITECTURE_V1.md). It implements the product relationships, states, visibility, and lifecycle in Product Scope V1 and Information Architecture V2 without treating the current Firestore-shaped prototype model or `localStorage` records as production design.

Authority remains:

1. Product Scope V1 for product purpose and first-version boundaries.
2. Information Architecture V2 for target behavior, permissions, visibility, content, and state transitions.
3. Backend and Integration Architecture V1 for selected technologies and trust boundaries.
4. This document for target logical entities, relationships, constraints, and database responsibilities.

If an authoritative product rule conflicts with this model, implementation pauses and the documents are reconciled explicitly. This document does not constitute complete SQL migrations.

## 2. Modelling principles

- PostgreSQL is the durable source of truth.
- UUID primary keys are internal and non-sequential. Separate opaque public IDs are used where a shareable URL needs one.
- Passenger and driver are actions and relationships in a ride, not account roles.
- Each recurring driver series produces date-specific occurrences with independent capacity.
- One confirmed agreement belongs to one response and one occurrence/date.
- Public representations are separate projections; protected data is not selected and hidden by the client.
- Exact locations, contacts, recovery state, complaints, and provider diagnostics live behind explicit protected boundaries.
- Critical transitions use protected database functions and database constraints, not client ordering.
- Timestamps are stored as `timestamptz` in UTC. Local scheduling also stores the source IANA time zone and local wall-clock components needed to preserve intent.
- Enumerated states are constrained database values or reference rows with controlled migrations.
- Provider references are attributes of delivery/verification records, not domain identities.
- Soft lifecycle states preserve relational integrity; retention jobs later remove or anonymize approved sensitive fields.

## 3. Proposed PostgreSQL schemas

| Schema | Purpose | Exposure |
| --- | --- | --- |
| `auth` | Supabase-managed authentication identity and sessions | Managed by Supabase; never exposed as a general application table |
| `app` | Core relational product state without unnecessary secrets | No blanket client grants; accessed through explicit policies/functions |
| `private` | Contacts, exact user geography, recovery, notification preferences/subscriptions, contact snapshots | Not exposed through broad Data API; protected functions only |
| `api` | Deliberate public/account/participant views and callable functions | Only schema considered for narrowly granted application access |
| `ops` | Complaints, abuse controls, audits, deletion ledger, delivery diagnostics, owner operations | Operational roles and protected functions only |
| `storage` | Supabase-managed Storage metadata | Supabase-managed with object policies |

Creating a table in an exposed schema requires RLS, explicit grants, and a reviewed reason. Views use `security_invoker` when caller RLS must apply. Security-definer functions pin `search_path`, validate the actor internally, and expose the minimum result.

## 4. Identity, eligibility, and consent

### 4.1 `app.account`

One row per Supabase Auth identity.

| Field | Key/rule | Classification |
| --- | --- | --- |
| `id` | PK; FK to `auth.users.id`; immutable | System-only |
| `public_id` | Unique opaque identifier | Public only where an approved card/link requires it |
| `display_name` | Required; controlled length; no required surname | Public safe name |
| `preferred_language` | Check: `en`, `ru`, `it`, `ro`, `uk`, `de` | User-private |
| `status` | Check: `email_verified`, `active`, `restricted`, `deleting`, `deleted` | Account/operational |
| `adult_declared_at` | Nullable until declared | User-private/system |
| `created_at`, `updated_at` | Required | System-only |
| `deleted_at` | Nullable | Operational |

Email verification is read from the managed auth identity through a protected eligibility function. The application row does not duplicate an authoritative editable role.

In the implemented foundation, `active` means normal account standing and is intentionally distinct from participation eligibility. An active account can remain ineligible until its phone is verified, the 18+ declaration is recorded, and the current Terms version is accepted.

### 4.2 `private.account_contact`

| Field | Key/rule |
| --- | --- |
| `account_id` | PK/FK to `app.account` |
| `email_normalized` | Required; unique while account is active; synchronized through protected identity-change operation |
| `phone_e164` | Nullable until supplied; may repeat while unverified; unique once verified while the binding remains valid |
| `phone_verified_at` | Nullable |
| `email_changed_at`, `phone_changed_at` | Nullable audit helpers |

Contacts are user-private and participant-visible only through an eligible agreement disclosure function. General account queries never join this table.

Entering a phone does not reserve it. The implemented partial unique index applies only when `phone_verified_at` is set, so incomplete accounts may temporarily hold the same E.164 value while a second verified binding is rejected. The current foundation has no phone-change, deletion, or binding-release workflow; until a later protected operation explicitly invalidates a verified binding, it remains reserved across account lifecycle states.

### 4.3 `app.legal_document_version` and `app.legal_acceptance`

`legal_document_version` records document type, version, language set, effective time, and content hash. `legal_acceptance` has a composite unique key `(account_id, document_version_id, acceptance_type)`, acceptance time, and safe evidence metadata. Current Terms acceptance is checked by the eligibility function.

The implemented current-version rule selects the published document of the requested type with the latest `effective_at` not later than the evaluation time. Effective times are unique per document type, future and draft versions do not apply, and no production legal document is inserted by the foundation migration.

### 4.4 `ops.phone_verification_attempt`

The implemented account-bound foundation stores normalized phone, client idempotency key, safe provider adapter/reference, delivery/verification state, failed-code count, and requested/sent/expired/verified times. Versioned `ops.security_policy` values use the IA-recommended initial 10-minute expiry, five code attempts, and 60-second resend delay plus a bounded 60-second worker lease pending production operational review. A separate restricted delivery row holds the six-digit code only until the worker records delivery outcome; terminal attempts clear the salted digest as well. An abandoned delivery lease can be reclaimed with the same attempt identifier, while a completion after code expiry fails and clears the remaining code material. No application role can lease or complete delivery, and the authenticated API never returns OTP or provider diagnostics.

The provider-independent API queues only for the current active account with verified email, verifies only a delivered unexpired code, rejects cross-account attempts, and atomically binds the phone through the existing partial unique index. Concurrent attempts to verify the same unbound phone result in exactly one binding. The Bird delivery adapter and targeted worker bridge are implemented, and an isolated staging smoke confirmed provider acceptance, handset receipt, safe supersession, and application-owned OTP verification without making delivery alone authoritative. Phone change/recovery, wider abuse buckets, multi-country provider coverage, and production delivery remain later work behind the same boundary; the provider is never an authentication identity.

### 4.5 Implemented contextual-registration draft boundary

The implemented `private.contextual_draft` stores a versioned, size-bounded action-only JSON payload under opaque internal and public identifiers. It rejects nested account, contact, password, token, and secret fields. The raw resume capability and intended email are never stored: only SHA-256 capability material and a per-draft salted normalized-email digest are retained. Server-only create and email-attach functions consume privacy-preserving rate-bucket keys; application actors have no direct table or draft-creation grant.

The protected `private.contextual_registration_profile` keeps display name, normalized phone, and preferred language outside the action JSON until account materialization. After passwordless Auth verifies the matching email, that Auth identity may claim the draft even before `app.account` exists. Claim is idempotent for that owner, cannot publish or complete the action, and exposes the action/profile only through an owner-scoped function. A protected link operation attaches the subsequently materialized application account for the same actor and clears the temporary profile. Expiry, cancellation, and internal atomic completion clear the payload, capability digest, profile, and remaining email material. The application uses an encrypted authenticated resume ticket rather than placing the raw database capability in a cookie or URL; magic-link callback state stays in a browser fragment until explicit confirmation so ordinary HTTP request logs do not receive it. Transport publication RPCs now exist, but contextual final review is not yet connected to them.

### 4.6 Implemented Core transport source boundary

The first transport migration materializes the canonical source side of the domain: a minimal church/service reference subset, passenger requests with one to three protected places, bounded regular driver series, and independent date-specific occurrences. Every protected mutation derives the actor from Auth, rechecks current participation eligibility, uses an actor-scoped idempotency key, and writes only through hardened functions. Base tables have forced RLS and no application-role grants. Anonymous projections omit account IDs, contacts, and exact labels; the authenticated private projection returns exact labels only for the current owner.

Until the explicitly later Maps phase, `private.user_place` contains bounded protected exact and public-area labels but no coordinate, provider, radius, or route claim. This is a compatible non-map Core representation, not a substitute for the approved 1 km stable area, protected coordinates, PostGIS indexes, or quality matching. The Maps campaign replaces it through a safe compatible migration. Browser-local prototype records are neither imported nor trusted. Responses, condition snapshots, agreements, capacity, cancellation, restoration, disclosure, lifecycle anonymization, and the configured Core application cutover are implemented through protected functions. The application requests contacts and exact meeting data only after an explicit participant action.

### 4.7 `private.recovery_case`

Stores only an allowed recovery type such as verified-phone replacement with available email or verified-email replacement with the previously verified phone, account, old/new contact references in protected form, state, prepare/execute identifiers, protective-delay deadline where applicable, verification result, session-revocation result, timestamps, and audit link. States are `prepared`, `contact_verification`, `delay`, `ready`, `executed`, `rejected`, `expired`, `cancelled`.

Loss of both verified contacts is not a recovery type. The old identity is never transferred to a claimant: the person creates a new account, while a protected support/owner-operation case may block the old account or resolve church-administration and complaint consequences without exposing its private ride history. No identity-document evidence model is introduced.

## 5. Churches, schedules, images, and administration

### 5.1 `app.church`

| Field | Key/rule | Classification |
| --- | --- | --- |
| `id` | PK UUID | System-only |
| `public_id` | Unique opaque identifier | Public |
| `slug` | Unique current slug; history table preserves redirects | Public |
| `official_name`, `source_language` | Required | Public |
| `description_source` | Optional; versioned through content source | Public |
| `address_display`, `locality`, `country_code` | Required after confirmation | Public |
| `place_id` | Optional; retain only where current provider terms permit | System-only |
| `location` | `geography(Point, 4326)`; required | Public church geography |
| `timezone` | Required IANA zone | Public |
| `status` | `draft`, `published`, `hidden`, `archive_requested`, `archived` | Public safe state/operational |
| `schedule_updated_at` | Derived/maintained timestamp | Public |
| `created_by`, `created_at`, `updated_at` | FKs/timestamps | Protected/system |

A deduplication constraint cannot rely on address text alone. Use a normalized address fingerprint plus a proximity check and protected exception workflow. A partial unique index applies to active/published records; archived records are restored rather than duplicated.

The internal `needs_administrator` condition belongs to a restricted operational case, not this public status field. Public responses translate any affected page state into approved plain-language availability and next steps.

### 5.2 `app.church_slug_history`

Unique `(church_id, slug)` plus global unique active slug. Supports safe redirects without exposing archived content.

### 5.3 `app.church_admin_membership`

| Field | Key/rule |
| --- | --- |
| `id` | PK |
| `church_id`, `account_id` | FKs; unique active pair |
| `status` | `active`, `transferring`, `ended` |
| `access_source` | `creator`, `invite`, `protected_repair` |
| `accepted_at`, `ended_at` | Lifecycle timestamps |

A protected constraint/function limits active memberships plus reserved invitations to three. Membership never grants access to ride contacts, exact user locations, responses, or agreements.

### 5.4 `app.church_admin_invite`

Fields: church, normalized invite email in protected form, sender, reserved slot, token hash, expiry, and state `pending`, `accepted`, `declined`, `cancelled`, `expired`, `no_slot`. Unique pending invite per church/email. Acceptance and transfer of a membership slot are atomic.

### 5.5 `app.service_series`, `app.service_occurrence`, and `app.service_exception`

`service_series` stores church, source name/type, weekly recurrence, local start, IANA time zone, start/end bounds, status, and version. `service_occurrence` represents a concrete service date/time when materialized or explicitly created, with unique `(church_id, source_series_id, local_date, local_start_time)` where applicable. `service_exception` changes or cancels a concrete date and increments the relevant version.

Ride records preserve a reference and an immutable date/time snapshot so schedule edits notify users but do not silently change agreements.

### 5.6 `app.church_image`

Stores church, opaque Storage object key for cleaned master, prepared variant manifest, media type, dimensions, checksum, attribution/rights statement, processing status, uploader, and lifecycle timestamps. Only one `current` image per church. The untouched upload is not retained.

## 6. Protected and public geographic data

### 6.1 `private.user_place`

| Field | Rule |
| --- | --- |
| `id` | PK UUID |
| `owner_account_id` | FK; required |
| `exact_location` | `geography(Point, 4326)`; required |
| `saved` | Boolean; a saved place lives until its owner deletes it and is independent of completed-ride exact-data retention |
| `normalized_address` | Optional, protected |
| `user_label` | Optional, validated against contacts/exact-address leakage |
| `source_kind` | `user_pin`, `user_confirmed_geocode`, `place_selection` |
| `provider_place_id` | Optional and retained only where permitted |
| `public_center` | Application-owned `geography(Point, 4326)` generated once |
| `public_radius_m` | Check: `1000` for V1 |
| `approximation_version`, `offset_seed_ref` | Required for stability/migration |
| `retention_due_at` | Nullable lifecycle hook |

Check or protected creation logic guarantees the exact point lies within the public circle. The public centre is deliberately not the exact point and must not allow the exact point to be inferred from repeated regeneration. The `api` public projection selects `public_center` and radius only.

### 6.2 No stored route geometry

There is no `driver_route_input` entity, no `public_route_corridor` entity, and no persisted provider route polyline. A public driver route is not a product concept, so no table represents one. The driver's public geography is only the stable approximate departure area derived from `private.user_place`.

Route calls are transient calculation steps. Where a derived match cache is technically justified it stores only privacy-safe derived facts — source entity and version identifiers, the selected compatible passenger place reference, verdict, added distance, added estimated time, and calculation timestamp/version — and never provider geometry.

### 6.3 Spatial indexes

- GiST on `church.location`.
- GiST on `user_place.exact_location` in the protected schema.
- GiST on `user_place.public_center` only where safe public proximity queries require it.
- Partial indexes limit active churches, requests, and occurrences.
- Exact-location joins never back a public view.
- pgRouting, a self-hosted street graph, and a second database are excluded.

## 7. Passenger requests

### 7.1 `app.passenger_request`

| Field | Key/rule |
| --- | --- |
| `id`, `public_id` | PK and unique opaque public ID |
| `author_account_id`, `church_id` | Required FKs |
| `service_occurrence_id` | Optional FK; otherwise custom date/time fields required |
| `desired_arrival_at`, `timezone` | Required absolute time and IANA zone |
| `total_passengers` | Positive integer; approved upper bound required before implementation |
| `children_count` | Integer `0..total_passengers` |
| `child_seat_required` | Required boolean when children > 0 |
| `return_required` | Required boolean |
| `public_note` | Optional controlled length; no contacts/links/exact address |
| `remaining_passengers` | Maintained atomically; check `0..total_passengers` |
| `status` | `draft`, `verification`, `active`, `partial`, `fulfilled`, `restore`, `cancelled`, `expired` |
| `terms_version`, `content_version` | Required publication evidence/change control |
| `published_at`, `closed_at`, `created_at`, `updated_at` | Lifecycle timestamps |

At most one active public request exists for the same author, church, occurrence/custom date, and explicit deduplication scope unless an approved remaining-need record requires otherwise.

### 7.2 `app.passenger_request_place`

Join table `(request_id, user_place_id, position)` with unique positions 1–3 and unique place per request. The place must belong to the request author. Public projections include only each stable approximate area.

## 8. Driver offers, series, and occurrences

### 8.1 `app.driver_offer_series`

Stores author, church, recurrence weekdays, local departure/arrival intent, time zone, eight-week bounds, total-seat default, maximum detour kilometres, child/seat capabilities, return availability, public note, series state `draft`, `active`, `change_pending`, `stopped`, `ended`, and content version.

Check constraints enforce an approved seat upper bound, non-negative detour from an approved set/range, at least one recurrence weekday, and a maximum eight-week active period. A series is not a capacity pool.

### 8.2 `app.driver_offer_occurrence`

| Field | Key/rule |
| --- | --- |
| `id`, `public_id` | PK and public ID |
| `series_id` | Nullable FK for regular offer; null for one-time offer |
| `author_account_id`, `church_id` | Required denormalized FKs checked against series/source |
| `service_occurrence_id` | Optional FK |
| `departure_at`, `arrival_at`, `timezone` | Concrete date-specific values |
| `origin_place_id` | Protected FK to the driver's exact departure place; public projections expose only its approximate area |
| `total_seats` | Positive integer within approved bound |
| `confirmed_seats` | Non-negative; default 0; check `confirmed_seats <= total_seats` |
| `max_detour_km` | Non-negative approved value |
| `children_allowed`, `driver_child_seat_available`, `return_available` | Required booleans |
| `status` | `draft`, `verification`, `active`, `full`, `cancelled`, `completed`, `expired` |
| `conditions_version` | Required optimistic/change control |
| lifecycle timestamps | Required |

Unique `(series_id, departure_at)` prevents duplicate series dates. A partial unique index prevents duplicate one-time occurrences from the same explicit publication operation. `available_seats` is exposed as a computed value `total_seats - confirmed_seats`.

## 9. Responses and condition snapshots

### 9.1 `app.ride_response`

One protected entity covers passenger-to-driver and driver-to-passenger directions.

| Field | Rule |
| --- | --- |
| `id` | PK UUID |
| `direction` | `passenger_to_driver` or `driver_to_passenger` |
| `passenger_account_id`, `driver_account_id` | Required distinct FKs |
| `passenger_request_id` | Required for open-request response; optional for a private contextual request only as approved |
| `driver_occurrence_id` | Required before final confirmation |
| `selected_request_place_id` | Required after driver chooses a meeting option |
| `offered_passenger_count` | Positive; cannot exceed request remaining need or occurrence availability at submission |
| `conditions_snapshot_id` | Required FK |
| `status` | `draft`, `await_driver`, `await_passenger`, `accepted`, `declined`, `withdrawn`, `expired`, `stale` |
| `expires_at`, lifecycle timestamps | Required |

Unique active-response constraints prevent the same actor pair/source/occurrence from creating concurrent semantic duplicates. Pending responses do not reserve seats or reveal contacts.

### 9.2 `app.ride_condition_snapshot`

Immutable structured fields capture church, occurrence/date, service/custom time, passenger count, selected approximate meeting area reference, detour, children/seat conditions, return flags, and source content versions. Exact location and contacts are referenced only through protected relationships, not copied into this row.

## 10. Agreements, capacity, and disclosure

### 10.1 `app.ride_agreement`

| Field | Key/rule |
| --- | --- |
| `id` | PK UUID; participant-private |
| `response_id` | Required FK; unique |
| `driver_occurrence_id` | Required FK |
| `passenger_request_id` | Required FK where sourced from public request |
| `driver_account_id`, `passenger_account_id` | Required distinct FKs |
| `confirmed_passenger_count` | Positive; immutable |
| `active_snapshot_id` | Required FK to immutable accepted conditions |
| `selected_exact_place_id` | Protected FK to the one passenger place chosen for this agreement; authorized only through the participant function. The passenger's other places are never disclosed |
| `driver_origin_place_id` | Protected FK to the driver's exact departure place; disclosed to the confirmed passenger through the same participant function |
| `status` | `confirmed`, `change_pending`, `cancelled`, `completed`, `outcome`, `no_outcome`, `archived` |
| `contact_visible_until`, `exact_data_delete_due_at` | Required lifecycle values after confirmation |
| `confirmed_at`, `cancelled_at`, `completed_at`, `archived_at` | Lifecycle timestamps |

Constraints:

- Unique `response_id` prevents two agreements from one accepted response.
- Unique logical confirmation key prevents a retry/double tap from duplicating an agreement.
- Participant IDs must match response actors and occurrence author.
- Confirmed count must match the accepted snapshot.
- An agreement cannot reference an occurrence from another church/date.
- `contact_visible_until` and `exact_data_delete_due_at` cannot exceed 30 days after the scheduled ride time; cancellation revokes access immediately.
- Capacity is changed only by protected confirmation/cancellation functions.

### 10.2 `app.agreement_condition_version`

Immutable versions preserve confirmed conditions. A change proposal creates a pending version; accepting it atomically replaces `active_snapshot_id`, while declining leaves the previous version active. Existing conditions remain authoritative during `change_pending`.

### 10.3 `private.agreement_contact_snapshot`

Stores agreement, participant account, verified email/phone values as of confirmation, creation time, visibility end constrained to no later than 30 days after the scheduled ride, deletion/anonymization time, and source verification timestamps. It is never joined into public, church-admin, email, push, analytics, or prefetched account responses.

The participant disclosure function returns only the counterparty snapshot for an eligible agreement and caller. Cancellation revokes future authorized retrieval immediately. Retention cannot erase data already seen or saved by a person.

### 10.4 `app.agreement_outcome`

Unique `(agreement_id, respondent_account_id)` with `happened_yes`, `happened_no`, or `no_answer`, recorded time, and later anonymization state. It does not create ratings or sanctions.

## 11. Notifications, Web Push, and durable dispatch

### 11.1 `app.notification`

Fields: recipient, event type, safe object route/type/ID, localization key, structured safe parameters, current outcome reference, read time, created time, and retention due. Parameters cannot contain contacts, exact coordinates/addresses, private notes, or full routes.

In-app notification history is always enabled and has no opt-out preference.

### 11.2 `private.notification_preference`

Exactly one account-level row per user:

| Field | Key/rule |
| --- | --- |
| `account_id` | PK/FK to `app.account`; one row per account |
| `ride_email_enabled` | Required boolean for ordinary transactional ride/activity email |
| `web_push_enabled` | Required boolean for Web Push eligibility at account level |
| `created_at`, `updated_at` | Required audit timestamps |

The row contains no email address, phone number, push endpoint, or device key. Users may read and change only their own ordinary notification preferences through an authorized application operation. Mandatory authentication, recovery, account-security, and legally required communications are outside these opt-out flags. The row follows the account lifecycle and is removed or anonymized with the account under the approved deletion policy.

### 11.3 `private.push_subscription`

One row per device subscription: account, endpoint ciphertext/protected value, key material, VAPID key version, device label where useful, permission state, last success/failure, created/revoked timestamps. Unique endpoint fingerprint prevents duplicates.

An account may have zero or more device subscriptions, but they count as an effective Web Push channel only when `notification_preference.web_push_enabled` is true and at least one subscription is active and valid.

### 11.4 `app.notification_delivery`

Fields: notification, channel (`email`, `web_push`), delivery state (`queued`, `claimed`, `sent`, `delivered`, `temporary_failure`, `permanent_failure`, `suppressed`), attempt count, next attempt, provider code/reference, safe failure class, timestamps, and unique `(notification_id, channel, destination_version)`.

### 11.5 `app.outbox_job`

Fields: job type, aggregate type/ID, payload reference, idempotency key, priority, state, attempt count, available time, lock owner/deadline, last safe error, and timestamps. Unique idempotency key prevents duplicate dispatch. Workers claim with `FOR UPDATE SKIP LOCKED` or equivalent, use bounded retries, and move exhausted jobs to a reviewable terminal state.

Signed webhook event IDs are unique in `ops.provider_webhook_receipt`; payloads are minimized and expired after diagnostics retention. Out-of-order events cannot move a delivery record backward from a terminal authoritative state.

### 11.6 Effective external-channel invariant

While an account has at least one relevant active transport commitment—an active passenger request, a relevant active/future driver occurrence, a pending response requiring attention, or a future confirmed agreement—the server requires at least one effective external notification channel:

- email is effective only when `ride_email_enabled` is true and the account has a usable verified email;
- Web Push is effective only when `web_push_enabled` is true and at least one active valid `push_subscription` exists.

The authorized preference-change operation evaluates current commitments and channel effectiveness together and rejects a user action that would leave none. A client-disabled toggle is not enforcement. Voluntary removal of the final valid push subscription is rejected when it would remove the last effective channel; the user may instead enable usable email in the same authorized flow. If a provider/browser later invalidates that subscription for an external or technical reason, the server marks it invalid without changing `ride_email_enabled` or `web_push_enabled`. It records an operational alert, warns the user through in-app history, and existing eligibility checks prevent new transport actions requiring an external channel until the user restores one. Existing rides and commitments remain intact, and mandatory authentication, recovery, account-security, and legally required email remains unaffected. The invalid subscription is never counted as effective.

## 12. Translation model

### 12.1 `app.content_source`

Stores object type/ID, field name, source language, original text, monotonically increasing source version, author/editor, and timestamps. Only approved church and schedule fields are eligible.

### 12.2 `app.content_translation`

Unique `(content_source_id, source_version, target_language)`. Fields: translated text, source (`machine`, `manual`), provider/model metadata, status (`pending`, `ready`, `error`, `stale`), created/updated time, and manual editor. A partial unique rule ensures at most one current manual correction per target. Source version changes mark previous automatic rows stale; manual corrections are never overwritten.

### 12.3 `app.translation_glossary_version`

Stores controlled Orthodox terminology glossary version, languages, checksum, effective time, and provider reference if uploaded. Ride-private content is never linked to translation jobs.

## 13. Complaints, blocking, audit, deletion, and owner operations

### 13.1 `app.user_block`

Unique active `(blocker_account_id, blocked_account_id)`, distinct accounts, created/ended timestamps. Protected eligibility/matching functions enforce blocks without revealing them to the blocked person beyond safe unavailable states.

### 13.2 `ops.complaint`

Fields: opaque case ID, target type/ID, reporter account or verified reporter-email reference, category, protected description, status (`received`, `reviewing`, `needs_information`, `resolved`, `closed`), decision/reason, legal-hold flag, retention due, and timestamps. Email receives only a safe case reference, not a full copied ride.

### 13.3 `ops.audit_event`

Append-oriented fields:

- PK and occurred time;
- actor account ID, protected operator ID, or system actor;
- action type;
- target type and ID;
- result;
- safe reason or support-case reference;
- request/operation ID;
- changed field names;
- transaction correlation ID;
- integrity/version metadata.

It excludes full email, phone, exact address/coordinate, private comment, OTP, token, secret, and full before/after payloads. Critical business rows and their audit event are inserted in the same transaction where practical.

### 13.4 `ops.owner_operation`

Stores prepare/execute lifecycle, operation type, safe target preview, target fingerprint, support reference, reason, short-lived token hash, expiry, prepared/executed actor, result, and audit event. No free-form SQL is stored or accepted.

### 13.5 `ops.deletion_request` and `ops.deletion_ledger`

`deletion_request` tracks re-authenticated account deletion, state, active-object closure, session/push revocation, anonymization steps, errors, and completion. `deletion_ledger` stores only a non-recoverable subject fingerprint, deletion version/time, affected backup scope, and reapplication status needed after restore. It contains no unnecessary personal data and is protected separately from ordinary backups.

### 13.6 `ops.retention_task` and legal hold

Retention tasks reference a record, policy code/version, due time, state, attempts, and result. A legal hold references only relevant records, reason, authority, review date, and release. Holds do not silently keep an entire account forever.

### 13.7 `ops.church_administration_case`

Stores church, case state (`needs_administrator`, `replacement_pending`, `archive_pending`, `resolved`), reason, support reference, current/future membership references, protected decision, prepared/executed owner operation, and audit links. It is used when support must resolve a final-administrator account deletion. The final active membership remains until a replacement is atomically assigned or the church is archived; then the membership ends and account deletion continues. The internal state is never exposed verbatim to ordinary users.

## 14. Idempotency and protected operation records

`app.idempotency_record` uses `(actor_id, operation_type, client_key)` as a unique key and stores request fingerprint, result object reference, status, and expiry. Reusing a key with a different request fingerprint fails. A matching retry returns the original result.

Protected provider calls may also use provider-specific idempotency keys derived from the durable outbox job, never directly from untrusted client text.

## 15. Status lifecycle summary

| Entity | States |
| --- | --- |
| Account | `email_verified` → `active` ↔ `restricted` → `deleting` → `deleted` |
| Passenger request | `draft` ↔ `verification`; `draft` → `active` ↔ `partial` → `fulfilled`/`restore`/`cancelled`/`expired` |
| Driver occurrence | `draft` ↔ `verification`; `draft` → `active` ↔ `full` → `cancelled`/`completed`/`expired` |
| Driver series | `draft` → `active` ↔ `change_pending` → `stopped`/`ended` |
| Response | `draft` → `await_driver`/`await_passenger` → `accepted`/`declined`/`withdrawn`/`expired`/`stale` |
| Agreement | `confirmed` ↔ `change_pending` → `cancelled`/`completed` → `outcome`/`no_outcome` → `archived` |
| Church | `draft` → `published` ↔ `hidden` → `archive_requested` → `archived` |
| Admin invite | `pending` → `accepted`/`declined`/`cancelled`/`expired`/`no_slot` |

State changes use controlled functions. Direct client updates of status, capacity, contacts, author/participant IDs, audit, or retention deadlines are prohibited.

## 16. RLS responsibility matrix

| Data group | Anonymous | Authenticated owner | Agreement participant | Church admin | Protected operator |
| --- | --- | --- | --- | --- | --- |
| Published churches/schedules | Safe read | Safe read | Safe read | Safe read | Safe read |
| Active safe ride projections | Safe read | Safe read | Safe read | Safe read only | Safe protected lookup |
| Own drafts/requests/offers | None | Own rows through functions | Own relation only | No inherited ride access | Safe protected lookup only when operation requires |
| Responses | None | Only actor/recipient | Only actor/recipient | None | Case-scoped protected lookup |
| Agreements | None | Only if participant | Both participants | None unless personally a participant | No default access; explicit case-scoped function |
| Exact places and contacts | None | Own values | Counterparty only through an eligible agreement function before cancellation and within the 30-day maximum | None | No default access; dispute-scoped legal hold does not create participant access |
| Church editing | Read only | None unless member | None unless member | Own churches through membership | Protected repair function |
| Notifications/preferences/subscriptions | None | Own history; own ordinary preferences and device subscriptions only through authorized flows | Own only | Own only | Delivery diagnostics without content where possible; no ordinary preference override |
| Complaints/audit/deletion/abuse | None | Own safe complaint status only | No inherited access | No inherited access | Protected least-privilege operations |

RLS is required on every application-accessible table, but RLS alone is not enough. Schema privileges, column omission, protected functions, server validation, and response-shape tests form defence in depth.

## 17. Protected database functions and atomic operations

Architectural function responsibilities:

- `api.current_eligibility()` — verified email/phone, adult declaration, current Terms, account status.
- `api.publish_passenger_request(...)` — validate ownership, places, eligibility, deduplication, safe content, notifications, audit.
- `api.publish_driver_occurrence(...)` and series materialization — create date-specific capacity safely.
- `api.submit_ride_response(...)` — validate actors, active sources, blocks, time, compatibility, and safe snapshot.
- `api.confirm_ride_response(...)` — lock/re-check state and capacity; create one agreement; consume seats; authorize disclosure; create notifications/outbox/audit; idempotent result.
- `api.cancel_agreement(...)` — return seats once; update remaining need; revoke disclosure; notify/audit atomically.
- `api.propose_agreement_change(...)` / `api.resolve_agreement_change(...)` — preserve active snapshot until accepted.
- `api.get_agreement_contacts(agreement_id)` — verify caller, participant pair, state, and visibility deadline; return only counterparty snapshot.
- `api.update_notification_preference(...)` — update only the caller's ordinary email/push preferences after enforcing the effective-external-channel invariant against active commitments and valid subscriptions.
- `api.replace_church_image(...)` — verify current church membership and storage object processing state.
- `api.accept_church_admin_invite(...)` — verify email/account, reserved capacity, eligibility; accept/transfer atomically.
- `ops.prepare_owner_operation(...)` / `ops.execute_owner_operation(...)` — fixed operation types, safe preview, one-time token, least privilege, audit.
- `ops.resolve_church_administration_case(...)` — atomically assign a justified replacement or archive the church, end the old final membership, and release support-assisted account deletion.
- `ops.claim_outbox_jobs(...)` and `ops.complete_outbox_job(...)` — bounded leasing and idempotent delivery state.
- `ops.apply_retention_batch(...)` — approved policy/version, legal-hold check, minimized audit result.

Implementation migrations must define exact signatures, volatility, ownership, `search_path`, grants, timeouts, and concurrency tests.

## 18. Capacity and concurrency invariants

1. `driver_offer_occurrence.confirmed_seats` is between zero and `total_seats`.
2. Only confirmed, non-cancelled agreements consume capacity.
3. A confirmed agreement count is immutable; a material count change creates a new approved snapshot and atomic capacity delta.
4. Cancellation applies its seat return once, guarded by state and unique audit/idempotency records.
5. Pending responses and notifications consume no seats.
6. A regular series never pools capacity across dates.
7. Confirmation locks the occurrence row or uses a single conditional update checked for success.
8. Unique `response_id` and idempotency keys prevent semantic duplicates.
9. Database tests must simulate two transactions attempting the last seat and verify exactly one succeeds.

## 19. Public projections

The `api` schema exposes purpose-built projections rather than base tables:

- `api.published_church` and schedule projection;
- `api.active_passenger_request` with safe name/counts, time, structured conditions, and approximate areas only;
- `api.active_driver_occurrence` with safe name, capacity, structured conditions, and the approximate departure area only;
- `api.safe_completed_activity` with aggregate non-sensitive fields only;
- account-owned lists without counterparty protected fields;
- participant agreement summary, with a separate contact-disclosure function.

Public transport content is excluded from indexable page metadata and structured data even though anonymous visitors may view it in the application. Closed public IDs return a safe unavailable state without historical places or comments.

## 20. Retention and lifecycle hooks

Creation or state transitions set policy codes and `retention_due_at` values rather than hard-coding deletion logic in UI code. Jobs cover:

- incomplete contextual forms;
- expired/cancelled unmatched exact places;
- agreement contact visibility and exact-place deletion/anonymization;
- notification and provider diagnostic expiry;
- technical/audit/complaint policies;
- church image replacement cleanup;
- deleted-account anonymization;
- backup deletion-ledger reapplication.

Participant access to the disclosed exact locations and contact snapshots ends immediately on cancellation or no later than 30 days after the scheduled ride time. The applicable exact ride geodata is then deleted or irreversibly anonymized under the approved retention policy. A user's own saved place is governed by the separate saved-place rule and lives until its owner deletes it; ride-disclosure expiry never silently removes it. A separately restricted legal hold for an already existing dispute may preserve only necessary evidence; it does not extend participant access or create a generic retention period.

## 21. Backup and restore relationships

Database exports contain Storage object metadata and checksums, not the objects themselves. A backup manifest links:

- database archive checksum and schema migration version;
- Storage object keys/checksums;
- encryption key version reference;
- backup time and source environment;
- retention class;
- deletion-ledger watermark;
- integrity and restore-test result.

Restore order is isolated database, Storage objects, provider-independent configuration, integrity checks, deletion-ledger reapplication, security review, then traffic. Provider delivery jobs restored from backup are reconciled by idempotency keys before dispatch so old notifications are not sent again.

## 22. Migration from prototype entities

There is no row-level import from browser storage. Conceptual mapping only:

| Prototype concept | Target concept |
| --- | --- |
| Local driver profile | Supabase identity + `app.account` + protected contact |
| Local Route | `driver_offer_series` + date-specific occurrences |
| Local Trip | One `driver_offer_occurrence` |
| PassengerRequest | `passenger_request` + protected place joins |
| DriverResponse/targeted request | `ride_response` + immutable condition snapshot |
| RideMatch | `ride_agreement` + condition/contact snapshots |
| MockNotification | `notification` + `notification_delivery` + `outbox_job` |
| Browser ownership ID | Authenticated account FK and RLS/function authorization |
| Browser seat calculation | Transactional occurrence capacity |

Synthetic staging seeds and migrated test scenarios prove behavior. Browser-generated IDs, contacts, ownership, confirmations, and capacity have no production provenance and are discarded.

## 23. Pre-migration decisions

Before the remaining executable target domain migrations are written, owner/legal/security review must approve:

- technical upper bounds for passenger counts, seats, note lengths, and detour values;
- protective delay and verification policy for email replacement while the previously verified phone remains available;
- remaining retention-policy values within the approved 30-day maximum, including the short cancelled-data cleanup period and dispute-scoped legal holds;
- provider content versus application-owned and user-confirmed data boundary, resolved in favour of open-licensed Geoapify data;
- phone verification provider coverage and fallback;
- the remaining exposed schema/function list and complete RLS matrix beyond the implemented account/eligibility boundary;
- backup encryption/key custody and deletion-ledger protection;
- support-case and protected-operator authentication process.

## 24. Approval status

This logical model is approved as the canonical target model for Backend and Integration Architecture V1. It intentionally stops before a complete executable target schema, remaining domain migrations, production legal-document seeds, provider configuration, or remote infrastructure. Versioned local migrations and the configured application mode now materialize the approved Auth-linked account/eligibility, contextual registration, and Core transport/response/agreement subset described above; Maps and later target entities remain unimplemented. The model's approval completes the backend and integration architecture roadmap phase alongside the approved architecture document, but it does not authorize implementation of later phases.
