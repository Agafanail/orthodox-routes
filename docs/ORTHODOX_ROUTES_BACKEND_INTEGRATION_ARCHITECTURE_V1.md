# Orthodox Routes — Backend and Integration Architecture V1

- **Status:** approved
- **Date:** 6 August 2026
- **Scope:** target production architecture for the first complete public version
- **Implementation state:** the version-controlled local Supabase/PostgreSQL migration foundation, local-only passwordless email identity/session slice, backend-only account/consent/eligibility and provider-independent phone-verification foundations, and protected contextual-registration application foundation are implemented; no remote service, production email/SMS, production legal document, transport backend, provider integration, or remaining target domain schema is configured

## 1. Purpose and authority

This document turns the approved product behavior into an implementable production architecture. It selects technologies and defines security, privacy, release, cost, and operational boundaries. It does not authorize implementation or a later roadmap phase.

Authority order:

1. [Product Scope V1](ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md) controls product purpose and first-version boundaries.
2. [Information Architecture V2](ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md) controls target screens, routes, roles, permissions, journeys, states, visibility, taxonomy, content, and transitions.
3. [Design System V2](ORTHODOX_ROUTES_DESIGN_SYSTEM_V2.md) controls the canonical approved visual system and supersedes archived V1; production UI adoption is separate.
4. This document controls the selected target backend and integration architecture within those boundaries.
5. [Target Data Model V1](ORTHODOX_ROUTES_TARGET_DATA_MODEL_V1.md) is the canonical target logical model for this architecture.
6. Code, tests, and `README.md` describe what is implemented now.
7. `DATA_MODEL.md`, `PROJECT_MAP.md`, `UX_RULES.md`, and `PROJECT_SPEC_V0_1.md` remain prototype or historical references unless a clearly labelled target section says otherwise.

If Product Scope and IA V2 conflict, implementation pauses until the owner resolves the conflict. This architecture must not choose a product rule independently.

## 2. Current and target architecture

### 2.1 Current implementation

The transport application remains a browser-only Next.js mock prototype. Static mock data and namespaced `localStorage` demonstrate passenger requests, driver offers, responses, confirmations, capacity, cancellations, and notifications within one browser. There is no production backend, real transport-data isolation, map integration, transactional email, SMS verification, Web Push, production storage, or administration backend.

Current browser behavior is evidence for reusable domain rules and tests, not a production trust boundary or a source of production data.

The repository contains a local-only Supabase/PostgreSQL configuration and versioned migrations that create the `app`, `private`, `api`, and `ops` foundation schemas plus the Account & Eligibility Foundation. CI replays committed migrations from a clean local database. The local-only passwordless email Auth slice uses Supabase-managed `auth.users`, an explicit token-hash confirmation action, SSR cookies, verified `getClaims()` identity resolution, and current-session sign-out. A separate narrow authenticated API explicitly materializes `app.account` only for the current verified identity, derives protected email, stores optional unverified E.164 phone data, records the 18+ declaration and version-specific Terms acceptance, and evaluates structured participation eligibility from authoritative data. The application-owned phone-verification foundation adds idempotent attempts, versioned expiry/resend/attempt policy, transient restricted delivery material, a least-privilege worker contract with no application-role grant, and atomic race-safe verified-phone binding. No production legal document or external SMS provider is configured, so an ordinary local active account remains ineligible through the current UI. The implementation does not connect transport data to the identity, configure a remote Supabase project, or send external email/SMS.

### 2.2 Selected target

The target remains one Next.js App Router application:

- Render hosts the production Next.js web service in Frankfurt.
- Next.js owns the UI, server-rendered behavior, route handlers, protected server actions, integration adapters, worker endpoints, and operational endpoints.
- Supabase provides managed PostgreSQL, PostGIS, Auth, Storage, optional Realtime delivery, and database-owned scheduling.
- PostgreSQL is the source of truth for accounts, product state, authorization relationships, notifications, jobs, audits, and retention state.
- External providers are called through narrow application-owned adapters.
- Vercel Hobby may provide temporary non-commercial previews during development and review, but is not canonical production hosting.

No separately deployed backend language, microservices, Kubernetes, self-managed virtual machines, Redis, dedicated queue service, or multi-cloud runtime is selected for the first full version.

## 3. Architecture principles

