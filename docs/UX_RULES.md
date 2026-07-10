# UX rules v0.1

## Core screen

The central screen is the church page.

The church page is a transport board for one church and must answer: «Как мне попасть в храм?»

It shows:

- church information;
- church photo or a local fallback illustration in the hero;
- service schedule;
- active driver offers;
- active passenger requests;
- page-level creation actions.

## Button placement

Main action buttons must belong to specific cards when they act on a specific person or ride.

- «Попросить подвезти» belongs inside a driver offer card.
- «Подвезти» belongs inside a passenger request card.
- «Создать запрос» is a page-level creation action on the church page.
- «Создать поездку / маршрут» is a page-level creation action on the church page.

Do not place generic «Мне нужно место» / «Могу подвезти» as abstract primary actions detached from specific cards.

Do not show a heavy registration step when a passenger creates the first request. The visible button is «Создать запрос», not «Создать запрос и зарегистрироваться».

«Создать запрос» opens a modal titled «Создать запрос на поездку». On desktop it is centered; on mobile it is a large full-width dialog. It has a close control, «Отмена», and Escape support. Successful submit closes it.

## Driver offer card

The card shows a concrete driver trip or regular route.

It should show:

- driver name;
- approximate departure area;
- service / date / time;
- free seats;
- offer type: one-time trip or regular route;
- action button «Попросить подвезти».

The button means: the passenger asks this specific driver for a seat.

## Passenger request card

The card shows a concrete passenger request.

It should show only safe public information:

- passenger first name;
- approximate pickup area or hub;
- number of passengers;
- service / date / time;
- short safe comment;
- action button «Подвезти».

The button means: the driver responds to this specific passenger request.

Never show publicly:

- phone;
- exact address;
- private contact;
- sensitive personal details.

The optional passenger comment is public in an open request. Both open and targeted request forms limit comments to 300 characters and show: «Не указывайте телефон, точный домашний адрес или другие личные данные.» This is a user-facing warning plus the native `maxLength` constraint, not automated filtering or moderation.

## Passenger flow

1. Open app.
2. Language is detected from browser/device.
3. Find or open a church.
4. View the church transport board.
5. If a suitable driver offer exists, tap «Попросить подвезти» inside that offer card.
6. Fill only the required request data: first name, phone, optional email, passenger count, pickup area, optional comment, and consent.
7. Driver receives a targeted notification.
8. Wait for driver answer.
9. If accepted, see participant contact.
10. If no suitable offer exists, tap page action «Создать запрос».
11. Fill first name, phone, optional email, service/event, passenger count, pickup area, optional comment, and consent in the modal.
12. The open request appears in the passenger requests block while active.
13. The app may notify the passenger about compatible driver offers.

Passenger profile should feel like a short request form, not heavy registration. Optional fields must be visibly marked as optional.

The first request form data can later become lightweight PassengerProfile data. In the mock implementation it stays in client-side state and may be used to prefill the form on the next visit.

Pickup area is currently a text label. The UI copy must tell passengers not to enter an exact home address. The future model may support an approximate circular pickup zone with label, optional center latitude, optional center longitude, and optional radius in meters.

Phone input accepts spaces, dashes, and parentheses, but normalizes them away before validation. The normalized value must match `^\+[1-9]\d{7,14}$`. Show «Введите номер в международном формате, например +39 333 123 4567.» when invalid. Optional email must be validated when present.

Visible calendar dates always use `dd.mm.yyyy`; date with time uses `dd.mm.yyyy в HH:mm`. Never render raw ISO dates.

After «Попросить подвезти» on a driver offer, open a targeted request modal with the driver and offer context. The created request is private, appears only in «Мой запрос водителю», and never appears in «Кому нужно место».

## Driver flow

