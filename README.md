# Orthodox Routes MVP / Православные маршруты

PWA-сервис, который помогает пассажиру без машины найти поездку к конкретному православному храму с водителем, который уже едет туда. Центральный экран продукта — страница храма как транспортная доска.

## Что реализовано сейчас

- Next.js App Router, React, TypeScript и Tailwind CSS;
- ESLint;
- утверждённая [Initial Design System V1](docs/ORTHODOX_ROUTES_DESIGN_SYSTEM_V1.md) и изолированный маршрут `/design-preview` с шестью контрольными экранами;
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
- a version-controlled local Supabase/PostgreSQL foundation for database migrations, isolated from the runnable application.

The runnable application still has no functional backend, authentication, or real user isolation. The local database foundation is not an application runtime dependency. The transport board continues to use namespaced `localStorage` only to exercise the complete mock flow in one browser; it is not an authorization boundary or production storage.

## Утверждённое направление продукта

Текущая реализация остаётся браузерным mock-прототипом. Назначение и границы первой полноценной публичной версии закреплены в [Product Scope](docs/ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md), а утверждённые целевые экраны, навигация, роли, права, состояния, видимость и пользовательские пути — в [Information Architecture V2](docs/ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md). Эти документы описывают целевой продукт и не означают, что перечисленные функции уже реализованы.

Информационная архитектура завершена на уровне утверждённого документа; фактические card sorting и tree testing ещё предстоят. Initial Design System V1 утверждена и завершена. Утверждённые [Backend and Integration Architecture V1](docs/ORTHODOX_ROUTES_BACKEND_INTEGRATION_ARCHITECTURE_V1.md) и [Target Data Model V1](docs/ORTHODOX_ROUTES_TARGET_DATA_MODEL_V1.md) фиксируют выбранную целевую архитектуру и модель данных; этап Backend and integration architecture завершён, а активный этап — Core multi-user platform. The local database/migration foundation is implemented, but no functional application backend, authentication, remote Supabase project, target domain schema, or external integration is configured. Изолированный `/design-preview` служит только для проверки утверждённого визуального направления и не означает, что production-приложение уже визуально переработано.

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

## GitHub Actions CI

GitHub Actions runs on pushes to `main` and pull requests targeting `main`. The frontend job preserves the clean-install tests, lint, and production build. A separate database-foundation job starts the local database and runs `db:reset`, proving that all committed migrations replay from a clean database without remote projects or secrets.

Перед коммитом по-прежнему необходимо локально запускать тесты, lint и production build.
