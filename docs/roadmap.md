# Roadmap и состояние системы ClashBot

Документ фиксирует подтверждённый функционал **AS-IS** (на основе `src/`, `tests/` и `migrations/`), известные ограничения и незапланированные направления развития. Канонические термины определены в [`GLOSSARY.md`](../GLOSSARY.md).

## 1. Текущее состояние (AS-IS)

### Платформа, жизненный цикл и эксплуатация

- **Стек**: TypeScript (ESM), Node.js `>=24.0.0` (LTS), `pnpm@12.21.0`, `zod`, `better-sqlite3`, `grammY`, `undici`, `pino` (`src/`, [`package.json`](../package.json)).
- **Конфигурация**: валидация `config.json` и переменных окружения (`SUPERCELL_TOKEN`, `TELEGRAM_TOKEN`) через `zod` ([`src/config/`](../src/config/)); автоматическая загрузка `.env` из каталога конфига.
- **Однопроцессная модель**: четыре фоновых цикла (`syncLoop` / `ClanManager`, `DomainEventWorker`, `NotificationWorker`, `TelegramBotService`) работают в одном event loop с единым `AbortController` и бюджетом остановки `15s` в `ShutdownCoordinator`; при аварии цикла или превышении бюджета процесс завершается с кодом `1` ([`src/main.ts`](../src/main.ts), [`src/app/`](../src/app/)).
- **Сборка и CI/CD**: multi-stage [`Dockerfile`](../Dockerfile) (`node:24-slim`, `USER node` с UID/GID `1000:1000`), [`docker-compose.yml`](../docker-compose.yml), workflow [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) (проверки, Docker smoke-тест, публикация в GHCR), скрипт онлайн-бэкапа [`scripts/backup-sqlite.sh`](../scripts/backup-sqlite.sh) и SSH-туннель [`scripts/startTunnel.sh`](../scripts/startTunnel.sh).

### База данных и целостность

- **SQLite**: одно синхронное соединение `better-sqlite3` в режиме `WAL` (`PRAGMA foreign_keys = ON`, `synchronous = NORMAL`, `busy_timeout = 5000`); все записи идут в синхронных транзакциях `BEGIN IMMEDIATE` с повторами при `SQLITE_BUSY` ([`src/database/`](../src/database/)).
- **Миграции**: 12 SQL-миграций `001`–`012` ([`migrations/`](../migrations/)), применяемых `MigratorManager` атомарно с проверкой `PRAGMA foreign_key_check`; сохранена drop-in совместимость с накопленными БД схемы `001`–`012`.
- **Мультиклановость и подписки**: одновременное отслеживание нескольких кланов (`tracking_enabled`), независимое хранение **Telegram-назначений** (`chat_id + message_thread_id`), **подписок** с **аудиториями** (`players` | `management`) и **поколениями подписки**, эпизодов сбоев (`sync_outages`), журнала **доменных событий** (`domain_events`, `domain_event_destinations`) и outbox (`notifications`).

### Синхронизация с CoC API, события и аналитика

- **Цикл опроса**: `ClanManager` ведёт расписание `next_due` по каждому активному **отслеживаемому клану** с целевым интервалом `15` минут (без накопления дрейфа от длительности обхода), до `3` попыток на сервис, пробуждением по `notify()` сразу после `/link` для немедленной первичной синхронизации и фиксацией открытия/закрытия эпизодов сбоев `sync_outages` ([`src/services/clanManager.ts`](../src/services/clanManager.ts)).
- **Четыре сервиса данных** ([`src/services/`](../src/services/)): `ClanInfoService` (профиль клана, игроки, история членства, снапшоты; первичная синхронизация клана не генерирует поток событий входа), `ClanwarService` (обычные войны с пропуском приватного war log), `ClanwarLeagueService` (текущая группа и раунды CWL), `RaidService` (последний рейдовый уикенд `limit=1`).
- **Доменные события** ([`src/events/applicationEvents.ts`](../src/events/applicationEvents.ts)): 10 типизированных событий (`PlayerJoinedClanEvent`, `PlayerLeftClanEvent`, `PlayerRoleChangedEvent`, `war_ended`, `raids_ended`, `cwl_round_ended`, `SyncFailureEvent`, `SyncRecoveryEvent`, `war_reminder`, `raid_reminder`), сохраняемых атомарно с изменением состояния и снимком **получателей события** в одной транзакции.
- **Контрольные точки напоминаний** ([`src/services/reminders.ts`](../src/services/reminders.ts)): для войн и CWL — `started`, `six_hours_left`, `one_hour_left`; для рейдов — `started`, `forty_eight_hours_left`, `twenty_four_hours_left`, `six_hours_left`, `one_hour_left`.
- **Отчёты, нарушения и аналитика** ([`src/reports/`](../src/reports/), [`src/analytics/`](../src/analytics/)):
  - итоги обычных войн, раундов CWL и рейдов;
  - отчёты по **нарушениям** войн, CWL и рейдов;
  - сравнительная аналитика обычных войн и рейдов с предыдущими записями (`Better` / `Worse` / `Similar`);
  - отчёт надёжности текущего состава по последним войнам (*Стабильные / Требуют внимания / Риск / Не участвовали*);
  - кадровые, системные уведомления и **напоминания** (форматирование дат в `UTC+3`).

### Outbox и Telegram

