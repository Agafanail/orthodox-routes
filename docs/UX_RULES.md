# UX rules v0.1

## Core screen

The central screen is the church page.

The church page is a transport board for one church and must answer: «Как мне попасть в храм?»

It shows:

- church information;
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

## Passenger flow

1. Open app.
2. Language is detected from browser/device.
3. Find or open a church.
4. View the church transport board.
5. If a suitable driver offer exists, tap «Попросить подвезти» inside that offer card.
6. Fill minimal contact/request data, maximum 5 fields.
7. Wait for driver answer.
8. If accepted, see participant contact.
9. If no suitable offer exists, tap page action «Создать запрос».
10. The open request appears in the passenger requests block while active.

Passenger profile should feel like a short request form, not heavy registration.

## Driver flow

1. Open app.
2. Language is detected from browser/device.
3. Open a church page.
4. View the church transport board.
5. If a suitable passenger request exists, tap «Подвезти» inside that request card.
6. Confirm availability.
7. If passenger confirms, contacts open to participants.
8. If creating supply instead, tap page action «Создать поездку / маршрут».
9. Create a driver profile if needed.
10. Create one-time trip or regular route.

Driver profile can be more complete because the driver takes responsibility for others.

## Church flow

1. Parish participation is optional.
2. A parish may create or claim a church card.
3. A parish may fill simple public info and update schedule.
4. Product value must not depend on parish activity; drivers and passengers can create transport activity themselves.

## UI priorities

- Mobile interface first.
- Every important action is a large button.
- Short forms.
- Passenger request form has maximum 5 fields.
- Avoid dropdowns with huge lists on mobile.
- Use search + suggestions.
- Do not ask for exact home address.
- Prefer pickup hubs and approximate pickup areas.
- Show verification state clearly where relevant.
- Avoid church-political recommendations; show factual jurisdiction/language only.
- Do not force language choice on first visit.
- Provide a manual language switcher somewhere in the UI.
- Supported MVP languages: `ru`, `it`, `en`, `ro`.

## Public board visibility

- Active/open passenger requests are visible.
- Matched, cancelled, expired, or completed passenger requests are hidden.
- Active driver offers with free seats are visible.
- Full, cancelled, expired, or completed driver offers are hidden.
- Hidden items remain in internal history.
