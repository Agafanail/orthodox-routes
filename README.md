# Orthodox Routes MVP / Православные маршруты

PWA-сервис, который помогает пассажиру без машины найти поездку к конкретному православному храму с водителем, который уже едет туда. Центральный экран продукта — страница храма как транспортная доска.

## Что реализовано сейчас

- Next.js App Router, React, TypeScript и Tailwind CSS;
- ESLint;
- каноническая утверждённая [Design System V2](docs/ORTHODOX_ROUTES_DESIGN_SYSTEM_V2.md), сохранённый [V2 visual reference](docs/reference/design-system-v2/Orthodox-Routes-Reference-Screens.html) и изолированный маршрут `/design-preview` с двенадцатью V2 control screens;
- публичные страницы храмов и водителей без регистрации;
- mock-данные храмов, водителей, регулярных маршрутов и разовых поездок;
- открытый запрос пассажира через короткую модальную форму;
- адресный запрос к конкретному предложению водителя;
- повторное использование совместимого открытого запроса без повторного ввода данных;
- полный mock-поток `RideMatch` для адресных запросов и ответов водителей;
- приватный ответ водителя без обязательной публикации поездки на общей доске;
- частичные предложения мест, повторная публикация оставшейся потребности и отмена договорённостей;
- учёт мест по подтверждённым `RideMatch`, включая отдельную вместимость каждой даты регулярного маршрута;
- выбор одной из пяти ближайших дат регулярного маршрута и предупреждение, если группе нужно больше текущего числа свободных мест;
- приватное раскрытие телефона и optional email только после подтверждения;
- две связанные области «Ищут место» и «Предлагают поездки» и один общий безопасный блок «Уже договорились» под обеими колонками, объединяющий до пяти будущих завершённых пассажирских запросов, разовых поездок и дат регулярных маршрутов;
- компактная временная обратная связь после успешных действий с автоматическим переходом и краткой подсветкой созданной или обновлённой карточки;
- namespaced localStorage-персистентность запросов, ответов, адресных запросов, `RideMatch` и mock-уведомлений;
- a version-controlled local Supabase/PostgreSQL foundation with clean migration replay;
- a passwordless email Auth slice with an explicit confirmation action, cookie-backed SSR sessions, server-verified identity, and current-device sign-out;
- a backend-only application-account and participation-eligibility foundation with protected contacts, an 18+ declaration, versioned legal-document acceptance, and hardened authenticated RPCs;
- an application-owned phone-verification foundation with versioned security policy, idempotent attempts, targeted service-role-only delivery leasing, a Bird SMS adapter, expiry and attempt limits, race-safe verified-phone binding, and no client verification bypass;
- a protected contextual-registration application foundation with server-owned drafts, separate pre-account profile data, verified-email ownership, explicit final review, account materialization, terminal cleanup, and no automatic publication;
- a server-owned Core transport foundation for eligible passenger requests, one-time driver offers, bounded regular series, date-specific occurrences, anonymous safe projections, idempotent publication/cancellation, and database-enforced ownership;
- participant-private responses in both directions, immutable condition snapshots, atomic agreements and seat accounting, exact-once cancellation/restoration, lifecycle expiry, and separately authorized contact/exact-place disclosure;
- an authenticated account-scoped `My Trips` read projection across all churches, with deterministic IA V2 section classification, passenger response/agreement items, aggregated driver occurrences, safe capacity counts, and no contact, exact-place, note, or route data;
- a participant-only `api.get_my_trip_details(p_agreement_id)` read for an explicitly opened agreement, with accepted child/seat and return conditions, current remaining passenger need, and the existing bounded contact/exact-place disclosure;
- a configured Core transport board backed only by server RPCs, including direct and contextual publication, cross-account responses and confirmation, owner cancellation/restoration, and contact disclosure only after an explicit participant action; the historical `localStorage` board is mounted only when the backend is explicitly unconfigured;
- a PostGIS-backed protected geographic foundation: exact public church coordinates, exact private user places, up to three passenger meeting places, one driver departure place, reusable saved places, a stable deliberately off-centre public area of about 1 km, GiST indexes, public church catalog search with optional viewport and proximity, and participant-only disclosure of the selected meeting place and the driver exact departure place;
- an application-owned map-provider adapter contract with a deterministic local fake, so the whole domain and its tests run without a provider account, network access, or spend, plus the Geoapify adapter for address search and route measurement;
- one embedded interactive map, drawn with MapLibre GL over Geoapify vector tiles, shared by the church catalog, the church location screen, the transport board group map, and the place picker, with pan, zoom, touch, markers, approximate circles, view fitting, and tap-to-place;
- outbound links that open a place or a route in Google Maps or Yandex Maps, which are links only: no external map, search, or routing API is integrated;
- deterministic quality matching with live cheap conditions, a cached road measurement, up to three passenger places, the best compatible place, added kilometres and approximate added minutes, and a service-role-only measurement bridge;
- a server-backed church catalog with universal search, an explicit `Рядом со мной` action, a catalog map panel, and a dedicated church location screen opened from the exact public address.

