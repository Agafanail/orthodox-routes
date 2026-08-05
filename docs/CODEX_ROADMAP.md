# Roadmap for Codex tasks

Roadmap separates the implemented browser-only prototype from the approved first complete public multi-user version. Product purpose and version boundaries are defined by [ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md](ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md); target screens, navigation, journeys, permissions, states, visibility, routes, taxonomy, and content structure are defined by [ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md](ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md). The phases below are an implementation sequence for that one complete approved version, not a series of reduced product releases. Do not add future functionality silently or combine multiple phases into one task without explicit approval.

## Authority and current phase

- The Product Scope is the authority for product purpose and first-version boundaries.
- IA V2 is the authority for target-product screens, navigation, journeys, permissions, states, visibility, URL model, taxonomy, and content model.
- The code, tests, and README describe what is implemented now.
- `PROJECT_SPEC_V0_1.md`, `DATA_MODEL.md`, `UX_RULES.md`, and `PROJECT_MAP.md` remain explicitly labelled prototype or legacy references and cannot override Product Scope or IA V2.
- Information architecture is complete at the approved-document level. Empirical card sorting and tree testing remain future validation work recorded in IA V2, not invented research results.
- **Initial Design System** is complete and approved. The active product phase is **Backend and integration architecture**. Phase status alone does not authorize implementation inside a documentation-only task.
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
- First church transport board component-extraction refactor for the request dialog, passenger request card, and mock notification center.
- Second church transport board presentational extraction for page actions, request and response panels, targeted requests, and driver offers.
- Centralized one-time-trip visibility based on open status, available seats, and a local departure date and time that has not passed.
- Complete local mock driver-offer flow with reusable driver identity, one-time trips, regular routes, and cancellation history.
- Human-language driver-offer UI with trip-specific origin, numeric maximum detour, 1–55 seat selection, blur/touched validation, human cancellation copy, and static-plus-browser-local church counters.
- Role-labelled passenger/driver page actions, origin-to-church offers with numeric maximum detour, shared compact service/date selection, and an intentional no-schedule church scenario.

The current prototype has no backend, authentication, real user isolation, push/email delivery, Firebase, Google Maps, Telegram, payments, SMS, WhatsApp API, or admin features.

## Development sequence

### 1. Information architecture — completed

- Approved in [ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md](ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md).
- Defines the complete screen inventory, mobile/desktop navigation, URL model, roles, permissions, visibility, content model, journeys, and states.
- Records the future card-sorting and tree-testing protocol without claiming that user research has already occurred.

### 2. Initial design system — completed

- Establish the visual direction and reusable foundations.
- Design key mobile and desktop samples: church directory/map, church page/transport board, trip and request cards, forms, My Trips, notifications, profile, navigation, and empty states.
- Review each important screen manually.
- Approved foundations and the isolated `/design-preview` review artifact are recorded in [ORTHODOX_ROUTES_DESIGN_SYSTEM_V1.md](ORTHODOX_ROUTES_DESIGN_SYSTEM_V1.md).

### 3. Backend and integration architecture — active phase

Choose and document:

- database, backend, hosting, deployment, backups, and monitoring;
- passwordless email-link authentication, SMS phone verification, and account recovery;
- authorization boundaries and contact disclosure;
- maps, geocoding, routing, quotas, and cost controls;
- transactional email, Web Push, PWA installation, and offline form drafts;
- automatic translation, localized-content storage, images, analytics, audit logs, retention, and deletion.

Update the data model and project diagrams after these decisions are approved.

### 4. Core multi-user platform

- Implement the backend, passwordless email-link authentication, SMS phone verification, the 18+ declaration, and Terms acceptance.
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
- Record acceptance of document versions and timestamps.
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
