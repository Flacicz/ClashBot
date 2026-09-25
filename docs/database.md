# Схема SQLite

## Назначение

SQLite хранит текущее состояние кланов и историю, необходимую для отчётов. Один файл базы может обслуживать несколько
кланов и несколько Telegram-назначений.

Каталог видео-гайдов в SQLite не хранится: он загружается из JSON при старте приложения.

При открытии соединения Database включает:

    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

Кроме того, SQLite busy timeout установлен в 5 секунд. Повтор транзакций при временной блокировке выполняется
TransactionManager: до трёх попыток с линейной задержкой 100 мс.

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

    domain_events ── domain_event_destinations ── notifications
    notifications  (устойчивая outbox-очередь Telegram)
    sync_outages    (эпизоды сбоев синхронизации)
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
| subscription_id | идентификатор конкретного поколения подписки |
| clan_tag | клан |
| chat_id, message_thread_id | назначение |
| audience | players или management |
| created_at | время подписки |

Первичный ключ — `subscription_id`; уникальное ограничение на `(clan_tag, chat_id, message_thread_id, audience)` не
позволяет создать дубликат активной подписки. При `/unlink` строка удаляется, а повторный `/link` создаёт новую строку с
новым `subscription_id`. Это технический идентификатор поколения подписки, а не отдельный счётчик поколений.

Один чат может подписаться на несколько кланов, а одно назначение может иметь две независимые аудитории.

Аудитория players получает изменения состава, итоговые отчёты, сравнения и reminders. Аудитория management получает
нарушения, надёжность состава и системные сообщения о сбоях/восстановлении.

### notifications

Outbox-очередь намерений отправки в Telegram. Запись создаётся до HTTP-вызова и живёт в базе независимо от процесса
приложения.

| Поле | Содержание |
| --- | --- |
| id | идентификатор outbox-записи |
| domain_event_destination_id | назначение durable-события, из которого создана запись; `NULL` у исторических строк |
| event_type, event_id | тип и стабильный идентификатор доменного события |
| chat_id, message_thread_id | Telegram-назначение |
| message_text | готовый HTML-текст сообщения |
| part_index, part_count | номер части и общее количество частей; сейчас всегда `1/1` |
| status | `pending`, `sent`, `failed` или `cancelled` |
| attempts | количество неудачных попыток доставки |
| next_attempt_at | Unix-время, после которого разрешена следующая попытка |
| last_error | последняя ошибка доставки |
| created_at, sent_at | время постановки в очередь и успешной отправки |

`id` — первичный ключ. Для записей, созданных из durable events, уникальный ключ дедупликации —
`(domain_event_destination_id, event_type, event_id, part_index)`. Поскольку destination уже содержит chat, topic,
аудиторию и subscription ID, разные назначения независимы. Исторические записи, перенесённые миграцией 011, имеют
`domain_event_destination_id = NULL` и сохраняют свой прежний статус; SQLite допускает несколько `NULL` в этом
уникальном ключе.
Миграция 012 добавляет для таких строк отдельный частичный уникальный индекс по
`(event_type, event_id, chat_id, message_thread_id, part_index)`: прежний путь постановки уведомлений
сохраняет идемпотентность, не смешиваясь с ключом durable destinations.

Типовые ключи:

    war_ended     | 42
    war_reminder  | 42:started
    war_reminder  | 42:six_hours_left
    raid_reminder | 15:twenty_four_hours_left
    raids_ended   | 15

Новые записи получают статус `pending` и становятся доступными worker-у после commit. После успешного ответа Telegram
статус меняется на `sent`; временная ошибка оставляет запись `pending` и обновляет `next_attempt_at` и `last_error`;
исчерпание попыток переводит запись в `failed`. `/unlink` переводит связанные ещё pending-записи в `cancelled`.

События вступления и выхода используют ID строки `clan_memberships`, изменение роли — ID текущего `player_snapshots`.
Системные события используют ID строки `sync_outages`, поэтому ошибка и восстановление ссылаются на один эпизод.

### domain_events и domain_event_destinations

`domain_events` — долговременное хранилище application events, сохранённых вместе с изменением предметных данных:

| Поле | Содержание |
| --- | --- |
| id | идентификатор события |
| event_type, event_id | тип и стабильный идентификатор события |
| event_payload, payload_version | сериализованные данные события и версия формата |
| clan_tag | клан, связанный с событием |
| created_at | время сохранения |