Local Auth identifies a verified email through Supabase-managed `auth.users`. A separate protected API can explicitly create the matching Orthodox Routes application account only after verified authentication and valid required account input; Auth identity creation alone never materializes an account. Eligibility is derived on every check from authoritative email verification, account state, phone verification, the 18+ declaration, and acceptance of the current Terms version. The phone foundation queues a six-digit code without returning it to the authenticated API, exposes only the requested attempt through a service-role-only worker bridge, removes recoverable code material after delivery failure, expiry, supersession, attempt exhaustion, or successful verification, and atomically rejects a second verified binding. The selected Bird adapter sends only authentication-category OTP messages, uses the attempt ID as the provider idempotency key, records only a validated provider reference, and fails closed when its three-value server configuration is absent or invalid. No Bird key or production-accessible fake is committed. The contextual-registration boundary stores bounded action payloads separately from protected pre-account profile data and from hashed email/capability material. A verified Auth identity can claim its draft before an application account exists; account creation later links the same actor and clears the temporary profile. Resume capabilities are sealed into HTTP-only cookies, magic-link secrets stay in a browser URL fragment rather than request logs, and the owner returns to an explicit final review. Claim and verification never publish the action.

Geography is application-owned. A person selects only the real place; there is no field for a public area, because the database derives it. The public centre is a deterministic function of a coarse grid cell, the owner, and a database-owned pepper, so republishing the same place reproduces the same circle and several public centres cannot be averaged back to the exact point. A database constraint keeps the exact point inside the published circle and at least 100 metres away from its centre, so a centred circle can never be stored. Anonymous visitors and authenticated non-participants receive exactly the same approximate projection. Saved places belong to their owner, live until that owner deletes them, and are excluded by design from ride exact-data retention; publishing from a saved place copies it, so deleting the reusable entry never rewrites geography a live listing or a confirmed agreement depends on. There is no public driver route corridor, no public route line, and no persisted provider route geometry anywhere in the schema.

Quality matching is deterministic and explainable. Every hard condition except the road detour — same church, both records active, the same service occurrence or the approved one-hour custom-time rule, no mutual block, enough seats for the passenger's entire remaining group, and child and child-seat compatibility — is evaluated live in SQL on each read, so a seat taken a moment ago is reflected immediately and no stored verdict can go stale. Only the road measurement is cached, and that cache holds two integers and place references rather than provider route geometry. Because the cheap conditions run first, a billed route call only ever happens for a pair that is otherwise a match. The measurement bridge carries exact coordinates belonging to two different people, so it is granted to the service role alone and is never reachable from a signed-in session. Added kilometres decide the match; added minutes are shown for understanding only. A candidate whose route could not be measured is never called a mismatch: the ordinary board simply makes no claim, and only the explicit `Подходящие мне` view says in one ordinary sentence that the check did not succeed. A confirmed agreement is never cancelled by a later matching change.