1. **One deployable application.** Keep the operational surface small enough for one non-technical owner working through reviewed Git changes.
2. **PostgreSQL owns durable truth.** Realtime, email, push, and provider callbacks never replace authoritative rows.
3. **Server and database enforce access.** UI hiding is not authorization.
4. **Privacy by response shape.** Public queries and payloads never contain protected fields that the client merely hides.
5. **Atomic business transitions.** Confirmation, capacity, disclosure authorization, cancellation, notifications, and audit records change together.
6. **Idempotent external effects.** Retries and duplicate provider webhooks cannot create duplicate business outcomes.
7. **Replaceable integrations.** Provider identifiers stay at adapter boundaries; domain tables store only safe references and results.
8. **Low fixed cost with explicit risk.** Free plans are acceptable only with documented limits, hard usage controls, backups, and upgrade triggers.
9. **Versioned operations.** Schema, permissions, functions, jobs, and seeds change through reviewed migrations in Git.
10. **No production access for Codex.** Codex prepares reviewed code and commands; it does not receive production secrets, dumps, or unrestricted database access.

## 4. Selected stack and rejected alternatives

| Concern | Selected target | Reason |
| --- | --- | --- |
| Web and server | Next.js App Router on Render | One codebase, server-side authorization, Frankfurt region, low operational burden |
| Database | Supabase managed PostgreSQL | Relational consistency, transactions, constraints, RLS, manageable operations |
| Spatial data | PostGIS | Application-owned coordinates, GiST indexes, proximity filtering |
| Account identity | Supabase Auth email magic links | Passwordless verified-email identity and remembered sessions |
| Phone verification | Application adapter; Bird first candidate | International testing without coupling the account model to one SMS vendor |
| Email | Resend, including Supabase custom SMTP | One transactional channel with webhook support and tracking disabled |
| Maps and routing | Google Maps, Places/Geocoding, Routes | One embedded map system and route-quality validation |
| External navigation | Google Maps and Yandex Maps links | User choice after confirmation without a second embedded map architecture |
| Files | Supabase Storage | One church photograph plus cleaned prepared variants |
| Translation | Google Cloud Translation adapter | Stored translations, glossary support, replaceable provider boundary |
| In-app refresh | Supabase Realtime, optional | Convenience only; durable rows remain authoritative |
| Durable dispatch | PostgreSQL outbox plus protected worker endpoint | No separate queue service at launch |
| Web Push | Standard Web Push with VAPID | Browser standard, per-device subscriptions, no unnecessary push vendor |
| Bot protection | Cloudflare Turnstile plus server limits | Low-cost abuse resistance without advertising tracking |
| Coarse web analytics | Cloudflare Web Analytics | Privacy-first traffic and performance view |
| Technical errors | Sentry EU data region | Error monitoring with aggressive data scrubbing and no replay |
| Uptime | Better Stack | Independent health and backup-heartbeat monitoring |
| Backups | Encrypted PostgreSQL and Storage exports to Backblaze B2 EU | Independent recovery path outside Supabase |

Rejected alternatives are not inherently unsuitable; they add costs or burdens that do not fit this version:

- Firebase/Firestore is not selected because confirmation, occurrence capacity, relational constraints, auditing, and protected joins fit PostgreSQL transactions more directly.
- A backend in another language would duplicate deployment, security, and maintenance responsibility.
- Self-managed servers, microservices, and Kubernetes exceed the operational needs of one small application.
- Redis and a dedicated queue add another durable system before measured load demonstrates a need.
- Vercel Hobby is limited to personal or non-commercial use and is therefore a preview tool, not the canonical commercial production host.
- Two embedded map providers duplicate UI, privacy review, billing, and route semantics. Yandex remains an external navigation choice only.
- Public OpenStreetMap infrastructure is not a production service with the required owned capacity and support guarantees; using it directly would transfer operational risk rather than remove it.
- A full platform-owner dashboard expands the attack surface and product scope for rare operations.
- Direct production-table editing is unauditable and too error-prone.
- Existing browser data lacks trustworthy identity and provenance and will not be imported.
- Ratings, chat, payments, and other excluded features do not belong in the architecture.

## 5. Component responsibilities and trust boundaries

### Browser

- Renders public and authenticated UI.
- Holds only short-lived UI state, harmless preferences, and unsubmitted local drafts.
- Uses restricted public map credentials only for approved browser APIs.
- Never receives Supabase privileged keys, Resend/Bird/Translation secrets, unrestricted database credentials, full contact tables, exact route data for unauthorized users, or operational audit records.

### Next.js server

- Resolves the authenticated actor and re-checks eligibility.
- Validates input into explicit domain shapes.
- Calls protected database functions for atomic transitions.
- Produces separate public, account-private, participant-private, church-admin, and operational response shapes.
- Calls integration adapters and verifies signed webhooks.
- Exposes protected worker, health, and owner-operation endpoints.
- Uses narrowly scoped server credentials; normal user actions do not use a universal privileged key.

### PostgreSQL and PostGIS

- Store authoritative state and protected relationships.
- Enforce foreign keys, checks, unique constraints, RLS, grants, and atomic functions.
- Lock or atomically update occurrence capacity.
- Store notification and outbox rows in the same business transaction where practical.
- Store exact application-owned coordinates separately from public approximate representations.

### External providers

