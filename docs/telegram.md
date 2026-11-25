# Telegram-интеграция (grammY)

Единственный источник истины по входящему Telegram-слою (`src/telegram/`), каталогу гайдов
(`resources/telegram/attack_guides.json`), правилу «тип чата → аудитория», проверке прав администратора чата и
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

Бот не выполняет произвольных аналитических запросов по команде пользователя: игровые данные поступают только от фоновой
синхронизации с Clash of Clans API ([`docs/architecture.md`](architecture.md)).

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
- Остановка интегрирована с общим `AbortSignal`: вызывается `bot.stop()`, а `installTransportGuards()` при остановке
  ограничивает завершающий `getUpdates` без внешнего сигнала таймаутом `2000 мс` (`DEFAULT_STOP_CONFIRMATION_TIMEOUT_MS`).
- Необработанные ошибки обработчиков перехватываются `bot.catch` и логируются (отмена при shutdown логируется на `info`).

## Команды и валидация тега клана

Парсер `parseBotCommand` (`src/telegram/commands.ts`) поддерживает только три команды:

- `/start` — только без аргументов (при наличии аргументов игнорируется);
- `/link #TAG` — ровно 1 аргумент;
- `/unlink #TAG` — ровно 1 аргумент.

Правила разбора:

- текст обрезается по краям и должен начинаться с `/`;
- опциональный суффикс `@bot_username` сохраняется в распарсенной команде и сравнивается в `TelegramBotService` без учёта
  регистра с `username` текущего бота (`botInfo.username`); команды, адресованные другому боту или с пустым суффиксом
  после `@`, игнорируются; имя команды приводится к нижнему регистру, токены разделяются по `/\s+/`;
- любые неизвестные команды и обычные сообщения игнорируются;
- команды `/link` и `/unlink` без `message.from` игнорируются с предупреждением в лог;
- ошибки формата аргументов или тега отправляются в тот же чат и ту же форумную тему.

Нормализация и валидация тега клана (`parseClanTag`):

- ведущий `#` опционален, строка приводится к верхнему регистру;
- проверяется шаблон `/^[0289PYLQGRJCUV]{3,15}$/` (длина 3–15 символов из алфавита CoC);
- результат возвращается и хранится в каноническом виде `#TAG` в верхнем регистре.

## Правило «тип чата → аудитория» и права администратора чата

Функция `resolveAudience(chatType)` (`src/telegram/validation.ts`) и проверка `canManageCurrentChat` определяют, какую
аудиторию и кто может подключать/отключать:

| Тип чата Telegram        | Аудитория                  | Проверка прав для `/link`, `/unlink` и `clans:unlink`                              |
| ------------------------ | -------------------------- | ---------------------------------------------------------------------------------- |
| `private`                | `management`               | `chatType === 'private' && chatId === userId` (без вызова `getChatMember`)         |
| `group`                  | `players`                  | `api.getChatMember(chatId, userId)` → `status` равен `administrator` или `creator` |
| `supergroup`             | `players`                  | `api.getChatMember(chatId, userId)` → `status` равен `administrator` или `creator` |
| Прочие (`channel` и др.) | `null` (не поддерживается) | Отклоняется сообщением о неподдерживаемом типе чата                                |

Инварианты:

- в группе/супергруппе бот должен иметь права, достаточные для вызова `getChatMember`; обычный `member` получает отказ, а
  ошибка API при проверке прав прерывает команду с сообщением о временной ошибке;
- правило «тип чата → аудитория» задаёт только поведение интерфейса бота; на уровне БД (`clan_subscriptions`) аудитория
  является отдельным полем подписки (две аудитории на одно Telegram-назначение возможны только при ручной записи в SQLite).

## Форумные темы (`message_thread_id`)

- Если команда или callback пришли из темы форума, используется `message_thread_id` из исходного сообщения; для обычного
  или личного чата подставляется `GENERAL_CHAT_THREAD_ID = 0`.
- В Telegram Bot API поле `message_thread_id` передаётся только при `messageThreadId > 0`; для `0` оно опускается (как в
  `TelegramBotService.sendHtmlMessage`, так и в `GrammyTelegramGateway.sendMessage`).
- Подписки изолированы по тройке `(chat_id, message_thread_id, audience)`: разные темы одной супергруппы подключаются и
  отображаются в «Моих кланах» независимо.

## Управление подписками через `/link` и `/unlink`

- **`/link #TAG`** в одной транзакции (`TransactionManager.retryInTransaction`):
  1. `ClansRepo.insertMinimalClan` — создаёт запись клана с именем `'Pending synchronization'` (если её ещё нет) и включает
     `tracking_enabled = 1`;
  2. `SubscriptionRepo.saveTelegramChat(chatId, messageThreadId, title)` — заголовок выбирается по приоритету
     `chat.title` → `first_name last_name` → `first_name` → `username` → `'Telegram-чат'`;
  3. `SubscriptionRepo.subscribeToChat` (`INSERT OR IGNORE`). Повторный `/link` идемпотентен и сохраняет текущее
     поколение подписки (`subscription_id`).
  После успешного коммита транзакции (строго вне транзакции) `TelegramBotService` вызывает `clanManager.notify()`, чтобы
  `ClanManager` немедленно запустил первичную синхронизацию нового отслеживаемого клана без ожидания 15-минутного интервала.
- **`/unlink #TAG`** (и кнопка отключения в меню) в одной транзакции:
  1. получает `subscription_id` для `(chatId, messageThreadId, clanTag, audience)` (если подписки нет — ничего не меняет);
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
`clans:unlink` ответ отправляется после проверки прав: при отказе в правах или ошибке `getChatMember` пользователь
получает персональное уведомление через `answerCallbackQuery` (`show_alert: true`), а общее inline-меню в чате не
перезаписывается.

Формат `callback_data` (`src/telegram/callbackData.ts`): части разделяются `:`, минимум 2 части (`prefix:action[:args...]`),
пустые сегменты, неизвестные команды и невалидные аргументы игнорируются.

| `callback_data`                       | Аргументы и валидация                    | Действие (`TelegramBotService`)                                                                                |
| ------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `menu:start`                          | без аргументов                           | `editMessageText` → главное меню                                                                               |
| `help:main`                           | без аргументов                           | `editMessageText` → справка по `/link`, `/unlink` и правам                                                     |
| `clans:link`                          | без аргументов                           | `editMessageText` → инструкция по `/link`                                                                      |
| `clans:list`                          | без аргументов                           | `editMessageText` → список кланов для `(chatId, messageThreadId, audience)`                                    |
| `clans:unlink`                        | 0 или 1 (`clanTag` через `parseClanTag`) | Проверка прав; без тега — список кнопок отключения; с тегом — транзакционное отключение                        |
| `guides:townhalls`                    | без аргументов                           | `editMessageText` → сетка ратуш `MIN_TOWN_HALL..MAX_TOWN_HALL` (`7..18`, по 3 в ряд)                           |
| `guides:townhall:<townHall>`          | `parseTownHall` (`7..18`)                | `editMessageText` → уникальные стратегии для выбранной ратуши                                                  |
| `guides:strategy:<townHall>:<armyId>` | `townHall` (`7..18`), `armyId`           | `editMessageText` → список гайдов стратегии (если пусто — игнорируется)                                        |
| `guides:guide:<townHall>:<guideId>`   | `townHall` (`7..18`), `guideId`          | Проверка совместимости гайда с `townHall` (`findById(guideId, townHall)`); `sendMessage` (2 HTML-сообщения с сохранением `message_thread_id`): `escapeHtml(title)\nescapeHtml(youtubeUrl)` и кнопки навигации |

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
