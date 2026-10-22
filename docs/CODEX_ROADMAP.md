# Roadmap for Codex tasks

Roadmap separates the isolated browser demo and implemented local Core slice from the approved first complete public multi-user version. Product purpose and version boundaries are defined by [ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md](ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md); target screens, navigation, journeys, permissions, states, visibility, routes, taxonomy, and content structure are defined by [ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md](ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md). The phases below are an implementation sequence for that one complete approved version, not a series of reduced product releases. Do not add future functionality silently or combine multiple phases into one task without explicit approval.

## Authority and current phase

- The Product Scope is the authority for product purpose and first-version boundaries.
- IA V2 is the authority for target-product screens, navigation, journeys, permissions, states, visibility, URL model, taxonomy, and content model.
- Canonical approved [Design System V2](ORTHODOX_ROUTES_DESIGN_SYSTEM_V2.md) controls the visual system within Product Scope and IA V2 and supersedes archived V1. Its approval is distinct from production UI adoption.
- Approved [Backend and Integration Architecture V1](ORTHODOX_ROUTES_BACKEND_INTEGRATION_ARCHITECTURE_V1.md) and [Target Data Model V1](ORTHODOX_ROUTES_TARGET_DATA_MODEL_V1.md) record the selected production architecture and canonical logical model within Product Scope and IA V2. They are not implementation evidence.
- The code, tests, and README describe what is implemented now.
- `PROJECT_SPEC_V0_1.md`, `DATA_MODEL.md`, `UX_RULES.md`, and `PROJECT_MAP.md` remain explicitly labelled prototype or legacy references and cannot override Product Scope or IA V2.
- Information architecture is complete at the approved-document level. Empirical card sorting and tree testing remain future validation work recorded in IA V2, not invented research results; they do not block Design System V2 approval.
- **Design System V2** is canonical and approved, and **Backend and integration architecture** is complete and approved. The **Core multi-user platform** phase is complete. The **Maps and quality matching** phase is complete, recorded in [BACKEND_CAMPAIGN_MAPS_QUALITY_MATCHING.md](BACKEND_CAMPAIGN_MAPS_QUALITY_MATCHING.md). Phase 6 backend now includes the account-scoped `My Trips` projection, durable notifications, profile update, and account-export foundations; its production UI, PWA, and remaining sensitive account operations are unfinished. The isolated `/design-preview` reference artifact now carries twelve V2 control screens, including the approved transport-board ride map; production adoption remains separate Phase 10 work. Phase approval does not authorize implementation inside a documentation-only task or combine later roadmap phases.
- Maps are part of the required first full version, even though they are not part of the current mock.
- Product-scope approval does not authorize implementing all phases in one change.

## Current implementation and unconfigured demo