- Receive the minimum data required for a specific operation.
- Never determine a final product state without a verified, idempotent application transition.
- Return provider references and delivery results; payloads are not copied wholesale into the database.

## 6. Environments and deployment

| Environment | Compute | Data | Secrets and providers |
| --- | --- | --- | --- |
| Local | Local Next.js and temporary local PostgreSQL/Supabase when useful | Synthetic only | No production secrets; sandbox/test credentials only |
| Staging | Temporary preview deployment | Dedicated Supabase project; synthetic accounts, churches, contacts, rides, and locations; no production copy | Separate keys, callbacks, and provider test modes or subprojects where practical |
| Production | Render web service in Frankfurt | Separate Supabase project | Separate domains, keys, secrets, callbacks, provider accounts/subprojects, quotas, and alerts where practical |

The owner has accepted launching staging and production as two isolated Supabase Free projects. This accepts possible inactivity pausing, no Free-plan production SLA, and no native automatic backup entitlement. Production must never be used as a development database.

### Deployment rules

- Application deployments may follow reviewed merges to `main`, but a successful build is not permission to run a production migration.
- Production migrations run only through an explicit protected action with an identified migration range, reviewed plan, fresh external backup, and recorded result.
- Provider configuration remains an owner-controlled operational step and is not created by ordinary application deployment.
- Health endpoints expose no secrets. `/health/live` answers process health; `/health/ready` checks only bounded critical dependencies and reports coarse states.

## 7. Migrations and release safety

- Every schema, grant, RLS policy, function, trigger, index, cron job, and seed change is a versioned migration in Git.
- Supabase Studio is not used for undocumented production schema changes.
- CI validates migrations from an empty database and against representative staged upgrade data.
- Release order is expand, deploy compatible application code, backfill or verify, then contract in a later explicit migration.
- Destructive migrations require a documented recovery decision. Rolling back application code does not reverse a destructive database migration.
- A pre-migration encrypted external backup is mandatory.
- Migration audit records include migration identifier, commit, actor, time, result, and safe failure summary.

## 8. Authentication, eligibility, and recovery

### Email identity and sessions

- The canonical sign-in identity is a verified email managed by Supabase Auth.
- Passwordless magic links use a confirmation page with an explicit user action before the final one-time token is consumed. This reduces failures caused by automated email link scanners.
- A remembered device keeps a session. A new link is required on a new device/browser, after sign-out, after site-data deletion, after global revocation, or for selected sensitive actions.
- Supabase production email uses Resend custom SMTP. Open and click tracking stay disabled because link rewriting can break auth links and adds unnecessary tracking.

### Phone and participation eligibility

- Phone is a separately verified protected contact, not a second Supabase login identity.
- Publishing offers, requests, responses, confirmations, or church pages requires verified email, verified phone, recorded 18+ declaration, current Terms acceptance, and an account state that permits the action.
- Public viewing remains anonymous.
- Contextual registration stores an incomplete action and returns the user to a final review; verification never publishes automatically.

### Recovery and sensitive changes

- Available email: request a new magic link.
- Lost phone with available email: require recent re-authentication, verify the replacement phone, notify affected contacts, and record the change.
- Lost email with available verified phone: verify the old phone, confirm the replacement email, apply a configurable protective delay, notify old and new contacts, revoke old sessions, and audit the result.
- Lost email and phone: the old personal account is not recovered. The person creates a new account. After protected support review, the old account may be blocked where appropriate, and protected owner operations may resolve church administration, complaints, or other operational consequences without transferring the old identity, private ride history, contacts, or account access to the claimant.
- Email change, phone change, account deletion, recovery, and comparable operations require recent re-authentication.
- After takeover recovery, revoke all existing sessions and device subscriptions safely.

Identity-document verification or another both-contact-loss recovery mechanism is outside Product Scope and is not introduced by this architecture.

All applicable recovery/contact-change delays, link lifetimes, resend delays, and attempt limits are named security-policy configuration values, not scattered literals.

## 9. Authorization and data classification

Authorization is enforced twice: protected Next.js operations determine the intended action and PostgreSQL RLS/grants/functions enforce the data boundary.

Authoritative roles and permissions are not stored in user-editable auth metadata. Passenger and driver are actions in a ride. Church administration is a protected `church_admin_membership` relationship. Platform-owner access is a separate operational identity and is not an ordinary all-seeing application role.

| Class | Examples | Permitted delivery |
| --- | --- | --- |
| Public | Published church and schedule; active safe ride cards; safe names/counts; stable approximate areas/corridors | Anonymous public views and pages |
| Participant-private | Confirmed agreement snapshot; exact agreed meeting point; counterparty contacts during authorized visibility | Protected participant operation after checking both caller and agreement |
| User-private | Verified email/phone; exact proposed locations; notification preferences/subscriptions; recovery state | Account owner and narrowly scoped system functions |
| Operationally restricted | Complaints; abuse controls; audit; deletion ledger; provider references; owner-operation state | Protected operational functions only |

