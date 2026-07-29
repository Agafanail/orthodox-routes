# Roadmap for Codex tasks

Roadmap separates the implemented browser-only prototype from the approved first full multi-user version. The destination is defined by [ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md](ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md). Do not add future functionality silently or combine multiple phases into one task without explicit approval.

## Authority and current phase

- The Product Scope is the authority for target-product behavior and first-version boundaries.
- The code, tests, and README describe what is implemented now.
- `PROJECT_SPEC_V0_1.md`, `DATA_MODEL.md`, `UX_RULES.md`, and `PROJECT_MAP.md` remain prototype references until the corresponding roadmap phase updates them.
- The active product phase is **information architecture**. New full-version feature implementation starts only after that phase is approved.
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

### 1. Information architecture — current phase

- Define the complete screen inventory and mobile/desktop navigation.
- Document visitor, registered-user, and church-page-administrator states.
- Define loading, empty, error, expired, cancelled, archived, and permission-denied states.
- Reconcile future journeys with the approved Product Scope before implementation.

### 2. Initial design system

- Establish the visual direction and reusable foundations.
- Design key mobile and desktop samples: church directory/map, church page/transport board, trip and request cards, forms, notifications, personal area, navigation, and empty states.
- Review each important screen manually.

### 3. Backend and integration architecture

Choose and document:

- database, backend, hosting, deployment, backups, and monitoring;
- passwordless email-link authentication and account recovery;
- authorization boundaries and contact disclosure;
- maps, geocoding, routing, quotas, and cost controls;
- transactional email, Web Push, PWA installation, and offline form drafts;
- automatic translation, localized-content storage, images, analytics, audit logs, retention, and deletion.

Update the data model and project diagrams after these decisions are approved.

### 4. Core multi-user platform

- Implement the backend and passwordless email-link authentication.
- Migrate the approved transport-board domain model from browser storage.
- Enforce ownership and authorization server-side.
- Keep contacts unavailable to anonymous users and unconfirmed counterparties.
- Support contextual registration from the action the visitor was already performing.

### 5. Maps and quality matching

- Add the church directory map and address-based church creation.
- Add exact driver departure points, up to three passenger meeting points, and driver routes.
- Implement route-aware matching with seat, church, service/date, one-hour time compatibility, detour, direction, and active-status rules.
- Send suggestions only for quality matches; suggestions never confirm a ride automatically.

### 6. Personal area, notifications, and PWA

- Implement the personal dashboard, active items, agreements, history, contacts, settings, and church-page administration entry points.
- Implement durable in-app notifications, transactional email, and Web Push.
- Ask for push permission after the user's first successful action and provide the agreed iPhone PWA guidance.
- Make the web application installable as a PWA.

### 7. Church pages, schedules, administration, and localization

- Implement church creation with address deduplication, archival behavior, and up to three equal administrators.
- Implement recurring and one-time services, exceptions, cancellations, and date/time fallback.
- Support English, Russian, Italian, Romanian, Ukrainian, and German.
- Add prepared translations for system content and stored automatic translations for approved dynamic church content.

### 8. Privacy, terms, support, and operations

- Draft the Terms of Use and Privacy Policy for the selected architecture, providers, data flows, and pilot countries.
- Record acceptance of document versions and timestamps.
- Implement account deletion and the agreed data-retention behavior.
- Add the support form, owner runbook, protected administrative operations, and audit logging.
- Add minimal pilot analytics without advertising trackers.
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

### 12. Closed pilot

Start only when the Product Scope readiness criteria are met and users no longer need to imagine missing core behavior. Use several churches in the intended pilot regions, measure real coordination outcomes, and keep a manual support fallback.

## Required before a real multi-user pilot

- Backend, authentication, server-side authorization, and cross-device persistence.
- Maps, geocoding, routing, exact points, and quality matching.
- Complete driver, passenger, confirmation, contact-disclosure, capacity, and cancellation flows.
- Personal areas and real in-app, email, and Web Push notifications.
- Installable PWA behavior.
- Church-page creation, schedules, archival, and multiple equal administrators.
- Six approved interface and notification languages.
- Terms of Use, Privacy Policy, consent recording, deletion, support, and operational runbook.
- Critical automated and E2E coverage plus manual device/browser verification.
- Finished, accessible interface with understandable loading, empty, error, and weak-network states.

## Explicitly excluded from the first full version

- SMS, Telegram bots, WhatsApp, and other messenger integrations.
- Built-in chat.
- Ratings, reviews, payments, prices, commissions, and subscriptions.
- Native iOS and Android applications.
- Identity, age, driving-licence, insurance, vehicle, parish-membership, jurisdiction, or church-page verification.
- Regular passenger requests.
- User photos, vehicle photos, and galleries.
- User-to-user blocking, complaint workflows, and a full moderation system.
- Multiple church-administrator permission levels and a platform-owner dashboard.
- Complex route optimization, calendar synchronization, social feeds, and diocesan analytics.
- Full offline mode and special transport logic for children or vulnerable passengers.

These exclusions do not prevent protected manual administrative intervention through the selected backend when required.
