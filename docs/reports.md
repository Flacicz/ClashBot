# События, отчёты и напоминания

Единственный источник истины по контрактам `ApplicationEvent` (`src/events/`), сериализации (`src/domainEvents/`),
форматтерам и аналитике (`src/reports/`, `src/analytics/`), контрольным точкам напоминаний (`src/services/reminders.ts`)
и политике outbox (`DomainEventWorker`, `NotificationService`, `NotificationWorker`).

Смежные документы:

- термины предметной области — [`GLOSSARY.md`](../GLOSSARY.md);
- общая архитектура циклов и транзакций — [`docs/architecture.md`](architecture.md);
- DDL таблиц `domain_events`, `domain_event_destinations`, `notifications`, `sync_outages` — [`docs/database.md`](database.md);
- правила выбора аудитории по типу чата и работа `TelegramGateway` — [`docs/telegram.md`](telegram.md).

## Границы слоя и сквозной поток

Сервисы синхронизации (`src/services/`) не вызывают Telegram Bot API напрямую и не формируют текст уведомлений:

1. В одной SQLite-транзакции сервис обновляет игровое состояние и передаёт массив `ApplicationEvent` в
   `DomainEventRecorder.recordAll` (`src/domainEvents/domainEventRecorder.ts`). Исключение — `SyncFailureEvent` и
   `SyncRecoveryEvent`, которые в отдельной транзакции после цикла записывает `ClanManager` через `SyncOutageRepo`.
   Поле `SyncResult.events` хранит сгенерированные события только для логов/совместимости — повторной отправки из него нет.
2. `DomainEventRecorder` сериализует каждое событие (`DomainEventPayloadSerializer`), определяет допустимые аудитории через
   `EventNotificationPolicy.audiencesFor` и фиксирует снимок активных подписок (`subscription_id`, `chat_id`,
   `message_thread_id`, `audience`) — **получателей события** на момент события. Подписки, созданные позже, старые
   доменные события не получают.
3. После commit `DomainEventWorker` загружает `pending`-получателей и в одной транзакции условно захватывает получателя
   через `DomainEventsRepo.markMaterialized` (`WHERE status = 'pending'`, `changes === 1`), десериализует payload
   (`DomainEventPayloadDeserializer`) и вызывает `NotificationService.materialize`. При ошибке вся транзакция откатывается;
   при успехе будит `NotificationWorker`.
4. `NotificationWorker` восстанавливает зависшие `'sending'`-записи (при старте — все, перед батчем — по TTL
   `claimTtlSeconds = 60`), читает `pending`-уведомления из outbox `notifications`, атомарно захватывает каждую запись в
   статус `'sending'` с `claimed_at` до внешнего HTTP-вызова, отправляет HTML-текст через `TelegramGateway` и завершает
   запись из `'sending'` в `sent`, `pending` (reschedule), `cancelled` (если подписка отменена к моменту повтора) или `failed`.

Legacy-метод `NotificationService.handle` сохраняется для обратной совместимости (пишет в `notifications` напрямую с
`domain_event_destination_id = NULL`), но в основном runtime-потоке не используется.

## Каталог `ApplicationEvent` и контракты payload

Сериализатор (`src/domainEvents/domainEventPayloadSerializer.ts`) и десериализатор
(`src/domainEvents/domainEventPayloadDeserializer.ts`) используют `CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION = 1`. При
несовпадении `payload_version`, невалидном JSON или нарушении `zod`-схемы десериализатор выбрасывает `ValidationError`.

