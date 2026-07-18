# UX rules v0.1

## Core screen

The central screen is the church page.

The church page is a transport board for one church and must answer: «Как мне попасть в храм?»

All user-facing copy must use plain human language for ordinary parishioners. UI text must describe the action or consequence, never implementation concepts such as local/mock/public profiles, local history, localStorage, persisted state, or ownership IDs. Technical terms remain appropriate in code and technical documentation.

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
- The page-level passenger role card uses «Я пассажир», «Укажите, откуда и к какой службе хотите поехать.», and «Попросить подвезти» to open a general public request.
- The page-level driver role card uses «Я водитель», «Укажите, откуда и когда вы едете и сколько у вас свободных мест.», and «Предложить поездку» to open driver offer creation.
- «Попросить подвезти» inside a specific driver-offer card remains a targeted request and must not be confused with the general passenger action.

Do not place generic «Мне нужно место» / «Могу подвезти» as abstract primary actions detached from specific cards.

Do not show a heavy registration step when a passenger creates the first request. The page-level button is «Попросить подвезти» and the modal submit remains «Создать запрос»; never use «Создать запрос и зарегистрироваться».

The general «Попросить подвезти» passenger action opens a modal titled «Создать запрос на поездку». On desktop it is centered; on mobile it is a large full-width dialog. It has a close control, «Отмена», and Escape support. Successful submit closes it.

## Driver offer card

The card shows a concrete driver trip or regular route.

It should show:

- driver name;
- trip-specific origin;
- maximum detour in kilometres, or a clear statement that the driver follows only their route;
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
10. If no suitable offer exists, tap «Попросить подвезти» in the «Я пассажир» role card.
11. Fill first name, phone, optional email, a future church service or separate alternative date, passenger count, pickup area, optional comment, and consent in the modal.
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
12. If creating supply instead, tap «Предложить поездку» in the «Я водитель» role card.
13. In the modal, choose «Разовая поездка» or «Регулярная поездка».
14. On the first browser-local offer, enter name, private phone, and optional private email. Labels use asterisks for required fields; the UI does not ask for a profile-level departure area.
15. For every offer, enter the trip-specific origin, choose a numeric maximum detour from `0`, `2`, `5`, `10`, `15`, or `20` kilometres, choose 1–55 free seats, and set the return-trip choice. Do not require pickup-point enumeration.
16. For a one-time trip, use the shared compact dropdown to choose one of up to five nearest future church services or use the separately visible «Другая дата» field, then enter an independent approximate departure time. Selecting a service clears the alternative date and entering a date clears the service.
17. For a regular trip, choose at least one weekday and the usual departure time.
18. After creating a one-time trip, replace the form heading and body with one clean success state led by «Поездка создана». Show the visually secondary «Ездите в храм так регулярно?» suggestion without a nested bordered card. «Добавить регулярную поездку» switches the same dialog to a prefilled regular form without carrying over the service or date; «Закрыть» closes it.
19. A regular trip is never created automatically.
20. Only browser-owned offers show cancellation. The confirmation explains only that passengers will no longer be able to choose the trip; internal cancelled-history behavior is not exposed in UI copy.
21. The app may notify the driver about compatible passenger requests.

Driver profile can be more complete because the driver takes responsibility for others.

The offer modal is mobile-first, closes by its close control, «Отмена», overlay click, or Escape, and locks body scrolling while open. Untouched fields show no errors. A field validates on blur; once its error is visible, it revalidates while edited without removing unrelated errors. Submit validates the whole form, preserves entered data, keeps the dialog open when invalid, and focuses the first invalid field. Driver phone and email are private fields and must not appear in public cards, offer objects, or notifications. A browser-local driver card is not linked to a server driver route, and its displayed origin is derived from that driver's active offers for the current church.

The open passenger form and one-time driver form use the same compact native service dropdown and shared future-service options. Long labels must remain constrained by the modal width. «Другая дата» is always a separate visible date field, never a dropdown option. If a church has no structured future services, neither form renders an empty or disabled dropdown; only the date field is shown. The second mock church intentionally covers this no-schedule state.

`maxDetourKm` is not a map match. Until route geometry exists, the UI must not claim that a passenger is on the route or within the selected distance; the driver evaluates the passenger's requested pickup location manually.

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
- Normal focused form controls use a neutral stone/gray focus state. Red styling appears only after blur or submit validation identifies an error for that field.
- Editing an invalid field revalidates only that field; other unresolved field errors remain visible until corrected or the form is submitted again.
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
- A one-time trip is visible and available in the passenger service/event choices only while `status === 'open'`, `seatsAvailable > 0`, and its local departure date and time have not passed.
- Hidden items remain in internal history.
- Targeted passenger requests are never public board items.
- Church-list counters merge static and sanitized browser-local offers by church. They count unique active drivers, active regular trips, and visible one-time trips using the centralized visibility rules.

## Mock persistence

- Open passenger requests, driver responses, targeted requests, personal mock notifications, one local driver profile, and local trip/route history use namespaced localStorage keys.
- State survives back/forward navigation, internal route navigation, and browser refresh.
- Local ownership is based on the current browser profile plus membership in the local offer collections, never on a displayed driver name.
- localStorage can be manually modified and is not real authorization. Production persistence, authorization, ownership checks, and user isolation belong to the future backend/Firestore implementation.