- Next.js App Router prototype with React, TypeScript, Tailwind CSS, and ESLint.
- Public routes for churches and drivers without registration.
- Church page as the central transport board.
- Standalone driver pages plus driver names inside visible regular routes and one-time trips.
- Open passenger request modal.
- Targeted passenger request modal linked to a specific route or trip.
- Compatible open-request reuse for targeted passenger requests, including source linking and duplicate prevention per offer occurrence.
- Confirmed `RideMatch` flows in both directions: driver acceptance of a targeted request and passenger acceptance of a driver response.
- Private targeted driver offers when no compatible public trip or route exists; unused seats are not published publicly.
- Partial seat counteroffers, remaining-request republication/editing, and safe cancellation history.
- Date-specific regular-route capacity and one-time-trip capacity derived from confirmed RideMatches.
- Up to five future regular-route occurrences with independent availability, disabled full dates, and non-blocking over-capacity request warnings.
- Private participant contacts only after confirmation, plus safe mock notifications.
- Side-by-side desktop / stacked mobile `Ищут место` and `Предлагают поездки` areas, followed by one shared `Уже договорились` section with up to five upcoming completed passenger requests, one-time trips, and partial or full dated route occurrences.
- Compact transient action feedback with automatic scrolling and brief highlighting of the created or updated card.
- Namespaced localStorage persistence for open requests, responses, targeted requests, RideMatches, and notifications, with safe parsing of legacy and malformed records.
- Personal mock notification panel for development/testing.
- International phone normalization/validation and optional email validation.
- User-visible date formatting as `dd.mm.yyyy` and `dd.mm.yyyy в HH:mm`.
- Church hero with a local Byzantine fallback image.
- Public passenger comments limited to 300 characters with a privacy warning; no automated moderation.
- Vitest unit-test foundation for validation, date formatting, request visibility/state transitions, and safe localStorage parsing, plus P0 Church Transport Board component integration coverage for confirmation, contact disclosure, duplicate actions, and safe hydration. Pure unit tests use Node; the component integration file uses jsdom only.
- Basic GitHub Actions CI for clean-install tests, lint, and production builds on main-branch pushes and pull requests.
- Version-controlled local Supabase/PostgreSQL configuration, foundation and account/eligibility migrations, and isolated clean migration replay in CI.
- Local-only passwordless email Auth with a custom token-hash confirmation page, explicit POST confirmation, cookie-backed SSR session, `getClaims()` server identity verification, reload persistence, and current-device sign-out.
- Backend-only application accounts linked to verified `auth.users`, protected contacts, an 18+ declaration, versioned legal-document metadata/Terms acceptance, and one authoritative structured participation-eligibility check behind narrow authenticated RPCs. Account creation is explicit, `active` remains separate from eligibility, and ordinary clients cannot mark a phone verified.
- Application-owned phone verification with versioned policy, idempotent attempts, transient restricted delivery material, expiry and attempt limits, race-safe uniqueness, authoritative eligibility transition, a targeted service-role-only worker bridge, and a Bird SMS adapter. Bird credentials remain outside the repository; real staging delivery and application-owned OTP verification are confirmed, and no production fake is configured.
- A protected contextual-registration application foundation with bounded action-only payloads, separate temporary profile data, sealed resume tickets, hashed capabilities and intended-email binding, server-only rate-limited writes, pre-account Auth ownership, account linking, explicit final review, and terminal cleanup. Claim and verification never publish an action.
- The first server-owned Core transport slice with canonical church/service references, passenger requests, one-time driver offers, bounded regular series, date-specific capacity records, eligibility-gated/idempotent protected operations, owner-only exact pre-map labels, safe anonymous projections, and database-enforced ownership.
- The participant boundary for bidirectional responses, immutable condition snapshots, atomic agreement confirmation, independent occurrence capacity, partial passenger need, exact-once individual/date/series cancellation, explicit request restoration, lifecycle expiry, and participant-only contact/exact-place disclosure.
- The configured church transport board reads and mutates only the server-owned Core domain, supports contextual explicit publication after eligibility, and retrieves protected contact/exact-place data only after a participant action. The historical browser board remains an unconfigured demo and is never a fallback for a configured backend.
- First church transport board component-extraction refactor for the request dialog, passenger request card, and mock notification center.
- Second church transport board presentational extraction for page actions, request and response panels, targeted requests, and driver offers.
- Centralized one-time-trip visibility based on open status, available seats, and a local departure date and time that has not passed.
- Complete local mock driver-offer flow with reusable driver identity, one-time trips, regular routes, and cancellation history.
- Human-language driver-offer UI with trip-specific origin, numeric maximum detour, 1–55 seat selection, blur/touched validation, human cancellation copy, and static-plus-browser-local church counters.
- Role-labelled passenger/driver page actions, origin-to-church offers with numeric maximum detour, shared compact service/date selection, and an intentional no-schedule church scenario.

The isolated synthetic-only Supabase staging project and HTTPS deployment run the committed Core migrations, the configured RPC board, readiness checks, and guarded remote multi-user smoke verification. Staging Auth has an owner-configured Resend SMTP sender; real Gmail delivery, explicit link confirmation, SSR session persistence, and current-device sign-out are confirmed, with Spam placement tracked separately. Bird is the owner-approved SMS provider; its staging variables are injected only through the hosting secret manager, and the application-owned flow has confirmed provider acceptance, handset receipt, and OTP verification. Geoapify is the owner-approved map provider for tiles, address search, and route measurement; Google Maps and Yandex Maps remain outbound links only. The repository still has no production backend access, push delivery, production Terms/Privacy text, Firebase, Telegram, payments, WhatsApp API, or admin features. The contextual flow is connected from passenger/driver input through verified-email claim, account materialization, adult declaration, phone challenge, Terms acceptance, explicit final review, and idempotent publication. Local browser and remote API/web verification use synthetic legal and eligible-account fixtures; production participation remains correctly gated until current production legal content and separately authorized production infrastructure exist. The configured church transport board is cut over to the server-owned transport, response, agreement, capacity, cancellation, restoration, and disclosure RPCs with no `localStorage` fallback or dual write.

## Development sequence

### 1. Information architecture — completed

- Approved in [ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md](ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md).
- Defines the complete screen inventory, mobile/desktop navigation, URL model, roles, permissions, visibility, content model, journeys, and states.
- Records the future card-sorting and tree-testing protocol without claiming that user research has already occurred.

### 2. Canonical design system — approved

- Establish the visual direction and reusable foundations.
- Design key mobile and desktop samples: church directory/map, church page/transport board, trip and request cards, forms, My Trips, notifications, profile, navigation, and empty states.
- Review each important screen manually.
- Canonical approved foundations and the stored V2 visual reference are recorded in [ORTHODOX_ROUTES_DESIGN_SYSTEM_V2.md](ORTHODOX_ROUTES_DESIGN_SYSTEM_V2.md). V2 supersedes [archived V1](archive/ORTHODOX_ROUTES_DESIGN_SYSTEM_V1.md).
- `/design-preview` remains the isolated reference artifact and contains twelve V2 control screens, including the mobile and desktop ride map for one transport-board group. Production UI migration is separate and is not complete.