| `event_type` (`APPLICATION_EVENT_TYPES`) | Ключ `event_id` (`getApplicationEventKey`) | Поля JSON payload (`snake_case`)                                                       | Источник генерации                                                 |
| ---------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `PlayerJoinedClanEvent`                  | `String(membershipId)`                     | `player_tag`, `player_name`, `membership_id`                                           | `ClanInfoService` (кроме первичной синхронизации клана)            |
| `PlayerLeftClanEvent`                    | `String(membershipId)`                     | `player_tag`, `player_name`, `membership_id`                                           | `ClanInfoService`                                                  |
| `PlayerRoleChangedEvent`                 | `String(snapshotId)`                       | `player_tag`, `player_name`, `old_role`, `new_role`, `snapshot_id`                     | `ClanInfoService`                                                  |
| `war_ended`                              | `String(warReference.warId)`               | `war_reference: { clan_tag, war_id, home_clan_id, opponent_clan_id }`                  | `ClanwarService` при `state === 'warEnded'`                        |
| `cwl_round_ended`                        | `String(warReference.warId)`               | `cwl_season_id`, `war_reference: { clan_tag, war_id, home_clan_id, opponent_clan_id }` | `ClanwarLeagueService` для каждого раунда с `state === 'warEnded'` |
| `raids_ended`                            | `String(raidReference.raidId)`             | `raid_reference: { raid_id }`                                                          | `RaidService` при `state === 'ended'`                              |
| `war_reminder`                           | `${warId}:${kind}`                         | `war_id`, `end_time`, `war_kind` (`regular` \| `cwl`), `reminder_kind`, опц. `remaining_seconds` | `ClanwarService` / `ClanwarLeagueService`                          |
| `raid_reminder`                          | `${raidId}:${kind}`                        | `raid_reference: { raid_id }`, `end_time`, `reminder_kind`, опц. `remaining_seconds`             | `RaidService`                                                      |
| `SyncFailureEvent`                       | `String(outageId)`                         | `service_name`, `error_message`, `attempts`, `outage_id`                               | `ClanManager` после исчерпания попыток синхронизации               |
| `SyncRecoveryEvent`                      | `String(outageId)`                         | `service_name`, `outage_id`                                                            | `ClanManager` при первом успехе после открытого сбоя               |

Особенности генерации:

- В `ClanInfoService` при первой синхронизации клана (`activeMemberships.length === 0 && latestPlayerStates.length === 0`)
  события состава не создаются, чтобы не заспамить чат при первом `/link`.
- Для `SyncFailureEvent` ключ `event_id` равен `outageId`. Повторные сбои в рамках одного открытого `outage_id` увеличивают
  `sync_outages.failure_count`, но повторное доменное событие отбрасывается по уникальному ключу
  `(clan_tag, event_type, event_id)` в `domain_events`.
- Если два отслеживаемых клана-соперника (`A` и `B`) встречаются в одной обычной войне или раунде CWL, каждый получает
  собственный `war_uid` и собственный `war_id` (см. [`docs/database.md`](database.md)). Если оба клана подписаны на одно
  и то же Telegram-назначение, в этот чат доставляются два независимых набора отчётов и напоминаний — от лица клана `A`
  и от лица клана `B`.

## Матрица доставки и соответствие `notifications.event_type`

`EventNotificationPolicy` (`src/domainEvents/eventNotificationPolicy.ts`) задаёт аудиторию доменного события на этапе
записи получателей. Один получатель события может материализоваться в несколько уведомлений с разными
`notifications.event_type` (`NOTIFICATION_EVENT_TYPES` в `src/notifications/notificationService.ts`). Всего 10 типов
`ApplicationEvent` отображаются в 16 типов уведомлений:

| Доменное событие         | Аудитория `players` (`notifications.event_type` / форматтер)                                                                      | Аудитория `management` (`notifications.event_type` / форматтер)                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `PlayerJoinedClanEvent`  | `PlayerJoinedClanEvent` / `PlayerJoinedFormatter`                                                                                 | —                                                                                                      |
| `PlayerLeftClanEvent`    | `PlayerLeftClanEvent` / `PlayerLeftFormatter`                                                                                     | —                                                                                                      |
| `PlayerRoleChangedEvent` | `PlayerRoleChangedEvent` / `PlayerRoleChangedFormatter`                                                                           | —                                                                                                      |
| `war_ended`              | `war_ended` / `ClanwarEndedFormatter`<br>`war_comparison` / `ClanwarComparisonFormatter` (если есть ≥ 1 предыдущая обычная война) | `war_violations` / `ClanwarViolationsFormatter`<br>`war_roster_reliability` / `ClanwarRosterFormatter` |
| `cwl_round_ended`        | `cwl_round_ended` / `ClanwarsLeagueRoundEndedFormatter`                                                                           | `cwl_violations` / `ClanwarsLeagueRoundViolationsFormatter`                                            |
| `raids_ended`            | `raids_ended` / `RaidsEndedFormatter`<br>`raids_comparison` / `RaidsComparisonFormatter` (если есть ≥ 1 предыдущий рейд)          | `raids_violations` / `RaidsViolationsFormatter`                                                        |
| `war_reminder`           | `war_reminder` / `WarReminderFormatter`                                                                                           | —                                                                                                      |
| `raid_reminder`          | `raid_reminder` / `RaidReminderFormatter`                                                                                         | —                                                                                                      |
| `SyncFailureEvent`       | —                                                                                                                                 | `SyncFailureEvent` / `SystemAlertReportFormatter.formatFailureAlert`                                   |
| `SyncRecoveryEvent`      | —                                                                                                                                 | `SyncRecoveryEvent` / `SystemAlertReportFormatter.formatRecoveryAlert`                                 |

Инвариант двойной проверки аудитории: `NotificationService.materialize` повторно проверяет `destination.audience` для
событий, ограниченных одной аудиторией (`players` или `management`), и при несоответствии не создаёт строку в `notifications`.

## Форматтеры, аналитика и контрольные точки

### Состав клана и системные оповещения

- `PlayerJoinedFormatter` и `PlayerLeftFormatter` подставляют имя отслеживаемого клана из `ClansRepo.getClanNameByTag`.
- `PlayerRoleChangedFormatter` сопоставляет игровые роли: `member` (`Участник`, ранг 1), `admin` (`Старейшина`, ранг 2),
  `coLeader` (`Соруководитель`, ранг 3), `leader` (`Глава`, ранг 4). Неизвестная игровая роль вызывает `ValidationError`.
  Различаются повышение (`newRank > oldRank`) и понижение.
- `SystemAlertReportFormatter` выводит `clanTag`, `serviceName`, для сбоя также `attempts` и текст ошибки.

### Итоги войн, CWL и рейдов

Общие части войн вынесены в `src/reports/warReportParts.ts`:

- `ClanwarEndedFormatter` и `ClanwarsLeagueRoundEndedFormatter` выводят: названия/теги обеих сторон, счёт по звёздам и `%`
  разрушения, итог (`Победа` / `Поражение` / `Ничья`), статистику атак (использовано/максимум, средние звёзды и `%`
  разрушения на атаку, распределение `3⭐`/`2⭐`/`1⭐`/`0⭐`) и до 3 лучших атак (`stars DESC, destruction_percentage DESC,
order_num ASC`) с нормализованными позициями (`ROW_NUMBER() OVER (ORDER BY map_position)`).
- `ClanwarsLeagueRoundEndedFormatter` и `ClanwarsLeagueRoundViolationsFormatter` поддерживают раунды `1..7`
  (`getCwlRoundName`); номер вне диапазона или нецелое значение вызывают `ValidationError`.
- Нарушения обычной войны (`ClanwarViolationsFormatter`): участники без атак, участники ровно с 1 атакой, первые атаки
  (минимальный `order_num` игрока) не по зеркалу (`attacker_position !== defender_position`). При отсутствии нарушений
  выводится сообщение «Нарушений в войне кланов не обнаружено!».