The server-owned transport domain now derives every mutation actor from Auth, rechecks authoritative participation eligibility, and stores passenger requests, driver series, date-specific occurrences, responses, condition snapshots, agreements, contact snapshots, and safe history in PostgreSQL. Confirmation locks and rechecks both sources, consumes occurrence capacity and passenger need exactly once, and turns a capacity loser into `stale`; cancellation returns capacity once and keeps a fulfilled request non-public in `restore` until its owner explicitly republishes it. Direct table access remains revoked. Anonymous clients receive only deliberate safe projections; exact places are owner-private before confirmation and participant-private only through a current agreement authorization check. Contacts use separate on-demand functions, disappear immediately after cancellation, and are anonymized after lifecycle archival. When public Supabase configuration is present, the church page renders this server-owned domain and never mounts or dual-writes the historical browser transport state. When it is explicitly absent, the previous `localStorage` board remains an isolated demo. Browser records are never imported or trusted. The Maps campaign adds PostGIS coordinates and the public approximation on top of this domain without changing its agreement, capacity, cancellation, or disclosure behavior. An isolated synthetic-only Supabase staging project and HTTPS deployment run the committed Core migrations and RPC board. Staging Auth has an owner-configured Resend SMTP sender; real Gmail delivery, explicit link confirmation, SSR session persistence, and current-device sign-out are verified, with Spam placement tracked as a separate deliverability issue. The staging Bird configuration is injected only through the hosting secret manager, and a real application-owned OTP flow has verified provider acceptance, handset receipt, and phone verification without making Bird the verification authority. No Bird key, production Terms document, or production project is committed or configured in the repository.

## Утверждённое направление продукта

Текущая реализация включает настроенный через environment Core multi-user transport board и отдельный browser-only demo-режим без backend-конфигурации. Назначение и границы первой полноценной публичной версии закреплены в [Product Scope](docs/ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md), а утверждённые целевые экраны, навигация, роли, права, состояния, видимость и пользовательские пути — в [Information Architecture V2](docs/ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md). Эти документы описывают полный целевой продукт; более поздние фазы нельзя считать реализованными по наличию Core slice.

Информационная архитектура завершена на уровне утверждённого документа; фактические card sorting и tree testing ещё предстоят как эмпирическая проверка IA V2 и не блокируют утверждение Design System V2. [Design System V2](docs/ORTHODOX_ROUTES_DESIGN_SYSTEM_V2.md) является канонической утверждённой дизайн-системой и заменяет архивную V1. Утверждённые [Backend and Integration Architecture V1](docs/ORTHODOX_ROUTES_BACKEND_INTEGRATION_ARCHITECTURE_V1.md) и [Target Data Model V1](docs/ORTHODOX_ROUTES_TARGET_DATA_MODEL_V1.md) фиксируют выбранную целевую архитектуру и модель данных; этапы Backend and integration architecture и Core multi-user platform завершены. The local foundation and isolated synthetic-only staging deployment implement the verified-email identity boundary, account/consent/eligibility, the application-owned Bird SMS adapter boundary, contextual registration with explicit publication, server-owned Core transport/response/agreement boundaries, and configured application cutover. Real staging email delivery and the explicit link/session/sign-out flow are confirmed, with Spam placement tracked separately; real Bird-backed SMS receipt and application-owned OTP verification are also confirmed. Production legal text, production access, Maps integration, and other later external integrations are not configured. Изолированный `/design-preview` содержит двенадцать V2 control screens, включая мобильную и desktop-карту поездок группы, и остаётся reference artifact. Полный перенос production UI на Design System V2 выполняется отдельно.

До допуска реальных пользователей в полную публичную версию должны войти:

- backend, вход по одноразовой ссылке из email и SMS-проверка телефона;
- карты, публичные примерные области радиусом около 1 км и качественное сопоставление; публичной линии маршрута водителя нет;
- раскрытие выбранного точного места встречи, точного места отправления водителя и контактов только участникам после взаимного подтверждения;
- «Мои поездки», уведомления, профиль и история;
- уведомления в приложении, по email и через Web Push;
- устанавливаемая PWA;
- страницы храмов, расписания и управление несколькими равноправными администраторами;
- английский, русский, итальянский, румынский, украинский и немецкий языки;
- структурированные поля о детях и детском кресле, жалобы и личная блокировка;
- пользовательское соглашение, политика конфиденциальности, E2E-тесты и ручная проверка.

