# Telegram-интеграция (grammY)

Единственный источник истины по входящему Telegram-слою (`src/telegram/`), каталогу гайдов
(`resources/telegram/attack_guides.json`), правилу «тип чата → пресет подписки по умолчанию», проверке прав администратора чата и
транспортному адаптеру `TelegramGateway` (`src/notifications/telegramGateway.ts`).

Смежные документы:

- термины предметной области — [`GLOSSARY.md`](../GLOSSARY.md);
- общая конфигурация приложения и жизненный цикл `ShutdownCoordinator` — [`docs/architecture.md`](architecture.md);
- схема таблиц `telegram_chats` и `clan_subscriptions` — [`docs/database.md`](database.md);
- матрица доставки событий, форматтеры и политика retry/outbox `NotificationWorker` — [`docs/reports.md`](reports.md).

## Границы слоя

Telegram-слой разделён на два независимых компонента на базе `grammy`:

1. `TelegramBotService` (`src/telegram/telegramBotService.ts`) — принимает входящие обновления `message`,
   `callback_query` и `my_chat_member` через long polling, показывает меню видео-гайдов, управляет подписками
   (`/link`, `/unlink`), прозрачно переносит подписки при апгрейде группы в супергруппу и автоматически отключает
   подписки при удалении/блокировке/ограничении бота.
2. `GrammyTelegramGateway` / `TelegramGateway` (`src/notifications/telegramGateway.ts`) — исходящий транспорт для
   `NotificationWorker`: отправляет HTML-сообщения через `sendMessage` и классифицирует ошибки Bot API.

Бот не выполняет произвольных аналитических запросов по команде пользователя: игровые данные войн, ЛВК и рейдов поступают
только от фоновой синхронизации с Clash of Clans API ([`docs/architecture.md`](architecture.md)). Единственное
исключение — команда `/link #TAG`, которая выполняет один запрос `GET /clans/{tag}` строго вне SQLite-транзакции для
проверки существования клана и отображения статуса онбординга.

## Конфигурация и long polling

### Настройки и ресурсы

В `config.json` (`src/config/configSchema.ts`) используется секция `telegram`:

- `telegram.attack_guides_path` — путь к JSON-каталогу гайдов (по умолчанию `resources/telegram/attack_guides.json`,
  разрешается относительно рабочего каталога процесса; в Docker-образе — `/app/resources/telegram/attack_guides.json`).

Обязательный секрет `TELEGRAM_TOKEN` передаётся через окружение или `.env` рядом с `config.json`
([`docs/architecture.md`](architecture.md)). Каталог гайдов загружается и валидируется при старте (`loadAttackGuideCatalog`);
ошибка чтения файла, невалидный JSON или ошибка `zod`-схемы прерывают запуск (`ConfigError`).

### Long polling (`TelegramBotService`)

- `allowed_updates`: `['message', 'callback_query', 'my_chat_member']` (`TELEGRAM_BOT_ALLOWED_UPDATES`).
- `timeout` long polling: `2` сек (`DEFAULT_POLLING_TIMEOUT_SECONDS = 2`), HTTP-таймаут клиента — `max(10, pollingTimeoutSeconds + 5)`
  сек (минимум `10` сек).
- Для long polling у бота не должно быть активного webhook.
- При старте `TelegramBotService.start()` до начала цикла `getUpdates` синхронизирует метаданные бота через Telegram Bot API:
  - `setMyCommands` — регистрирует список команд (`/start`, `/help`, `/link`, `/unlink`) для подсказок по `/` в клиенте Telegram;
  - `setMyDescription` и `setMyShortDescription` — выставляет описание и короткое описание бота с дисклеймером
    Supercell Fan Content Policy. Ошибка любого из этих вызовов логируется на уровне `warn` и не прерывает запуск polling.
- Остановка интегрирована с общим `AbortSignal`: вызывается `bot.stop()`, а `installTransportGuards()` при остановке
  ограничивает завершающий `getUpdates` без внешнего сигнала таймаутом `2000 мс` (`DEFAULT_STOP_CONFIRMATION_TIMEOUT_MS`).
- Необработанные ошибки обработчиков перехватываются `bot.catch` и логируются (отмена при shutdown логируется на `info`).

## Команды и валидация тега клана