### 3. Backend and integration architecture — completed

The approved [Backend and Integration Architecture V1](ORTHODOX_ROUTES_BACKEND_INTEGRATION_ARCHITECTURE_V1.md) and [Target Data Model V1](ORTHODOX_ROUTES_TARGET_DATA_MODEL_V1.md) select and document:

- database, backend, hosting, deployment, backups, and monitoring;
- passwordless email-link authentication, SMS phone verification, and account recovery;
- authorization boundaries and contact disclosure;
- maps, geocoding, routing, quotas, and cost controls;
- transactional email, Web Push, PWA installation, and offline form drafts;
- automatic translation, localized-content storage, images, analytics, audit logs, retention, and deletion.

The target data model and target project diagrams are approved architecture artifacts. This phase is complete; their approval does not constitute backend implementation or resolve the implementation gates listed inside the documents.

### 4. Core multi-user platform — completed

- Establish version-controlled local Supabase/PostgreSQL configuration and clean migration replay — completed locally.
- Implement the passwordless email identity/session foundation — completed locally and on isolated staging; the owner confirmed real Gmail delivery, explicit visible confirmation, SSR session persistence after refresh, and current-device sign-out. Spam placement remains a separate deliverability issue, and production email is absent.
- Implement the backend-only Account & Eligibility Foundation — completed with explicit application-account materialization, protected contacts, an 18+ declaration, versioned legal-document/Terms acceptance, and authoritative eligibility evaluation. Production legal text and later profile scope remain absent.
- Implement the Phone Verification Foundation and provider adapter — database ownership, targeted service-role worker bridge, fail-closed Bird adapter, and application integration are complete; the isolated staging flow confirmed Bird acceptance, handset receipt, and application-owned OTP verification without exposing OTP or granting the provider verification authority.
- Implement contextual registration/profile flow — protected drafts, application orchestration, verified-email claim, account materialization, adult declaration, phone challenge request, Terms acceptance, explicit final review, idempotent publication, and terminal draft cleanup are complete. Production legal versions remain an external gate.
- Keep real SMS delivery behind owner-controlled billing, sender registration, regional routing, and secret injection. Bird and the `OrthoRoutes` Italy sender are approved and verified for the staging smoke; only the server-owned delivery adapter is committed, never the Bird API key.
- Migrate the approved transport-board domain model from browser storage — source entities, ownership, safe projections, date-specific occurrences, responses, agreements, capacity, cancellation, disclosure, and the configured Core application cutover are implemented locally without importing or dual-writing browser records.
- Enforce ownership and authorization server-side — completed for the implemented Core domain.
- Keep contacts unavailable to anonymous users and unconfirmed counterparties — completed for the implemented Core agreement boundary.
- Public passenger/driver list RPCs independently enforce published-church visibility for filtered and global calls. Hidden/archived/draft church records cannot bypass the page boundary through direct Data API reads; restoring publication preserves the same active rows and personal history remains unchanged.
- Support contextual registration from the action the visitor was already performing — completed for requests, offers, and responses with an explicit final send.

The complete Core campaign passed its final local, migration, security/privacy, isolated-staging, provider, and GitHub Actions release gates. The Maps and quality-matching phase is complete and merged, with its own release gates passed and the owner's manual acceptance test signed off.

### 5. Maps and quality matching — complete

- Use Geoapify as the only embedded map and geospatial provider, rendered with MapLibre GL; Google and Yandex remain outbound navigation links only.
- Add the church catalog map with universal search and an explicit `Рядом со мной` action, and the dedicated church location screen opened from the exact public address.
- Add the reusable address/place-first location picker with map confirmation, marker correction, manual placement fallback, and reusable saved places.
- Add protected exact church and user coordinates, up to three passenger meeting points, one driver departure point, and stable off-centre approximate public areas exposed identically to anonymous visitors and authenticated non-participants.
- Implement deterministic route-aware quality matching with church, active-state, block, whole-group seat, child and child-seat, and detour-distance rules. Time is compatible when both sides chose the same service, or when the arrival the driver stated falls from sixty minutes before to thirty minutes after the passenger's desired arrival (amended 28 August 2026; the added minutes of a pickup explain a suggestion and never decide it).
- Show suggestions as an explainable `Подходит` marker and a `Подходящие мне` view; suggestions never confirm a ride, never restrict the ordinary board, and never show a score.
- Do not create public driver route corridors, persisted provider route geometry, a separate direction rule, route optimization, or pgRouting.

### 6. My Trips, notifications, profile, and PWA