Private data is omitted from public response shapes, logs, analytics, email, push, search markup, and client prefetch. Sensitive schemas are not broadly exposed by the Supabase Data API. Views exposed to application roles use explicit grants and `security_invoker` where appropriate.

## 10. Confirmation, capacity, cancellation, and contact disclosure

Every real date of a recurring driver series is a separate `driver_offer_occurrence` with independent total and confirmed capacity. Every agreement belongs to exactly one occurrence.

The protected confirmation function performs one transaction:

1. Resolve and authorize the actor.
2. Lock the response and occurrence or perform an equivalent atomic conditional update.
3. Re-check response state, church, occurrence/date, conditions snapshot, passenger count, both accounts' eligibility, blocks, and remaining capacity.
4. Reject duplicates through a unique idempotency key and agreement-source constraint.
5. Insert the immutable confirmed agreement snapshot.
6. Increase confirmed capacity once and enforce `0 <= confirmed_seats <= total_seats`.
7. Change the response and affected request states.
8. Authorize participant contact disclosure as a consequence of the confirmed agreement.
9. Insert notifications, outbox jobs, and audit entry.
10. Commit and return the original result for an idempotent retry.

Contacts are never copied to public offers, requests, or responses and are never preloaded for visual hiding. A protected contact operation checks that the caller is one of the two participants, the agreement is eligible, and the visibility period is active. Church administrators receive no inherited access. Both participants use the same confirmed-state rule.

Cancellation atomically changes agreement state, returns seats exactly once, restores or makes remaining need eligible according to Product Scope/IA rules, creates notifications, and writes audit history. It does not depend on a disabled browser button. Authorized access is revoked immediately, but documentation cannot promise to erase information already seen or saved by the other participant.

## 11. Maps, geographic privacy, and quality matching

### Provider boundary

- Google Maps is the only embedded map provider.
- Places/Geocoding supports church discovery and user-confirmed address/place selection.
- Routes is called server-side for temporary route and detour validation.
- PostGIS stores application-owned exact coordinates, public approximate geometry, spatial indexes, and candidate filters.
- Google and Yandex external navigation links are offered only after confirmation. Russia may default to Yandex first while preserving a user/device choice.

Exact user locations never enter anonymous HTML, public API responses, public map payloads, analytics, or logs.

### Public approximate area

The application generates a stable one-kilometre area from an application-owned, user-confirmed exact point:

- generate a random offset once inside the permitted radius;
- persist the offset seed/version and public centre;
- guarantee that the exact point remains inside the public area;
- reuse the same representation until the protected point changes;
- never recalculate a different circle on every view.

### Public corridor

The exact driver route remains private. The permanent public corridor is generated from application-owned inputs such as the stable approximate origin area, user-supplied intermediate localities/landmarks, church location, and a versioned application approximation algorithm. Google route geometry is not edited, simplified, stored, or republished as a permanent public corridor.

Google results are temporary quality-validation inputs subject to the then-current retention, display, attribution, caching, and derivative-content terms. Place IDs are retained only where permitted; provider payloads are not stored wholesale. The boundary between user-confirmed coordinates and Google Maps Content requires a fresh contractual review before implementation and must not be presented as settled legal interpretation.

### Two-stage matching

1. PostgreSQL/PostGIS selects candidates with the same church and occurrence/date, one-hour compatibility, sufficient capacity, child/seat compatibility, active states, and broad proximity to the application-owned corridor.
2. Google Routes validates only the best candidates by comparing the baseline route with the route through the proposed meeting point and calculating added distance/time against the driver's approved detour.

Provider responses are cached only when current terms permit and are invalidated when relevant inputs or terms change. Existing agreements, contact access, and cancellation remain usable during map-provider outages.

### Cost and key controls

- Separate Google Cloud projects and credentials per environment.
- Separate browser and server keys with application and API restrictions.
- Enable only required APIs.
- Set per-API quotas below financially dangerous levels and add application-side per-user/network limits.
- Add billing budgets and alerts, understanding that budget alerts do not stop spend.

## 12. Notifications, email, Web Push, and PWA

`notification` rows are the complete, always-enabled in-app history. `private.notification_preference` stores one account-level choice for ordinary transactional ride/activity email and one for Web Push. It does not store contact values or device endpoints. `notification_delivery` records channel attempts, `outbox_job` stores durable dispatch work, and `private.push_subscription` stores zero or more device-specific Web Push subscriptions.

The business transaction inserts:

- the notification;
- a privacy-safe structured payload reference;
- one or more `notification_delivery` rows;
- durable `outbox_job` rows.