- Нарушения раунда CWL (`ClanwarsLeagueRoundViolationsFormatter`): только пропустившие атаку (с пометкой `[0/1]`) и первые
  атаки не по зеркалу; отдельного раздела для одной атаки нет (в CWL 1 атака на раунд).
- Итог рейдов (`RaidsEndedFormatter`): добыча золота, завершённые рейды, использованные атаки, уничтоженные районы,
  награды за нападение и оборону, до 3 лучших участников (`total_loot DESC, player_tag ASC`) с указанием бонусных атак.
- Нарушения рейдов (`RaidsViolationsFormatter`): лимит `5 + bonus_attacks`. Игрок обязан отыграть рейд только если
  состоял в клане на момент начала рейдового уикенда (`joined_at <= start_time`) и не покинул клан до его окончания
  (`left_at IS NULL OR left_at >= end_time`). Вступившие позже `start_time` и вышедшие до `end_time` в отчёт нарушений
  не попадают (при этом атаки вступивших позже учитываются в общих показателях рейда). Запись в `player_raid_snapshots`
  с `attacks_count = 0` трактуется одинаково с отсутствием снимка как «не атаковал». Разделы: не использовали все атаки
  (`0 < attacks < limit`) и без атак (`0/limit`).

### Напоминания (`src/services/reminders.ts`)

Напоминания предназначены только для аудитории `players`. На каждом цикле синхронизации активной войны, раунда ЛВК
(`state !== 'warEnded'`) или рейда (`state !== 'ended'`) в окне `startTime <= nowEpochSeconds < endTime` функции
`selectWarReminders` / `selectRaidReminders` (и обёртки `getActiveWarReminderKinds` / `getActiveRaidReminderKinds`)
определяют открытые контрольные точки (`nowEpochSeconds >= threshold`):

| Событие                             | `kind`                   | Порог (`threshold`) | Особенности                                                                               |
| ----------------------------------- | ------------------------ | ------------------- | ----------------------------------------------------------------------------------------- |
| `war_reminder` (`regular` \| `cwl`) | `started`                | `startTime`         | Разные тексты для обычной войны и раунда ЛВК; grace-период `1 ч` после `startTime`        |
| `war_reminder` (`regular` \| `cwl`) | `six_hours_left`         | `endTime - 6h`      | Показывает фактический остаток времени; дедупликация по стабильному ключу `warId:kind`    |
| `war_reminder` (`regular` \| `cwl`) | `one_hour_left`          | `endTime - 1h`      | Показывает фактический остаток времени; дедупликация по стабильному ключу `warId:kind`    |
| `raid_reminder`                     | `started`                | `startTime`         | Grace-период `1 ч` после `startTime`                                                      |
| `raid_reminder`                     | `forty_eight_hours_left` | `endTime - 48h`     | Показывает фактический остаток времени; дедупликация по стабильному ключу `raidId:kind`   |
| `raid_reminder`                     | `twenty_four_hours_left` | `endTime - 24h`     | Показывает фактический остаток времени; дедупликация по стабильному ключу `raidId:kind`   |
| `raid_reminder`                     | `six_hours_left`         | `endTime - 6h`      | Показывает фактический остаток времени; дедупликация по стабильному ключу `raidId:kind`   |
| `raid_reminder`                     | `one_hour_left`          | `endTime - 1h`      | Показывает фактический остаток времени; дедупликация по стабильному ключу `raidId:kind`   |

Правила выбора окна, пропусков и текста:

- **Только самое свежее открытое окно**: если в момент синхронизации открыто сразу несколько контрольных точек
  (например, при позднем старте синхронизации или после восстановления от простоя), генерируется **не более одного**
  напоминания — для самой свежей открытой точки.
- **Grace-период для `started` (`DEFAULT_STARTED_REMINDER_GRACE_PERIOD_SECONDS = 3600`, 1 ч)**: если единственной
  открытой точкой является `started`, но с `startTime` уже прошёл `1 ч` или больше, напоминание о старте считается
  просроченным и не отправляется.
