# Roadmap for Codex tasks

Do not ask Codex to build the whole product in one task. Use these steps.

## Phase 0 — repo setup

1. Create Next.js app with TypeScript, Tailwind, ESLint, App Router, src directory and AGENTS.md.
2. Add Firebase client config and `.env.example`.
3. Add base layout, header, mobile-first styles.
4. Add static placeholder data for churches, routes and trips.

## Phase 1 — public prototype without auth

5. Build homepage with Google Map placeholder/list fallback.
6. Build church card page with tabs: How to get there / Schedule / About.
7. Build visible drivers block on church page.
8. Build trips and routes blocks.
9. Add Google Maps link button.

## Phase 2 — Firebase data

10. Connect Firestore read for churches/routes/trips.
11. Add create/edit church for admin/church_admin.
12. Add create route for driver.
13. Add create trip for driver.
14. Add ride request form for passenger.

## Phase 3 — auth and roles

15. Add Firebase Auth phone login for passenger/driver.
16. Add Firebase Auth email login for church_admin.
17. Create user profile on first login.
18. Protect driver/church/admin routes.

## Phase 4 — request workflow

19. Passenger requests a seat on trip.
20. Driver receives request in dashboard.
21. Driver accepts/declines.
22. Contact details become visible only after acceptance.
23. Seats count updates after acceptance.

## Phase 5 — notifications

24. Add in-app notifications.
25. Add FCM push subscription and send push for ride requests.
26. Add email sending.
27. Add Telegram bot webhook and send Telegram notifications.

## Phase 6 — admin and moderation

28. Admin can verify churches.
29. Admin can approve church claims.
30. Admin can hide suspicious users/routes/trips.

## Phase 7 — i18n

31. Add ru/en/it/ro interface strings.
32. Add language switcher.
