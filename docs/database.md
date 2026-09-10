# Схема SQLite

## Назначение

SQLite хранит текущее состояние кланов и историю, необходимую для отчётов. Один файл базы может обслуживать несколько
кланов и несколько Telegram-назначений.

Каталог видео-гайдов в SQLite не хранится: он загружается из JSON при старте приложения.

При открытии соединения Database включает:

    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

Все временные значения в таблицах — Unix timestamp в секундах. Поля created_at имеют SQLite-значение по умолчанию
strftime('%s', 'now').

## Связи

    clans
     ├── players.clan_tag
     ├── clan_memberships
     ├── clan_snapshots
     ├── wars
     │    ├── war_clans
     │    ├── war_members
     │    └── attacks
     ├── cwl_seasons
     │    └── cwl_season_members
     └── clan_raids
          └── player_raid_snapshots

    telegram_chats
     └── clan_subscriptions ── clans

    notifications  (отдельный журнал идемпотентной доставки)
    schema_migrations

## Кланы и игроки

### clans

Центральная запись клана:

| Поля | Содержание |
| --- | --- |
| tag | первичный ключ, нормализованный тег клана |
| name, description | название и описание |
| location_id, location_name | регион |
| chat_language_id, chat_language | язык чата |
| is_family_friendly | флаг семейного клана |
| created_at | время создания записи |
| tracking_enabled | 1 — клан участвует в синхронизации, 0 — история оставлена, но синхронизация выключена |

/link создаёт минимальную запись с именем Pending synchronization и включает tracking_enabled. ClanInfoService заполняет
остальные поля после следующего ответа API.

### players

Текущее имя игрока и его текущая связь с кланом:

| Поле | Содержание |
| --- | --- |
| tag | первичный ключ |
| name | последнее известное имя |
| clan_tag | текущий клан или NULL |
| created_at | время первого появления |

Игрок не удаляется при выходе из клана. Внешний ключ clan_tag использует ON DELETE SET NULL, поэтому данные игрока
остаются доступными для исторических snapshots и отчётов.

### clan_memberships

История периодов членства:

| Поле | Содержание |
| --- | --- |
| id | первичный ключ |
| clan_tag | клан, ON DELETE CASCADE |
| player_tag | игрок, ON DELETE NO ACTION |
| joined_at | время вступления |
| left_at | время выхода; NULL означает активное членство |

Индекс idx_memberships_active ускоряет выборку строк с left_at IS NULL. При первом импорте текущий состав получает
время вступления момента миграции или первой синхронизации.

### clan_snapshots

История состояния клана. Хранятся type, members_count, clan_level, clan_points, clan_builder_points,
clan_capital_points, capital_hall_level, capital_league_id, требования по трофеям и ратуше, war_frequency,
is_war_log_public, war_win_streak, war_wins, war_ties, war_losses, war_league_id и created_at.

Индекс idx_clan_snapshots_lookup (clan_tag, created_at DESC) используется для истории конкретного клана.

### player_snapshots

Снимки состояния игрока внутри клана:

player_tag, clan_tag, role, th_level, exp_level, clan_rank, league_id, builder_base_league_id, trophies,
builder_base_trophies, donations, donations_received, created_at.

История не удаляется при выходе игрока: внешний ключ на игрока использует ON DELETE NO ACTION, а связь с кланом —
ON DELETE SET NULL. Индексы idx_player_snapshots_lookup и idx_player_snapshots_clan_history обслуживают последние
снимки и историю внутри клана.

## Клановые войны

### wars

Одна строка на уникальную войну:

| Поле | Содержание |
| --- | --- |
| war_id | первичный ключ |
| war_uid | уникальный идентификатор войны из API |
| clan_tag | отслеживаемый клан |
| state | состояние API |
| war_type | regular, cwl или friendly |
| team_size | размер команды |
| attacks_per_member | лимит атак на участника |
| preparation_start_time, start_time, end_time | Unix timestamps |
| season_id | внешний ключ на cwl_seasons для CWL |
| round_number | номер раунда CWL |
| created_at | время первой записи |

Повторный ответ API обновляет state по существующему war_uid, не создавая новую войну. Индексы есть по CWL-сезону и
времени начала.

Текущий endpoint обычной войны сохраняется сервисом как war_type = regular; CWL-раунды сохраняются с типом cwl.

### war_clans

Две строки на войну — стороны home и opponent. Поля: war_clan_id, war_id, side, clan_tag, clan_name, clan_level,
attacks_count, stars, destruction_percentage, created_at.

Уникальны пары (war_id, side) и (war_id, clan_tag). Удаление войны каскадно удаляет обе стороны.

### war_members

Участники обеих сторон: war_member_id, war_id, war_clan_id, player_tag, player_name, townhall_level, map_position,
created_at. На одного игрока в одной войне действует уникальность (war_id, player_tag).

При обновлении непустого состава репозиторий удаляет старые строки этой стороны и вставляет актуальный список. Если
ответ API неожиданно содержит пустой массив, старые строки не удаляются — это важная деталь при диагностике неполного
ответа.

### attacks

Все атаки войны:

attack_id, war_id, attacker_war_clan_id, defender_war_clan_id, attacker_tag, defender_tag, attacker_position,
defender_position, stars, destruction_percentage, order_num, duration, created_at.

stars ограничены диапазоном 0–3, order_num должен быть положительным. Уникальный ключ (war_id, order_num) позволяет
обновлять результат уже сохранённой атаки.

На основе этих таблиц строятся итог войны, распределение атак по звёздам, игроки без атак, игроки с одной атакой,
первые атаки не по зеркалу, сравнительная динамика и отчёт надёжности текущего состава.