- **Фиксация пропущенных точек без отправки**: все более старые открытые точки (и просроченный `started`) записываются
  в той же транзакции через `DomainEventRecorder.recordSkipped` — строка попадает в `domain_events` со стабильным
  `event_id` (`${warId}:${kind}` / `${raidId}:${kind}`), но с пустым списком `domain_event_destinations` (без отправки).
  Если точка уже была записана ранее (отправлена или пропущена), `ON CONFLICT DO NOTHING` оставляет её без изменений;
  повторные циклы не генерируют пропущенные точки повторно.
- **Фактическое оставшееся время**: для всех отсчётных напоминаний (`kind !== 'started'`) сервис передаёт в событии
  фактический остаток `remainingSeconds = Math.max(0, Math.trunc(endTime - nowEpochSeconds))` (сохраняется как
  опциональное поле `remaining_seconds` в payload v1 с обратной совместимостью для старых записей без этого поля).
  Форматтеры (`WarReminderFormatter`, `RaidReminderFormatter`) отображают фактический остаток через
  `formatRemainingTimePhrase` (`src/common/formatUtils.ts`) с корректным склонением (`остался 1 час`,
  `осталось 3 часа 45 минут`, `осталась 21 минута`, `осталось менее минуты` для `< 60` с); при отсутствии
  `remaining_seconds` в историческом payload используется номинальное значение контрольной точки.
- Время окончания в напоминаниях (и дата рейда в сравнении рейдов) форматируется через `formatUnixToMoscowDateTime`
  (`UTC+3`, `DD.MM.YYYY HH:MM`; при значении `<= 0` или нечисловом — `"неизвестно"`). Так как цикл синхронизации
  работает с интервалом 15 минут, каждое актуальное напоминание приходит в первом цикле после наступления порога и
  больше не дублируется.

### Сравнительная аналитика и надёжность состава (`src/analytics/`)

- `ClanwarComparisonFormatter` (`clanwarComparisonAnalyzer.ts`):
  - Если предыдущих завершённых и полных обычных войн (`war_type = 'regular'`, `state = 'warEnded'`, `is_complete = 1`,
    более ранний `preparation_start_time`) нет, возвращает `""` и строка `war_comparison` в outbox не создаётся.
  - Загружает до 4 предыдущих полных войн для ленты исходов; исторические средние строятся максимум по **3** ближайшим
    предыдущим полным войнам как взвешенные отношения сумм (а не среднее средних), деление на `0` даёт `0`. Незавершённые
    и неполные записи (`is_complete = 0` или `state <> 'warEnded'`) в сравнение и baseline не попадают.
  - Тренд (`better` / `worse` / `similar`) считается строго по **4 основным метрикам**: средние звёзды на атаку (↑),
    среднее разрушение на атаку (↑), доля участников без атак (↓), доля первых атак не по зеркалу (↓). Активность
    (использование атак, пропущенные атаки, ровно 1 атака) выводится справочно и не влияет на тренд.
- `RaidsComparisonFormatter` (`raidComparisonAnalyzer.ts`):
  - При отсутствии предыдущего завершённого и полного рейда (`state = 'ended'`, `is_complete = 1`) возвращает `""` и
    строка `raids_comparison` в outbox не создаётся.
  - Загружает до 3 предыдущих полных рейдов (и для сравнения, и для взвешенного среднего); незавершённые/неполные рейды
    (`is_complete = 0` или `state <> 'ended'`) исключаются.
  - Тренд (`better` / `worse` / `similar`) считается строго по **3 основным метрикам**: добыча на использованную атаку (↑),
    доля активных участников, использовавших все атаки (↑), доля eligible-участников без атак (↓). Активность и
    абсолютные итоги рейда выводятся как контекст. Когорта `eligible`-участников согласована с отчётом нарушений
    (`joined_at <= start_time AND (left_at IS NULL OR left_at >= end_time)`), а снимок `player_raid_snapshots` с
    `attacks_count = 0` не входит в активных участников (`attacks_count > 0`) и учитывается в доле участников без атак.