Парсер `parseBotCommand` (`src/telegram/commands.ts`) распознаёт четыре команды и неизвестные slash-команды:

- `/start` (и `/start <arg>`, аргументы игнорируются) — отправляет главное меню с inline-клавиатурой (без дисклеймера);
- `/help` (дополнительные аргументы игнорируются) — отправляет справку со списком команд, правами, кратким описанием
  пресетов подписки и дисклеймером Supercell Fan Content Policy;
- `/link #TAG` — ровно 1 аргумент;
- `/unlink #TAG` — ровно 1 аргумент;
- неизвестная команда (`/unknown` и т. д.) — возвращается как `{ kind: 'unknown', name, botUsername? }`.

Правила разбора и маршрутизации:

- текст обрезается по краям и должен начинаться с `/`;
- опциональный суффикс `@bot_username` сохраняется в распарсенной команде и сравнивается в `TelegramBotService` без учёта
  регистра с `username` текущего бота (`botInfo.username`); команды, адресованные другому боту (`@other_bot`, включая
  неизвестные команды) или с пустым суффиксом после `@`, игнорируются в любом типе чата; имя команды приводится к нижнему
  регистру, токены разделяются по `/\s+/`;
- на неизвестную команду бот отвечает `Не знаю такой команды, см. /help` только в личном чате (`private`); в группах,
  супергруппах и прочих чатах бот молчит, чтобы не конфликтовать с другими ботами;
- обычные сообщения без ведущего `/` игнорируются;
- команды `/link` и `/unlink` без `message.from` игнорируются с предупреждением в лог;
- ошибки формата аргументов или тега отправляются в тот же чат и ту же форумную тему.

Нормализация и валидация тега клана (`parseClanTag`):

- ведущий `#` опционален, строка приводится к верхнему регистру;
- проверяется шаблон `/^[0289PYLQGRJCUV]{3,15}$/` (длина 3–15 символов из алфавита CoC);
- результат возвращается и хранится в каноническом виде `#TAG` в верхнем регистре.

## Правило «тип чата → пресет подписки по умолчанию» и права администратора чата

Функции `resolveDefaultPreset(chatType)` и `isSupportedTelegramChatType(chatType)` (`src/telegram/validation.ts`), а также
проверка `canManageCurrentChat` определяют пресет по умолчанию при первом `/link` и права управления подписками:

| Тип чата Telegram        | Пресет по умолчанию при `/link` | Проверка прав для `/link`, `/unlink`, `clans:unlink` и `settings:*`                |
| ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------- |
| `private`                | `management` («Руководство»)    | `chatType === 'private' && chatId === userId` (без вызова `getChatMember`)         |
| `group`                  | `players` («Игроки»)            | `api.getChatMember(chatId, userId)` → `status` равен `administrator` или `creator` |
| `supergroup`             | `players` («Игроки»)            | `api.getChatMember(chatId, userId)` → `status` равен `administrator` или `creator` |
| Прочие (`channel` и др.) | `null` (не поддерживается)      | Отклоняется сообщением о неподдерживаемом типе чата                                |

Инварианты:

- в группе/супергруппе бот должен иметь права, достаточные для вызова `getChatMember`; обычный `member` получает отказ, а
  ошибка API при проверке прав прерывает команду с сообщением о временной ошибке;
- на уровне БД (`clan_subscriptions`) существует ровно одна подписка на пару `(clan_tag, chat_id, message_thread_id)` с
  5 независимыми булевыми категориями уведомлений (минимум 1 включённая категория), флагом правила «первая атака не по
  зеркалу» (по умолчанию `0` для новых подписок) и смещением часового пояса (`UTC+3` по умолчанию).

## Форумные темы (`message_thread_id`)

- Если команда или callback пришли из темы форума, используется `message_thread_id` из исходного сообщения; для обычного
  или личного чата подставляется `GENERAL_CHAT_THREAD_ID = 0`.
- В Telegram Bot API поле `message_thread_id` передаётся только при `messageThreadId > 0`; для `0` оно опускается (как в
  `TelegramBotService.sendHtmlMessage`, так и в `GrammyTelegramGateway.sendMessage`).
- Подписки изолированы по паре `(chat_id, message_thread_id)`: разные темы одной супергруппы подключаются и
  отображаются в «Моих кланах» независимо.

## Управление подписками через `/link` и `/unlink`