Уникальность `(clan_tag, event_type, event_id)` предотвращает повторную запись того же события. Если синхронизация
откатывается, событие тоже не появляется. Повторная запись уже сохранённого события не добавляет новых destinations:
снимок получателей остаётся таким, каким был при первом commit.

`domain_event_destinations` фиксирует снимок получателей в момент события и хранит состояние обработки каждого
назначения:

| Поле | Содержание |
| --- | --- |
| id | идентификатор destination |
| domain_event_id | ссылка на событие |
| chat_id, message_thread_id, audience | Telegram-назначение и аудитория |
| subscription_id | конкретная подписка, по которой назначение было выбрано |
| status | `pending`, `materialized` или `cancelled` |
| attempts, next_attempt_at, last_error | состояние retry материализации |
| materialized_at, cancelled_at | время успешной обработки или отмены |

У `domain_events` нет общего статуса обработки: событие может иметь несколько независимых destinations, и состояние
хранится отдельно для каждого из них. При пустом снимке получателей останется событие без destinations и уведомлений.
DomainEventWorker создаёт связанную `notifications` и меняет status destination на `materialized` в одной транзакции.
Повторная обработка не создаёт дубликат outbox-строки благодаря уникальному ключу.

`/unlink` в транзакции отменяет destinations со статусом `pending` и их связанные pending notifications по
`subscription_id`, после чего удаляет подписку. Запись `sent` не отменяется; однако из-за отсутствия атомарного захвата
работником между чтением пачки и обработкой остаётся гонка: уже загруженный destination может быть материализован, а
уже загруженная notification — отправлена после commit `/unlink`. Подробности и граница этой гарантии описаны в
[`telegram.md`](telegram.md).

У `notifications.domain_event_destination_id` разрешён `NULL` для исторических записей, созданных до миграции 011;
для новых строк, материализуемых из domain events, он указывает на destination-источник.

### sync_outages

Таблица хранит один открытый эпизод сбоя для каждой пары `(clan_tag, service_name)`:

| Поле | Содержание |
| --- | --- |
| id | стабильный ID эпизода сбоя |
| clan_tag, service_name | клан и сервис, для которых возник сбой |
| failure_count | количество последовательных неудачных циклов |
| started_at | начало эпизода |
| recovered_at | время восстановления; `NULL` означает открытый эпизод |

Частичный уникальный индекс не позволяет открыть два одновременных эпизода для одного сервиса и клана. После
восстановления следующий сбой получает новый ID.

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
| 009_notification_outbox.sql | переход notifications к outbox-очереди и статусам доставки |
| 010_sync_outages.sql | эпизоды сбоев синхронизации и стабильные IDs системных событий |
| 011_domain_events.sql | event log, снимки получателей и связь destinations с notifications |
| 012_legacy_notification_idempotency.sql | частичный уникальный индекс для уведомлений без domain destination |

Не редактируйте уже применённую миграцию для изменения рабочей базы. Добавляйте следующую миграцию с новым числовым
префиксом.

При переходе на миграцию 009 прежние строки notifications переносятся в статус sent с пустым message_text: старая
схема хранила только факт уже выполненной доставки, а не текст сообщения. Такие строки не отправляются повторно.

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
- snapshots рейдов по игроку;
- очередь pending-уведомлений по `(status, next_attempt_at, created_at, id)`.

Внешние ключи с ON DELETE CASCADE удаляют дочерние данные войны, рейда, сезона или Telegram-подписки вместе с
родителем. Исторические данные игрока сохраняются через ON DELETE NO ACTION на players.

## Операционные правила

- остановите приложение перед ручным изменением базы;
- сохраните резервную копию файла базы и WAL-файла, если он существует;
- не удаляйте строки из schema_migrations в работающей базе;
- не меняйте clan_tag вручную без проверки внешних ключей;
- после ручного добавления подписки убедитесь, что message_thread_id и audience корректны;
- для диагностики очереди используйте status, attempts, next_attempt_at и last_error;
- перед ручным изменением notifications остановите приложение, чтобы worker не отправлял изменяемую запись;
- для штатного подключения используйте /link, потому что команда атомарно создаёт клан, назначение и подписку.