- `ClanwarRosterFormatter` (`clanwarRosterAnalyzer.ts`):
  - Строит срез по текущему активному составу (`ClansRepo.getActiveMembers`) за текущую и до 4 предыдущих завершённых и
    полных обычных войн (`war_type = 'regular'`, `state = 'warEnded'`, `is_complete = 1`; максимум 5 КВ): число включений,
    давность последнего участия (`lastWarOffset`: `в последней КВ`, `посл. N КВ назад`, `не участвовал`), сумма и средние
    по атакам, счётчики нарушений (`warsWithoutAttacks`, `warsWithOneAttack`, `firstAttacksNotOnMirror`).
  - Неполные/незавершённые записи (`is_complete = 0` или `state <> 'warEnded'`) исключаются из расчёта дисциплины и не
    ухудшают рейтинг игроков. Знаменатель отчёта (`warsCount`) уменьшается до фактически учтённых полных КВ. Если в
    рассматриваемом окне истории (между текущей КВ и самой старой вошедшей полной КВ, либо за всю историю клана до текущей
    КВ, если полных предыдущих КВ меньше 4) были отфильтрованы неполные обычные войны, под заголовком периода выводится
    явное примечание с их количеством (`ℹ️ Примечание: в окне истории пропущен...`). Если у нового клана просто меньше
    5 КВ без неполных записей, примечание не выводится.
  - Взаимоисключающие категории: `Риск` (`includedWars > 0 && warsWithoutAttacks > 0`), `Требуют внимания`
    (`includedWars > 0`, не риск, `warsWithOneAttack > 0 || firstAttacksNotOnMirror > 0`), `Стабильные` (`includedWars > 0`
    без нарушений), `Не участвовали` (`includedWars === 0`).

### HTML-форматирование, разбиение длинных сообщений и округление

- Все уведомления отправляются с `parse_mode: 'HTML'`. `escapeHtml` (`src/common/formatUtils.ts`) в один проход экранирует
  `&`, `<`, `>`, а также декоративные угловые скобки `\u300A` (`《` → `&lt;`) и `\u300B` (`》` → `&gt;`). Любые данные из
  CoC API и БД (названия кланов, имена игроков, теги, имена сервисов, сообщения об ошибках) должны проходить через `escapeHtml`.
- **HTML-безопасное разбиение (`src/notifications/htmlMessageSplitter.ts`)**: при материализации в `NotificationService`
  любой отчёт длиннее `3900` видимых символов UTF-16 (после удаления HTML-тегов и разбора HTML entities) разбивается на
  части `1..N` с сохранением каждой части через `NotificationRepo.enqueueDomainEventIfAbsent` (`part_index`, `part_count`).
  Нарезка выполняется по `\n` (а для одиночных строк длиннее бюджета — по пробелам/графемам без разрыва тегов, HTML entities
  и Unicode/emoji), с закрытием открытых тегов (`<b>`, `<i>`, `<code>`, `<a>` и др.) в конце части и их переоткрытием в
  начале следующей. Индикатор `\n\n<i>Часть K/N</i>` добавляется только при `part_count > 1` и учитывается в бюджете длины
  (`<= 3900`, гарантированно `<= 4096`); короткие сообщения (`part_count = 1`) сохраняются без изменений.
- Дробные метрики округляются по правилам IEEE-754 round-half-to-even (`formatFixedHalfToEven` в `src/reports/numberFormat.ts`,
  `formatFixed2` в `src/reports/warReportParts.ts`). Долевые сдвиги в сравнениях отображаются в процентных пунктах (`п.п.`).

## Дедупликация и политика outbox

### Идемпотентность, порядок частей и семантика доставки