SMS используется только для проверки телефона, а не для уведомлений о поездках. Telegram, WhatsApp, встроенный чат, рейтинги, оплата поездок и нативные мобильные приложения не входят в первую полноценную версию. Добровольная внешняя поддержка самого проекта отделена от поездок и не даёт дополнительных возможностей.

## Локальный запуск

Требуется Node.js 20.9 или новее.

```bash
npm install
npm run dev
```

Проверка проекта:

```bash
npm test
npm run lint
npm run build
```

## Local database foundation

Docker Desktop or another compatible Docker engine is required only for backend/database work. Ordinary frontend installation, development, tests, lint, and production builds do not require Docker, Supabase environment variables, or a running database.

The local database workflow uses the project-pinned Supabase CLI:

```bash
npm run db:start
npm run db:reset
npm run db:stop
```

`db:start` starts only the local PostgreSQL database. `db:reset` destroys and recreates that local database, then applies every committed migration in `supabase/migrations` from a clean state. `db:stop` stops the local stack while preserving its Docker volume. These local database commands never link to or change a remote Supabase project; `test:staging-core` and `test:staging-email` are separately guarded remote verification paths for the exact isolated staging project.

## Local email Auth, account, and phone foundations

Local passwordless email Auth and the protected account RPCs use PostgreSQL, PostgREST, the Kong API/Auth gateway, Supabase Auth (GoTrue), and the bundled Mailpit email catcher. Storage, Realtime, Studio, Analytics, Edge Functions, image processing, metadata, pooling, and other unrelated services are excluded by the project wrapper. Only the narrow `api` schema is exposed through PostgREST; `app` and `private` tables have no client table grants.

```bash
npm run auth:start
npm run dev
```

`auth:start` starts the required local services and updates the ignored `.env.local` file with only the local public API URL, public publishable/anonymous key, and `ORTHODOX_ROUTES_APP_URL=http://localhost:3000`. It never writes a service-role or application secret. Ordinary Auth works with those public values. The configured contextual-registration UI additionally requires an ephemeral server-process `SUPABASE_SECRET_KEY` from the local stack and a local-only `CONTEXTUAL_REGISTRATION_SECRET` of at least 32 characters; do not store either in `.env.local` or commit them. Open the application at `http://localhost:3000/auth` and captured email at `http://127.0.0.1:54324`. Use synthetic email addresses only.

The captured email opens `/auth/confirm` with callback state in the URL fragment, which browsers do not send in the HTTP request. Loading, previewing, or refreshing that GET page does not verify the token or create a session, and callback secrets do not enter ordinary server request logs. Only the visible `Войти` form action posts the callback state and calls `verifyOtp`. Successful verification stores the SSR session in cookies; the server resolves identity with `getClaims()`. Sign-out uses current-session scope and removes the browser's Auth cookies.

Optional local verification and status commands:

```bash
npm run auth:verify
npm run test:account
npm run test:phone
npm run test:drafts
npm run test:transport
npm run test:agreements
npm run test:my-trips
npm run test:geography
npm run test:matching
npm run test:maps-upgrade
npm run test:e2e
npm run core:e2e:prepare
npm run auth:stop
```

