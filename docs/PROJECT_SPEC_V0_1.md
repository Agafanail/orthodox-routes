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
- Публичная доска показывает только активные элементы. История не удаляется, но скрывается с публичной страницы.
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

- PassengerRequest видим на странице храма только пока он активен/открыт.
- Когда PassengerRequest получает подтвержденный match, он исчезает с публичной страницы храма.
- DriverOffer видим на странице храма только пока он активен и есть свободные места.
- Когда у DriverOffer не остается свободных мест, он исчезает с публичной страницы храма.
- Разовая mock-поездка видима на транспортной доске только при `status === 'open'`, `seatsAvailable > 0` и еще не наступившем локальном времени выезда, составленном из `date` и `departureTime`. Выбор службы в формах берётся из структурированного расписания храма, а не из транспортных предложений.
- Expired, cancelled, completed, matched и full элементы исчезают с публичной транспортной доски.
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

## Current mock passenger request flow

Текущая реализация заявки пассажира работает в браузере и сохраняет mock-state в namespaced localStorage. Она переживает переходы по маршрутам, back/forward и обновление страницы в том же браузере, но не является production persistence и не заменяет будущий backend/Firestore.

The passenger selects «Попросить подвезти» in the page-level «Я пассажир» role card. This opens the general public-request dialog «Создать запрос на поездку»; the same copy inside a specific driver-offer card remains a separate targeted flow. On desktop the dialog is centered; on mobile it is a large full-width panel. It closes by its close control, «Отмена», or Escape. Do not show heavy registration or use «Создать запрос и зарегистрироваться».

Поля формы:

- first name: required;
- phone: required;
- email: optional;
- one of a future structured church service or a separate alternative date: required;
- passenger count: required;
- pickup area: required;
- comment: optional, maximum 300 characters;
- consent checkbox: required.

Pickup area сейчас является текстовым label. Модель должна быть готова к будущей approximate circular pickup zone:

- label;
- optional center latitude;
- optional center longitude;
- optional radius in meters.

Consent text должен явно объяснять, что телефон и email не видны публично, но будут открыты водителю, который нажмет «Подвезти».

Телефон обязателен. Перед проверкой из него удаляются пробелы, дефисы и скобки. Нормализованное значение должно начинаться с `+`, содержать от 8 до 15 цифр после `+`, а первая цифра после `+` не может быть `0`. Сообщение ошибки: «Введите номер в международном формате, например +39 333 123 4567.» Email необязателен, но введенное значение должно выглядеть как email.

Все видимые даты показываются как `dd.mm.yyyy`, а дата со временем — как `dd.mm.yyyy в HH:mm`. Raw ISO date не выводится пользователю.

После отправки:

- создается mock PassengerRequest и сохраняется в `orthodox-routes:passenger-requests`;
- запрос появляется в блоке «Кому нужно место»;
- создается mock in-app notification;
- запускается простой mock matching check по существующим видимым поездкам/маршрутам этого храма;
- если найдено совместимое предложение водителя, создается mock notification «Найдены возможные водители для вашего запроса.»

Когда водитель нажимает «Подвезти» на карточке PassengerRequest:

- сразу создается mock DriverResponse;
- сразу создается mock notification;
- PassengerRequest скрывается из активного публичного блока «Кому нужно место» на время активного отклика;
- контакт пассажира показывается только в персональной mock-зоне «Мой отклик» после клика;
- PassengerRequest и DriverResponse синхронно сохраняются в localStorage.

Публичный пустой блок «Отклики» не показывается. «Мой отклик» появляется только после действия конкретного mock-водителя и поясняет, что в production эти данные доступны только ему. Для текущего mock-flow не нужен confirmation modal перед первичным «Подвезти». После отклика водитель может нажать «Отменить отклик»; это требует confirmation. Если отклик отменен, запрос возвращается в публичный список и создается mock notification «Отклик отменен.»

Mock state использует ключи `orthodox-routes:passenger-requests`, `orthodox-routes:driver-responses`, `orthodox-routes:targeted-requests` и `orthodox-routes:notifications`. Реальное разделение пользователей и хранение данных будут обеспечены auth и backend позже.

## Current mock driver offer flow

The driver selects «Предложить поездку» in the page-level «Я водитель» role card. A mobile-first dialog titled «Создать поездку» opens with a close control, «Отмена», overlay close, Escape support, and body-scroll locking. User-facing text describes actions and privacy in plain language and never exposes implementation concepts such as local/mock/public profiles, local history, localStorage, persisted state, or ownership IDs.

The first browser-local offer collects name, private phone, and optional private email. Required labels use an asterisk and the form explains that phone and email are visible only to a passenger with whom the driver arranges a trip. Departure area is not driver-profile data. Older stored profiles with `departureArea` remain readable, but hydration discards that field. Later offers reuse the stored driver data without exposing private contacts. The local driver card is unlinked and derives its displayed origin from active offers for the current church.

