---
status: accepted
---

# ADR-0004: Двусторонняя drop-in совместимость с SQLite (миграции 001–012)

На момент перехода с C++ на TypeScript в продакшене использовалась БД `database.sqlite` со схемой миграций 001–012 и накопленной историей отслеживаемых кланов, игроков, войн, CWL, рейдов, подписок, доменных событий и уведомлений. Принято решение выполнить переключение без конвертации БД и сохранить совместимость формата для безопасного отката на прежний образ.

## Решение

- **Схема БД на момент переключения зафиксирована на миграциях 001–012**:
  - существующие SQL-файлы `001_initial_schema.sql` … `012_legacy_notification_idempotency.sql` не изменяются;
  - при переключении на TypeScript миграция `013` не добавлялась; дальнейшее развитие схемы допускается только добавлением новых миграций `013+` по правилам [`docs/database.md`](../database.md);
  - TypeScript-реализация и прежняя C++-реализация (`v1-cpp`) работают с одним и тем же форматом БД 001–012 в обе стороны.
- **Точное воспроизведение протокола `MigratorManager`**:
  - до цикла применения файлов создаётся таблица `schema_migrations(version TEXT NOT NULL, applied_at INTEGER DEFAULT (strftime('%s', 'now')))`;
  - каталог миграций сканируется с лексикографической сортировкой `.sql`-файлов; наличие любого не-SQL файла в каталоге считается ошибкой и останавливает запуск приложения;
  - проверка наличия версии в `schema_migrations`, выполнение SQL, `PRAGMA foreign_key_check` и запись имени файла в `schema_migrations.version` выполняются в одной транзакции `BEGIN IMMEDIATE`;
  - по умолчанию перед транзакцией проверяется `PRAGMA foreign_keys = ON`; единственное явное исключение — историческая миграция `003_clan_info_schema_v1_to_v2.sql` (пересборка `clans` с сохранением ссылающихся таблиц), для которой `PRAGMA foreign_keys = OFF` выставляется **до** транзакции, целостность проверяется `PRAGMA foreign_key_check` **внутри** транзакции, а после коммита режим `PRAGMA foreign_keys = ON` проверяемо восстанавливается.
- **Строгое сохранение строковых и структурных контрактов БД**:
  - **`domain_events.event_type`** (сохраняется историческая смесь PascalCase и snake_case): `PlayerJoinedClanEvent`, `PlayerLeftClanEvent`, `PlayerRoleChangedEvent`, `SyncFailureEvent`, `SyncRecoveryEvent`, `war_ended`, `raids_ended`, `cwl_round_ended`, `war_reminder`, `raid_reminder`;
  - **`domain_events.payload_version`**: значение `1` и существующая JSON-структура `event_payload` (snake_case поля) для всех 10 типов доменных событий;
  - **`domain_events.event_id` и `notifications.event_id`**: стабильные ключи дедупликации — `membershipId` для входа/выхода, `snapshotId` для смены роли, `outageId` для сбоев/восстановления, `warId` для войн и раундов CWL, `raidId` для рейдов, `<warId>:<started|six_hours_left|one_hour_left>` для напоминаний войн/CWL и `<raidId>:<started|forty_eight_hours_left|twenty_four_hours_left|six_hours_left|one_hour_left>` для напоминаний рейдов;
  - **`notifications.event_type`**: все 10 базовых типов плюс типы составных отчётов `war_comparison`, `war_roster_reliability`, `war_violations`, `cwl_violations`, `raids_comparison`, `raids_violations` при `part_index = 1`, `part_count = 1`;
  - **`sync_outages.service_name`**: `ClanInfoService`, `ClanwarService`, `ClanwarLeagueService`, `RaidService`;
  - **`audience`** (`clan_subscriptions`, `domain_event_destinations`): строго `'players'` и `'management'`;
  - **`status`**: для `domain_event_destinations` — `'pending'`, `'materialized'`, `'cancelled'`; для `notifications` — `'pending'`, `'failed'`, `'sent'`, `'cancelled'`;
  - **`message_thread_id`**: `0` для общего чата и положительный идентификатор темы для форумных тем во всех таблицах (`telegram_chats`, `clan_subscriptions`, `domain_event_destinations`, `notifications`).

## Рассмотренные альтернативы

- **Унификация имён `event_type` в snake_case и добавление миграции `013`**: отклонено, так как ломает совместимость с незавершёнными записями в `domain_events` / `notifications` и делает невозможным быстрый откат на C++-образ без ручной обратной миграции данных.
- **Отдельная БД для TypeScript с экспортом/импортом истории**: отклонено из-за риска потери данных, простоя при переключении и высокой стоимости поддержки отдельного конвертера.

## Последствия

- Оператор получил возможность запустить TS-контейнер поверх продовой `database.sqlite` без конвертации и при необходимости откатиться на `v1-cpp` без повреждения схемы 001–012.
- TS-реализация поддерживает историческую неоднородность имён `event_type` (часть в PascalCase, часть в snake_case) до принятия отдельного решения о новой версии схемы/payload.
- Любые изменения схемы или строковых контрактов БД после переключения оформляются отдельными задачами и новой миграцией с возрастающим номером.