- **`/link #TAG`** (тексты и статусы онбординга — `src/telegram/linkOnboarding.ts`):
  1. проверяет тип чата (`resolveDefaultPreset`), формат аргументов/тега (при неверном теге отвечает подсказкой с
     допустимым алфавитом и примером `/link #2PPLQ`) и права пользователя (`canManageCurrentChat`);
  2. проверяет, не привязан ли клан уже к текущему назначению `(chat_id, message_thread_id)`: если подписка уже
     существует, отвечает статусом «уже подключён» с текущим пресетом и кнопкой `⚙️ Настройки` — идемпотентно, без
     запроса к CoC API, без смены `subscription_id` и без перезаписи настроек;
  3. для нового подключения выполняет **один** запрос `GET /clans/{tag}` к CoC API (`cocApiClient.getCompleteClanData`)
     **строго вне SQLite-транзакции**:
     - `404` (клан не найден) → отказ «Клан `#TAG` не найден» с подсказкой примера; запись клана и подписка не
       создаются, `ClanManager` не пробуждается;
     - успех (`200`) → в одной транзакции (`TransactionManager.retryInTransaction`) сохраняются карточка клана
       (`ClansRepo.saveClan` + `ClansRepo.enableTracking`) и стартовый снимок `clan_snapshots`
       (`ClansRepo.saveClanSnapshot`, без записи `players`/`player_snapshots`/`clan_memberships`, чтобы первый фоновый
       синк `ClanInfoService` корректно считался первичным), обновляется `telegram_chats` и создаётся подписка с
       пресетом по умолчанию (`SubscriptionRepo.subscribeToChat`). Ответ содержит:
       - «Подключён клан **Имя** (`#TAG`), N участников»;
       - пометку, если клан уже отслеживается другими чатами;
       - указание активного пресета по умолчанию (`«Игроки»` или `«Руководство»`);
       - при закрытом журнале войн (`isWarLogPublic = false`) — предупреждение:
         `🔒 Журнал войн клана закрыт — обычные КВ недоступны через CoC API. ЛВК и рейды отслеживаются. Откройте журнал в настройках клана в игре.`;
       - inline-кнопку `⚙️ Настройки` (`makeSubscriptionSettingsEntryKeyboard` → `settings:open:#TAG`);
     - недоступность CoC API (таймаут, `5xx`, сетевая ошибка и т. п.) → мягкий fallback: в транзакции выполняется
       `ClansRepo.insertMinimalClan` (имя `'Pending synchronization'` для нового клана или сохранение известного имени с
       `tracking_enabled = 1`), сохраняются `telegram_chats` и подписка; ответ содержит пометку
       `⏳ данные появятся после первой синхронизации`, активный пресет и кнопку `⚙️ Настройки`.
  4. заголовок `telegram_chats` выбирается по приоритету `chat.title` → `first_name last_name` → `first_name` →
     `username` → `'Telegram-чат'`. При конкурентной гонке двух `/link` транзакция повторно проверяет наличие подписки
     и отвечает идемпотентным статусом «уже подключён» без смены `subscription_id`.
  5. после успешного коммита новой подписки (строго вне транзакции) `TelegramBotService` вызывает `clanManager.notify()`,
     чтобы `ClanManager` немедленно запустил первичную синхронизацию без ожидания 15-минутного интервала.
