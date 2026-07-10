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

The current prototype has no backend, authentication, real user isolation, push/email delivery, Firebase, Google Maps, Telegram, payments, SMS, WhatsApp API, or admin features.

## Next priorities

1. Clean and componentize the current mock UI without changing approved flows.
2. Add automated tests for validation, localStorage persistence, public/private visibility, open requests, targeted requests, response cancellation, and date formatting.
3. Complete the driver offer creation mock flow for one-time trips and regular routes.
4. Define and validate the real confirmation and `RideMatch` flow, including when contacts are shared and seats decrease.
5. Introduce authentication and backend persistence only after the mock request and confirmation flows are stable.
6. Move personal notifications into a dedicated personal notification center.
7. Add web/PWA push and email delivery after notification ownership and backend events are defined.
8. Consider maps for church discovery/approximate pickup zones and Telegram as a later optional channel only after the core product is validated.

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
