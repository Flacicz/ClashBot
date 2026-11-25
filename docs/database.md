# База данных SQLite

## Подключение и базовые параметры (`src/database/database.ts`)

ClashBot хранит состояние отслеживаемых кланов, историю, подписки, доменные события и outbox-очередь в одном файле SQLite. Каталог видео-гайдов в БД не хранится — он загружается при старте из JSON.

При открытии `Database` (`better-sqlite3`) применяет обязательные настройки соединения:

```sql
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

- **Одно соединение и один процесс**: приложение делит одно соединение `better-sqlite3` между всеми кооперативными циклами в одном процессе Node.js ([ADR-0002](adr/0002-single-loop-better-sqlite3.md)). На один файл БД допускается только один активный процесс ClashBot (межпроцессного `lease/claim` механизма нет).
- **Время**: все временные поля хранятся как Unix timestamp в секундах (`INTEGER`), значения по умолчанию — `strftime('%s', 'now')`.

## Транзакции и политика повторов

### `TransactionManager` и `TransactionGuard` (`src/database/transactionManager.ts`)

- Записывающие операции выполняются через `transactionManager.retryInTransaction(operation)` между `BEGIN IMMEDIATE` и `COMMIT`.
- При ошибке (включая исключение после начала транзакции) `TransactionGuard.rollback()` откатывает изменения.
- **Строгая синхронность**: `operation` не может возвращать `PromiseLike` — это проверяется на уровне типов TypeScript и в runtime (возврат промиса немедленно прерывается ошибкой `DatabaseError` с `SQLITE_MISUSE` и откатом). Внешние HTTP-вызовы к CoC API и Telegram внутри транзакций исключены.
- **Повтор при `SQLITE_BUSY`**: если SQLite возвращает `SQLITE_BUSY` или `SQLITE_BUSY_*` (например, при внешнем онлайн-бэкапе), `TransactionManager` повторяет транзакцию согласно `RetryPolicy` (`src/database/retryPolicy.ts`). По умолчанию: до `3` попыток с линейной задержкой от `100 мс` (`100 мс` перед 2-й попыткой, `200 мс` перед 3-й) через `Atomics.wait`.
- **Обработка ошибок**: `src/database/sqliteErrors.ts` (`toDatabaseError`) переводит исключения `better-sqlite3` в типизированный `DatabaseError` с сохранением `sqliteCode`.

## Миграции (`MigratorManager` и `ForeignKeysGuard`)

### Протокол применения (`src/database/migratorManager.ts`)

1. До цикла применения файлов создаётся таблица `schema_migrations`.
2. Читается каталог `database.migrations_path` (по умолчанию `migrations/`, в контейнере `/app/migrations`). Наличие любого не-`.sql` файла или подкаталога в этом каталоге немедленно выбрасывает `DatabaseError` и останавливает запуск.
3. Список `.sql`-файлов сортируется лексикографически по имени.
4. Для каждого файла в одной транзакции `BEGIN IMMEDIATE`:
   - проверяется, записано ли имя файла в `schema_migrations.version` (если да — файл пропускается);
   - выполняется SQL файла (`db.connection.exec()`);
   - выполняется `PRAGMA foreign_key_check` по всей базе; при наличии любого нарушения связей транзакция откатывается;
   - имя файла записывается в `schema_migrations.version` до `COMMIT`.
5. При любой ошибке транзакция откатывается, `migrate()` выбрасывает `DatabaseError` и приложение завершает старт с кодом `1`.

### Управление внешними ключами (`src/database/foreignKeysGuard.ts`)

- По умолчанию перед транзакцией мигратор проверяет `requireForeignKeysEnabled()` (`PRAGMA foreign_keys = ON`), чтобы корректно работали `ON DELETE CASCADE` и остальные ограничения.
- Единственное исключение — историческая миграция `003_clan_info_schema_v1_to_v2.sql`, пересоздающая `clans` с переносом строк. Для неё `ForeignKeysGuard` отключает `PRAGMA foreign_keys = OFF` **строго до** начала транзакции; целостность итоговых связей проверяется `PRAGMA foreign_key_check` **внутри** транзакции; после `COMMIT` вызывается `restore()`, а при исключении — `restoreBestEffort()` (ошибка восстановления логируется, а наружу уходит исходная ошибка).

### Правила эволюции схемы

- Уже применённые файлы `001`–`014` изменять запрещено ([ADR-0004](adr/0004-sqlite-drop-in-compatibility.md)). Новые изменения схемы добавляются только новым `.sql`-файлом с возрастающим числовым префиксом (`015_...`).
- SQL-файлы миграций не должны содержать собственных `BEGIN`, `COMMIT`, `ROLLBACK` или переключения `PRAGMA foreign_keys`, чтобы не нарушать транзакционный протокол `MigratorManager`.
- Если новая миграция требует пересборки таблицы при `foreign_keys = OFF`, необходимо явно расширить политику в `MigratorManager` и добавить интеграционный тест обновления заполненной БД.

### Применённые миграции (`migrations/001`–`014`)

| Версия | Содержание |
| --- | --- |
| `001_initial_schema.sql` | Первоначальные таблицы схемы v1 |
| `002_war_schema_v1_to_v2.sql` | Переход войн и CWL на схему v2 (`cwl_seasons`, `cwl_season_members`, `wars`, `war_clans`, `war_members`, `attacks`, переименование `clan_info` → `clans`) |
| `003_clan_info_schema_v1_to_v2.sql` | Пересборка `clans`, создание `players`, `clan_memberships`, `clan_snapshots`, `player_snapshots` |
| `004_raid_schema_v1_to_v2.sql` | Таблицы рейдов `clan_raids` и `player_raid_snapshots` |
| `005_notifications_schema_v1_to_v2.sql` | `telegram_chats`, `clan_subscriptions`, `notifications` v2 |
| `006_telegram_topics.sql` | Составной ключ `(chat_id, message_thread_id)` для форумных тем (`0` — общий чат) |
| `007_subscription_audience.sql` | Разделение `clan_subscriptions` по `audience` (`players` \| `management`) |
| `008_clan_tracking.sql` | Добавление `clans.tracking_enabled` (`0` \| `1`) |
| `009_notification_outbox.sql` | Преобразование `notifications` в outbox со статусами доставки; перенос старых записей как `sent` с пустым текстом |
| `010_sync_outages.sql` | Таблица `sync_outages` и частичный уникальный индекс открытого эпизода |
| `011_domain_events.sql` | Таблицы `domain_events` и `domain_event_destinations`, `subscription_id` в `clan_subscriptions`, связь `notifications.domain_event_destination_id` |
| `012_legacy_notification_idempotency.sql` | Частичный уникальный индекс `idx_notifications_legacy_event_destination` для строк без `domain_event_destination_id` |
| `013_notification_claim_status.sql` | Пересборка `notifications`: добавлен статус `'sending'` в `CHECK`, колонка `claimed_at INTEGER` и частичный индекс `idx_notifications_sending` |
| `014_history_completeness.sql` | Добавлены `is_complete` (`0` \| `1`) и `last_observed_at` в `wars` и `clan_raids`, backfill по финальным состояниям (`'warEnded'` / `'ended'`) и индексы `idx_wars_regular_history`, `idx_clan_raids_history` |

## Актуальная схема БД

### Граф связей

```text
clans
 ├── players.clan_tag (ON DELETE SET NULL)
 ├── clan_memberships (ON DELETE CASCADE; player_tag ON DELETE NO ACTION)
 ├── clan_snapshots (ON DELETE CASCADE)
 ├── player_snapshots.clan_tag (ON DELETE SET NULL; player_tag ON DELETE NO ACTION)
 ├── cwl_seasons (ON DELETE CASCADE)
 │    ├── cwl_season_members (ON DELETE CASCADE)
 │    └── wars.season_id (без ON DELETE)
 ├── clan_raids (ON DELETE CASCADE)
 │    └── player_raid_snapshots (ON DELETE CASCADE на raid_id и player_tag)
 ├── clan_subscriptions (ON DELETE CASCADE) ── telegram_chats (ON DELETE CASCADE)
 └── sync_outages (ON DELETE CASCADE)