Supabase Cron or an equivalent database-owned schedule calls a protected Next.js worker endpoint. Workers claim jobs using database locking, use idempotency identifiers, retry with bounded exponential backoff, and dead-letter permanently failed jobs for review. Signed webhooks update delivery state idempotently and tolerate duplicates and out-of-order arrival.

Priority order is authentication/account security, confirmation/cancellation/material ride change, then optional reminders. User preferences apply only to ordinary ride/activity email and Web Push. Authentication, recovery, account-security, and legally required email remain mandatory and cannot be disabled by these preferences. Email contains no counterparty phone/email, exact coordinate/address, private comment, or full route. Resend open and click tracking remain disabled.

Web Push uses VAPID and one subscription per device. Push payloads contain only a generic event type, notification identifier, and safe application route. They never contain contacts, exact places, or private ride details. Permission is requested only after a meaningful action and explicit gesture. On iPhone/iPad, installation to the Home Screen is explained first; installation and permission remain separate voluntary steps. Ordinary ride email can serve as the user-selected fallback external channel when it is enabled; technical push unavailability never changes the saved preference automatically.

The server enforces the approved effective-external-channel rule. While an account has a relevant active transport commitment—using the existing active request, relevant active/future driver occurrence, pending response, or future confirmed agreement states—it must have at least one effective external channel. Email is effective only when ordinary ride email is enabled and the account has a usable verified email. Web Push is effective only when the account preference is enabled and at least one active valid device subscription exists. Preference changes that would leave neither channel are rejected server-side.

Device removal and subscription invalidation preserve user intent. The server rejects a voluntary removal or preference change when it would remove the last effective external channel during relevant active commitments; the user may instead enable usable email in the same authorized flow. If a provider/browser later invalidates the final active push subscription for an external or technical reason, the server marks that subscription invalid but does not change `ride_email_enabled` or `web_push_enabled`. It warns the user in-app, records an operational alert, and existing eligibility checks prevent new transport actions requiring an external channel until the user restores one. Existing rides and commitments remain intact. A preference flag without a valid subscription never counts as Web Push availability. Mandatory authentication, recovery, account-security, and legally required email remains unaffected.

The ride business transaction commits its authoritative notification and outbox rows before external delivery. Email or push failure is retried and recorded but never rolls back confirmation, cancellation, capacity, or another underlying ride transition.

Offline support is limited to the application shell, an understandable offline state, and local form drafts. Recovered drafts are never published automatically. Confirmation, cancellation, disclosure, capacity, and current ride state require the server.

## 13. Church images and translation

### Images

- One public church photograph plus a cleaned master and a small prepared set of sizes are stored in Supabase Storage.
- Accept only approved raster formats; SVG is rejected.
- Verify actual file signatures, image dimensions, and input size; normalize orientation; remove EXIF and geolocation; re-encode before storage.
- Do not retain the untouched upload.
- Only a current administrator of that church can replace the image.
- Opaque object paths and authorization are independent of human filenames.
- Database references and Storage objects are both backed up.
- Prepared variants are generated by the application because Free-plan image transformations are not assumed.

### Translation

- English, Russian, Italian, Romanian, Ukrainian, and German system translations live in Git.
- Google Cloud Translation is called through an adapter only for approved dynamic church content.
- Store original language/text permanently and version the source.
- Store each translation with target language, source version, provider/model metadata where useful, status, and timestamps.
- A manual correction overrides automatic output and is never silently overwritten.
- Source edits mark translations stale; failures show the original and do not block publication.
- UI provides “Show original” and a clear automatic-translation label.
- Maintain a controlled Orthodox terminology glossary.
- Never send ride comments, complaints, contacts, exact places, or private agreement content for translation.

## 14. Analytics, monitoring, and audit

Cloudflare Web Analytics provides coarse privacy-preserving traffic and performance information. Do not add Google Analytics, Meta Pixel, advertising identifiers, session replay, heatmaps, advertising cookies, or unnecessary click-level events.

Product outcomes are computed from first-party operational rows: offers, requests, responses, confirmed agreements, cancellations, reported completed rides, repeat use, and failed matches with safe structured reasons. Long-term statistics are aggregated without direct identifiers, contacts, exact locations, free comments, or revealing low-count breakdowns.

Sentry uses its Germany data region for technical errors only. Disable session replay and screenshots; do not capture request bodies or form content; scrub IP addresses, emails, phones, coordinates, addresses, tokens, and sensitive fields before sending. Technical diagnostic retention defaults to 30 days pending legal review.

Better Stack independently monitors liveness, readiness, and backup heartbeats. Provider failures and outbox backlog have operational alerts.

The append-oriented `audit_event` records agreement/cancellation, material ride changes, contact changes, recovery, blocking/restoration, deletion, church lifecycle, admin membership, complaint decisions, protected owner operations, and production migrations. It stores time, actor/system identifier, action, target, result, safe reason/support reference, request/operation ID, and changed field names—not full sensitive before/after values.