The driver chooses «Разовая поездка» or «Регулярная поездка». Every offer models a route from a trip-specific origin to the current church and requires a numeric `maxDetourKm` choice from `0`, `2`, `5`, `10`, `15`, or `20`, 1–55 seats, and a return-trip value. Drivers do not enumerate pickup points. Until map geometry is implemented, the selected distance is only the driver's stated willingness to detour; each passenger's requested pickup location is evaluated manually. Older stored pickup fields are accepted and discarded, older origin fields are sanitized where practical, and missing or unsupported `maxDetourKm` falls back to `0`.

For a one-time trip, the dialog uses the same compact native service dropdown and shared future-service options as the open passenger form. It shows up to five nearest future structured services and an always-visible separate «Другая дата» field. Past services are excluded. Selecting a service clears the alternative date; entering an alternative date clears the service. Exactly one is required, a past alternative date is rejected, and the selected service ID is preserved on the created trip. The independent «Примерное время выезда*» remains required and is not inferred from service start time. A one-time trip is created with `status: 'open'` and `seatsTotal === seatsAvailable`.

For a regular trip, at least one weekday and «Обычное время выезда*» are required. It is created with `status: 'active'`. Untouched fields show no errors; fields validate on blur; a visible field error revalidates during edits without clearing unrelated errors. Submit validates the complete form, retains all input after an invalid attempt, keeps the dialog open, and focuses the first invalid field.

After a successful one-time trip, the existing modal becomes one clear success state led by «Поездка создана»; it does not retain the form heading or render a bordered nested card. The smaller «Ездите в храм так регулярно?» suggestion explains that the same data can be reused. «Добавить регулярную поездку» switches the dialog to a prefilled regular-trip form with origin, `maxDetourKm`, departure time, seats, return-trip value, and driver data. It clears the selected church service, alternative date, and weekdays. «Закрыть» closes the dialog. No regular trip is created automatically and no separate church-page suggestion card is shown.

Only offers in `orthodox-routes:local-trips` and `orthodox-routes:local-routes` tied to the current stored driver identity receive cancellation controls. The custom confirmation says that passengers will no longer be able to choose the trip and uses «Не отменять» / «Отменить поездку». Confirmation changes status to `cancelled`, removes the offer from visible board and passenger choices, and retains internal history without exposing that implementation detail in UI copy.

Malformed or outdated local offer records are ignored during hydration. Unexpected fields are discarded, seat values outside 1–55 are rejected, and local IDs that collide with static driver or offer IDs are not merged into board data or passenger flows. The general church list uses the centralized merge and visibility rules to count unique active drivers, active regular trips, and visible one-time trips from both static and browser-local data, isolated per church and hydrated without server/client markup mismatch.

The second mock church intentionally has no schedule data and serves as a stable no-schedule scenario. Its public page shows the empty schedule state. Its open passenger and one-time driver forms omit the empty service dropdown and remain usable with only «Другая дата».

Это mock ownership: localStorage можно изменить вручную. Реальные identity, persistence, ownership и cancellation authorization должны быть реализованы позже через authentication, backend records и server security rules.

## Matching & Notifications v0.1

Пользователь не должен постоянно вручную открывать приложение и искать подходящие карточки. Приложение должно поднимать релевантные события через уведомления и подсказки совпадений.

### Адресные уведомления

Когда пассажир нажимает «Попросить подвезти» внутри конкретной карточки предложения водителя:

- открывается модальный диалог с именем водителя и контекстом поездки или маршрута;
- собираются имя, международный телефон, optional email, число пассажиров, район посадки, optional comment и consent;
- создается targeted PassengerRequest, связанный с этой поездкой или маршрутом, и сохраняется в localStorage;
- targeted request не показывается в публичном блоке «Кому нужно место»;
- пассажир видит безопасное summary в персональной mock-зоне «Мой запрос водителю»;
- создаются личные mock-уведомления об отправке запроса;
- контакты не раскрываются, потому что принятие водителем в текущем mock не реализовано.

В будущем водитель сможет принять или отклонить targeted request. RideMatch создается и контакты раскрываются только после принятия.

Когда водитель нажимает «Подвезти» внутри конкретной карточки запроса пассажира:

- создается DriverResponse, связанный с этим PassengerRequest;
- пассажир получает уведомление;
- пассажир может принять или отклонить ответ;
- RideMatch создается только если пассажир принимает;
- контакты раскрываются только после принятия.

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
- примерный район посадки или hub достаточно совместим;
- оба элемента имеют `publicVisible = true`;
- элементы не expired, cancelled, full, completed или already matched.

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
