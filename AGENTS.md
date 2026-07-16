# AGENTS.md — правила для Codex

## Роль проекта

Ты помогаешь разрабатывать MVP PWA-сервиса «Православные маршруты». Это не Uber, не социальная сеть и не церковный CRM. Главная задача: соединить пассажира без машины с водителем, который уже едет в конкретный православный храм.

## Текущий стек

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- ESLint
- mock-данные
- localStorage для mock-состояния запросов, откликов и уведомлений

## Будущие интеграции

- Firebase Auth / Firestore / Storage могут быть добавлены после стабилизации mock-flow.
- Web/PWA push и email — планируемые каналы доставки уведомлений.
- Google Maps можно рассмотреть позже для поиска храмов и примерных зон посадки; карты не обязательны для текущего mock.
- Telegram bot — возможный более поздний канал, не требование текущего MVP.
- Backend и deployment-платформа пока не реализованы и выбираются отдельно.

## Жесткие продуктовые правила

1. Храм может вести карточку, но продукт не должен зависеть от активности прихода.
2. Водители видимы в карточке храма как реальные люди: фото по желанию, имя, район выезда, храмы/маршруты, ближайшие поездки.
3. Телефон/WhatsApp водителя НЕ показывать публично. Контакт открывается пассажиру только после принятия заявки водителем.
4. Пассажир не должен вручную выбирать «каталог водителей». Он видит храм, поездки, маршруты и кнопку «Попросить место».
5. Водитель может создать и разовую поездку, и регулярный маршрут.
6. Главная единица продукта: храм + маршрут + поездка.
7. В MVP не делать платежи, записки, SMS и WhatsApp Business API.
8. Все личные данные хранить минимально. Домашний адрес не показывать публично. Предпочтительны публичные точки встречи.
9. Публичный комментарий пассажира не должен содержать телефон, точный домашний адрес или другие личные данные; в текущем mock это обеспечивается предупреждением и лимитом 300 символов без автоматической модерации.

## UX-правила

- Мобильный интерфейс первым.
- Большие кнопки, короткие формы.
- Формы пассажира должны оставаться короткими и содержать только поля утвержденного open или targeted flow; необязательные поля должны быть явно отмечены.
- Утвержденные поля: имя, телефон, optional email, служба/событие где применимо, количество пассажиров, район посадки, optional comment и consent.
- Для храма максимально простая карточка.
- Каждый экран должен отвечать на вопрос пользователя: «Как мне попасть в храм?»

## Качество кода

- Не добавляй тяжелые библиотеки без необходимости.
- Не пиши неиспользуемый код «на будущее».
- Все функции с доступом к личным данным держи явно типизированными.
- Перед завершением задачи запускай `npm test`, если в `package.json` есть script `test`, а также `npm run lint` и `npm run build`, если проект уже собран.
- Если меняешь схему данных, обнови `docs/DATA_MODEL.md`.
- Если добавляешь feature, обнови `docs/CODEX_ROADMAP.md`.

## Documentation Synchronization Rules

- The documentation is part of the product.
- Every product change must update the documentation in the same task.
- If a task changes product concept, user flows, UX, screen structure, navigation, buttons, entity relationships, visibility rules, permissions, public/private data, status transitions, or business rules, then the affected documentation must be updated before the task is considered complete.
- At minimum, check and update these files when relevant:
  - `docs/PROJECT_MAP.md`
  - `docs/PROJECT_SPEC_V0_1.md`
  - `docs/DATA_MODEL.md`
  - `docs/UX_RULES.md`
- Mermaid diagrams are the product visualization source of truth.
- The Mermaid diagrams must always match the current implementation and current product concept.
- If the diagrams become outdated, the task is incomplete.
- Codex must never silently change product concept, business logic, user journeys, UX decisions, button placement, navigation, screen hierarchy, or terminology.
- If Codex believes a product change is needed, it must describe the recommendation separately and wait for explicit approval.
- At the end of every task, Codex must explicitly report:
  - Task type: Product Change or Technical Change
  - Which documentation files were updated
  - Whether Mermaid diagrams were updated
  - If diagrams were not updated, why not
  - Whether lint and build passed

## Безопасность

- Не логируй телефоны, токены, private keys.
- Не клади secrets в клиентский код. Если Firebase config или Google Maps browser key появятся позже, используй только публичную конфигурацию и доменные ограничения.
- Firestore rules должны запрещать чтение приватных контактов до подтверждения заявки.
- Админские операции должны быть доступны только пользователям с role `admin`.