## Лига войн кланов

### cwl_seasons

Сезон CWL имеет cwl_season_id, clan_tag, season_id из API и created_at. Уникальна пара (clan_tag, season_id).

### cwl_season_members

Участники сезона: cwl_season_id, season_id, clan_tag, player_tag, player_name, townhall_level, created_at. Первичный
ключ — (cwl_season_id, player_tag). Удаление сезона каскадно удаляет участников.

Данные самого раунда хранятся в общих таблицах wars, war_clans, war_members и attacks; поле wars.season_id связывает
его с сезоном CWL, а round_number содержит номер раунда.

## Рейдовые выходные

### clan_raids

Одна строка на клан и начало рейдового выходного:

id, clan_tag, start_time, end_time, state, total_loot, raids_completed, total_attacks, enemy_districts_destroyed,
offensive_reward, defensive_reward, created_at.

Уникальность (clan_tag, start_time) позволяет обновлять значения последнего рейда без дублей.

### player_raid_snapshots

Статистика участника рейда: id, raid_id, player_tag, attacks_count, bonus_attacks, total_loot, created_at. Уникальна
пара (raid_id, player_tag), удаление рейда каскадно удаляет snapshots.

В сравнении рейдов:

- active participants — игроки, присутствующие в API-ответе рейда;
- eligible participants — активные участники состава клана, рассчитанные по clan_memberships на конец рейда;
- доступные атаки — 5 базовых атак плюс bonus_attacks;
- участник без атак — eligible player без строки snapshot;
- участник, использовавший все атаки, — snapshot с attacks_count не меньше 5 + bonus_attacks.

Игроки, которые вышли из клана до окончания рейда, не считаются eligible для управленческого отчёта.

## Telegram-подписки

### telegram_chats

Telegram-назначение определяется составным ключом (chat_id, message_thread_id):

- chat_id — личный чат, группа или супергруппа;
- message_thread_id = 0 — общий чат;
- положительный message_thread_id — forum topic;
- title, created_at — описание и время регистрации.

Несколько строк могут иметь одинаковый chat_id, если подписки заведены в разные темы.

### clan_subscriptions

Связь «многие ко многим» между кланами и назначениями:

| Поле | Содержание |
| --- | --- |
| clan_tag | клан |
| chat_id, message_thread_id | назначение |
| audience | players или management |
| created_at | время подписки |

Первичный ключ — (clan_tag, chat_id, message_thread_id, audience). Один чат может подписаться на несколько кланов, а
одно назначение может иметь две независимые аудитории.

Аудитория players получает изменения состава, итоговые отчёты, сравнения и reminders. Аудитория management получает
нарушения, надёжность состава и системные сообщения о сбоях/восстановлении.

### notifications

Журнал успешно отправленных дедуплицируемых сообщений:

event_type, event_id, chat_id, message_thread_id, notified_at.

Первичный ключ — (event_type, event_id, chat_id, message_thread_id). Это позволяет независимо доставлять одно событие в
разные чаты и темы.

Типовые ключи:

    war_ended     | 42
    war_reminder  | 42:started
    war_reminder  | 42:six_hours_left
    raid_reminder | 15:twenty_four_hours_left
    raids_ended   | 15

В таблицу не записываются события вступления, выхода, изменения роли, SyncFailureEvent и SyncRecoveryEvent: они
отправляются без дедупликации.

## schema_migrations

Таблица создаётся MigratorManager:

| Поле | Содержание |
| --- | --- |
| version | имя применённого SQL-файла |
| applied_at | время применения |

Миграции читаются из каталога database.migrations_path, сортируются по имени и применяются ровно один раз.

## Миграции

| Файл | Изменение |
| --- | --- |
| 001_initial_schema.sql | первоначальные таблицы старой схемы |
| 002_war_schema_v1_to_v2.sql | кланы, войны, CWL и атаки версии 2 |
| 003_clan_info_schema_v1_to_v2.sql | текущие кланы/игроки, членство и snapshots |
| 004_raid_schema_v1_to_v2.sql | таблицы рейдов и snapshots участников |
| 005_notifications_schema_v1_to_v2.sql | Telegram-чаты, подписки и уведомления |
| 006_telegram_topics.sql | темы Telegram и перенос старых назначений в thread 0 |
| 007_subscription_audience.sql | разделение подписок на players и management |
| 008_clan_tracking.sql | отдельный флаг включённого отслеживания |

Не редактируйте уже применённую миграцию для изменения рабочей базы. Добавляйте следующую миграцию с новым числовым
префиксом.

## Индексы и целостность

Ключевые индексы:

- активные членства клана;
- последние snapshots клана и игрока;
- история snapshots внутри клана;
- войны по CWL-сезону и времени начала;
- стороны и участники войны;
- атаки по войне, атакующему и защитнику;
- сезоны CWL по клану;
- рейды по клану;
- snapshots рейдов по игроку.

Внешние ключи с ON DELETE CASCADE удаляют дочерние данные войны, рейда, сезона или Telegram-подписки вместе с
родителем. Исторические данные игрока сохраняются через ON DELETE NO ACTION на players.

## Операционные правила

- остановите приложение перед ручным изменением базы;
- сохраните резервную копию файла базы и WAL-файла, если он существует;
- не удаляйте строки из schema_migrations в работающей базе;
- не меняйте clan_tag вручную без проверки внешних ключей;
- после ручного добавления подписки убедитесь, что message_thread_id и audience корректны;
- для штатного подключения используйте /link, потому что команда атомарно создаёт клан, назначение и подписку.
