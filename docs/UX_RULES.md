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

The public transport board places «Ищут место» on the left and «Предлагают поездки» on the right at desktop widths. On mobile they stack in that order. The columns keep their natural heights. «Предлагают поездки» retains separate «Регулярные поездки» and «Разовые поездки» subsections. The church page has no separate public «Водители» block; `/drivers` and driver names inside offers remain available.

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

One-time availability uses one line only. With all seats free, show «Свободно N мест» and the green «Есть свободные места» badge. With partial occupancy, show «Свободно N из M мест» and the yellow «Часть мест занята» badge. A full one-time trip leaves the active list.

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

A linked open request for the remaining part of a group stays as one active card and shows «Нужно ещё N мест из первоначальных M» with the yellow «Часть группы уже едет» badge. It must not also produce a completed card. Once the root need is resolved, show one compact summary such as «4 из 4 человек договорились о поездке» and use correct Russian count forms.

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
6. For a regular route, first select one of up to five nearest future dates; a full date remains visible but disabled and later dates keep their independent availability.
7. Reuse one compatible open request with «Отправить этот запрос», select among several, or choose «Создать другой запрос» and fill the normal form.
8. Driver receives a targeted notification.
9. Driver may accept the full count, decline, or offer fewer seats.
10. A partial offer shows «Сергей может подвезти 2 из 4 человек.» with «Принять 2 места» and «Отклонить».
11. Only final acceptance creates a RideMatch and reveals participant contacts.
12. If no suitable offer exists, tap «Попросить подвезти» in the «Я пассажир» role card.
13. Fill first name, phone, optional email, a future church service or separate alternative date, passenger count, pickup area, optional comment, and consent in the modal.
14. The open request remains public while any driver responses are pending.
15. Accepting one response creates a RideMatch, closes the original request, and expires its other pending responses.
16. After a partial match, publish a copied request for the remaining count, edit the prefilled request, or say that no more seats are needed.

Passenger profile should feel like a short request form, not heavy registration. Optional fields must be visibly marked as optional.

The first request form data can later become lightweight PassengerProfile data. In the mock implementation it stays in client-side state and may be used to prefill the form on the next visit.

Pickup area is currently a text label. The UI copy must tell passengers not to enter an exact home address. The future model may support an approximate circular pickup zone with label, optional center latitude, optional center longitude, and optional radius in meters.

Phone input accepts spaces, dashes, and parentheses, but normalizes them away before validation. The normalized value must match `^\+[1-9]\d{7,14}$`. Show «Введите номер в международном формате, например +39 333 123 4567.» when invalid. Optional email must be validated when present.

Open and targeted passenger forms follow the same validation interaction as the driver-offer form. Required labels show an asterisk. Fields validate on blur; a visible error revalidates while that field is edited without clearing unrelated errors. Invalid submit preserves every entered value, keeps the dialog open, and focuses the first invalid field. Required passenger fields are name, phone, passenger count, pickup area, the applicable service or alternative date, and contact-sharing consent. Email and comment remain visibly optional.

Visible calendar dates always use `dd.mm.yyyy`; date with time uses `dd.mm.yyyy в HH:mm`. Never render raw ISO dates.

After «Попросить подвезти» on a driver offer, open a targeted request modal with the driver and offer context. Compatible open requests for the same church and service or concrete date are offered for reuse before the normal form. Reuse links the targeted request to its source and excludes a source already sent to the same offer occurrence. The created request is private, appears only in «Мой запрос водителю», and never appears in «Ищут место».

If the selected offer occurrence still has at least one seat but fewer than the requested count, show the exact yellow inline warning for the current counts, keep submission enabled, and do not open another confirmation dialog. Zero availability disables submission. The warning is not a validation error and updates with the passenger count or regular-route date.

## Driver flow

1. Open app.
2. Language is detected from browser/device.
3. Open a church page.
4. View the church transport board.
5. If a suitable passenger request exists, tap «Подвезти» inside that request card.
6. The response dialog lists only compatible browser-owned active offers for the request date with at least one available seat.
7. Select one concrete offer and a positive seat count up to both current capacity and the requested count.
8. If no compatible public offer exists, use the short «Предложить места пассажиру» form. Ask only for origin, departure time, offered count, optional maximum detour, required contact-sharing consent, and driver contact fields when they are not stored.
9. Sending either response keeps the passenger request public and contacts hidden. A short-form response is private to that request, creates no public Trip or Route, and never publishes unused seats.
10. Passenger acceptance revalidates capacity or the private departure, creates a RideMatch, closes the request, expires competing driver responses and linked targeted requests, and reveals both participants' contacts privately.
11. If creating supply instead, tap «Предложить поездку» in the «Я водитель» role card.
12. In the modal, choose «Разовая поездка» or «Регулярная поездка».
13. On the first browser-local offer, enter name, private phone, and optional private email. Labels use asterisks for required fields; the UI does not ask for a profile-level departure area.
14. For every offer, enter the trip-specific origin, choose a numeric maximum detour from `0`, `2`, `5`, `10`, `15`, or `20` kilometres, choose 1–55 free seats with the shared editable minus/value/plus control, and set the return-trip choice. Do not require pickup-point enumeration.
15. For a one-time trip, use the shared compact dropdown to choose one of up to five nearest future church services or use the separately visible «Другая дата» field, then enter an independent approximate departure time.
16. For a regular trip, choose at least one weekday and the usual departure time.
17. After creating either offer type, close the dialog, show compact transient success feedback, and move to the published card.
18. Only browser-owned offers show cancellation. If future confirmed matches exist, the dialog warns that those agreements will also be cancelled and affected passengers notified.
19. The app may notify the driver about compatible passenger requests using cautious date/church compatibility language, not map claims.