## 15. Retention, deletion, backup, and restore

The following are proposed engineering defaults requiring legal review before launch:

| Record | Proposed policy |
| --- | --- |
| Local drafts | 30 days inactivity |
| Incomplete server contextual forms | Up to 7 days |
| Unmatched cancelled/expired exact locations | Access closes immediately when applicable; delete or irreversibly anonymize within the approved short period, never later than 30 days |
| Confirmed-agreement contact visibility | Until cancellation or no later than 30 days after scheduled ride time |
| Confirmed exact meeting location and protected route data | Until cancellation or no later than 30 days after scheduled ride time; then delete or irreversibly anonymize |
| User-visible agreement history | 24 months |
| Ordinary / security notifications | 12 / 24 months |
| Provider delivery diagnostics | 90 days |
| Technical errors | 30 days |
| Security/auth logs | 12 months |
| Important ride audit | 24 months |
| Owner and complaint audit | 36 months |
| Terms/Privacy acceptance evidence | Account lifetime plus legally reviewed post-deletion period |

Current operational records, participant-visible history, restricted audit history, and fully anonymized aggregates are separate layers. A legally required hold may preserve only evidence relevant to an already existing dispute in a separately restricted process. It never extends participant access and never becomes the default retention period for all rides.

Account deletion requires recent re-authentication, closes public items, safely cancels future agreements, revokes sessions and push subscriptions, immediately hides public data, removes or anonymizes contacts/exact places/recoverable identifiers, and retains only minimum anonymous structure needed for other participants, capacity integrity, audit, and legal defence. A neutral deleted-user label replaces the name where needed.

The normal voluntary-exit and self-service deletion flow does not let the final church administrator abandon the last position. The user is asked to appoint a replacement or contact support. In a support-assisted deletion, the account is not retained indefinitely: support first places the page into a restricted operational `needs_administrator` case, then uses a protected owner operation to assign an appropriate replacement when justified or archive the page when appropriate. The old membership is removed only after the page is resolved, and personal account deletion then continues. Ordinary users receive plain-language status and next-step copy, never the internal case-state name.

### Backup design

- Daily encrypted PostgreSQL logical export to a separate Backblaze B2 EU bucket.
- Daily or change-aware export of Supabase Storage church-image objects and manifest.
- Extra backup immediately before production migration.
- Client-side encryption before upload; encryption and B2 credentials are separate from application credentials.
- Proposed retention: daily 30 days, monthly 12 months, pre-migration 30 days.
- Verify archive integrity and record a heartbeat after each run.
- Perform a documented full restore before launch and at least quarterly.
- Maintain a minimal separately protected deletion ledger and reapply it before reopening a restored system.
- Proposed RPO is up to 24 hours at launch; RTO is one working day until a measured rehearsal provides a better value. Do not promise zero loss or zero downtime.

Supabase database backups do not include Storage objects. Free-plan native backups are not the launch recovery plan.

## 16. Protected platform-owner operations

There is no full owner dashboard. Rare operations use prebuilt, narrowly scoped commands launched manually through a protected GitHub Actions workflow or an equivalent approved interface:

- block or restore account;
- prepare and complete a protected email change only where an approved recovery factor remains available;
- block an old account after reviewed loss of both verified contacts without transferring its identity or private history;
- archive or restore church;
- resolve a `needs_administrator` case and repair church-admin membership;
- hide or restore disputed content;
- complete complaint action;
- reapply deletion after restore.

There is no free-form production SQL input. High-impact operations use prepare/execute: prepare resolves the target and displays a safe preview; execute requires a short-lived single-use operation token, support-case reference, reason, separate operational authentication, and least-privilege function. Every result is audited and identity changes revoke sessions. An emergency Supabase procedure is documented but normal manual row editing is prohibited.

## 17. Migration from the browser prototype

Do not import `localStorage` ride data. Migrate domain rules, validators, state machines, and test scenarios—not browser records without trustworthy identity or provenance.

Production `localStorage` is limited to unsubmitted drafts, language, external-navigation preference, dismissed guidance, and harmless device preferences. Offers, requests, responses, agreements, notifications, capacity, contacts, and administration rights become server-owned. There is no dual write.

Staging cutover sequence:

1. Canonical schema and synthetic seeds.
2. Authentication and eligibility.
3. Passenger requests.
4. One-time driver offers.
5. Regular series and occurrences.
6. Responses, confirmation, capacity, disclosure, and cancellation.
7. My Trips and notifications.
8. Full backend cutover and one-time cleanup of obsolete prototype keys.

Preserve compatible validation, formatting, domain logic, focused tests, design-system components, and approved behavior. Replace browser-generated IDs, mock contacts, local ownership, local confirmation, and local capacity with server-owned equivalents.

