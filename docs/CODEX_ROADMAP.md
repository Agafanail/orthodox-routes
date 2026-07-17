# Roadmap for Codex tasks

Roadmap follows the approved product sequence: validate the church transport board first, then introduce identity, backend persistence, and delivery integrations. Do not add future functionality silently or combine multiple phases into one task without explicit approval.

## Current implemented mock prototype

- Next.js App Router prototype with React, TypeScript, Tailwind CSS, and ESLint.
- Public routes for churches and drivers without registration.
- Church page as the central transport board.
- Visible drivers, regular routes, and one-time trips.
- Open passenger request modal.
- Targeted passenger request modal linked to a specific route or trip.
- Mock driver response, cancellation, and conditional private mock panels.
- Namespaced localStorage persistence for open requests, responses, targeted requests, and notifications.
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

The current prototype has no backend, authentication, real user isolation, push/email delivery, Firebase, Google Maps, Telegram, payments, SMS, WhatsApp API, or admin features.

## Next priorities

1. Complete the driver offer creation mock flow for one-time trips and regular routes.
2. Expand automated coverage beyond the initial pure-logic unit tests; component and end-to-end tests remain future work.
3. Define and validate the real confirmation and `RideMatch` flow, including when contacts are shared and seats decrease.
4. Introduce authentication and backend persistence only after the mock request and confirmation flows are stable.
5. Move personal notifications into a dedicated personal notification center.
6. Add web/PWA push and email delivery after notification ownership and backend events are defined.
7. Consider maps for church discovery/approximate pickup zones and Telegram as a later optional channel only after the core product is validated.

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