- **`/unlink #TAG`** (и кнопка отключения в меню) в одной транзакции:
  1. получает `subscription_id` для `(chatId, messageThreadId, clanTag)` (если подписки нет — ничего не меняет);
  2. вызывает `DomainEventsRepo.cancelForSubscription(subscriptionId)` — отменяет `pending`-получателей события и
     связанные `pending`-уведомления этого поколения подписки ([`docs/reports.md`](reports.md#отмена-по-поколению-подписки-unlink));
  3. удаляет подписку; если в Telegram-назначении больше нет подписок — удаляет строку `telegram_chats`; если у клана не
     осталось подписок — устанавливает `clans.tracking_enabled = 0`, сохраняя всю историю войн, рейдов и игроков.

## Миграция чата (`group → supergroup`) и автоотключение недоступных назначений

Жизненный цикл подписок при изменениях чата и постоянных сбоях доставки координируется единым транзакционным сервисом
`TelegramSubscriptionLifecycle` (`src/services/telegramSubscriptionLifecycle.ts`), общим для `TelegramBotService` и
`NotificationWorker`:

- **Прозрачная миграция группы в супергруппу (`migrate_to_chat_id` / `migrate_from_chat_id`)**:
  - срабатывает как при получении служебного сообщения `message.migrate_to_chat_id` / `message.migrate_from_chat_id`
    в `TelegramBotService`, так и при ответе Bot API HTTP `400` с `parameters.migrate_to_chat_id` в `NotificationWorker`;
  - в одной синхронной SQLite-транзакции переносятся записи `telegram_chats`, `clan_subscriptions` (с сохранением
    существующего `subscription_id`; при конфликте с уже созданной подпиской в супергруппе дубликат старого поколения
    отменяется и удаляется), `pending`-записи `domain_event_destinations` и активные (`pending` / `sending`) записи
    `notifications`;
  - в `NotificationWorker` текущее `sending`-уведомление в той же транзакции возвращается в `pending` с новым `chat_id`
    (если подписка активна и уведомление не просрочено), после чего батч перечитывается с новым `chat_id` без лишних
    запросов к старому чату.
- **Автоматическое отключение при постоянной недоступности назначения**:
  - выполняется с той же семантикой, что и `/unlink` (отмена `pending`-записей `domain_event_destinations` и
    `notifications` текущего поколения подписки, удаление подписок из `clan_subscriptions`, очистка `telegram_chats`,
    выключение `clans.tracking_enabled = 0` для кланов без оставшихся подписок, диагностика в лог); отдельного статуса
    «пауза» нет — для возобновления нужен повторный `/link`;
  - срабатывает в `TelegramBotService` при получении `my_chat_member` с новым статусом `kicked`, `left` или
    `restricted` с `can_send_messages === false` (отключаются все подписки `chat_id`; статусы `member`, `administrator`
    и `restricted` с `can_send_messages: true` подписки не затрагивают);
  - срабатывает в `NotificationWorker` при постоянной ошибке недоступности от Bot API: ошибки уровня чата (любой `403`,
    а также `400` вроде `chat not found`, `group chat was deactivated`, `have no rights to send`, `CHAT_WRITE_FORBIDDEN`)
    отключают все подписки `chat_id`, а ошибки удалённой/закрытой форумной темы (`400` `message thread not found`,
    `TOPIC_DELETED`, `TOPIC_CLOSED`) отключают только конкретное назначение `(chat_id, message_thread_id)`, не затрагивая
    соседние темы той же супергруппы. Прочие ошибки формата/payload (`400 can't parse entities`, `message is too long`,
    `401`, `404`) переводят в `failed` только конкретное уведомление, оставляя подписку активной.

## Интерактивное меню и схема `callback_data`

Команда `/start` отправляет главное меню с inline-клавиатурой (`src/telegram/keyboards.ts`). При каждом `callback_query`
сервис сначала валидирует `CallbackContext` (`parseCallbackContext`: обязательны `id`, `from.id`, `message.message_id`,
`message.chat.id`; `data` по умолчанию `''`, `message_thread_id` по умолчанию `0`, `chat.type` по умолчанию `''`), затем
отвечает на callback через `safeAnswerCallbackQuery` (ошибка ответа логируется, не прерывая обработку). Для
`clans:unlink` и `settings:*` ответ отправляется после проверки прав и бизнес-инвариантов: при отказе в правах, ошибке
`getChatMember`, отсутствии подписки, ошибке БД или попытке отключить последнюю категорию уведомлений пользователь
получает персональное уведомление через `answerCallbackQuery` (`show_alert: true`), а общее inline-меню в чате не
перезаписывается.

Формат `callback_data` (`src/telegram/callbackData.ts`): части разделяются `:`, минимум 2 части (`prefix:action[:args...]`),
строка строго не длиннее `64` байт в UTF-8 (`MAX_CALLBACK_DATA_BYTES`); пустые сегменты, превышение лимита, неизвестные
команды и невалидные аргументы игнорируются.

| `callback_data`                       | Аргументы и валидация                                       | Действие (`TelegramBotService`)                                                                                |
| ------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `menu:start`                          | без аргументов                                              | `editMessageText` → главное меню                                                                               |
| `help:main`                           | без аргументов                                              | `editMessageText` → справка по командам, правам, пресетам подписки и дисклеймер Supercell Fan Content Policy   |
| `clans:link`                          | без аргументов                                              | `editMessageText` → инструкция по `/link`                                                                      |
| `clans:list`                          | без аргументов                                              | `editMessageText` → список кланов для `(chatId, messageThreadId)`                                              |
| `clans:unlink`                        | 0 или 1 (`clanTag` через `parseClanTag`)                    | Проверка прав; без тега — список кнопок отключения; с тегом — транзакционное отключение                        |
| `settings:open:<clanTag>`             | `clanTag` (`parseClanTag`)                                  | Проверка прав; `editMessageText` → экран «⚙️ Настройки» подписки `(clanTag, chatId, messageThreadId)`          |
| `settings:preset:<clanTag>:<preset>`  | `clanTag` (`parseClanTag`), `preset` (`players`/`management`/`all`) | Проверка прав; атомарное применение пресета в `clan_subscriptions` и `editMessageText` экрана настроек |
| `settings:category:<clanTag>:<category>` | `clanTag` (`parseClanTag`), `category` (`summaries`/`reminders`/`roster`/`discipline`/`system`) | Проверка прав; атомарное переключение категории (с запретом отключения последней) и `editMessageText` |
| `settings:tz:<clanTag>`               | `clanTag` (`parseClanTag`)                                  | Проверка прав; `editMessageText` → быстрый выбор часового пояса СНГ (`UTC+2`..`UTC+7`) и кнопка «🌍 Другой пояс» |
| `settings:tzall:<clanTag>`            | `clanTag` (`parseClanTag`)                                  | Проверка прав; `editMessageText` → сетка всех целых смещений от `UTC-12` до `UTC+14` (по 3 в ряд)             |
| `settings:tzset:<clanTag>:<offset>`   | `clanTag` (`parseClanTag`), целое `offset` (`-12..14`)      | Проверка прав; атомарное сохранение `timezone_offset_hours` в `clan_subscriptions` и возврат на экран настроек |
| `guides:townhalls`                    | без аргументов                                              | `editMessageText` → сетка ратуш `MIN_TOWN_HALL..MAX_TOWN_HALL` (`7..18`, по 3 в ряд)                           |
| `guides:townhall:<townHall>`          | `parseTownHall` (`7..18`)                                   | `editMessageText` → уникальные стратегии для выбранной ратуши                                                  |
| `guides:strategy:<townHall>:<armyId>` | `townHall` (`7..18`), `armyId`                              | `editMessageText` → список гайдов стратегии (если пусто — игнорируется)                                        |
| `guides:guide:<townHall>:<guideId>`   | `townHall` (`7..18`), `guideId`                             | Проверка совместимости гайда с `townHall` (`findById(guideId, townHall)`); `sendMessage` (2 HTML-сообщения с сохранением `message_thread_id`): `escapeHtml(title)\nescapeHtml(youtubeUrl)` и кнопки навигации |

### Экран «⚙️ Настройки» подписки

Экран настроек управляет параметрами конкретной подписки `(clan_tag, chat_id, message_thread_id)` (форматирование —
`src/telegram/subscriptionSettings.ts`, клавиатура — `makeSubscriptionSettingsKeyboard` в `src/telegram/keyboards.ts`,
кнопка входа для `/link` и карточек «Моих кланов» — `makeSubscriptionSettingsButton` / `makeSubscriptionSettingsEntryKeyboard`):

- **Отображаемое состояние**: название клана (если оно уже синхронизировано и отлично от служебного значения
  `'Pending synchronization'`), тег клана, текущий статус пресета (`Пресет: Игроки`, `Пресет: Руководство`,
  `Пресет: Всё вместе` или `Пресет: своя настройка`, если набор категорий вручную отклонён от всех трёх пресетов) и
  текущий часовой пояс подписки (`Часовой пояс: UTC+N` / `UTC-N`, по умолчанию `UTC+3`).
- **Клавиатура**:
  1. ряд быстрого выбора из 3 пресетов: `Игроки`, `Руководство`, `Всё вместе`;
  2. 5 кнопок-переключателей категорий уведомлений со статусом `✅` (вкл) / `▫️` (выкл): «Итоги и сравнения»,
     «Напоминания», «Кадры», «Дисциплина и аналитика», «Системные оповещения»;
  3. расширяемая секция `extraRows` (под дополнительные переключатели, например правило зеркала);
  4. кнопка `🕒 Часовой пояс: UTC+N` (`settings:tz:<clanTag>`), открывающая выбор часового пояса подписки:
     - первый экран (`makeTimezoneQuickSelectKeyboard`): 6 частых поясов СНГ с городом-подсказкой (`UTC+2 Кишинёв`,
       `UTC+3 Москва/Минск`, `UTC+4 Баку`, `UTC+5 Астана/Ташкент`, `UTC+6 Бишкек`, `UTC+7 Новосибирск`, текущий пояс
       отмечается `✅`), кнопка **«🌍 Другой пояс»** (`settings:tzall:<clanTag>`) и `⬅️ Назад` к экрану настроек;
     - второй экран (`makeTimezoneAllSelectKeyboard`): сетка всех целых смещений от `UTC-12` до `UTC+14` (27 кнопок по 3
       в ряд, без автоматического перехода на летнее время) и `⬅️ Назад` к быстрому списку;
     - выбор любого смещения (`settings:tzset:<clanTag>:<offset>`) сохраняет `timezone_offset_hours` в рамках того же
       поколения подписки (`subscription_id`) и возвращает на экран настроек;
  5. кнопка возврата `⬅️ Назад` (по умолчанию ведёт на `clans:list`, может быть переопределена через `backButton`).
- **Права доступа и защита общего меню**: открыть и менять настройки (включая часовой пояс) может только владелец
  личного чата (`private`, `chatId === userId`) или администратор/создатель группы/супергруппы (`group` / `supergroup`).
  При отказе в правах или ошибке `getChatMember` отправляется персональный `answerCallbackQuery({ show_alert: true })`, а
  общее сообщение в чате не перезаписывается.
- **Запрет отключения последней категории**: при попытке снять последнюю активную категорию запись в БД не меняется,
  общее сообщение не перезаписывается, а пользователю отправляется персональный alert
  `Оставьте хотя бы одну категорию или отключите клан`.
- **Эффект изменений**: обновления категорий и часового пояса сохраняются в `clan_subscriptions` в рамках того же
  поколения подписки (`subscription_id`), влияют только на новые события/материализацию и не отменяют уже поставленные в
  очередь уведомления.
- **Изоляция тем форума**: все запросы чтения и обновления привязаны к `(chat_id, message_thread_id)`, поэтому настройки
  одного клана в разных темах одной супергруппы полностью независимы.
- **Ограничение длины `callback_data`**: максимальная длина команд `settings:*` для самого длинного валидного тега клана
  (`#` + 15 символов) составляет `45` байт UTF-8 (`settings:category:#<15 chars>:discipline`), для выбора часового пояса —
  `35` байт (`settings:tzset:#<15 chars>:-12`), что строго укладывается в лимит Telegram Bot API `64` байта
  (`MAX_CALLBACK_DATA_BYTES`).

## Каталог видео-гайдов (`resources/telegram/attack_guides.json`)

Файл содержит JSON-объект (в актуальном файле есть `"version": 1`) с обязательным массивом `guides`. Поля элемента
(`rawAttackGuideSchema` / `attackGuideCatalogSchema` в `src/telegram/attackGuideCatalog.ts`):

| Поле            | Обязательность               | Значение по умолчанию | Назначение                                                                    |
| --------------- | ---------------------------- | --------------------- | ----------------------------------------------------------------------------- |
| `id`            | обязательно (`string`)       | —                     | Уникальный непустой идентификатор гайда без `:`                               |
| `army_id`       | обязательно (`string`)       | —                     | Непустой идентификатор стратегии без `:`                                      |
| `army_title`    | опционально (`string`)       | `army_id`             | Отображаемое название стратегии                                               |
| `variant_id`    | обязательно (`string`)       | —                     | Идентификатор варианта                                                        |
| `variant_title` | обязательно (`string`)       | —                     | Название варианта                                                             |
| `title`         | обязательно (`string`)       | —                     | Заголовок кнопки и сообщения                                                  |
| `town_halls`    | обязательно (`number[]` int) | —                     | Допустимые ратуши в диапазоне `7..18`; пустой массив `[]` = любая поддерживаемая ратуша (`7..18`) |
| `youtube_url`   | обязательно (`string`)       | —                     | Валидный `http(s)` URL на видео (видео не скачивается и не проксируется)      |
| `sort_order`    | опционально (`number` int)   | `0`                   | Порядок стабильной сортировки каталога                                        |
| `enabled`       | опционально (`boolean`)      | `true`                | При `false` гайд исключается из всех выборок                                  |

При загрузке каталога дополнительно проверяется контракт Telegram Bot API: уникальность `id` среди всех записей
каталога (включая отключённые) и ограничение длины формируемых `callback_data` (`guides:guide:<townHall>:<id>` и
`guides:strategy:<townHall>:<army_id>`) не более `64` байт в UTF-8 (`MAX_CALLBACK_DATA_BYTES`). Нарушение любого
правила прерывает запуск с `ConfigError`.

Каталог хранится только в памяти (`AttackGuideCatalog`) и не записывается в SQLite.

## `TelegramGateway`: отправка и классификация ошибок

`GrammyTelegramGateway` (`src/notifications/telegramGateway.ts`) оборачивает `grammy.Api`:

- проверяет непустой `TELEGRAM_TOKEN` (`ConfigError`) и положительный `timeoutSeconds` (`10` сек по умолчанию);
- использует `createNormalizedTelegramFetch`, который адаптирует `AbortSignal` и нормализует не-JSON или нестандартные
  HTTP-ответы со статусом `>= 400` в `{ ok: false, error_code, description }` для предсказуемого разбора в grammY;
- `sendMessage(chatId, text, messageThreadId = 0, signal?)` отправляет HTML-сообщение, добавляя `message_thread_id` только
  при `messageThreadId > 0`, и немедленно прерывает ожидание по `AbortSignal`.

Функция `classifyTelegramError` делит сбои на пять категорий (`TelegramDeliveryError`):

| Категория (`kind`) | Условие                                                                                    | `retryable` | Обработка в `NotificationWorker`                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aborted`          | `signal?.aborted` или вложенный `AbortError`                                               | `false`     | Корректная остановка с освобождением claim без изменения `attempts`                                                                                            |
| `rate_limit`       | HTTP `429` или наличие `retry_after`                                                       | `true`      | Клиент не спит сам; извлекает `retryAfterSeconds = Math.ceil(retry_after)` для `next_attempt_at`                                                               |
| `transient`        | HTTP `5xx`, сетевой `HttpError` или прочие непостоянные сбои                               | `true`      | Повтор по backoff-политике (`NotificationWorker`)                                                                                                              |
| `chat_migrated`    | HTTP `400` (или ошибка API) с валидным `parameters.migrate_to_chat_id`                     | `false`     | Атомарный перенос `chat_id → migrate_to_chat_id` (`telegram_chats`, `clan_subscriptions`, очереди) и немедленный возврат уведомления в `pending` с новым `chat_id` |
| `permanent`        | HTTP `4xx` (кроме `429` и `migrate_to_chat_id`) или `retryable === false`                  | `false`     | Перевод уведомления в `status = 'failed'`; если задан `destinationUnavailableScope` (`'chat'` или `'destination'`), в той же транзакции автоматически отключаются затронутые подписки и отменяются их оставшиеся `pending`-записи |

## Получение `chat_id` и `message_thread_id` вручную

Для штатного подключения достаточно команды `/link` в нужном чате или теме форума. Если идентификаторы требуются для
ручной диагностики SQLite:

- в объекте `message` обновления Telegram `getUpdates` используются `message.chat.id` (`chat_id`) и
  `message.message_thread_id` (`message_thread_id`; при отсутствии — `0`);
- не публикуйте URL `getUpdates` с реальным `TELEGRAM_TOKEN` в логах и документации.

## Проверка поведения тестами

Автоматизированные проверки (без реального Telegram API, на заглушках и временных SQLite БД) расположены в:

- [`tests/telegram/`](../tests/telegram/) — команды, валидация тега и ратуш, права доступа, форумные темы, меню,
  `callback_data`, каталог гайдов и отмена long polling;
- [`tests/notifications/`](../tests/notifications/) — `TelegramGateway`, классификация ошибок `429`/`5xx`/`4xx`/`AbortError`,
  `NotificationWorker` и отмена записей при `/unlink`.
