# AGENTS.md — ClashBot

Индекс проекта для AI-агента. Определения предметных терминов — в [`GLOSSARY.md`](GLOSSARY.md).

## О проекте

ClashBot — автономный C++20-сервис мониторинга кланов Clash of Clans: собирает данные из CoC API, сохраняет состояние и события в SQLite (WAL, автоматические миграции) и доставляет отчёты через Telegram Bot API.

- Стек: C++20, CMake, Ninja, vcpkg (`cpr`, `fmt`, `nlohmann-json`, `sqlite3`, `spdlog`), GoogleTest (`FetchContent`).
- Среда: локальная разработка на Windows x64 (MSVC); сборка и деплой на Linux (`Ubuntu 24.04`, Docker).
- Язык: ответы, отчёты, issues и описания PR — на русском; имена коммитов (Conventional Commits) — на английском.

## Команды

```powershell
# При необходимости подхватить VCPKG_ROOT из пользовательских переменных среды Windows
if (-not $env:VCPKG_ROOT) { $env:VCPKG_ROOT = [Environment]::GetEnvironmentVariable("VCPKG_ROOT", "User") }

# Конфигурация и сборка Debug из обычного PowerShell через CMakePresets (не трогает кэш CLion cmake-build-debug)
cmake --preset windows-vs
cmake --build --preset windows-vs-debug --parallel

# Все unit- и integration-тесты (не требуют сети и токенов)
ctest --preset windows-vs-debug

# Проверка пробелов и концов строк в diff
git diff --check
```

Из Developer PowerShell, CLion или на CI (где окружение MSVC уже загружено) также доступны `Ninja`-пресеты `windows-debug` и `windows-release`, на Linux — `linux-debug` и `linux-release`.

Основные цели `CMakeLists.txt`: `ClashBotCore`, `ClashBot`, `ClashBotTests` (unit), `ClashBotIntegrationTests` (integration).

### TypeScript side-by-side (`ts/`)

На период переноса (`#16`, тикеты `#17`–`#35`) TypeScript-реализация разрабатывается рядом с C++ в подкаталоге `ts/` (Node.js 24 LTS, ESM, `strict` + `noUncheckedIndexedAccess`, `pnpm`, `zod`, `pino` в `stdout`, Vitest, ESLint, Prettier).

```powershell
# Установка зависимостей по lockfile
pnpm --dir ts install --frozen-lockfile

# Проверка типов, линт, форматирование и тесты
pnpm --dir ts typecheck
pnpm --dir ts lint
pnpm --dir ts format:check
pnpm --dir ts test

# Автоформатирование при необходимости
pnpm --dir ts format
```

Отдельный CI-workflow `.github/workflows/ts-ci.yml` прогоняет `typecheck`, `lint`, `format:check` и `test` на `ubuntu-24.04` (Node.js 24) при PR в `main`, push в `main` и push в `feat/ts-migration`.

## Карта `docs/`

Открывай нужный документ по триггеру до проектирования и правок:

- Термины, сущности, аудитории, отчёты или Telegram → [`GLOSSARY.md`](GLOSSARY.md)
- Несколько слоёв, потоки, транзакции, `DomainEventWorker`, outbox → [`docs/architecture.md`](docs/architecture.md)
- Схема SQLite, новые миграции, индексы, внешние ключи, запросы репозиториев → [`docs/database.md`](docs/database.md)
- `ApplicationEvent`, payload, форматтеры, матрица доставки, дедупликация → [`docs/reports.md`](docs/reports.md)
- Команды `/start`, `/link`, `/unlink`, права, форумные темы, гайды, long polling → [`docs/telegram.md`](docs/telegram.md)
- Деплой на сервер, GHCR, Docker Compose, бэкап и восстановление SQLite → [`docs/deployment.md`](docs/deployment.md)
- Реализованные возможности и известные ограничения → [`docs/roadmap.md`](docs/roadmap.md)
- Сборка, конфигурация, переменные окружения и запуск → [`README.md`](README.md)
- Автономная оркестрация переноса на TypeScript (`#16`, тикеты `#17`–`#35`) → [`docs/agents/ts-migration-orchestration.md`](docs/agents/ts-migration-orchestration.md)

