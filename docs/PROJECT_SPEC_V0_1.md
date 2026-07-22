# ТЗ v0.1 — «Православные маршруты»

## Цель

Создать PWA-сервис, который помогает православным людям без машины добраться до конкретного храма на конкретную службу через открытые запросы пассажиров и предложения водителей.

Orthodox Routes — не Orthodox Uber. Это транспортная доска храма, где водители и пассажиры координируют поездки к службе.

Центральный экран продукта — страница храма. Она работает как transport board одного храма.

## Принципы продукта

- Храм может вести карточку, но продукт не зависит от активности прихода.
- Главная единица продукта: храм + служба + предложение водителя или запрос пассажира.
- Пассажир не выбирает абстрактный каталог водителей. Он видит страницу храма, активные предложения водителей и активные запросы пассажиров.
- Контакты водителя и пассажира открываются только после подтвержденного совпадения.
- Уведомление или автоматическая подсказка не создают подтвержденный match сами по себе.
- Публичная доска показывает «Ищут место» слева и «Предлагают поездки» справа на desktop, в том же порядке вертикально на mobile. Активные элементы идут первыми. Пассажирские summary остаются в своём подразделе, а предложения водителей используют один общий «Уже договорились» после регулярных и разовых поездок; cancelled и прошедшая активность остаются только в приватной истории.
- Не заставлять пользователя выбирать язык при первом входе. Язык определяется из браузера/устройства, ручной переключатель доступен в интерфейсе.
- MVP-языки: `ru`, `it`, `en`, `ro`.

## Роли

### Пассажир

- просматривает храмы без регистрации;
- открывает страницу храма;
- видит расписание, активные предложения водителей и активные запросы пассажиров;
- нажимает «Попросить подвезти» внутри карточки конкретного предложения водителя;
- либо нажимает «Попросить подвезти» в page-level карточке «Я пассажир», если подходящего предложения нет;
- заполняет короткую форму с минимальными контактными/профильными данными без видимого тяжелого шага регистрации;
- получает ответ водителя;
- получает уведомления о реакции конкретного водителя или о возможных подходящих предложениях;
- после подтвержденного совпадения видит приватный контакт участника поездки.

### Водитель

- просматривает храмы;
- создает профиль водителя перед созданием поездок или маршрутов;
- открывает страницу храма;
- нажимает «Подвезти» внутри карточки конкретного запроса пассажира;
- либо нажимает «Предложить поездку» в page-level карточке «Я водитель»;
- создает разовую поездку или регулярный маршрут;
- принимает или отклоняет адресные запросы пассажиров;
- получает уведомления о реакции конкретного пассажира или о возможных подходящих запросах;
- после подтвержденного совпадения видит приватный контакт пассажира.

### Представитель храма

- может создать или запросить управление карточкой храма;
- заполняет простую публичную информацию: название, локация, юрисдикция, языки, расписание, публичные контакты;
- может обновлять карточку, если claim подтвержден.

Участие прихода необязательно: страница храма должна оставаться полезной, если активность создают водители и пассажиры.

### Админ сервиса

- проверяет новые храмы;
- подтверждает представителей храмов;
- модерирует жалобы;
- может скрыть храм, предложение водителя, запрос пассажира, маршрут или пользователя.

Админские возможности не входят в текущую mock-only реализацию.

## Основные сущности

- User
- Church
- ServiceEvent
- PassengerProfile
- DriverProfile
- ParishCoordinatorProfile
- DriverOffer
- PassengerRequest
- DriverResponse
- RideMatch
- MatchSuggestion
- HubPoint
- Notification
- ChurchClaim

## Главные экраны

1. Главная / список или карта храмов.
2. Поиск храма.
3. Страница храма как транспортная доска.
4. Профиль водителя.
5. Короткая пассажирская форма / профиль.
6. Создание запроса пассажира.
7. Создание поездки / маршрута водителя.
8. Уведомления.
9. Создание/редактирование карточки храма.
10. Админ-панель.

## Страница храма

Страница храма должна отвечать на вопрос: «Как мне попасть в храм?»

Она показывает:

- информацию о храме;
- фотографию храма или стандартную fallback-иллюстрацию;
- расписание служб;
- активные предложения водителей:
  - разовые поездки;
  - регулярные маршруты;
- активные запросы пассажиров;
- page-level role actions:
  - «Я пассажир» / «Попросить подвезти» opens the general public passenger-request flow;
  - «Я водитель» / «Предложить поездку» opens driver-offer creation.