wars (связан с clans логически через clan_tag, FK только на cwl_seasons)
 ├── war_clans (ON DELETE CASCADE)
 ├── war_members (ON DELETE CASCADE на war_id и war_clan_id)
 └── attacks (ON DELETE CASCADE на war_id; FK на attacker/defender_war_clan_id)

domain_events ── domain_event_destinations (FK на domain_event_id) ── notifications (FK на domain_event_destination_id)
schema_migrations
```

### Кланы и игроки

| Таблица | PK и ключевые ограничения | Поля и FK-политика | Индексы |
| --- | --- | --- | --- |
| `clans` | PK: `tag` (`TEXT`); `CHECK (tracking_enabled IN (0, 1))` | `name`, `description`, `location_id`, `location_name`, `chat_language_id`, `chat_language`, `is_family_friendly` (`DEFAULT 0`), `created_at`, `tracking_enabled` (`DEFAULT 1`) | — |
| `players` | PK: `tag` (`TEXT`) | `name` (`NOT NULL`), `clan_tag` (`FK → clans(tag) ON DELETE SET NULL`), `created_at` | `idx_players_clan_tag (clan_tag)` |
| `clan_memberships` | PK: `id` (`AUTOINCREMENT`) | `clan_tag` (`FK → clans(tag) ON DELETE CASCADE`), `player_tag` (`FK → players(tag) ON DELETE NO ACTION`), `joined_at`, `left_at` (`NULL` = активное членство) | `idx_memberships_active (clan_tag, player_tag) WHERE left_at IS NULL` |
| `clan_snapshots` | PK: `id` (`AUTOINCREMENT`) | `clan_tag` (`FK → clans(tag) ON DELETE CASCADE`), `type`, `members_count`, `clan_level`, `clan_points`, `clan_builder_points`, `clan_capital_points`, `capital_hall_level`, `capital_league_id`, `required_trophies`, `required_builder_base_trophies`, `required_town_hall_level`, `war_frequency`, `is_war_log_public`, `war_win_streak`, `war_wins`, `war_ties`, `war_losses`, `war_league_id`, `created_at` | `idx_clan_snapshots_lookup (clan_tag, created_at DESC)` |
| `player_snapshots` | PK: `id` (`AUTOINCREMENT`) | `player_tag` (`FK → players(tag) ON DELETE NO ACTION`), `clan_tag` (`FK → clans(tag) ON DELETE SET NULL`), `role`, `th_level`, `exp_level`, `clan_rank`, `league_id`, `builder_base_league_id`, `trophies`, `builder_base_trophies`, `donations`, `donations_received`, `created_at` | `idx_player_snapshots_lookup (player_tag, created_at DESC)`, `idx_player_snapshots_clan_history (clan_tag, created_at DESC)` |

### Клановые войны и CWL

| Таблица | PK и ограничения | Поля и FK-политика | Индексы |
| --- | --- | --- | --- |
| `cwl_seasons` | PK: `cwl_season_id` (`AUTOINCREMENT`); `UNIQUE (clan_tag, season_id)` | `clan_tag` (`FK → clans(tag) ON DELETE CASCADE`), `season_id`, `created_at` | `idx_cwl_seasons_clan_tag (clan_tag)` |
| `cwl_season_members` (`WITHOUT ROWID`) | PK: `(cwl_season_id, player_tag)` | `cwl_season_id` (`FK → cwl_seasons(cwl_season_id) ON DELETE CASCADE`), `season_id`, `clan_tag`, `player_tag`, `player_name`, `townhall_level`, `created_at` | `idx_cwl_season_members_id (cwl_season_id)` |
| `wars` | PK: `war_id` (`AUTOINCREMENT`); `UNIQUE (war_uid)`; `CHECK (war_type IN ('regular', 'cwl', 'friendly'))`; `CHECK (is_complete IN (0, 1))` | `war_uid` (формат `${clanTag}_${tag1}_${tag2}_${prepTime}`, где `tag1 <= tag2`), `clan_tag` (без FK на `clans`), `state`, `war_type`, `team_size`, `attacks_per_member` (`DEFAULT 2`), `preparation_start_time`, `start_time`, `end_time`, `season_id` (`FK → cwl_seasons(cwl_season_id)`), `round_number`, `created_at`, `is_complete` (`DEFAULT 0`; `1` при наблюдении в `'warEnded'`), `last_observed_at` | `idx_wars_cwl_season_id (season_id)`, `idx_wars_start (start_time)`, `idx_wars_regular_history (clan_tag, war_type, preparation_start_time DESC)` |
| `war_clans` | PK: `war_clan_id` (`AUTOINCREMENT`); `CHECK (side IN ('home', 'opponent'))`; `UNIQUE (war_id, side)`; `UNIQUE (war_id, clan_tag)` | `war_id` (`FK → wars(war_id) ON DELETE CASCADE`), `side`, `clan_tag`, `clan_name`, `clan_level`, `attacks_count`, `stars`, `destruction_percentage`, `created_at` | `idx_war_clans_war_id (war_id)`, `idx_war_clans_tag (clan_tag)` |
| `war_members` | PK: `war_member_id` (`AUTOINCREMENT`); `UNIQUE (war_id, player_tag)` | `war_id` (`FK → wars(war_id) ON DELETE CASCADE`), `war_clan_id` (`FK → war_clans(war_clan_id) ON DELETE CASCADE`), `player_tag`, `player_name`, `townhall_level`, `map_position`, `created_at` | `idx_war_members_war_id (war_id)`, `idx_war_members_war_clan_id (war_clan_id)`, `idx_members_player (player_tag)` |
| `attacks` | PK: `attack_id` (`AUTOINCREMENT`); `CHECK (stars BETWEEN 0 AND 3)`; `CHECK (order_num > 0)`; `UNIQUE (war_id, order_num)` | `war_id` (`FK → wars(war_id) ON DELETE CASCADE`), `attacker_war_clan_id` (`FK → war_clans(war_clan_id)`), `defender_war_clan_id` (`FK → war_clans(war_clan_id)`), `attacker_tag`, `defender_tag`, `attacker_position`, `defender_position`, `stars`, `destruction_percentage`, `order_num`, `duration`, `created_at` | `idx_attacks_war (war_id)`, `idx_attacks_attacker (attacker_tag)`, `idx_attacks_defender (defender_tag)` |

### Рейдовые выходные

| Таблица | PK и ограничения | Поля и FK-политика | Индексы |
| --- | --- | --- | --- |
| `clan_raids` | PK: `id` (`AUTOINCREMENT`); `UNIQUE (clan_tag, start_time)`; `CHECK (is_complete IN (0, 1))` | `clan_tag` (`FK → clans(tag) ON DELETE CASCADE`), `start_time`, `end_time`, `state`, `total_loot`, `raids_completed`, `total_attacks`, `enemy_districts_destroyed`, `offensive_reward`, `defensive_reward`, `created_at`, `is_complete` (`DEFAULT 0`; `1` при наблюдении в `'ended'`), `last_observed_at` | `idx_clan_raids_clan_tag (clan_tag)`, `idx_clan_raids_history (clan_tag, start_time DESC)` |
| `player_raid_snapshots` | PK: `id` (`AUTOINCREMENT`); `UNIQUE (raid_id, player_tag)` | `raid_id` (`FK → clan_raids(id) ON DELETE CASCADE`), `player_tag` (`FK → players(tag) ON DELETE CASCADE`), `attacks_count`, `bonus_attacks`, `total_loot`, `created_at` | `idx_player_raid_snapshots_player_tag (player_tag)` |

### Telegram-подписки, события, outbox и служебные таблицы

| Таблица | PK и ограничения | Поля и FK-политика | Индексы |
| --- | --- | --- | --- |
| `telegram_chats` (`WITHOUT ROWID`) | PK: `(chat_id, message_thread_id)` | `chat_id`, `message_thread_id` (`DEFAULT 0`; `0` — общий чат, `> 0` — тема форума), `title`, `created_at` | — |
| `clan_subscriptions` | PK: `subscription_id` (`AUTOINCREMENT`); `UNIQUE (clan_tag, chat_id, message_thread_id, audience)`; `CHECK (audience IN ('players', 'management'))` | `clan_tag` (`FK → clans(tag) ON DELETE CASCADE`), `(chat_id, message_thread_id)` (`FK → telegram_chats ON DELETE CASCADE`), `audience` (`DEFAULT 'players'`), `created_at` | — |
| `domain_events` | PK: `id` (`AUTOINCREMENT`); `UNIQUE (clan_tag, event_type, event_id)` | `event_type`, `event_id`, `event_payload` (JSON), `payload_version` (`DEFAULT 1`), `clan_tag`, `created_at` | — |
| `domain_event_destinations` | PK: `id` (`AUTOINCREMENT`); `CHECK (audience IN ('players', 'management'))`; `CHECK (status IN ('pending', 'materialized', 'cancelled'))`; `CHECK (attempts >= 0)`; `UNIQUE (domain_event_id, chat_id, message_thread_id, audience, subscription_id)` | `domain_event_id` (`FK → domain_events(id)`), `chat_id`, `message_thread_id`, `audience`, `subscription_id` (логическая ссылка на поколение подписки без FK), `status`, `attempts`, `next_attempt_at`, `last_error`, `created_at`, `materialized_at`, `cancelled_at` | `idx_domain_event_destinations_pending (status, next_attempt_at, created_at, id)`, `idx_domain_event_destinations_subscription (subscription_id)` |
| `notifications` | PK: `id` (`AUTOINCREMENT`); `CHECK (part_index >= 1 AND part_index <= part_count)`; `CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled'))`; `CHECK (attempts >= 0)`; `UNIQUE (domain_event_destination_id, event_type, event_id, part_index)` | `domain_event_destination_id` (`FK → domain_event_destinations(id)`, `NULL` для исторического пути), `event_type`, `event_id`, `chat_id`, `message_thread_id`, `message_text`, `part_index` (`DEFAULT 1`), `part_count` (`DEFAULT 1`), `status` (`DEFAULT 'pending'`), `attempts`, `next_attempt_at`, `claimed_at` (`NULL`, если запись не в `'sending'`), `last_error`, `created_at`, `sent_at` | `idx_notifications_pending (status, next_attempt_at, created_at, id)`, `idx_notifications_domain_destination (domain_event_destination_id)`, `UNIQUE idx_notifications_legacy_event_destination (event_type, event_id, chat_id, message_thread_id, part_index) WHERE domain_event_destination_id IS NULL`, `idx_notifications_sending (claimed_at, id) WHERE status = 'sending'` |
| `sync_outages` | PK: `id` (`AUTOINCREMENT`); `CHECK (failure_count >= 1)` | `clan_tag` (`FK → clans(tag) ON DELETE CASCADE`), `service_name`, `failure_count`, `started_at`, `recovered_at` (`NULL` = открытый эпизод) | `UNIQUE idx_sync_outages_open (clan_tag, service_name) WHERE recovered_at IS NULL`, `idx_sync_outages_history (clan_tag, service_name, started_at DESC)` |
| `schema_migrations` | Без PK | `version` (`TEXT NOT NULL`), `applied_at` | — |