1. `DomainEventsRepo.appendEvent` дедуплицирует событие по `(clan_tag, event_type, event_id)` и получателей по
   `(domain_event_id, chat_id, message_thread_id, audience, subscription_id)`.
2. `NotificationRepo.enqueueDomainEventIfAbsent` дедуплицирует строки outbox по
   `(domain_event_destination_id, event_type, event_id, part_index)` для каждой части `1..N` (`part_count = N`). Повторная
   материализация одного получателя не создаёт дубли ни для одной части.
3. **Строгий порядок доставки частей (`1 → 2 → ... → N`)**: `NotificationRepo.getPending` возвращает часть `part_index = K`
   только после того, как все предыдущие части (`part_index < K`) этого же уведомления перешли в статус `'sent'`. Пока
   предыдущая часть находится в `'pending'` (включая ожидание ретрая) или в `'sending'`, последующие части ждут её успешной
   отправки (не блокируя уведомления других чатов и событий), а уже отправленные части (`part < K`) не дублируются при
   восстановлении.
4. **Каскадный `'failed'`**: при переходе захваченной (`'sending'`) части `part K` в терминальный статус `'failed'`
   (перманентная ошибка Telegram или исчерпание попыток ретрая) `NotificationRepo.markAsFailed` в одной транзакции сбрасывает
   `claimed_at = NULL` и переводит все оставшиеся `pending`-части (`part_index > K`) того же уведомления в `'failed'`,
   исключая накопление «вечных» `pending`-сирот.
5. Гарантия доставки — **at-least-once**: это осознанный компромисс outbox-доставки. Если процесс упадёт или произойдёт
   сбой БД после успешного ответа Telegram API `sendMessage`, но до вызова `markAsSent`, запись останется в статусе
   `'sending'`. При перезапуске воркера или по истечении TTL захвата (`claimTtlSeconds`, по умолчанию `60` секунд)
   восстановление вернёт её в `'pending'` (если подписка всё ещё активна) и уведомление будет отправлено повторно.

### Отмена по поколению подписки (`/unlink`) и claim/TTL

При отключении клана через `/unlink` или меню в одной транзакции (`DomainEventsRepo.cancelForSubscription` +
`SubscriptionRepo.unsubscribeFromChat`) все `pending`-записи в `domain_event_destinations` и связанные `pending`-строки в
`notifications` переводятся в `cancelled` (`last_error = 'subscription cancelled'`), а строка подписки удаляется из
`clan_subscriptions`. Повторный `/link` создаёт новое поколение подписки (`subscription_id`), не воскрешая отменённые.

Защита от гонок и восстановление зависших отправок:

- **`DomainEventWorker`**: в одной синхронной SQLite-транзакции условно захватывает получателя через
  `markMaterialized(destinationId)` (`WHERE id = ? AND status = 'pending'` с проверкой `changes === 1`) до десериализации и
  `enqueue` уведомлений. Если `/unlink` успел отменить получателя раньше, захват возвращает `false`, а материализация не
  выполняется. При ошибке форматирования/вставки транзакция полностью откатывается, возвращая destination в `pending`.
- **`NotificationWorker` (атомарный claim)**: перед внешним HTTP-вызовом `TelegramGateway.sendMessage` переводит запись в
  `status = 'sending'` с фиксацией `claimed_at = now` (`UPDATE notifications SET status = 'sending', claimed_at = ? WHERE id = ? AND status = 'pending'`).
  Если `/unlink` выиграл до claim, запись уже в `cancelled` и не отправляется. Уже захваченная (`'sending'`) отправка
  считается in-flight и может завершиться.
