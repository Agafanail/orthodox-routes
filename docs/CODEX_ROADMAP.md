# Roadmap for Codex tasks

Roadmap separates the implemented browser-only prototype from the approved first complete public multi-user version. Product purpose and version boundaries are defined by [ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md](ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md); target screens, navigation, journeys, permissions, states, visibility, routes, taxonomy, and content structure are defined by [ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md](ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md). The phases below are an implementation sequence for that one complete approved version, not a series of reduced product releases. Do not add future functionality silently or combine multiple phases into one task without explicit approval.

## Authority and current phase

- The Product Scope is the authority for product purpose and first-version boundaries.
- IA V2 is the authority for target-product screens, navigation, journeys, permissions, states, visibility, URL model, taxonomy, and content model.
- Canonical approved [Design System V2](ORTHODOX_ROUTES_DESIGN_SYSTEM_V2.md) controls the visual system within Product Scope and IA V2 and supersedes archived V1. Its approval is distinct from production UI adoption.
- Approved [Backend and Integration Architecture V1](ORTHODOX_ROUTES_BACKEND_INTEGRATION_ARCHITECTURE_V1.md) and [Target Data Model V1](ORTHODOX_ROUTES_TARGET_DATA_MODEL_V1.md) record the selected production architecture and canonical logical model within Product Scope and IA V2. They are not implementation evidence.
- The code, tests, and README describe what is implemented now.
- `PROJECT_SPEC_V0_1.md`, `DATA_MODEL.md`, `UX_RULES.md`, and `PROJECT_MAP.md` remain explicitly labelled prototype or legacy references and cannot override Product Scope or IA V2.
- Information architecture is complete at the approved-document level. Empirical card sorting and tree testing remain future validation work recorded in IA V2, not invented research results; they do not block Design System V2 approval.
- **Design System V2** is canonical and approved, and **Backend and integration architecture** is complete and approved. The active phase is **Core multi-user platform**. The isolated `/design-preview` reference artifact now carries twelve V2 control screens, including the approved transport-board ride map; production adoption remains separate Phase 10 work. Phase approval does not authorize implementation inside a documentation-only task or combine later roadmap phases.
- Maps are part of the required first full version, even though they are not part of the current mock.
- Product-scope approval does not authorize implementing all phases in one change.

## Current implemented mock prototype

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
- Provider-independent application-owned phone verification with versioned policy, idempotent attempts, transient restricted delivery material, expiry and attempt limits, race-safe uniqueness, authoritative eligibility transition, and an ungranted worker lease contract. No external SMS provider or production fake is configured.
- A protected contextual-registration draft database boundary with bounded action-only payloads, hashed capabilities and intended-email binding, server-only rate-limited writes, verified-actor claim, ownership checks, and terminal cleanup. Application orchestration and account-completion UI remain in progress, and claim never publishes an action.
- First church transport board component-extraction refactor for the request dialog, passenger request card, and mock notification center.
- Second church transport board presentational extraction for page actions, request and response panels, targeted requests, and driver offers.
- Centralized one-time-trip visibility based on open status, available seats, and a local departure date and time that has not passed.
- Complete local mock driver-offer flow with reusable driver identity, one-time trips, regular routes, and cancellation history.
- Human-language driver-offer UI with trip-specific origin, numeric maximum detour, 1–55 seat selection, blur/touched validation, human cancellation copy, and static-plus-browser-local church counters.
- Role-labelled passenger/driver page actions, origin-to-church offers with numeric maximum detour, shared compact service/date selection, and an intentional no-schedule church scenario.

The repository still has no remote application backend, transport-domain schema, real transport-data isolation, production email/push/SMS delivery, production Terms/Privacy text, Firebase, Google Maps, Telegram, payments, WhatsApp API, or admin features. The implemented local account, phone, and contextual-draft foundations provide authoritative server boundaries, but the contextual flow is not yet connected to the UI and a normal account cannot receive an SMS or become participation-eligible through the current UI because no provider is configured and no production Terms version is seeded. Transport flows remain browser-local and do not depend on the local database, Auth, or account stack.

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

### 4. Core multi-user platform — active

- Establish version-controlled local Supabase/PostgreSQL configuration and clean migration replay — completed locally.
- Implement the local passwordless email identity/session foundation — completed locally only, without remote Supabase or production email.
- Implement the backend-only Account & Eligibility Foundation — completed locally with explicit application-account materialization, protected contacts, an 18+ declaration, versioned legal-document/Terms acceptance, and authoritative eligibility evaluation; no external SMS delivery, production legal text, profile UI, or contextual registration is included.
- Implement the provider-independent Phone Verification Foundation — completed locally in the active Backend Campaign; external SMS delivery remains behind the adapter and owner-controlled provider boundary.
- Implement contextual registration/profile flow — protected database drafts are complete; application orchestration and account-completion UI remain in progress.
- Implement external SMS adapter/environment work and later Core application backend slices in the active Backend Campaign.
- Migrate the approved transport-board domain model from browser storage.
- Enforce ownership and authorization server-side.
- Keep contacts unavailable to anonymous users and unconfirmed counterparties.
- Support contextual registration from the action the visitor was already performing.

### 5. Maps and quality matching

- Add the church directory map and address-based church creation.
- Add protected exact driver departure points, up to three passenger meeting points, and driver routes, exposing only approved approximate public representations before mutual confirmation.
- Implement route-aware matching with seat, church, service/date, one-hour time compatibility, detour, direction, and active-status rules.
- Send suggestions only for quality matches; suggestions never confirm a ride automatically.

### 6. My Trips, notifications, profile, and PWA

- Implement `My Trips` with its approved IA V2 sections and agreement history, the in-app notification history, and the lightweight profile with notification settings.
- Preserve church-management entry points without treating church administration as part of personal trips.
- Implement durable in-app notifications, transactional email, and Web Push.
- Follow the IA V2 PWA guidance: provide iPhone installation guidance before Web Push; on Android, use the system installation prompt when supported and otherwise provide browser-specific guidance; keep installation and push permission separate; request push only after a useful user action; and continue important messages by email while push is unavailable.
- Make the web application installable as a PWA.

### 7. Church pages, schedules, administration, and localization

- Implement church creation with address deduplication, immediate publication without routine pre-approval, later protected intervention, archival behavior, and up to three equal administrators.
- Implement recurring and one-time services, exceptions, cancellations, and date/time fallback.
- Support English, Russian, Italian, Romanian, Ukrainian, and German.
- Add prepared translations for system content and stored automatic translations for approved dynamic church content.

### 8. Privacy, terms, support, and operations

- Draft the Terms of Use and Privacy Policy for the selected architecture, providers, data flows, and public international scope.
- Publish approved production document versions and connect the existing versioned acceptance foundation to the final legal UI.
- Implement account deletion, complaints, personal blocking, and the agreed data-retention behavior.
- Keep voluntary external project support separate from prohibited ride payments and commissions.
- Add the support form, owner runbook, protected administrative operations, and audit logging.
- Add minimal product analytics without advertising trackers.
- Obtain appropriate legal review before broad public launch.

### 9. Full end-to-end coverage

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
- Maps, geocoding, routing, protected exact data, approximate public areas/corridors, and quality matching.
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