## Контракты репозиториев (`src/database/repos/`)

Все репозитории изолируют SQLite-запросы, работают поверх одного `Database` / `SqliteConnection` (через `BaseRepository` или `runRepoQuery` из `repoHelpers.ts`) и оборачивают ошибки SQLite в `DatabaseError`.

| Репозиторий | Зона ответственности и ключевые контракты |
| --- | --- |
| `ClansRepo` | `getTrackedClans()` (`tracking_enabled = 1`), `insertMinimalClan()` (имя `'Pending synchronization'`, при конфликте включает `tracking_enabled = 1`), `disableTracking()`, `insertMinimal()` для игроков (`'Unknown Player'`), `saveCompleteClanData()` (возвращает `snapshotIds`), `getActiveMemberships()`, `saveMembershipChanges()` (закрывает `left_at` + сбрасывает `players.clan_tag = NULL` или создаёт новую запись `clan_memberships`), `getLatestPlayerSnapshots()` (по `MAX(id)`). |
| `ClanwarRepo` | `saveCompleteClanwarData()` (возвращает `ClanwarReference`), `saveClanwar()` (выставляет `is_complete = 1` при `state === 'warEnded'`, при конфликте `war_uid` монотонно сохраняет `is_complete = MAX(is_complete, excluded.is_complete)` и финальный `state = 'warEnded'`, обновляет `last_observed_at`), `saveClanwarDetails()` (upsert сторон `home`/`opponent`), `saveClanwarAttacks()` (upsert по `(war_id, order_num)`), `replaceClanwarMembers()` (удаляет старых участников стороны и вставляет новых, но **пропускает операцию при пустом входящем массиве**, сохраняя прежний состав), выборки для отчётов и аналитики (`getClanwarStats`, `getBestAttacks`, `getSlackersWithNoAttacks`, `getSlackersWithOneAttack`, `getPlayersWithFirstAttackNotOnMirror`, `getPreviousClanwars` — только `state = 'warEnded' AND is_complete = 1`, `countSkippedIncompleteClanwars` — число отфильтрованных неполных обычных войн в рассматриваемом окне). |
| `ClanwarsLeagueRepo` | `saveCompleteCWLData()` (upsert сезона и `INSERT OR IGNORE` участников), `getRoundInfo()` (читает `season_id` и `round_number` из `wars`). |
| `RaidRepo` | `saveCompleteRaidData()` (upsert по `(clan_tag, start_time)` с монотонным `is_complete = MAX(is_complete, excluded.is_complete)`, сохранением финального `state = 'ended'` и обновлением `last_observed_at`; `player_raid_snapshots` по `(raid_id, player_tag)`), `getRaidStats()`, `getBestRaidMembers()`, `getRaidSlackers()`, `getRaidComparisonStats()`, `getPreviousRaids()` (только `state = 'ended' AND is_complete = 1`), `countSkippedIncompleteRaids()`. В выборках для нарушений и сравнения `eligible`-участники вычисляются по `clan_memberships` на момент `end_time` рейда (`joined_at <= r.end_time AND (left_at IS NULL OR left_at >= r.end_time)`). |
| `SubscriptionRepo` | `saveTelegramChat()`, `deleteTelegramChat()`, `subscribeToChat()` (`INSERT OR IGNORE`), `getSubscriptionId()`, `getDestinationsForClan()`, `getSubscriptionDestinationsForClan()` (возвращает `subscriptionId` поколения), `getClanTagsForChat()`, `unsubscribeFromChat()` (удаляет подписку, чистит `telegram_chats` при отсутствии других подписок назначения и ставит `clans.tracking_enabled = 0` при отсутствии других подписок клана). |
| `DomainEventsRepo` | `appendEvent()` (`INSERT ... ON CONFLICT (clan_tag, event_type, event_id) DO NOTHING RETURNING id`; если событие уже существовало, новые destinations не добавляются), `getPendingDestinations()` (учитывает `next_attempt_at` и `attempts`), `isDestinationPending()`, `markMaterialized()` (условный атомарный захват `WHERE id = ? AND status = 'pending'` с проверкой `changes === 1`), `reschedule()`, `cancelForSubscription(subscriptionId)` (переводит `pending` destinations и связанные `pending` notifications в `'cancelled'`). |
| `NotificationRepo` | `enqueueDomainEventIfAbsent()` (дедупликация по `(domain_event_destination_id, event_type, event_id, part_index)`), `enqueueIfAbsent()` (исторический путь с `ON CONFLICT ... WHERE domain_event_destination_id IS NULL DO NOTHING`), `getPending()`, `isPending()`, `claimForSending(id, claimedAt)` (атомарно переводит `pending` → `'sending'` с фиксацией `claimed_at`), `markAsSent()`, `reschedule()`, `markAsFailed()` (все три обновляют только `status = 'sending'` и сбрасывают `claimed_at = NULL`), `cancelSendingIfSubscriptionInactive()`, `releaseClaimed()`, `recoverAllSending()` и `recoverStaleSending(cutoff)` (восстановление зависших `'sending'`-записей: перевод в `'cancelled'`, если подписка отсутствует в `clan_subscriptions`, иначе возврат в `'pending'` со сбросом `claimed_at = NULL`), `cancelForSubscription()`. |
| `SyncOutageRepo` | `recordFailure()` (атомарный upsert через частичный индекс `idx_sync_outages_open` с инкрементом `failure_count`), `getOpenOutageId()`, `markRecovered()`. |