`auth:verify` uses a synthetic address and Mailpit's documented local integration endpoint. It verifies the fragment-only custom-link structure, explicit token verification, cookie-backed server identity across a new request client, and current-session sign-out without printing token or cookie values. `test:account` uses synthetic local identities and legal-document fixtures to verify account ownership, input constraints, protected contacts, 18+ declaration, current Terms acceptance, lifecycle-state eligibility, authoritative email verification, RLS, grants, and hardened function boundaries. `test:phone` uses isolated synthetic accounts plus a database-owner delivery fixture to prove that application RPCs cannot read or create OTP delivery outcomes, that expiry and attempt limits clear code material, and that concurrent verification of one phone produces exactly one verified binding. `test:drafts` proves server-only and rate-limited draft creation, idempotency, concurrent replay, contact-data rejection, verified-email claim before account materialization, owner-only profile access, account linking, terminal cleanup, and the absence of auto-publication. `test:transport` uses three synthetic identities to verify authoritative eligibility, idempotent publication, cross-account mutation denial, regular occurrence materialization, owner-only exact labels, anonymous safe shapes, cancellation, RLS, grants, and hardened functions. `test:agreements` additionally verifies the application church projection, participant role projection, ownership-checked contextual completion, atomic contextual responses, both response directions, terminal response states, partial groups, exact-once cancellation, full-request restoration, occurrence/series cancellation, last-seat concurrency, protected disclosure, 30-day access bounds, expiry/anonymization, and cross-account denial. `test:geography` uses isolated synthetic accounts and coordinates to verify that PostGIS is installed in the `extensions` schema, that place tables force row level security with no application-role grants, that the public centre is stable per owner and place, differs between owners, stays inside its approved offset band, and cannot be stored centred on or away from its exact point, that the church catalog search honours text, viewport, and explicit proximity, that saved places are owner-only and survive ride retention, that publishing from a saved place copies it, that malformed place input is rejected rather than silently trimmed, and that no exact address, exact coordinate, or route geometry appears in any anonymous payload. `test:matching` uses four synthetic accounts and a deterministic straight-line stand-in for a route provider to verify every hard condition, the detour limit, the best place among several with the alternatives kept visible, that an unmeasured candidate produces neither a match nor a mismatch, that a signed-in session cannot reach the measurement bridge, that a mutual block suppresses a suggestion in both directions, that a tightened detour limit takes effect without recalculating routes, and that a confirmed agreement and its disclosure survive every later matching change. `test:maps-upgrade` rebuilds only the disposable local database at the last pre-Maps migration, creates representative label-only Core data including a confirmed agreement through the protected API, applies the geographic migration, and then verifies that the agreement and its disclosure survive, that the pre-Maps listing stays publicly visible without inventing a circle for it, and that new coordinate-based publication derives a correct off-centre area. `core:e2e:prepare` writes only disposable local synthetic passenger, driver, unrelated-account, and church fixture state, then prints one-use local confirmation URLs for an available-browser smoke test; it must never target staging or production. Privileged fixtures are not application-accessible production bypasses.

`test:my-trips` uses synthetic accounts and churches to verify that the protected actor-derived projection rejects anonymous callers, isolates unrelated accounts, spans multiple churches, assigns passenger and driver roles, classifies supported response/agreement/listing/history states into exactly one primary IA V2 section, aggregates multiple passenger responses under one driver occurrence, and omits contacts, exact places, addresses, coordinates, notes, route geometry, tokens, and secrets. It also verifies the function grant, pinned empty `search_path`, source-table grants, and forced RLS boundary.

The My Trips projection keeps a driver response actionable when a partial seat counteroffer is possible; it does not require space for the passenger's entire initial request. Elapsed response deadlines or scheduled times remove pending actions before lifecycle cleanup: passenger responses are placed in history, while driver children remain under their occurrence without pending/action counts. The read boundary preserves the stored status and never performs lifecycle writes. The focused verifier covers these intervals, confirms a partial counteroffer and withdrawn/stale outcomes through existing mutation RPCs, and checks expired responses and genuinely past agreement fixtures after lifecycle cleanup.