## 18. Cost scenarios and upgrade triggers

All prices and limits below are a planning snapshot accessed **6 August 2026**, in USD before tax, domain registration, currency conversion, and provider-specific sender/carrier fees. They are not architectural guarantees.

### 18.1 Official planning snapshot

| Service | Snapshot | Primary cost driver |
| --- | --- | --- |
| Render | Starter web service: $7/month; Frankfurt available | Instance size, bandwidth, build minutes, previews |
| Supabase | Free: $0, two active projects, 500 MB database and 1 GB Storage per project, pausing after inactivity, no automatic backups; Pro from $25/month with first project included and daily backups, additional projects from $10/month | Database/storage/egress, MAU, compute, reliability |
| Resend | Free: 3,000 emails/month and 100/day; Pro: $20/month for 50,000 with $0.90/1,000 overage | Authentication and transactional email volume |
| Bird SMS | Published base examples per segment: Italy $0.0896, US $0.0073, Canada $0.0075, Belarus $0.2395, Russia $0.6859; carrier/sender fees and registration may add cost | Country, carrier, sender registration, message segments, abuse |
| Google Maps | Essentials free caps generally 10,000 monthly events per SKU; Dynamic Maps $7/1,000, Routes Essentials $5/1,000, Geocoding $5/1,000 after cap | Map loads, address searches, route validations |
| Google Cloud Translation | First 500,000 characters/month covered by a $10 credit; then $20/million NMT characters | Source characters times target languages and revisions |
| Cloudflare Turnstile | Free plan with unlimited challenges and up to 20 widgets | Enterprise requirements only |
| Cloudflare Web Analytics | Free privacy-first service | No planned usage charge |
| Backblaze B2 | $6.95/TB/month; first 10 GB stored free; egress free up to 3× average storage | Backup volume and restores |
| Better Stack | Free personal tier: 10 monitors/heartbeats and one status page; free checks start at 3-minute frequency | More monitors, responders, shorter interval |
| Sentry | Developer plan available with Germany storage region; paid plan/quotas must be rechecked at implementation | Error/event volume and retention |

Published SMS coverage and a price row do not guarantee successful production delivery. Bird is a candidate, not an international-support claim.

### 18.2 Scenarios

| Scenario | Fixed planning baseline | Variable assumptions |
| --- | ---: | --- |
| Development | Approximately $0/month | Vercel Hobby previews are temporary and non-commercial; synthetic Supabase projects; provider test/free allowances |
| Small public launch | Approximately $7/month | Render Starter; accepted Supabase Free risk; Resend/Turnstile/analytics/monitoring/B2 within free allowances; SMS and Google usage charged as incurred |
| Reliability upgrade | Approximately $32–42/month | Render Starter plus Supabase Pro for production; second Pro project adds cost if staging also moves into the paid organization; usage remains variable |
| Growing usage | Scenario, not promise: roughly $52–100+ fixed before SMS/maps | Supabase Pro, Resend Pro, Render Starter or Standard, plus provider and storage usage |

No fixed EUR 100–250 budget is guaranteed. SMS is the least predictable early expense. Google Maps is the strongest deliberate vendor dependency. Budget alerts do not guarantee a spend stop.

### 18.3 Hard controls and upgrade triggers

Configurable operational values include monthly SMS warning and stop amounts, per-country/day limits, per-number/network limits, Google per-SKU quotas, translation batch limits, email priority shedding, and upload limits. Initial values require owner approval after staging measurements.

Upgrade Supabase production to Pro when any one trigger is met:

- one inactivity pause or credible pause risk is unacceptable for real users;
- database exceeds 70% of 500 MB, Storage exceeds 70% of 1 GB, or egress exceeds 70% of allowance in two consecutive weeks;
- observed traffic, auth use, or connection pressure reaches 70% of a Free limit;
- owner requires native daily backups, email support, longer logs, or stronger reliability before/after launch;
- restore rehearsal shows the Free-plan recovery path cannot meet approved RPO/RTO.

Upgrade Render when memory/CPU/latency remains above an approved threshold for 15 minutes, process restarts occur, or load tests miss the service-level target. Upgrade Resend before critical traffic can exceed 80% of the daily or monthly Free quota.

## 19. Vendor lock-in and exit paths