1. Open app.
2. Language is detected from browser/device.
3. Open a church page.
4. View the church transport board.
5. If a suitable passenger request exists, tap «Подвезти» inside that request card.
6. Confirm availability.
7. Current mock implementation creates and persists DriverResponse immediately and shows a personal mock notification.
8. The passenger request hides from the public «Кому нужно место» block while the response is active.
9. Passenger contact opens in the private mock area «Мой отклик» after the driver clicks «Подвезти»; this area is absent before a response exists.
10. Driver can click «Отменить отклик» and confirm cancellation.
11. If cancelled, the request returns to the public list and a mock notification is created.
12. If creating supply instead, tap page action «Создать поездку / маршрут».
13. Create a driver profile if needed.
14. Create one-time trip or regular route.
15. The app may notify the driver about compatible passenger requests.

Driver profile can be more complete because the driver takes responsibility for others.

## Church flow

1. Parish participation is optional.
2. A parish may create or claim a church card.
3. A parish may fill simple public info and update schedule.
4. Product value must not depend on parish activity; drivers and passengers can create transport activity themselves.

## UI priorities

- Mobile interface first.
- Every important action is a large button.
- All interactive controls and clickable links/cards have clear hover, keyboard focus, and pointer-cursor states.
- Disabled controls use a visibly disabled state and a not-allowed cursor; static cards must not look clickable.
- Short forms.
- Passenger request forms contain only the fields required by the open or targeted flow; email and comment remain optional.
- Modal forms remain single-column on mobile and may use two columns only when every field stays within the dialog. Inputs, selects, textareas, consent text, and action buttons must never overflow the modal.
- Avoid dropdowns with huge lists on mobile.
- Use search + suggestions.
- Do not ask for exact home address.
- Prefer pickup hubs and approximate pickup areas.
- Show verification state clearly where relevant.
- Avoid church-political recommendations; show factual jurisdiction/language only.
- Do not force language choice on first visit.
- Provide a manual language switcher somewhere in the UI.
- Supported MVP languages: `ru`, `it`, `en`, `ro`.

## Matching and notifications UX

- Users should not need to constantly monitor the app manually.
- The app should surface relevant possible matches through notifications.
- A notification is not a confirmed match.
- Match suggestions should help users return to the relevant driver offer or passenger request.
- Notification actions must lead to the relevant card, request, or offer.
- Notification text must be short, safe, and privacy-preserving.
- Do not show private contacts inside notification text.
- Do not show phone, exact address, private contact, or sensitive personal data in notifications.
- Notification text may show only safe summary data: first name, church, service/event, approximate area or hub, number of passengers, available seats, and short safe comment.
- Contacts become visible only after the required confirmation creates a RideMatch.
- Current MVP UX may use an in-app notification center and mock notification state.
- A notification is a personal in-app record; a delivery channel is how the user is reached outside the app.
- Production notifications belong to a personal notification center, such as a header bell, user menu, profile area, or dedicated page.
- Web push/PWA push and email are future MVP delivery channels because users may not open the app frequently.
- Telegram is a possible later channel, not a current delivery requirement.
- On the church page, show «Мои уведомления» only as temporary personal mock UI for development/testing, never as public church content.
- Persist mock notifications in localStorage so they survive internal navigation and refresh in the same browser.
- Notification examples: «Создан запрос: Мария ищет место на Литургию.», «Водитель откликнулся на запрос Марии.», «Отклик отменен.»

## Public board visibility

- Active/open passenger requests are visible.
- Matched, cancelled, expired, or completed passenger requests are hidden.
- Active driver offers with free seats are visible.
- Full, cancelled, expired, or completed driver offers are hidden.
- Hidden items remain in internal history.
- Targeted passenger requests are never public board items.

## Mock persistence

- Open passenger requests, driver responses, targeted requests, and personal mock notifications use namespaced localStorage keys.
- State survives back/forward navigation, internal route navigation, and browser refresh.
- This is mock-only browser persistence. Production persistence, authorization, and user isolation belong to the future backend/Firestore implementation.