`api.get_my_trip_details(p_agreement_id uuid)` is a separate on-demand read for a confirmed agreement's participants. It returns the caller's role, counterparty name/role, church, accepted schedule, confirmed count, approximate meeting-area label, cancellation role, and structured accepted conditions (`children_count`, child-seat requirements/capabilities, both return flags, and detour). Conditions come from `active_snapshot_id`, never from subsequently edited source listings; `counts.remaining_passengers` is explicitly the current unfilled request need. The `contacts` and `places` objects reuse `get_agreement_contacts` and `get_agreement_exact_place` and their independent visibility checks. An unknown agreement, unrelated caller, or unconfirmed response returns null; anonymous and service-role execution is not granted. Cancellation, archival, or elapsed exact-data retention leaves only a safe summary, with null conditions, current remaining need, contacts, and places; the contact deadline can separately close contacts sooner. No read performs lifecycle writes. Never prefetch this RPC for a list or put its response into public HTML, shared caches, notifications, or analytics.

`test:my-trips` also verifies both participants' detail reads, partial groups, children/return conditions, immutable accepted terms after source edits, unrelated/malformed/spoofed access, omission of unused exact places and notes, immediate cancellation, and visibility before and after lifecycle cleanup. Existing list payloads remain unchanged. Group 5 is approved as an isolated copy-review surface; production My Trips UI is still absent. The `change_pending` proposal/answer workflow and its awaiting actor remain unimplemented and are not inferred by this detail read.

`test:e2e` runs the focused Chromium Core regression through real isolated anonymous, passenger, driver, and unrelated-user browser contexts. Run `npx playwright install chromium` once, then start and reset the disposable local stack with `npm run auth:start` and `npm run db:reset` before the test. Playwright starts the configured Next.js application, prepares synthetic users through `core:e2e:prepare`, keeps one-use confirmation links out of normal test output, verifies application payloads and protected RPC responses, and removes its temporary fixture file afterward.

`test:staging-core` is a separately guarded remote smoke command for the already linked project named exactly `orthodox-routes-staging`. It retrieves project keys only through the authenticated Supabase CLI, requires an existing current synthetic Terms version, exercises remote Auth/Data API coordination with uniquely identified synthetic users and transport records, and removes only the records created by that run. It preserves unrelated staging fixtures, never truncates shared staging data, does not configure or verify real email or SMS delivery, and must never target production.

`npm run test:staging-email` is a separate interactive verifier for the same exact linked staging project. It reads the owner-approved recipient and the received confirmation URL only from standard input, does not include them in its own status output, checks that a safe callback GET cannot establish a session, then performs explicit token verification, cookie-backed server identity, local-session sign-out, and synthetic Auth cleanup. It must not be used with an unrelated person's address or against production.

The configured Core church board requires a matching published `app.church` row. It uses RPC state exclusively and does not read or write the historical transport `localStorage` keys. Protected contact and exact-place values are fetched only after an explicit participant action and are not included in the ordinary board response. `GET /api/readiness` fails closed unless the required public/server configuration is valid and the committed safe Core RPC boundary responds; it returns no configuration, provider, account, or database details. See [Core Multi-User Staging Readiness](docs/CORE_STAGING_READINESS.md) for the exact remote environment, migration, provider, privacy, and smoke-test gates; that document is readiness guidance, not authority to access or mutate a remote project.

The `/auth` route displays a safe unavailable state when the public local Auth variables are absent. Ordinary public routes, tests, lint, and production builds do not require the Auth stack, `.env.local`, production secrets, or a remote Supabase project.

## GitHub Actions CI

GitHub Actions runs on pushes to `main` and pull requests targeting `main`. The frontend job preserves the clean-install tests, lint, and production build. A separate database-foundation job starts the local Core API stack and proves both a clean replay of every committed migration and a representative upgrade from the last pre-cutover migration with existing transport data. A separate local-auth job starts the same committed local Auth/Data API configuration and runs the focused Auth, account/eligibility, phone-verification, contextual-draft, transport, agreement, My Trips, concurrency, and disclosure boundary tests. The isolated Core browser E2E job installs Chromium, rebuilds the same disposable local stack, and runs the multi-session privacy and agreement regression through the configured Next.js application. All local-stack jobs always stop their isolated services; none requires a Supabase account, access token, remote project, SMTP/SMS credentials, or repository secrets.

Перед коммитом по-прежнему необходимо локально запускать тесты, lint и production build.