Hero страницы использует изображение храма. Координатор сможет загрузить фотографию позже; в текущем mock используется локальная fallback-иллюстрация без upload и Storage. Вместо большого внутреннего объяснения показываются компактные тексты «Транспортная доска храма» и «Здесь можно попросить подвезти или предложить поездку».

### Карточка предложения водителя

Показывает конкретную поездку или маршрут водителя:

- имя водителя;
- примерный район выезда;
- службу / дату / время;
- свободные места;
- тип предложения: разовая поездка или регулярный маршрут;
- кнопку «Попросить подвезти».

Кнопка «Попросить подвезти» относится к этой карточке. Она означает, что пассажир просит место у этого конкретного водителя.

### Карточка запроса пассажира

Показывает конкретный запрос пассажира:

- имя или первое имя пассажира;
- примерный район посадки или hub;
- количество пассажиров;
- службу / дату / время;
- короткий безопасный комментарий;
- кнопку «Подвезти».

Кнопка «Подвезти» относится к этой карточке. Она означает, что водитель отвечает на этот конкретный запрос пассажира.

## Видимость и статусы

- PassengerRequest видим на странице храма только пока он активен/открыт. Повторно опубликованный остаток частично закрытого запроса показывается одной активной карточкой, связанной для отображения с первоначальным количеством.
- Когда потребность PassengerRequest полностью закрыта, активная карточка исчезает и заменяется одним безопасным summary в «Ищут место».
- DriverOffer видим на странице храма только пока он активен и есть свободные места.
- Когда у разового DriverOffer не остается свободных мест, его активная карточка исчезает и заменяется одним безопасным summary в подразделе «Разовые поездки». Полностью занятая дата регулярного маршрута агрегируется отдельно в подразделе «Регулярные поездки».
- Разовая mock-поездка видима на транспортной доске только при `status === 'open'`, `seatsAvailable > 0` и еще не наступившем локальном времени выезда, составленном из `date` и `departureTime`. Выбор службы в формах берётся из структурированного расписания храма, а не из транспортных предложений.
- Expired и cancelled элементы исчезают с публичной транспортной доски. Частично занятые разовые поездки и запросы с активным остатком остаются только в активных списках. Каждая будущая дата регулярного маршрута с подтверждёнными пассажирами получает один безопасный summary: жёлтый для частичной занятости и серый для полной. Разовые и регулярные summaries водителей находятся в одном общем «Уже договорились».
- Скрытые элементы не удаляются из системы; они остаются во внутренней истории.

## Приватность

Публичная карточка пассажирского запроса может показывать только:

- первое имя;
- примерный район посадки или hub;
- количество пассажиров;
- службу/событие;
- короткий безопасный комментарий.

Публично нельзя показывать:

- телефон;
- точный адрес;
- приватный контакт;
- чувствительные личные детали.

Optional comment ограничен 300 символами. Рядом с полем показывается предупреждение: «Не указывайте телефон, точный домашний адрес или другие личные данные.» В текущем mock это только пользовательское предупреждение и нативный `maxLength`, без автоматической фильтрации или модерации.

Контакты водителя и пассажира раскрываются только после подтвержденного match.

## Current mock passenger request and confirmation flow

The browser-only implementation persists safely parsed records in namespaced localStorage and survives navigation and refresh in the same browser. It is not production persistence or user isolation.

The general «Я пассажир» action creates an open PassengerRequest for one concrete church service/date. It remains public while zero, one, or several DriverResponses are pending. «Подвезти» opens a response dialog; it never exposes contacts immediately. When compatible browser-owned public offers exist, the driver selects one concrete one-time trip or regular-route occurrence and may offer any positive count up to both available capacity and requested passengers. Without a compatible public offer, the same dialog shows the short «Предложить места пассажиру» form and creates a private targeted driver offer with origin, departure time, offered count, optional maximum detour, and any driver contact fields not already stored. Its introduction names the passenger, destination church, and selected service or concrete date before asking for only the missing trip data. This private offer is addressed only to the request, never appears as a public Trip or Route, and does not publish unused seats.

The passenger can accept or decline each pending response. Acceptance revalidates pending state, active offer or private departure, future date, recurrence, and seats; creates exactly one RideMatch; closes the original request as matched or partially matched; accepts the chosen response; expires other pending driver responses and linked targeted requests; and then exposes both participants' provided phone/optional email in their private match card. Pending responses neither reserve seats nor hide the request.