| Provider | Lock-in | Exit path |
| --- | --- | --- |
| Render | Low | Standard Next.js/Node deployment and environment variables can move to another managed host |
| Supabase PostgreSQL | Low to medium | SQL migrations, logical exports, standard PostgreSQL/PostGIS; replace Auth/Storage adapters separately |
| Supabase Auth | Medium | Internal user profile keys are independent; plan an identity migration with forced re-verification |
| Supabase Storage | Low | Object manifest and S3-compatible/export tooling; application-owned opaque paths |
| Resend | Low | Application email adapter, owned templates, standard SMTP/API concepts |
| Bird | Low | Phone-verification adapter and provider-neutral verification records; add second provider before claiming unsupported countries |
| Google Maps | High and deliberate | Provider adapter for calls, but embedded UX, Places semantics, billing, and terms require a planned product/contract migration |
| Google Translation | Low | Stored source/versioned translations and provider metadata permit regeneration through another adapter |
| Web Push | Low | Standard protocol and VAPID; subscriptions may need renewal after key/provider changes |
| Backblaze B2 | Low | Encrypted standard backup archives can move to another object store |

## 20. Risks and required implementation gates

The architecture is not launch approval. Required gates are:

1. Current Google Maps contractual review before storing, caching, or deriving geographic data.
2. Actual sender registration and end-to-end SMS delivery tests in Italy, representative EU countries, United States, Canada, Belarus, and Russia. Add a second provider behind the same adapter if Bird is inadequate in any mandatory country.
3. Legal review of GDPR special-category implications, controller/processor obligations, international transfers, Terms, Privacy, retention, deletion, and translation.
4. Approve exact configurable protective delays for email replacement, remaining retention values within approved product maxima, rate limits, SMS warning/stop thresholds, and capacity/text limits.
5. Configure domain, SPF, DKIM, DMARC, callbacks, and email-deliverability tests.
6. Review RLS, grants, security-definer functions, webhook verification, and owner operations independently.
7. Test last-seat concurrency and duplicate retries at the database level.
8. Test two accounts on two devices for every public/private boundary.
9. Test iPhone Home Screen Web Push and representative Android browsers/devices.
10. Rehearse backup restore, Storage restore, deletion-ledger reapplication, and migration rollback limits.
11. Validate provider quotas and costs with staging measurements and hard application controls.
12. Rehearse protected owner operations, including final-administrator deletion and both-contact-loss consequences, without Codex or a human receiving unrestricted production data.

## 21. Official-source register

Accessed 6 August 2026. Provider facts must be refreshed before implementation or budget approval.

- Supabase: [pricing](https://supabase.com/pricing), [Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [database backups](https://supabase.com/docs/guides/platform/backups), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Postgres extensions](https://supabase.com/docs/guides/database/extensions), [Cron](https://supabase.com/docs/guides/cron), [passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless), [email templates and scanner limits](https://supabase.com/docs/guides/auth/auth-email-templates), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Storage](https://supabase.com/docs/guides/storage), [Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits), and [Realtime](https://supabase.com/docs/guides/realtime).
- Render: [pricing](https://render.com/pricing), [instance types](https://render.com/docs/compute-plans), [regions](https://render.com/docs/regions), and [July 2026 cost model](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses).
- Vercel: [Terms, Hobby Plan](https://vercel.com/legal/terms).
- Resend: [pricing](https://resend.com/pricing), [quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits), and [open/click tracking](https://resend.com/docs/dashboard/domains/tracking).
- Bird: [SMS pricing](https://bird.com/en-us/pricing/sms), [SMS sending, cost, and idempotency](https://bird.com/en-us/docs/guides/sms/sending-sms), and [SMS overview](https://bird.com/en-us/docs/guides/sms/overview).
- Google Maps Platform: [core pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [cost controls](https://developers.google.com/maps/billing-and-pricing/manage-costs), [API security](https://developers.google.com/maps/api-security-best-practices), [Terms](https://cloud.google.com/maps-platform/terms), and [Service Specific Terms dated 22 April 2026](https://cloud.google.com/archive/maps-platform/terms/maps-service-terms-20260422).
- Google Cloud Translation: [pricing](https://cloud.google.com/translate/pricing).
- Cloudflare: [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/), [Web Analytics](https://developers.cloudflare.com/web-analytics/about/), and [data collection](https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/).
- Sentry: [Germany data region](https://sentry.io/changelog/data-storage-location-in-germany-is-generally-available/) and [organization privacy/scrubbing controls](https://docs.sentry.io/api/organizations/update-an-organization/).
- Better Stack: [pricing](https://betterstack.com/pricing), [monitoring](https://betterstack.com/docs/uptime/monitoring-start/), and [heartbeat monitoring](https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/).
- Backblaze B2: [storage pricing](https://www.backblaze.com/cloud-storage/pricing) and [transaction/egress pricing](https://www.backblaze.com/cloud-storage/transaction-pricing).
- Apple: [Web Push for browsers and Home Screen web apps](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

## 22. Approval status

This document is approved as the selected Backend and Integration Architecture V1. The backend and integration architecture roadmap phase is complete; Core multi-user platform is the active next phase. This approval selects the architecture, but it does not implement backend code, configure providers, create infrastructure, or authorize multiple later phases in one task.