- **Завершение из `'sending'`**: `markAsSent`, `reschedule` и `markAsFailed` обновляют только строки в статусе `'sending'` и
  сбрасывают `claimed_at = NULL`. Если in-flight отправка завершилась успешно после `/unlink`, она фиксируется как `'sent'`;
  если завершилась временной ошибкой (`5xx` / `429`), а подписка уже удалена из `clan_subscriptions`, воркер переводит
  запись в `'cancelled'` вместо постановки в повторную отправку. При корректной остановке по `AbortSignal` во время
  in-flight запроса запись освобождается через `releaseClaimed` (в `'cancelled'` для отменённой подписки или обратно в
  `'pending'` без увеличения `attempts`).
- **Восстановление зависших `'sending'`-записей (старт + TTL)**:
  - при старте `NotificationWorker.run()` восстанавливаются **все** записи в статусе `'sending'` (`recoverAllSending`);
  - перед каждой обработкой батча в `processPending()` восстанавливаются записи с истёкшим TTL
    (`claimed_at IS NULL OR claimed_at <= now - claimTtlSeconds`, `recoverStaleSending`). Дефолтный
    `claimTtlSeconds = 60` секунд (настраивается в `NotificationWorkerOptions`; в 6 раз превышает таймаут Telegram
    `DEFAULT_TELEGRAM_REQUEST_TIMEOUT_SECONDS = 10`, чтобы не перехватывать живой запрос);
  - при любом восстановлении проверяется наличие активного `subscription_id` в `clan_subscriptions` через
    `domain_event_destinations.subscription_id`: если подписка отменена (включая случай повторного `/link` с новым
    `subscription_id`), запись переводится в `'cancelled'` (`claimed_at = NULL`, `next_attempt_at = NULL`,
    `last_error = 'subscription cancelled'`); если подписка активна (или запись legacy с
    `domain_event_destination_id IS NULL`), запись возвращается в `'pending'` со сбросом `claimed_at = NULL`.

### Политики повторов (Retry) и отказы

| Компонент            | Интервал / батч по умолчанию    | Стратегия повторов                                                                                                                                                                                                  | Поведение при исчерпании                                                                                                                                                      |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DomainEventWorker`  | `1000 мс` / `100` destinations  | Экспоненциальный backoff: старт `1000 мс`, потолок `3 600 000 мс` (1 ч), округление вверх до целых секунд (мин. `1 с`)                                                                                              | После `maxAttempts = 5` логирует `error`-alert, но destination **остаётся `pending`** и продолжает повторяться, не блокируя остальные                                         |
| `NotificationWorker` | `1000 мс` / `100` notifications | `permanent` (4xx кроме 429) → сразу `failed`; `transient` (сеть, 5xx) / `rate_limit` (429) → экспоненциальный backoff: старт `500 мс`, потолок `8000 мс` (для 429 берётся `max(backoff, ceil(retry_after) * 1000)`) | После `maxAttempts = 4` или при `permanent`-ошибке переводит запись (и каскадно все оставшиеся `pending`-части `part_index > K` того же уведомления) в `status = 'failed'`; автоматического requeue нет (ручной сброс — см. [`docs/database.md`](database.md)) |

## Добавление нового типа отчёта или напоминания

1. Добавить структуру события и ключ `getApplicationEventKey` в `src/events/applicationEvents.ts`.
2. Обновить `DomainEventPayloadSerializer` и `zod`-схему в `DomainEventPayloadDeserializer` (сохраняя обратную
   совместимость или повышая `payload_version`).
3. Задать аудиторию в `EventNotificationPolicy` (`src/domainEvents/eventNotificationPolicy.ts`).
4. Генерировать событие в сервисе `src/services/` внутри транзакции через `DomainEventRecorder`.
5. Реализовать чистый форматтер в `src/reports/` с HTML-экранированием (без прямых вызовов Telegram и записи в БД) и
   добавить тесты (включая golden-фикстуры в `tests/fixtures/golden/`, если применимо).
6. Зарегистрировать `NOTIFICATION_EVENT_TYPES` и обработку в `NotificationService.materialize` (и при необходимости `handle`).
7. Обновить таблицы каталога и матрицы доставки в этом документе.