A targeted request is always private. A one-time trip fixes `rideDate`; a regular route lists up to five nearest future recurrence-compatible dates with independent availability, keeps full dates visible but disabled, and stores the selected concrete `rideDate`. If the requested group exceeds current availability while at least one seat remains, submission stays enabled and a yellow inline warning explains that the driver may offer fewer seats or decline. Zero availability disables submission, and final acceptance always revalidates capacity. The driver may accept the full count, decline, or offer fewer seats. Full acceptance is the final confirmation. A smaller offer remains pending without contacts or reservation until the passenger chooses «Принять N мест».

Before showing a new targeted-request form, the dialog finds compatible open PassengerRequests for the same church and service or concrete date. One compatible request is summarized directly; several can be selected. «Отправить этот запрос» creates a private targeted request linked through `sourcePassengerRequestId`; «Создать другой запрос» opens the normal form. Requests already sent to the same offer occurrence are excluded. Full confirmation closes the source request, while partial confirmation closes it as partially matched and preserves the existing remaining-need actions.

Partial acceptance closes the original request. Private actions can publish a new open request for exactly the remaining count, open the existing passenger form prefilled for editing, or record that no more seats are needed. Copied data includes passenger name, private contacts, church, service/date, pickup area, safe comment, and consent; the public UI does not expose the traceability link.

RideMatches use `orthodox-routes:ride-matches` and statuses `confirmed | cancelled | completed`. Confirmed matches are the source of newly occupied seats. One-time availability subtracts confirmed match counts from its initial available-seat baseline. Regular route availability is calculated independently for each `driverOfferId + rideDate`; capacity is never reduced globally. Cancellation keeps private history and contact snapshots, returns only that occurrence's seats, and never republishes a request automatically. The dialog title is «Отменить договорённость?». Passenger cancellation explains that the driver can offer the seats again and the preserved request can be republished; driver cancellation explains that the passenger receives a notification and the seats become available to others.

After cancellation, the passenger may publish again from preserved data or open the prefilled form. Direct publication uses local calendar parsing: when the matched offer has a departure time it is allowed only before that time; otherwise a structured church service is allowed only before its start time. An alternative date without a known time remains eligible for its entire local date. Previous dates are disabled and future dates remain eligible. Cancelling a driver offer first cancels its future confirmed RideMatches and creates safe notifications; past regular-route matches remain unchanged.

The required passenger consent copy is: «После подтверждения поездки водитель увидит мой телефон и электронную почту, если я её указал, а я увижу его контакты. Я согласен на это.» The required checkbox is unchecked by default and resets in copied, prefilled, edit, and republication forms. Where the driver form displays equivalent consent, use: «После подтверждения поездки пассажир увидит мой телефон и электронную почту, если я её указал, а я увижу его контакты. Я согласен на это.» Before confirmation, phone/email never appear in public cards, pending panels, completed summaries, or notification text. Every active driver-offer card states once that contacts open after confirmation. Static mock driver contacts live in a separate private source keyed by driver ID; browser-created drivers use LocalDriverProfile.

The public board has two natural-height areas: «Ищут место» and «Предлагают поездки»; the latter retains «Регулярные поездки» and «Разовые поездки», followed by one shared «Уже договорились» section. The church-page driver directory block is removed, while `/drivers` and driver names in offers remain. Public completion is aggregated once per root passenger request, once per one-time trip, and once per `routeId + rideDate`. A partially occupied one-time trip or request with an active remaining need never also appears as completed. A partial regular occurrence remains date-specific and uses the yellow `Часть мест занята` state without completing the recurring route; a full occurrence is gray. Summaries identify regular versus one-time supply and contain no contact, pickup area, exact address, private comment, or third-party actions. Cancelled records appear only in private history with «Отменено».

## Current mock driver offer flow

The driver selects «Предложить поездку» in the page-level «Я водитель» role card. A mobile-first dialog titled «Создать поездку» opens with a close control, «Отмена», overlay close, Escape support, and body-scroll locking. User-facing text describes actions and privacy in plain language and never exposes implementation concepts such as local/mock/public profiles, local history, localStorage, persisted state, or ownership IDs.