- The protected account-scoped `My Trips` read projection is implemented over the existing transport domain, with the four approved IA V2 sections, cross-church context, passenger participation, aggregated driver occurrences, and no protected disclosure data. The route and UI remain unimplemented.
- Group 5 My Trips copy-review screens and their IA V2 amendments are approved (PR #5); they remain an isolated fixture-based surface, not the production interface.
- Group 7 registration, sign-in, and contact-verification copy-review screens are approved (19 October 2026) with dated IA V2 and Product Scope amendments: one gate before any publication (eligibility, a future date, at least one external notification channel), publication only by a press whose label says so, an explicit press on the email-link page, and email trip notifications on by default for new accounts. They remain an isolated fixture-based surface; the production contextual-registration flow, which still returns to a separate review page and confirms by its own button, must be aligned in a separate approved task.
- Participant-only agreement detail reading is implemented through `api.get_my_trip_details`: accepted child/seat and return conditions, current remaining passenger need, pending proposed conditions, and on-demand contact/exact-place access under the existing cancellation and retention rules. The broad list remains free of protected disclosure data. This supplies the confirmed-agreement detail data identified by IA V2 sections 16.2/16.3, without implementing the UI.
- The `change_pending` proposal/answer workflow now has an authoritative proposer/responder, immutable accepted and proposed snapshots, idempotent participant-only mutation RPCs, and atomic capacity adjustment on acceptance. Production list integration must still reflect Group 5's own-listing grouping and response contexts.
- Implement the remaining `My Trips` route/interface, notification-history interface, and lightweight profile interface with notification settings.
- Preserve church-management entry points without treating church administration as part of personal trips.
- Implement durable in-app notifications, transactional email, and Web Push.
- The durable notification backend is implemented: account-owned history, ordinary email/Web Push preferences, protected device subscriptions, effective-channel enforcement, delivery state, a service-role-only leased outbox, provider-independent Resend/VAPID workers, and signed, deduplicated, out-of-order-safe Resend receipts. Authoritative response, confirmation, cancellation, and agreement-change transitions insert notification/outbox work atomically. The replay-safe scheduler enqueues newly measured quality matches, due 24-hour ride reminders, post-ride outcome requests, and ended-series notices. Owner-controlled provider configuration, real device/provider verification, and production UI remain outstanding.
- The existing protected profile RPC owns display-name and preferred-language changes. The account-owned export backend returns the authenticated person's current profile, legal acceptances, notification history/preferences, safe push-device metadata, exact owned places, and transport participation without provider secrets, delivery destinations, or counterpart contact snapshots. Protected phone/email replacement remains in progress; deletion remains Phase 8.
- Protected phone replacement preserves the verified old binding until the new number passes SMS verification, requires a recent non-refresh authentication method from the signed Auth claims, reuses the restricted delivery worker, applies the new verified binding atomically, and records an account notification. Email replacement remains in progress.
- Follow the IA V2 PWA guidance: provide iPhone installation guidance before Web Push; on Android, use the system installation prompt when supported and otherwise provide browser-specific guidance; keep installation and push permission separate; request push only after a useful user action; and continue important messages by email while push is unavailable.
- Make the web application installable as a PWA.

### 7. Church pages, schedules, administration, and localization

- Implement church creation with address deduplication, immediate publication without routine pre-approval, later protected intervention, archival behavior, and up to three equal administrators.
- The backend creation foundation enforces participation eligibility, combines a normalized-address fingerprint with PostGIS proximity checks, publishes atomically, records the creator as the first equal administrator, caps membership at three places, preserves slug and administrative history, and returns an actor-scoped management projection.
- The invitation backend reserves one of three places for seven days, binds acceptance to the matching confirmed email and full eligibility, supports an atomic transfer of the sender's own place, cancellation, decline, resend cooldown, and guarded voluntary exit. A protected email queue and service-only worker carry invitation links for accounts that do not yet exist. The invitation acceptance interface is still unimplemented.
- Church source text editing is protected by current membership, idempotency, and an optimistic content version so equal administrators cannot silently overwrite one another. The source description is public only through the published-church projection. Address/location changes are a later slice that must update deduplication and invalidate stale route measurements.
- Eligible administrators can create one-off services with actor-scoped idempotency. A bounded public projection lists future concrete services only for published churches. Recurring series, exceptions, schedule changes, cancellation notifications, and archival remain separate slices.
- Eligible administrators can preview linked listing, pending-response, and agreement counts and cancel a future one-off service. Cancellation is version-checked, notifies all affected accounts transactionally, leaves ride snapshots intact, and excludes the cancelled reference from automatic matching and new agreement confirmation. Recurring series, date/time editing, exceptions, and archival remain separate slices.
- A current equal administrator can open or cancel a protected owner-review request for church archival. The management projection shows `archive_requested` while the page stays publicly available and transport commitments stay active; the request is distinct from final protected owner archive/restore.
- The protected owner archive/restore database contract is implemented behind a distinct inactive NOLOGIN operational role, never the ordinary application key. Safe prepare/execute uses a login-bound expiring capability, current-state fingerprint, future-transport guard, unchanged participant history, and atomic minimized audit. Restoration preserves the existing identity and refuses an unresolved missing-administrator case. The fixed Node/psql runner defaults to preview-only, enforces narrow identity/logging/TLS configuration and exact interactive confirmation, and supports capability-free own-outcome lookup. Authorized execution requires a prior committed audit start; minimized success/refusal/error completion is atomic, and interrupted attempts remain explicitly unfinished without automatic retries. Real operator provisioning and operational rehearsal remain separate before activation.
- Eligible equal administrators can update a church's public address and coordinates together. Existing-address collisions fail closed for review; a successful change invalidates derived road measurements, rejects measurements computed from the old coordinates, and notifies affected future riders without rewriting their trips. A time-zone change is not hidden inside address editing.
- Future one-off service source text can be edited after an impact preview. A version check protects concurrent administrators; shared church/service locks serialize new ride publication with the edit, linked rides keep their original name/time snapshot, and affected participants receive a durable notification. Date/time editing and recurring-service exceptions remain separate.
- A future one-off service can be rescheduled with version checks and the same impact preview. Existing rides retain their scheduled times; new ride listings capture a new schedule generation. Automatic suggestions and new responses cannot mix old and new generations of that service, while all affected future participants are notified.
- Eligible equal administrators can create a weekly church-service source with optional end date. A privileged worker idempotently fills a rolling 90-local-day window of concrete occurrences; the public schedule remains one chronological list. Series editing, date exceptions, and cancellation remain separate.
- A future recurring service date can be cancelled after an affected-ride preview. The exception is recorded against that concrete occurrence; the weekly source and other dates remain active, existing rides keep their snapshots, and affected participants receive durable notifications.
- A future recurring service date can also be moved after an impact preview. Its original weekly slot remains the exception key, repeated moves retain the original time and advance the exception version, old ride snapshots and generation-safe matching remain intact, and the moved date may later be cancelled.
- A future recurring service date can have its source name/description edited after the same impact preview. The exception history records the before/after text for that date only; the weekly source, other dates, and existing ride snapshots are unchanged, while affected participants receive durable notifications.
- An administrator can preview and cancel a selected recurring date and all later dates of its weekly source. The source's end bound prevents rematerialization, only affected future concrete dates are cancelled, earlier dates remain available, and linked ride snapshots stay intact while participants are notified.
- An administrator can preview and edit source name/description from a selected recurring slot onward. Series version and schedule timestamp reject stale previews, including intervening one-date edits; changed scheduled slots reuse the existing exception/notification path, earlier/cancelled slots and ride snapshots remain, and later materialization uses the edited source.
- The same protected future-slot boundary supports changing weekly start time without changing weekdays. Changed concrete dates reuse generation-safe rescheduling and notifications; conflicts roll back the complete operation, earlier/cancelled dates and linked rides remain unchanged, and later materialization uses the new local time. Future weekday/bound editing remains unfinished.
- Protected fresh-preview operations can extend a finite recurring end bound or remove it, reusing the bounded rolling materializer and its existing conflict-alert behavior, or shorten the source through the existing future-service cancellation/notification path. Shortening preserves the exact requested end date and retained slots/exceptions, never silently cancels linked rides or changes snapshots, and also permits existing administrators to repair a hidden page. Retries are actor-scoped, stale/concurrent saves refuse with 409, and no-ops do not advance versions/timestamps. Weekday/start-bound editing remains unfinished.
- Implement recurring and one-time services, exceptions, cancellations, and date/time fallback.
- Confirmed-user authority for church creation/administration is separated from optional ride delivery channels. Church work remains available with both ordinary channels off; transport publication/response/confirmation still requires an effective external channel. Existing eligibility, membership, version, and idempotency checks remain in place.
- Optional public church contacts can be saved or removed by current administrators with shared content-version checks and actor-scoped retries. These deliberate public details are separate from account contacts, excluded from translation, and exposed only by the published church projection. Production form/rendering remains UI work.
- Provider-independent church-photo processing verifies static JPEG/PNG/WebP bytes and resource bounds, normalizes orientation, strips metadata, and produces a cleaned master and three uncropped WebP variants with opaque keys and checksums. Protected database replacement uses rights acknowledgement, actor-derived intents, a trusted-processor manifest, current eligibility/membership, shared versions, and atomic supersession/audit. The server-only private-bucket adapter provides immutable checksum-verified cleaned-object upload plus a published-only non-master delivery proxy without exposing paths, hashes, masters, or uploader details. The authenticated scheduler leases expired uncommitted manifests and removes only their four exact objects, with bounded requests and retry/recheck timing; published and superseded images remain excluded. Required CI exercises an isolated local Storage object flow with exact cleanup; remote/staging bucket verification, owner-approved upload activation, superseded-image retention, backups, and UI remain unfinished.
- Existing church, schedule, translation, membership, invitation, and archival-request events atomically feed the restricted minimized audit, with safe historical backfill and no text/contact/token copies. Protected owner operations and remaining account/moderation audit hooks are unfinished.
- Support English, Russian, Italian, Romanian, Ukrainian, and German.
- Add prepared translations for system content and stored automatic translations for approved dynamic church content.
- Ordinary notification email uses versioned Git-owned text for every currently emitted response, agreement/change, schedule, membership, phone-change, reminder, outcome, and channel-warning key in all six languages. Unknown keys/languages have deterministic generic/English fallbacks. Text contains no interpolated private parameters or numeric plural forms, reports an event rather than promising its current state, and directs the recipient to the application. The minimal push payload remains unchanged; authentication/recovery/invitation templates, standard service types, localized UI, and human language acceptance remain separate.
- The unified catalog backend searches official names and current ready stored translations across supported languages. An optional language selects display names and alphabetical order, while explicit proximity, geographic filtering, original fallback, and the published-only boundary remain intact. Production language selection and localized catalog rendering remain UI work.
- The dynamic-content storage foundation versions only approved church and concrete-service source fields, marks old translations stale on edits, and provides anonymous published-only localized reads with original-text fallback. Provider activation and the production UI remain separate work.
- A current equal administrator can inspect a single approved source and correct a target-language translation. Source and translation versions protect against silent overwrites, the original remains separate, and the corrected text is available through published-only localized reads. Real provider verification and the production UI remain separate.
- The provider-independent translation worker claims only current approved text for published churches and future scheduled concrete services. It uses short leases, bounded retries, safe failure states, and source/version checks; a late machine result cannot replace a manual correction. Real provider verification and the production UI remain separate.
- A separate authenticated server runner validates claimed translation payloads before passing public source text to the selected Google Cloud Translation NMT adapter. Missing server configuration disables dispatch. Atomic monthly character reservations, bounded attempts, abortable calls, safe counters, and versioned glossary references protect the provider boundary. Owner-controlled configuration, real staging delivery, and the production UI remain separate.

### 8. Privacy, terms, support, and operations

- Draft the Terms of Use and Privacy Policy for the selected architecture, providers, data flows, and public international scope.
- Publish approved production document versions and connect the existing versioned acceptance foundation to the final legal UI.
- Implement account deletion, complaints, personal blocking, and the agreed data-retention behavior.
- Existing church-invitation delivery now uses sequential single claims, authoritative relative lease/expiry timing, a secure application origin, bounded transport/RPC waits, and strict minimized acknowledgements. Completion rechecks invitation/mail state and deadlines after actual row waits. Additive migration/ACL replay and concurrency are required CI proof; message, dispatch idempotency, membership/resend/retry rules, and real provider/worker activation remain unchanged.
- Ordinary notification delivery uses a service-only single-job v3 bridge with relative database lease timing, bounded dependencies, fresh keys, and minimized adapter results. Post-lock expiry/terminal guards preserve authoritative provider outcomes. Bounded abandoned/exhausted recovery prevents a sixth dispatch and legacy counter overflow without changing subscriptions/preferences solely on abandonment; existing completed failure and business-event rules remain unchanged. Migration/replay/concurrency proof, coordinated rollout, actual hosting limits, and real provider/device acceptance remain distinct.
- An inactive server preparation broker now orders structural input/trusted-context validation, HMAC attempt budgets, server-selected Turnstile verification, and protected unsubmitted-draft preparation. Random independent server retry capabilities, strict minimal draft results, bounded waits, and no automatic retries preserve privacy and existing SQL authority. This is not an HTTP/session/proxy implementation, mailbox confirmation, received complaint, or activation; secure retry-state retention, operational settings, owner delivery, and retention remain required.
- An inactive service-only complaint-preparation attempt boundary atomically consumes global/network/mailbox budgets from server-derived HMAC digests, rolls back every dimension on denial, and re-evaluates time after its shared lock. A bounded server helper canonicalizes trusted addresses/mailboxes without parsing request headers, contains failures, and never retries an uncertain acknowledgement. Missing policy remains unavailable; exact limits, trusted-proxy/secret configuration, public broker enforcement, other complaint flows, maintenance activation, and real staging/provider proof remain separate.
- Own account export includes current/ended church-administrator positions, actor/subject events, sent or accepted invitations, and authored archival requests through the existing protected export. Other account identities, invitation emails/tokens/delivery, and current church content are excluded; own historical relationships remain available after leaving or hiding. Ungranted helpers and narrow account-history indexes preserve the current API/ACL and avoid global history scans. Remaining domain-export and deletion/retention audits are separate.
- An authenticated count-only deletion-impact read derives the account from the session, includes logical future transport and current/final administrator positions, and remains available without ride eligibility. Pending invitations do not resolve a final position; hidden/archived visibility alone never ends membership. This snapshot is not an execution authorization or deletion workflow; recent re-authentication, email confirmation, atomic closure, revocation/anonymization, protected support resolution, legal retention, and UI remain separate.
- An inactive complaint mailbox-proof queue/runner claims one service-only lease at a time, rotates non-persisted clear email capabilities, validates recipient/deadline data, contains provider failures, and uses fixed outcomes with bounded retry/backoff. Six-language prepared email contains no complaint/target payload. Public forms, explicit browser confirmation, actual mailbox/provider proof, operational rate policy, accepted cases, owner delivery, retention, and activation remain separate.
- An inactive service-only complaint-email draft contract stores unsubmitted text/recipient/target behind forced RLS, separates hashed resume and email-verification capabilities, clamps its 15-minute maximum lifetime to the approved reporting deadline, and serializes prepare/verification retries. Expiry clears sensitive fields in pending and verified drafts; own export excludes other reporters, capabilities, and logically expired drafts before cleanup. Shared target rules preserve the existing ordinary read API. No complaint receipt, identity change, delivery queue, public flow, rate-limit policy, owner review, or legal-retention decision is implied.
- The provider-independent Turnstile server verifier has fail-closed configuration, strict hostname/action checks, bounded token/response sizes and end-to-end timeout, private-data exclusion, and no automatic retries or cached verdicts. Official dummy secrets are rejected in every environment; unit tests inject a fake transport only. No public form/write endpoint is wired, and real widget/domain configuration, per-flow rate limits, staging/provider proof, and activation remain separate.
- A read-only complaint-target context validates public church/listing references and actor-derived own listing/participant history within the approved 30-day post-ride reporting window without returning private payload. It exposes only the validated type/public UUID, schema version, and stable codes for the IA categories; unavailable/expired targets return null even before lifecycle cleanup and no eligible-channel/phone/Terms requirement is added. Stored intake, guest email verification, abuse limits, owner delivery/review, retention, and the production form remain unfinished.
- The private block relation is enforced at the shared response/confirmation boundary, not only in quality matching. Pair-scoped locking prevents a concurrent block and future agreement from both committing; a future confirmed commitment must be cancelled first. Confirmed users can set/end only their own interaction-derived block through an idempotent protected operation. Reads reveal only the caller's setting, and own block history is included in account export. Production controls, complaints, and deletion remain unfinished.
- Keep voluntary external project support separate from prohibited ride payments and commissions.
- Add the support form, owner runbook, protected administrative operations, and audit logging.
- The inactive protected church-owner contract supports reviewed urgent temporary hiding, plus restoration from hidden/archived, through the existing separately authenticated preview/confirmation and durable-attempt workflow. Public projections already require published status; future rides, snapshots, capacity, and pending archival requests remain intact. Hiding/restore/replay and rollback use minimized audit without new application-role access. Real operator provisioning/rehearsal and remaining owner actions stay separate.
- The same inactive operator boundary supports reviewed exclusion of one exact current membership only when another administrator remains and the selected seat has no pending transfer. It grants no replacement and changes no church, invitation, account/session, or transport state. Subject/operator audit and neutral six-language notifications are atomic; final-administrator support resolution and real operational rehearsal remain separate.
- A separate reviewed pending-invitation cancellation revokes only the selected grant and mail capability/lease through that same protected attempt boundary, with minimized audit and no recipient discovery. Current membership, other invitations, and transport remain unchanged; a real authenticated transfer-acceptance race is verified locally in required CI. This does not implement representative replacement or final-administrator support cases.
- An inactive reviewed replacement primitive atomically swaps an exact church seat, including the final seat, to a confirmed eligible public-account reference without optional ride-channel requirements. Incoming identity/contact/legal facts are locked/rechecked, confirmation expires after lock waits, and subject/operator audit plus neutral notifications are atomic. No account/private ride history is transferred; final-administrator support-case/deletion orchestration and real representative/operator verification remain separate.
- Initial/phone-change SMS attempts now freeze a six-language template using the account preference, preserving legacy Russian retry bodies and denying old workers access to new templates. New copy removes the fixed ten-minute claim without changing policy-owned OTP expiry, sender/provider, or verification authority. Prepared-copy and synthetic Data API/migration proof remain distinct from real localized handset/provider acceptance.
- Targeted SMS delivery has a service-only v3 relative-time bridge, bounded application waits, and a transient lease deadline clamped to code expiry. Completion rechecks expiry after delivery/attempt locks; authenticated verification rechecks after contact/attempt locks and rolls back a tentative binding if the unique-phone index wait crosses expiry. Existing policy values, resend rules, frozen messages, recent-authenticated replacement, and legacy bridge shapes remain unchanged. Actual migration/concurrency/replay, real handset/provider acceptance, and coordinated rollout are separate proof requirements.
- Bird acknowledgement handling now refuses redirects/ambient credentials and bounds the entire request/body to ten seconds and 16 KiB through the shared Resend reader. Invalid, stalled, oversized, or late acknowledgements fail closed without reflecting provider data; delivery state/retries and activation remain unchanged.
- Actual successful phone-binding/replacement transitions atomically create deduplicated minimized account audit facts with opaque account targets and fixed changed-field names. Phone/OTP/provider values are excluded; failed attempts and retries create no success facts. Historical verified attempts retain their recorded verification time and unknown transaction IDs remain null. Integration verifies real-RPC rollback after an injected late failure and replay-safe actual-migration backfill. Email/recovery/deletion and other remaining domain hooks are separate.
- A restricted minimized audit foundation captures agreement events and private block transitions atomically, backfills known history without fabricating old transaction IDs, and rejects event rewrites. Public/client/service-role table access remains revoked. Case-scoped owner operations, remaining domain hooks, and legally approved retention/deletion remain separate work.
- Existing positive-participation guards use an account lifecycle row fence so an ordinary status restriction and an in-flight action cannot bypass one another. Eligibility is rechecked after waits, while read-only projections, existing agreement access/cancellation and restricted self-export remain unchanged. This authorization preparation does not activate protected account restriction/restoration or deletion; see `BACKEND_PARTICIPATION_ACCOUNT_FENCE.md`.
- Add minimal product analytics without advertising trackers.
- Obtain appropriate legal review before broad public launch.

### 9. Full end-to-end coverage

The opt-in staging church-image probe pins the existing isolated project reference/name/healthy state before retrieving keys, requires an existing private bucket, and exercises only fresh synthetic object keys with exact cleanup. It cannot create/change/delete buckets or resume the provider project. Remote success is not yet verified: the pinned project was `INACTIVE` on 17 October 2026. This small probe does not approve upload limits, replace load measurements, or activate uploads.

Cover contextual registration, multi-user ride coordination, quality matching, notifications, confirmation, contact disclosure, capacity, cancellation, church administration, schedule changes, authorization, and anonymous-data boundaries in real browsers.

### 10. Full visual redesign and polish

- Apply the approved design system to all real screens and states.
- Complete responsive behavior, accessibility, focus management, loading, error, and empty states.
- Verify every role manually on mobile and desktop.

### 11. Final verification

- Run automated, integration, and E2E checks.
- Test real phones, major browsers, weak connections, long localized content, incorrect actions, privacy boundaries, accessibility, performance, email, push, and recovery.
- Verify the manual support and emergency-administration procedure.

### 12. Public launch

Open to real users only when the Product Scope and IA V2 readiness criteria are met and users no longer need to imagine missing core behavior. Early measurement and support may be operationally focused, but access is not restricted to selected parishes or countries.

## Required before real users

- Backend, authentication, server-side authorization, and cross-device persistence.
- Maps, geocoding, routing, protected exact data, stable approximate public areas, and quality matching.
- Complete driver, passenger, confirmation, contact-disclosure, capacity, and cancellation flows.
- My Trips, profile, and real in-app, email, and Web Push notifications.
- Installable PWA behavior.
- Church-page creation, schedules, archival, and multiple equal administrators.
- Six approved interface and notification languages.
- Terms of Use, Privacy Policy, consent recording, deletion, support, and operational runbook.
- Email verification, SMS phone verification, an 18+ declaration, complaints, personal blocking, and structured child/child-seat data.
- Critical automated and E2E coverage plus manual device/browser verification.
- Finished, accessible interface with understandable loading, empty, error, and weak-network states.

## Explicitly excluded from the first full version

- SMS ride notifications, Telegram bots, WhatsApp, and other messenger integrations. SMS phone verification is required.
- Built-in chat.
- Ratings, reviews, payments, prices, commissions, and subscriptions.
- Native iOS and Android applications.
- Identity documents, documentary age checks, driving-licence, insurance, vehicle, parish-membership, jurisdiction, or routine church-page pre-verification. A user declaration of age 18+ is required.
- Regular passenger requests.
- User photos, vehicle photos, and galleries.
- A full moderation system beyond the approved complaint flow, simple personal blocking, and protected manual intervention.
- Multiple church-administrator permission levels and a platform-owner dashboard.
- Complex route optimization, calendar synchronization, social feeds, and diocesan analytics.
- Full offline mode and medical or vulnerability assessment. Structured child and child-seat fields are required.

These exclusions do not prevent protected manual administrative intervention through the selected backend when required.
