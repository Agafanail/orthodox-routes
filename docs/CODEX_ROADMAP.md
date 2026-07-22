# Roadmap for Codex tasks

Roadmap follows the approved product sequence: validate the church transport board first, then introduce identity, backend persistence, and delivery integrations. Do not add future functionality silently or combine multiple phases into one task without explicit approval.

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
- Initial Vitest unit-test foundation for validation, date formatting, request visibility/state transitions, and safe localStorage parsing.
- Basic GitHub Actions CI for clean-install tests, lint, and production builds on main-branch pushes and pull requests.
- First church transport board component-extraction refactor for the request dialog, passenger request card, and mock notification center.
- Second church transport board presentational extraction for page actions, request and response panels, targeted requests, and driver offers.
- Centralized one-time-trip visibility based on open status, available seats, and a local departure date and time that has not passed.
- Complete local mock driver-offer flow with reusable driver identity, one-time trips, regular routes, and cancellation history.
- Human-language driver-offer UI with trip-specific origin, numeric maximum detour, 1–55 seat selection, blur/touched validation, human cancellation copy, and static-plus-browser-local church counters.
- Role-labelled passenger/driver page actions, origin-to-church offers with numeric maximum detour, shared compact service/date selection, and an intentional no-schedule church scenario.

The current prototype has no backend, authentication, real user isolation, push/email delivery, Firebase, Google Maps, Telegram, payments, SMS, WhatsApp API, or admin features.

## Next priorities

1. Expand automated coverage with component and end-to-end tests after the current pure transition helpers are stable.
2. Introduce authentication and backend persistence only after the mock request and confirmation flows are stable.
3. Move personal notifications and private match history into dedicated authenticated personal areas.
4. Add web/PWA push and email delivery after notification ownership and backend events are defined.
5. Consider maps for church discovery/approximate pickup zones and Telegram as a later optional channel only after the core product is validated.

## Before any real multi-user pilot

### Privacy and terms readiness

- Draft a Privacy Policy and Terms of Use for the actual product architecture.
- Obtain legal review for the actual launch countries.
- Link both documents from registration and relevant product surfaces.
- Require an unchecked registration acceptance checkbox.
- After backend and authentication exist, record the accepted document versions and timestamp.
- Explain participant-to-participant phone and email disclosure clearly.
- Define access, correction, export, and deletion request handling.

Do not draft final legal text until backend, authentication, processors, retention periods, hosting, analytics, notification providers, and launch jurisdictions are known.

## Later product work

- Optional parish coordinator tools for maintaining church information and uploading a church photo.
- Moderation and admin capabilities after core ride coordination is validated.
- Localization for `ru`, `it`, `en`, and `ro` with browser/device detection and a manual switcher.
- Deployment and operational monitoring after backend architecture is selected.

## Out of current scope

- Payments and donations.
- SMS and WhatsApp Business API.
- Ratings.
- Complex route optimization.
- Native iOS/Android applications.
- Mandatory parish participation.
- Mandatory map-first navigation or church-page tabs.