The first browser-local offer collects name, private phone, and optional private email. Required labels use an asterisk and the form explains that phone and email are visible only to a passenger with whom the driver arranges a trip. Departure area is not driver-profile data. Older stored profiles with `departureArea` remain readable, but hydration discards that field. Later offers reuse the stored driver data without exposing private contacts. The local driver card is unlinked and derives its displayed origin from active offers for the current church.

The driver chooses «Разовая поездка» or «Регулярная поездка». Every offer models a route from a trip-specific origin to the current church and requires a numeric `maxDetourKm` choice from `0`, `2`, `5`, `10`, `15`, or `20`, 1–55 seats, and a return-trip value. Passenger count and driver free seats use the same directly editable minus/value/plus control with accessible buttons and disabled boundaries. Drivers do not enumerate pickup points. Until map geometry is implemented, the selected distance is only the driver's stated willingness to detour; each passenger's requested pickup location is evaluated manually. Older stored pickup fields are accepted and discarded, older origin fields are sanitized where practical, and missing or unsupported `maxDetourKm` falls back to `0`.

For a one-time trip, the dialog uses the same compact native service dropdown and shared future-service options as the open passenger form. It shows up to five nearest future structured services and an always-visible separate «Другая дата» field under the required group label «Когда вы едете *». Past services are excluded. Selecting a service clears the alternative date; entering an alternative date clears the service. Exactly one is required, a past alternative date is rejected, and the selected service ID is preserved on the created trip. «Другая дата» has no separate required marker. The independent «Примерное время выезда*» remains required and is not inferred from service start time. A one-time trip is created with `status: 'open'` and `seatsTotal === seatsAvailable`.

For a regular trip, at least one weekday and «Обычное время выезда*» are required. It is created with `status: 'active'`. Open and targeted passenger forms use the same validation interaction as this driver form: required markers, blur validation, inline red errors, field-only revalidation during edits, preserved values, and first-invalid focus after an invalid submit. Two-column fields reserve a compact inline-error row so an error does not move the neighboring control. Passenger name, phone, count, pickup area, applicable service/date, and consent are required; email and comment remain visibly optional.

After a successful one-time trip, the existing modal becomes one clear success state led by «Поездка создана»; it does not retain the form heading or render a bordered nested card. The smaller «Ездите в храм так регулярно?» suggestion explains that the same data can be reused. «Добавить регулярную поездку» switches the dialog to a prefilled regular-trip form with origin, `maxDetourKm`, departure time, seats, return-trip value, and driver data. It clears the selected church service, alternative date, and weekdays. «Оставить разовой» closes the dialog because the one-time trip is already published. No regular trip is created automatically and no separate church-page suggestion card is shown.

Only offers in `orthodox-routes:local-trips` and `orthodox-routes:local-routes` tied to the current stored driver identity receive cancellation controls. The custom confirmation says that passengers will no longer be able to choose the trip and uses «Не отменять» / «Отменить поездку». When future confirmed RideMatches are linked, it also gives their count and warns that those agreements will be cancelled and passengers notified. Confirmation changes the offer status to `cancelled`, removes it from visible board and passenger choices, cancels only linked future confirmed matches, and retains history.

Malformed or outdated local offer records are ignored during hydration. Unexpected fields are discarded, seat values outside 1–55 are rejected, and local IDs that collide with static driver or offer IDs are not merged into board data or passenger flows. The general church list uses the centralized merge and visibility rules to count unique active drivers, active regular trips, and visible one-time trips from both static and browser-local data, isolated per church and hydrated without server/client markup mismatch.

The second mock church intentionally has no schedule data and serves as a stable no-schedule scenario. Its public page shows the empty schedule state. Its open passenger and one-time driver forms omit the empty service dropdown and remain usable with only «Другая дата».

Это mock ownership: localStorage можно изменить вручную. Реальные identity, persistence, ownership и cancellation authorization должны быть реализованы позже через authentication, backend records и server security rules.

## Matching & Notifications v0.1

Пользователь не должен постоянно вручную открывать приложение и искать подходящие карточки. Приложение должно поднимать релевантные события через уведомления и подсказки совпадений.

### Адресные уведомления

Когда пассажир нажимает «Попросить подвезти» внутри конкретной карточки предложения водителя:

- открывается модальный диалог с именем водителя и контекстом поездки или маршрута;
- для регулярного маршрута сначала выбирается одна из пяти ближайших дат с отдельной доступностью мест;
- если есть совместимые открытые запросы, пассажир повторно использует один из них или выбирает «Создать другой запрос»;
- при создании другого запроса собираются имя, международный телефон, optional email, число пассажиров, район посадки, optional comment и consent;
- создается targeted PassengerRequest, связанный с этой поездкой или с конкретной будущей датой регулярного маршрута, и сохраняется в localStorage;
- повторно использованный запрос связан с исходным PassengerRequest через `sourcePassengerRequestId`; повторная отправка того же источника на ту же поездку и дату исключается;
- targeted request не показывается в публичном блоке «Ищут место»;
- пассажир видит безопасное summary в персональной mock-зоне «Мой запрос водителю»;
- создаются личные mock-уведомления об отправке запроса;
- водитель может принять весь запрос, отклонить его или предложить меньше мест;
- полное принятие сразу создает RideMatch, а частичное предложение ждет принятия пассажиром;
- контакты раскрываются только после создания RideMatch.

Когда водитель нажимает «Подвезти» внутри конкретной карточки запроса пассажира:

- создается DriverResponse, связанный с этим PassengerRequest;
- если есть совместимые публичные предложения водителя, DriverResponse связан с выбранным предложением, датой и числом мест;
- иначе короткая форма создает приватное адресное предложение с местом и временем выезда, числом мест и optional отклонением; публичные Trip или Route не создаются;
- пассажир получает уведомление;
- пассажир может принять или отклонить ответ;
- RideMatch создается только если пассажир принимает;
- контакты раскрываются только после принятия.

Открытый PassengerRequest остается публичным, пока ответы ожидают решения. Первый ответ не скрывает и не монополизирует запрос. Принятие одного ответа закрывает исходный запрос и переводит остальные pending responses в `expired`.

### Автоматические подсказки совпадений

Когда создается новый open PassengerRequest, приложение проверяет активные DriverOffers для того же храма и совместимой службы/даты. Если есть совместимые предложения:

- создаются MatchSuggestions;
- пассажир получает уведомление о возможных водителях;
- релевантные водители получают уведомление о пассажире рядом с их маршрутом или hub.

Когда создается новый DriverOffer, приложение проверяет open PassengerRequests для того же храма и совместимой службы/даты. Если есть совместимые запросы:

- создаются MatchSuggestions;
- водитель получает уведомление о возможных пассажирах;
- релевантные пассажиры получают уведомление о подходящем предложении.

### MVP-правила совместимости

- тот же храм;
- та же или совместимая служба/дата;
- у DriverOffer есть свободные места;
- PassengerRequest открыт;
- regular route recurrence includes the concrete date;
- элементы не expired, cancelled, full, completed или already matched.

Без карт нельзя утверждать географическую совместимость. Notification copy использует осторожную формулировку: «Возможно, эта поездка вам подходит.»

### Каналы уведомлений

Notification — персональная запись внутри приложения. Delivery channel — способ доставить событие пользователю вне приложения. Эти понятия нельзя смешивать.

Текущая mock-реализация описывает:

- личные mock-уведомления в localStorage;
- временный блок «Мои уведомления» на странице храма только для разработки и тестирования.

В production уведомления находятся в персональном notification center: header bell, user menu, profile area или dedicated notifications page. Они не принадлежат публичной странице храма и не показываются другому пользователю.

Будущие MVP delivery channels:

- web push / PWA push;
- email.

Позже возможен:

- Telegram bot.

В текущей реализации не добавляются real email, push, Telegram, Firebase Cloud Messaging или backend delivery.

### Приватность уведомлений

Уведомления не должны показывать:

- телефон;
- точный адрес;
- приватный контакт;
- чувствительные личные данные.

Уведомления могут показывать только безопасное summary:

- первое имя;
- храм;
- службу/событие;
- примерный район или hub;
- количество пассажиров;
- свободные места;
- короткий безопасный комментарий.

## Уведомления v0.1

- personal in-app notification center в production;
- localStorage mock notification state в текущем prototype;
- временное отображение «Мои уведомления» на church page только для mock-тестирования;
- future email;
- future web push;
- future Telegram bot;
- без real email/push/Telegram delivery в текущей реализации;
- без SMS;
- без WhatsApp Business API.

## Ограничения v0.1

Не делать:

- платежи;
- пожертвования;
- записки;
- рейтинги;
- сложную маршрутизацию;
- автоматическое построение оптимального маршрута;
- нативные приложения;
- публичный показ телефонов, WhatsApp или точных адресов.