- **Двухступенчатый outbox** ([`src/domainEvents/`](../src/domainEvents/), [`src/notifications/`](../src/notifications/)):
  - `DomainEventWorker` материализует `domain_event_destinations` в `notifications` с учётом политики **аудитории** (`EventNotificationPolicy`), HTML-безопасным разбиением длинных сообщений на части `1..N` (`part_index`/`part_count`, лимит `3900` видимых символов с индикатором `Часть K/N` при `part_count > 1`), дедупликацией и exponential backoff при ошибках;
  - `NotificationWorker` доставляет сообщения через `GrammyTelegramGateway` со статусами `pending`, `sending`, `sent`, `failed`, `cancelled`, атомарным захватом и восстановлением по TTL (`claimTtlSeconds = 60`), строгим порядком частей `1 → 2 → ...` при временных сбоях, каскадным переводом оставшихся `pending`-частей в `failed` при терминальном отказе предыдущей части, таймаутом запроса, классификацией ошибок Bot API (`rate_limit`, `transient`, `permanent`, `aborted`) и учётом `retry_after` в `next_attempt_at`.
  - Отмена **подписки** через `/unlink` в одной транзакции отменяет `pending` записи текущего **поколения подписки**; повторный `/link` создаёт новое поколение.
- **Входящий бот** ([`src/telegram/`](../src/telegram/)): `grammY` long polling, команды `/start`, `/link #TAG`, `/unlink #TAG`, проверка прав `administrator`/`creator` в группах, автоматическое правило `private → management` / `group|supergroup → players`, поддержка форумных тем (`message_thread_id`), inline-меню («Мои кланы» с кнопкой отключения, «Помощь») и каталог из 49 видео-гайдов для TH7–TH18 ([`resources/telegram/attack_guides.json`](../resources/telegram/attack_guides.json)).
- **Тесты**: 52 тестовых файла Vitest ([`tests/`](../tests/)) — unit-, integration-, golden-тесты форматтеров и HTML-сплиттера, а также тест drop-in совместимости с БД схемы `001`–`012`.

---

## 2. Известные ограничения и техдолг

### Архитектура выполнения и доставка

- **Только один экземпляр на БД**: запуск второго экземпляра ClashBot поверх той же файловой БД программно запрещён на старте через эксклюзивную блокировку ОС на `<dbPath>.lock` (`InstanceLockError`), однако горизонтальное масштабирование (многоэкземплярный межпроцессный `lease`/`claim`-механизм) не реализовано.
- **Доставка `at-least-once`**: аварийная остановка между успешным ответом Telegram Bot API и `markAsSent` в SQLite может привести к повторной отправке уведомления.
- **Очередь уведомлений**: нет TTL/автоотмены устаревших **напоминаний** в `notifications`; нет встроенного инструмента повторной постановки `failed`-записей в `pending`.
- **Изменения Telegram-чатов и polling**: не обрабатываются миграция `group → supergroup` (`migrate_to_chat_id`), удаление/блокировка бота и удаление форумной темы; polling offset `getUpdates` хранится только в памяти.

### Синхронизация и историческая аналитика

- **Ограничения `/link`**: отсутствуют квоты/rate-limit на `/link`.
- **Обработка граничных ответов CoC API**: `ClanwarLeagueService` нумерует раунды CWL последовательно по доступным ответам API без сохранения исходного индекса при пропусках.
- **Неполнота и перекрёстные данные**: опрашиваются только текущие окна (`currentwar`, `capitalraidseasons?limit=1`, текущая `leaguegroup`); корреляция пропусков с `sync_outages` и догрузка прошлых рейдов ещё не реализованы; `ClanInfoService.detectRoleChanges` сравнивает роль с последним снапшотом без учёта перерыва членства.

### Конфигурация, команды и эксплуатация

- **Жёсткие доменные настройки**: не настраиваются категории отчётов/напоминаний, расписание опроса, критерии **нарушений**, часовой пояс (`UTC+3` в форматтерах) и ручной выбор **аудитории** для **Telegram-назначения**; при позднем запуске в конце окна генерируются все уже открытые контрольные точки **напоминаний**.
- **Ограниченный Telegram UI и наблюдаемость**: нет интерактивных команд просмотра текущей войны, рейда, состава или поиска игрока; нет встроенных метрик/healthcheck endpoint (только JSON-логи `pino` в `stdout`) и автоматической ротации/архивации старых исторических записей в SQLite.

---

## 3. Возможные направления развития

Следующие направления являются ориентирами развития и **не представляют собой обещанных сроков или контракта ближайшего релиза**:

- **Надёжность синхронизации и доставки**: обработка недоступности/миграции чатов, TTL для **напоминаний**, инструмент управляемого повтора `failed`-уведомлений, уточнение правил полноты истории и конкурентных границ при `/unlink`.
- **Эксплуатация и наблюдаемость**: метрики длительности циклов и состояния очередей, доступность статуса синхронизации без чтения логов, политика архивации исторических таблиц SQLite.
- **Гибкость настроек и команды просмотра**: фильтрация типов уведомлений и **напоминаний**, настраиваемый часовой пояс и правила **нарушений**, переключение **аудитории** на уровне **Telegram-назначения**, команды просмотра текущей войны/рейда/активности игроков, экспорт или веб-интерфейс аналитики при масштабировании числа кланов.
