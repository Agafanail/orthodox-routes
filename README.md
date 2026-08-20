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
- a local-only passwordless email Auth slice with an explicit confirmation action, cookie-backed SSR sessions, server-verified identity, and current-device sign-out;
- a backend-only application-account and participation-eligibility foundation with protected contacts, an 18+ declaration, versioned legal-document acceptance, and hardened authenticated RPCs;
- an application-owned phone-verification foundation with versioned security policy, idempotent attempts, restricted delivery leasing, expiry and attempt limits, race-safe verified-phone binding, and no client verification bypass;
- a protected contextual-registration application foundation with server-owned drafts, separate pre-account profile data, verified-email ownership, explicit final review, account materialization, terminal cleanup, and no automatic publication.

Local Auth identifies a verified email through Supabase-managed `auth.users`. A separate protected API can explicitly create the matching Orthodox Routes application account only after verified authentication and valid required account input; Auth identity creation alone never materializes an account. Eligibility is derived on every check from authoritative email verification, account state, phone verification, the 18+ declaration, and acceptance of the current Terms version. The phone foundation queues a six-digit code without returning it to the authenticated API, exposes delivery material only through an ungranted worker contract, removes recoverable code material after delivery failure, expiry, supersession, attempt exhaustion, or successful verification, and atomically rejects a second verified binding. A local privileged test fixture exercises that boundary, but no SMS provider or production-accessible fake is configured. The contextual-registration boundary stores bounded action payloads separately from protected pre-account profile data and from hashed email/capability material. A verified Auth identity can claim its draft before an application account exists; account creation later links the same actor and clears the temporary profile. Resume capabilities are sealed into HTTP-only cookies, magic-link secrets stay in a browser URL fragment rather than request logs, and the owner returns to an explicit final review. Claim and verification never publish the action. No production Terms document is seeded and no SMS provider is configured, so an ordinary local account cannot yet become participation-eligible or publish the saved action. There is no remote Supabase project, production email/SMS delivery, transport backend, or real transport-data isolation. When the contextual server configuration is absent, the transport board continues to use namespaced `localStorage` only to exercise the complete mock flow in one browser; it is not an authorization boundary or production storage.

## Утверждённое направление продукта

Текущая реализация остаётся браузерным mock-прототипом. Назначение и границы первой полноценной публичной версии закреплены в [Product Scope](docs/ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md), а утверждённые целевые экраны, навигация, роли, права, состояния, видимость и пользовательские пути — в [Information Architecture V2](docs/ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md). Эти документы описывают целевой продукт и не означают, что перечисленные функции уже реализованы.

Информационная архитектура завершена на уровне утверждённого документа; фактические card sorting и tree testing ещё предстоят как эмпирическая проверка IA V2 и не блокируют утверждение Design System V2. [Design System V2](docs/ORTHODOX_ROUTES_DESIGN_SYSTEM_V2.md) является канонической утверждённой дизайн-системой и заменяет архивную V1. Утверждённые [Backend and Integration Architecture V1](docs/ORTHODOX_ROUTES_BACKEND_INTEGRATION_ARCHITECTURE_V1.md) и [Target Data Model V1](docs/ORTHODOX_ROUTES_TARGET_DATA_MODEL_V1.md) фиксируют выбранную целевую архитектуру и модель данных; этап Backend and integration architecture завершён, а активный этап — Core multi-user platform. The local database/migration foundation, verified-email session slice, account/consent/eligibility and provider-independent phone-verification foundations, and contextual-registration application foundation are implemented. No remote Supabase project, production email or SMS delivery, production legal text, transport backend, or external integration is configured. Изолированный `/design-preview` содержит двенадцать V2 control screens, включая мобильную и desktop-карту поездок группы, и остаётся reference artifact. Перенос production UI выполняется отдельно; production-приложение ещё не переведено на V2.

До допуска реальных пользователей в полную публичную версию должны войти:

- backend, вход по одноразовой ссылке из email и SMS-проверка телефона;
- карты, публичные примерные области радиусом 1 км, защищённые примерные маршруты и качественное сопоставление;
- раскрытие точных мест, нужной части маршрута и контактов только участникам после взаимного подтверждения;
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

`db:start` starts only the local PostgreSQL database. `db:reset` destroys and recreates that local database, then applies every committed migration in `supabase/migrations` from a clean state. `db:stop` stops the local stack while preserving its Docker volume. No command links to or changes a remote Supabase project.

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
npm run auth:stop
```

`auth:verify` uses a synthetic address and Mailpit's documented local integration endpoint. It verifies the fragment-only custom-link structure, explicit token verification, cookie-backed server identity across a new request client, and current-session sign-out without printing token or cookie values. `test:account` uses synthetic local identities and legal-document fixtures to verify account ownership, input constraints, protected contacts, 18+ declaration, current Terms acceptance, lifecycle-state eligibility, authoritative email verification, RLS, grants, and hardened function boundaries. `test:phone` uses isolated synthetic accounts plus a database-owner delivery fixture to prove that application RPCs cannot read or create OTP delivery outcomes, that expiry and attempt limits clear code material, and that concurrent verification of one phone produces exactly one verified binding. `test:drafts` proves server-only and rate-limited draft creation, idempotency, concurrent replay, contact-data rejection, verified-email claim before account materialization, owner-only profile access, account linking, terminal cleanup, and the absence of auto-publication. Privileged fixtures are not application-accessible production bypasses.

The `/auth` route displays a safe unavailable state when the public local Auth variables are absent. Ordinary public routes, tests, lint, and production builds do not require the Auth stack, `.env.local`, production secrets, or a remote Supabase project.

## GitHub Actions CI

GitHub Actions runs on pushes to `main` and pull requests targeting `main`. The frontend job preserves the clean-install tests, lint, and production build. A separate database-foundation job starts the local database and runs `db:reset`, proving that all committed migrations replay from a clean database without remote projects or secrets. A separate local-auth job starts the committed local Auth/Data API configuration, runs the focused Auth, account/eligibility, phone-verification, and contextual-draft boundary tests, and always stops the stack; it requires no Supabase account, access token, remote project, SMTP/SMS credentials, or repository secrets.

Перед коммитом по-прежнему необходимо локально запускать тесты, lint и production build.
