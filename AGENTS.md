# AGENTS.md — ClashBot

Индекс проекта для AI-агента. Определения предметных терминов — в [`GLOSSARY.md`](GLOSSARY.md).

## О проекте

ClashBot — автономный сервис мониторинга кланов Clash of Clans. Он получает данные из CoC API, хранит состояние и события
в SQLite и доставляет отчёты через Telegram Bot API.

- Стек — TypeScript, Node.js 24 LTS, ESM, pnpm, zod, better-sqlite3, grammY, pino и Vitest.
- Ответы, отчёты, issues и PR — на русском. Коммиты Conventional Commits — на английском.

## Команды

Запускай проверки из корня репозитория. Тесты используют фикстуры и заглушки внешних API.

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
git diff --check
```

Для изменений контейнера или публикации выполни `docker build -t clashbot:local .` и проверь smoke-тест
из [workflow](.github/workflows/docker-publish.yml).

## Карта `docs/`

Открывай нужный документ по триггеру до проектирования и правок:

- Термины, сущности, аудитории, отчёты или Telegram → [`GLOSSARY.md`](GLOSSARY.md)
- Несколько слоёв, асинхронные циклы, транзакции, `DomainEventWorker`, outbox → [`docs/architecture.md`](docs/architecture.md)
- Схема SQLite, новые миграции, индексы, внешние ключи, запросы репозиториев → [`docs/database.md`](docs/database.md)
- `ApplicationEvent`, payload, форматтеры, матрица доставки, дедупликация → [`docs/reports.md`](docs/reports.md)
- Команды `/start`, `/link`, `/unlink`, права администратора чата, форумные темы, гайды, long polling → [`docs/telegram.md`](docs/telegram.md)
- Деплой на сервер, GHCR, Docker Compose, бэкап и восстановление SQLite → [`docs/deployment.md`](docs/deployment.md)
- Реализованные возможности и известные ограничения → [`docs/roadmap.md`](docs/roadmap.md)
- Архитектурные решения и контекст принятых компромиссов → [`docs/adr/`](docs/adr/)
- Рыночный обзор аналогов и позиционирование → [`docs/research/competitors.md`](docs/research/competitors.md)
- Сборка, конфигурация, переменные окружения и запуск → [`README.md`](README.md)

При расхождении кода и документации сначала сообщи пользователю со ссылками и согласуй источник истины.

## Рабочий процесс

- Источник правды по задачам — **GitHub Issues**.
- **Техлид (пользователь)** формулирует задачу и критерии готовности, принимает доменные решения, ревьюит и **сам сливает PR**.
- **Исполнитель (агент)** планирует, пишет код и тесты, прогоняет проверки, коммитит в короткую ветку от `main` (`feat/`, `fix/`, `docs/`, `chore/`), пушит ветку и открывает PR через `gh`.
- Цепочка при сквозных изменениях: `модель / API → сервис → транзакция / репозиторий → доменное событие → форматтер → outbox → Telegram`.
- Слияние в `main` — squash merge; формат коммитов — Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).

## Правило масштаба

Задача считается **большой**, если выполняется хотя бы одно условие:

1. нужна новая SQL-миграция или изменение схемы SQLite;
2. появляется новый тип доменного события либо меняется payload, event ID или дедупликация;
3. меняется пользовательское поведение, требующее доменного решения;
4. затронуто больше двух звеньев цепочки `модель → сервис → репозиторий → событие → форматтер → outbox → Telegram`;
5. по issue нельзя сразу записать проверяемые критерии готовности без вопросов.

**При любом сомнении задача считается большой.**

- Маленькая задача: `issue → implement / tdd → PR`.
- Большая задача: `grill-with-docs → to-spec → to-tickets → каждый тикет как маленькая`.

## Definition of Done

Перед открытием PR:

- изменения локализованы задачей, без несвязанного рефакторинга и без правок применённых миграций;
- unit-, integration- и golden-тесты Vitest покрывают применимые штатные, граничные и повторные сценарии;
- успешно выполнены проверки из раздела «Команды»;
- для изменений схемы проверены как чистая, так и уже мигрированная БД, и синхронно обновлён Docker smoke-тест в `.github/workflows/docker-publish.yml` (см. `docs/agents/git-workflow.md`);
- обновлены затронутые документы в `docs/`, `GLOSSARY.md` и `README.md`, если изменились поведение, схема, события или доставка;
- в описании PR и финальном отчёте указаны: что изменено, какие команды прогнаны (и что не запускалось), ключевые решения и инварианты, какие сценарии доказаны тестами и какие риски остались.

## Что решает только человек

- Доменные правила: что считать нарушением в войне, CWL или рейде; какая аудитория (`players` / `management`) получает сообщение и каким должен быть тон.
- Операционные настройки: значения по умолчанию, расписание синхронизации, контрольные точки, часовой пояс, обратная совместимость.
- Слияние PR в `main`, релизы, сервер, рабочая SQLite-база, токены и реальные Telegram-чаты.

## Запреты

- Прямой `push` в `main`, слияние PR в `main`, `--force`, `git reset --hard` и `git checkout --`.
- Чтение, вывод в логи или ответ и изменение `.env`, `config.json`, `data/`, реальных токенов, продовой БД и реальных Telegram-чатов.
- Изменение уже применённых миграций в `migrations/`.
- Деструктивные SQL-команды, деплой и отправка сообщений в реальный Telegram.

## Инварианты

- **Атомарность событий**: `domain_events` и `domain_event_destinations` (с `subscription_id` поколения подписки) пишутся в одной SQLite-транзакции с изменением игрового состояния.
- **Чистые транзакции**: внешние HTTP-запросы к CoC API и Telegram выполняются только вне транзакций SQLite.
- **Эволюция схемы**: только новая SQL-миграция с возрастающим номером; `MigratorManager` выполняет SQL, проверяет внешние ключи и фиксирует версию атомарно.
- **Изоляция транзакций** — приложение использует одно соединение `Database` и синхронные транзакции. На базу запускается один процесс ClashBot.
- **Идемпотентность outbox**: повторная генерация и материализация событий опираются на стабильные event ID и уникальный ключ `notifications`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues (`Flacicz/ClashBot`, via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Standard five-label triage vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`GLOSSARY.md` at repo root, `docs/adr/` for ADRs). See `docs/agents/domain.md`.

### Git & PR workflow

Pre-flight `main` sync, wave integration PRs (`<wave-branch> → main`), updating `BEHIND`/`CONFLICTING` PRs without `--force`, SQL migration smoke-test checklist, and Windows PowerShell/worktree setup. See `docs/agents/git-workflow.md`.

### Swarm orchestration

Default `/swarm` roles and models (`Neon High` coders, `Hydrogen High` read-only reviewer), wave serialization, two-axis review gate, and worker lifecycle. See `docs/agents/swarm.md`.