При расхождении кода и документации сначала сообщи пользователю со ссылками и согласуй источник истины.

## Рабочий процесс

- Источник правды по задачам — **GitHub Issues**.
- **Техлид (пользователь)** формулирует задачу и критерии готовности, принимает доменные решения, ревьюит и **сам сливает PR**.
- **Исполнитель (агент)** планирует, пишет код и тесты, прогоняет проверки, коммитит в короткую ветку от `main` (`feat/`, `fix/`, `docs/`, `chore/`), пушит ветку и открывает PR через `gh`.
- **Исключение для TS-миграции (`#17`–`#35`)**: автономный оркестратор ведёт разработку в интеграционной ветке `feat/ts-migration`, принимает решения о слиянии проверенных side-by-side тикетов в `feat/ts-migration` и закрывает их по регламенту [`docs/agents/ts-migration-orchestration.md`](docs/agents/ts-migration-orchestration.md); итоговый PR в `main` и шаги `#36`–`#37` остаются за человеком.
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
- unit-тесты (`ClashBotTests` — модели, парсеры, аналитика, форматтеры) и integration-тесты (`ClashBotIntegrationTests` — миграции, SQL, транзакции, синхронизация, outbox, Telegram) покрывают обычный, граничный/ошибочный и повторный (идемпотентность) сценарии;
- успешно выполнены `cmake --build --preset windows-vs-debug --parallel`, `ctest --preset windows-vs-debug` и `git diff --check`;
- для изменений схемы проверены как чистая, так и уже мигрированная БД;
- обновлены затронутые документы в `docs/`, `GLOSSARY.md` и `README.md`, если изменились поведение, схема, события или доставка;
- в описании PR и финальном отчёте указаны: что изменено, какие команды прогнаны (и что не запускалось), ключевые решения и инварианты, какие сценарии доказаны тестами и какие риски остались.

## Что решает только человек

- Доменные правила: что считать нарушением в войне, CWL или рейде; какая аудитория (`players` / `management`) получает сообщение и каким должен быть тон.
- Операционные настройки: значения по умолчанию, расписание синхронизации, контрольные точки, часовой пояс, обратная совместимость.
- Слияние PR в `main`, релизы, сервер, рабочая SQLite-база, токены и реальные Telegram-чаты.

## Запреты

- Прямой `push` в `main`, `merge` PR в `main`, `--force`, `git reset --hard`, `git checkout --` *(единственное исключение для `merge`: слияние проверенных side-by-side веток тикетов `#17`–`#35` в `feat/ts-migration` по регламенту [`docs/agents/ts-migration-orchestration.md`](docs/agents/ts-migration-orchestration.md))*.
- Чтение, вывод в логи или ответ и изменение `.env`, `config.json`, `data/`, реальных токенов, продовой БД и реальных Telegram-чатов.
- Изменение уже применённых миграций в `src/database/migrations/`.
- Деструктивные SQL-команды, деплой и отправка сообщений в реальный Telegram.

## Инварианты

- **Атомарность событий**: `domain_events` и `domain_event_destinations` (с `subscription_id` поколения подписки) пишутся в одной SQLite-транзакции с изменением игрового состояния.
- **Чистые транзакции**: внешние HTTP-запросы к CoC API и Telegram выполняются только вне транзакций SQLite.
- **Эволюция схемы**: только новая SQL-миграция с возрастающим номером; `MigratorManager` выполняет SQL, проверяет внешние ключи и фиксирует версию атомарно.
- **Изоляция соединений**: каждый поток владеет отдельным экземпляром `Database`; на одну БД работает один `DomainEventWorker` и один `NotificationWorker`.
- **Идемпотентность outbox**: повторная генерация и материализация событий опираются на стабильные event ID и уникальный ключ `notifications`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues (`Flacicz/ClashBot`, via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Standard five-label triage vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`GLOSSARY.md` at repo root, `docs/adr/` for ADRs). See `docs/agents/domain.md`.

### TS migration orchestration

Autonomous Swarm runbook for side-by-side TypeScript migration tickets (`#17`–`#35` in `feat/ts-migration`). See `docs/agents/ts-migration-orchestration.md`.
