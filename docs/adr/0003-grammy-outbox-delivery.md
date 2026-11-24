---
status: accepted
---

# ADR-0003: Входящий бот на `grammY` и outbox-доставка через `TelegramGateway`

Исторически (в C++-версии) работа с Telegram Bot API (long polling, парсинг обновлений, ретраи и backoff при HTTP `429` и `5xx`) была реализована вручную. В TypeScript-реализации используется `grammY` для входящего бота и вызовов Telegram API при сохранении явного контроля над политикой повторов исходящей outbox-очереди в SQLite.

## Решение

- **Входящий бот (`TelegramBotService`) на `grammY`**:
  - используется `grammY` `Bot` в режиме long polling (таймаут `2` секунды) с `allowed_updates: ['message', 'callback_query']` (переход на webhook не выполняется);
  - сохранена совместимость команд (`/start`, `/link #TAG`, `/unlink #TAG`), нормализации тега отслеживаемого клана (3–15 символов алфавита CoC), проверки прав администратора чата (`administrator` / `creator`) через `getChatMember` для групп и супергрупп, соответствия типа чата и аудитории (`private` → `management`, `group`/`supergroup` → `players`) и поддержки форумных тем (`message_thread_id`, `0` для общего чата);
  - сохранён совместимый формат `callback_data` (`menu:start`, `help:main`, `clans:link`, `clans:list`, `clans:unlink`, `clans:unlink:<clanTag>`, `guides:townhalls`, `guides:townhall:<thId>`, `guides:strategy:<thId>:<armyId>`, `guides:guide:<thId>:<guideId>`), чтобы ранее отправленные в чаты inline-кнопки продолжали работать после обновления без повторного `/start`.
- **Исходящая доставка (`NotificationWorker`) через `TelegramGateway`**:
  - `NotificationWorker` не зависит от middleware и контекста `grammY` `Bot`, а работает через интерфейс `TelegramGateway` (`GrammyTelegramGateway` поверх `grammY` `Api`: `sendMessage` с `parse_mode: 'HTML'`, `chat_id`, `text` и передачей `message_thread_id > 0`);
  - интерфейс `TelegramGateway` служит тестовым швом для проверки исходящей доставки без реальной сети.
- **Отказ от `@grammyjs/auto-retry` на исходящем outbox-клиенте**:
  - при ответе Telegram HTTP `429 Too Many Requests` (с `parameters.retry_after`) или временной сетевой / `5xx` ошибке `NotificationWorker` не спит внутри HTTP-клиента, а немедленно переносит запись уведомления в SQLite через `reschedule` (политика по умолчанию: до `4` попыток, экспоненциальный backoff `500 мс`–`8000 мс` с `nextAttemptAt = now + max(backoffSeconds, ceil(retry_after))`) и переходит к следующему уведомлению в пачке;
  - постоянные ошибки (`4xx` кроме `429`, либо `retryable: false`) и исчерпание лимита попыток переводят запись в `failed`;
  - отмена через `AbortSignal` при остановке приложения прерывает активный запрос без инкремента `attempts` и без перевода уведомления в `failed`.

## Рассмотренные альтернативы

- **Использование `@grammyjs/auto-retry` для `NotificationWorker`**: отклонено по двум причинам: во-первых, ожидание `retry_after` в памяти блокирует обработку уведомлений для других Telegram-назначений (head-of-line blocking); во-вторых, таймер ожидания теряется при перезапуске контейнера и мешает уложиться в бюджет остановки 15 секунд.
- **Самописный HTTP-клиент Telegram вместо `grammY`**: отклонено, так как `grammY` даёт строгую типизацию Telegram Bot API, готовый цикл long polling с корректной остановкой и удобную тестируемость входящих обновлений через `bot.handleUpdate`.

## Последствия

- Rate limit (`429`) для одного Telegram-назначения не тормозит доставку уведомлений в остальные Telegram-назначения, а рассчитанное время `next_attempt_at` переживает перезапуск процесса в SQLite.
- Все существующие inline-клавиатуры в пользовательских чатах сохранили работоспособность после переключения на TypeScript-версию.
- `TelegramGateway` изолирует доменную и outbox-логику от деталей `grammY`, упрощая интеграционное тестирование доставки и ошибок Telegram.