## Идемпотентность и целостность на уровне БД

- **Изоляция проекций войн по отслеживаемому клану**: ключ `wars.war_uid` включает тег отслеживаемого клана (`${clanTag}_${tag1}_${tag2}_${prepTime}`, где `tag1 <= tag2`) как для обычных войн, так и для раундов CWL. Если два отслеживаемых клана встречаются друг с другом, для каждого создаётся собственная запись в `wars` (и связанные строки в `war_clans`, `war_members`, `attacks`, `getPreviousClanwars`), поэтому синхронизация сторон в любом порядке не перезаписывает данные соперника. Исторические строки со старым форматом `war_uid` (без префикса `clanTag`) не мигрируются; при первом синке незавершённой войны после обновления создаётся новая запись с новым `war_uid`.
- **Независимость поколений подписок**: `clan_subscriptions.subscription_id` (`AUTOINCREMENT`) идентифицирует конкретное поколение подписки от `/link` до `/unlink`. Отключение через `/unlink` отменяет `pending`-записи строго этого `subscription_id`; повторный `/link` получает новый `subscription_id` и не наследует старые `domain_event_destinations`.
- **Защита от дублей доменных событий**: `UNIQUE (clan_tag, event_type, event_id)` в `domain_events` гарантирует однократную фиксацию события и неизменность снимка его получателей при повторных циклах (например, в окне напоминаний).
- **Двойной контур дедупликации outbox**:
  - для durable-событий действует `UNIQUE (domain_event_destination_id, event_type, event_id, part_index)` в `notifications` — повторная материализация не создаёт дубль;
  - для исторического пути (`domain_event_destination_id IS NULL`) действует частичный уникальный индекс `idx_notifications_legacy_event_destination` по `(event_type, event_id, chat_id, message_thread_id, part_index)`, так как `NULL` не конфликтуют в обычном `UNIQUE`-ограничении SQLite.