Driver profile can be more complete because the driver takes responsibility for others.

The offer modal is mobile-first, closes by its close control, «Отмена», overlay click, or Escape, and locks body scrolling while open. Untouched fields show no errors. A field validates on blur; once its error is visible, it revalidates while edited without removing unrelated errors. Submit validates the whole form, preserves entered data, keeps the dialog open when invalid, and focuses the first invalid field. Driver phone and email are private fields and must not appear in public cards, offer objects, or notifications. A browser-local driver card is not linked to a server driver route, and its displayed origin is derived from that driver's active offers for the current church.

When no compatible public driver offer exists, the short private-offer form opens with one concise sentence naming the passenger, destination church, and selected service or concrete date, then explains that the driver should complete only the missing trip data. It must not imply that the offer is public.

Two-column form fields reserve one compact inline-validation row below each control. Showing a phone or email error must not move the neighboring control; mobile keeps the same fields in a natural single column without horizontal overflow.

Successful create, send, update, and confirmation actions use a compact green status at the top center of the viewport. It is dismissible, announced to assistive technology, disappears after about four seconds, and does not interrupt the workflow. Close an open dialog, smoothly scroll to the created or updated card, briefly highlight it, and respect reduced-motion preferences. Actual save or processing failures use the same compact pattern in red. Field validation remains inline and must never be replaced by transient feedback. This action feedback is ephemeral UI state and is separate from persisted personal mock notifications.

Passenger count and driver free-seat count use the same reusable control: accessible minus and plus buttons around a directly editable number input. Both accept only integers from 1 through 55, disable stepping at the boundaries, support keyboard, pointer, and touch input, and remain within the mobile modal width.

The open passenger form and one-time driver form use the same compact native service dropdown and shared future-service options under «Когда вы едете *». Long labels must remain constrained by the modal width. «Другая дата» is always a separate visible date field without its own required marker, never a dropdown option. Selecting either choice clears the other. If a church has no structured future services, neither form renders an empty or disabled dropdown; only the date field is shown. The second mock church intentionally covers this no-schedule state.

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
- Show all participant-provided phone and optional email methods only in private confirmed/cancelled match cards, with «Позвонить» and «Написать по email» actions.
- The required passenger consent copy is «После подтверждения поездки водитель увидит мой телефон и электронную почту, если я её указал, а я увижу его контакты. Я согласен на это.» The checkbox remains required, unchecked by default, and resets in copied, prefilled, edit, and republication forms.
- Where the driver form presents equivalent consent, use «После подтверждения поездки пассажир увидит мой телефон и электронную почту, если я её указал, а я увижу его контакты. Я согласен на это.»
- Every active one-time and regular driver-offer card shows «Контакты откроются после подтверждения поездки.» exactly once and never includes contact details.
- The confirmed-match cancellation dialog uses «Отменить договорённость?». Passenger cancellation explains that the driver can offer the seats again and that the old request can be republished; driver cancellation explains that the passenger will be notified and the seats become available to others.
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
- Fully resolved requests leave the active block. A linked open remainder stays as one active root-request representation; cancelled and expired requests remain private.
- Active driver offers with free seats are visible.
- Full occurrences leave active content; cancelled and expired offers remain private.
- A one-time trip is visible and available in the passenger service/event choices only while `status === 'open'`, `seatsAvailable > 0`, and its local departure date and time have not passed.
- Hidden items remain in internal history.
- Targeted passenger requests are never public board items.
- Church-list counters merge static and sanitized browser-local offers by church. They count unique active drivers, active regular trips, and visible one-time trips using the centralized visibility rules.
- One shared `Уже договорились` section appears below both primary columns and combines completed passenger requests, full one-time trips, and partial or full date-specific regular occurrences. Hide it when empty and show at most five upcoming cards.
- Public completed activity is aggregated once per root passenger request, once per one-time trip, and once per `routeId + rideDate`. Partial regular occurrences use a yellow `Часть мест занята` badge and occupied count; full occurrences, full one-time trips, and passenger summaries use gray completed cards. Cards identify the offer type where relevant, are non-clickable and action-free, and exclude phone, email, pickup area, private comments, exact addresses, and other private data.
- Every active status uses a text label in addition to color: «Ищет поездку», «Часть группы уже едет», «Есть свободные места», or «Часть мест занята» as appropriate. Private panels retain their confirmation and cancellation labels.

## Mock persistence

- Open passenger requests, driver responses, targeted requests, RideMatches, personal mock notifications, one local driver profile, and local trip/route history use namespaced localStorage keys.
- State survives back/forward navigation, internal route navigation, and browser refresh.
- Local ownership is based on the current browser profile plus membership in the local offer collections, never on a displayed driver name.
- localStorage can be manually modified and is not real authorization. Production persistence, authorization, ownership checks, and user isolation belong to the future backend/Firestore implementation.
- Legacy `pendingContact` responses become inactive and never expose contacts. Malformed records and unexpected fields are ignored or sanitized into explicit safe shapes.
