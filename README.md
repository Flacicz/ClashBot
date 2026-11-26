# ClashBot

Автономный сервис мониторинга кланов Clash of Clans на TypeScript и Node.js 24 LTS. Получает данные из официального
Clash of Clans API, хранит состояние и доменные события в SQLite и доставляет уведомления в Telegram.

## Системные требования

- **Локальный запуск и разработка**: Node.js `>=24.0.0` (24 LTS), `pnpm` (`12.21.0`), Git (при отсутствии готовой сборки
  `better-sqlite3` под платформу также нужны Python и инструменты нативной сборки Node.js).
- **Контейнерный запуск**: Docker Engine с плагином `docker compose` (Linux-контейнеры).

## Быстрый локальный запуск

Из корня репозитория:

```powershell
pnpm install --frozen-lockfile
```

Подготовьте конфигурацию и секреты:

1. Скопируйте [`config.example.json`](config.example.json) в `config.json` и замените контейнерные пути `/app/...` на
   локальные (например, `data/database.sqlite`, `migrations`, `resources/telegram/attack_guides.json`), затем создайте
   каталог `data/`.
2. Скопируйте [`.env.example`](.env.example) в `.env` рядом с `config.json` и заполните `SUPERCELL_TOKEN` и
   `TELEGRAM_TOKEN`.

Соберите и запустите сервис:

```powershell
pnpm build
pnpm start config.json
```

Команды проверки (тесты используют локальные фикстуры и заглушки внешних API):

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

## Быстрый Docker-запуск

Подготовьте `config.json` (из [`config.example.json`](config.example.json)), `.env` (из [`.env.example`](.env.example))
и каталог `data/`, затем запустите опубликованный образ `ghcr.io/flacicz/clashbot`:

```bash
docker compose up -d
```

Для локальной сборки образа используйте `docker build -t clashbot:local .`. Полная инструкция по серверному деплою,
CI/CD, обновлениям, SSH-туннелю и онлайн-бэкапам SQLite — в [`docs/deployment.md`](docs/deployment.md).

## Краткий обзор возможностей

- **Мультиклановый мониторинг и надёжная доставка**: синхронизация профиля и состава клана, обычных войн, раундов CWL и
  рейдовых выходных с транзакционной фиксацией **доменных событий** и двухэтапным outbox в SQLite (семантика доставки
  `at-least-once`, подробнее в [`docs/architecture.md`](docs/architecture.md)).
- **Отчёты, нарушения и напоминания**: итоги войн, CWL и рейдов, сравнительная динамика, **напоминания** о контрольных
  точках, отчёты по **нарушениям** и надёжности состава с разделением на **аудитории** `players` и `management`
  ([`docs/reports.md`](docs/reports.md)).
- **Telegram-бот (`grammY`)**: команды `/start` (в т.ч. `/start <arg>`), `/help`, `/link`, `/unlink`, регистрация
  подсказок команд и описания бота при старте, автоматическое определение **аудитории** по типу чата, поддержка форумных
  тем (`message_thread_id`) и интерактивный каталог видео-гайдов для ратуш TH7–TH18 ([`docs/telegram.md`](docs/telegram.md)).

Актуальное подтверждённое состояние **AS-IS** и известные ограничения зафиксированы в
[`docs/roadmap.md`](docs/roadmap.md).

## Документация

| Документ                                               | Назначение                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [`AGENTS.md`](AGENTS.md)                               | Правила работы AI-агента, команды проверок, инварианты и Definition of Done            |
| [`GLOSSARY.md`](GLOSSARY.md)                           | Канонические термины предметной области и запрещённые синонимы                         |
| [`docs/architecture.md`](docs/architecture.md)         | Архитектура TS/Node.js 24, границы модулей `src/`, схема `config.json`/`.env` и циклы  |
| [`docs/database.md`](docs/database.md)                 | SQLite WAL, транзакции, миграции `001`–`015`, схема таблиц и контракты репозиториев    |
| [`docs/reports.md`](docs/reports.md)                   | `ApplicationEvent`, payload, матрица доставки, форматтеры, напоминания и outbox        |
| [`docs/telegram.md`](docs/telegram.md)                 | `grammY`, команды, права администратора чата, форумные темы, меню и `TelegramGateway`  |
| [`docs/deployment.md`](docs/deployment.md)             | Серверные требования, Docker, GHCR CI/CD, SSH-туннель и бэкапы/восстановление SQLite   |
| [`docs/roadmap.md`](docs/roadmap.md)                   | Подтверждённый функционал AS-IS, известные ограничения и направления развития          |
| [`docs/adr/`](docs/adr/)                               | Архитектурные решения (ADR `0001`–`0005`)                                              |
| [`docs/research/competitors.md`](docs/research/competitors.md) | Рыночный обзор аналогов и позиционирование ClashBot                            |

## Правовая информация

This material is unofficial and is not endorsed by Supercell. For more information see
[Supercell's Fan Content Policy](https://supercell.com/en/fan-content-policy/).