- **Один активный сбой на сервис и клан**: `idx_sync_outages_open` не допускает двух незакрытых строк в `sync_outages` для одной пары `(clan_tag, service_name)`.
- **Сохранение истории игрока**: `players.clan_tag` и `player_snapshots.clan_tag` используют `ON DELETE SET NULL`, а `clan_memberships.player_tag` и `player_snapshots.player_tag` — `ON DELETE NO ACTION`, поэтому выход игрока из клана не разрушает исторические снимки и отчёты.

Детали форматов `event_type`, `event_id`, `event_payload` и матрицы аудиторий см. в [`docs/reports.md`](reports.md); правила привязки чатов и `/unlink` — в [`docs/telegram.md`](telegram.md).

## Операционные правила ручной работы с БД

1. **Остановите приложение** перед любым ручным изменением файла БД (особенно таблицы `notifications` или `domain_event_destinations`), чтобы фоновые воркеры не обработали изменяемые строки.
2. **Сделайте резервную копию** основного файла БД и сопутствующих `-wal` / `-shm` файлов (или используйте штатный онлайн-бэкап через `.backup`, см. [`docs/deployment.md`](deployment.md)).
3. **Не удаляйте строки из `schema_migrations`** в рабочей базе и не редактируйте применённые файлы в `migrations/`.
4. **Не меняйте `clan_tag` вручную** без учёта `ON DELETE CASCADE` / `SET NULL` и логической ссылки `wars.clan_tag`.
5. **Подписки заводите через `/link`**, так как команда атомарно создаёт минимальную запись в `clans`, `telegram_chats` и `clan_subscriptions` с корректными `message_thread_id` и `audience`.
6. **Диагностика очереди**: проверяйте `status`, `attempts`, `next_attempt_at` и `last_error` в `domain_event_destinations` и `notifications`, а также незакрытые строки `sync_outages` (`WHERE recovered_at IS NULL`).
