---
status: accepted
---

# ADR-0003: Входящий бот на `grammY` и outbox-доставка через `TelegramGateway`

В C++-версии вся работа с Telegram Bot API (long polling, парсинг обновлений, ретраи и backoff при HTTP `429` и `5xx`) была реализована вручную. При переносе на TypeScript мы используем `grammY` для входящего бота и вызовов Telegram API, но сохраняем явный контроль над политикой повторов исходящей outbox-очереди в SQLite.

## Решение

- **Входящий бот (`TelegramBotService`) на `grammY`**:
  - используется `grammY` `Bot` в режиме long polling с `allowed_updates: ['message', 'callback_query']` (переход на webhook не выполняется);
  - сохраняется 100% совместимость команд (`/start`, `/link #TAG`, `/unlink #TAG`), нормализации тега отслеживаемого клана (3–15 символов алфавита CoC), проверки прав `administrator` / `creator` через `getChatMember` для групп и супергрупп, соответствия типа чата и аудитории (`private` → `management`, `group`/`supergroup` → `players`) и поддержки форумных тем (`message_thread_id`, `0` для общего чата);
  - сохраняется совместимый формат `callback_data` (`menu:start`, `help:main`, `clans:link`, `clans:list`, `clans:unlink`, `guides:townhalls`, `guides:townhall:<thId>`, `guides:strategy:<thId>:<armyId>`, `guides:guide:<thId>:<guideId>`), чтобы ранее отправленные в чаты inline-кнопки продолжали работать после переезда без повторного `/start`.
- **Исходящая доставка (`NotificationWorker`) через `TelegramGateway`**:
  - `NotificationWorker` не зависит от middleware и контекста `grammY` `Bot`, а работает через тонкий интерфейс `TelegramGateway` поверх `grammY` `Api` (`sendMessage` с `parse_mode: 'HTML'`, `chat_id`, `text` и передачей `message_thread_id`, когда он отличен от `0`);
  - интерфейс `TelegramGateway` служит тестовым швом для проверки исходящей доставки без реальной сети.
- **Отказ от `@grammyjs/auto-retry` на исходящем outbox-клиенте**:
  - при ответе Telegram HTTP `429 Too Many Requests` (с `parameters.retry_after`) или временной сетевой / `5xx` ошибке `NotificationWorker` не спит внутри HTTP-клиента, а немедленно переносит запись уведомления в SQLite через `reschedule` с `next_attempt_at = max(backoff, now + retry_after)` и переходит к следующему уведомлению в пачке;
  - постоянные ошибки (`400`, `403`, `404`) и исчерпание лимита попыток переводят запись в `failed`;
  - отмена через `AbortSignal` при остановке приложения прерывает активный запрос без инкремента `attempts` и без перевода уведомления в `failed`.

## Рассмотренные альтернативы

- **Использование `@grammyjs/auto-retry` для `NotificationWorker`**: отклонено по двум причинам: во-первых, ожидание `retry_after` в памяти блокирует обработку уведомлений для других Telegram-назначений (head-of-line blocking); во-вторых, таймер ожидания теряется при перезапуске контейнера и мешает уложиться в бюджет остановки 15 секунд.
- **Самописный HTTP-клиент Telegram вместо `grammY`**: отклонено, так как `grammY` даёт строгую типизацию Telegram Bot API, готовый цикл long polling с корректной остановкой и удобную тестируемость входящих обновлений через `bot.handleUpdate`.

## Последствия

- Rate limit (`429`) для одного Telegram-назначения не тормозит доставку уведомлений в остальные чаты, а рассчитанное время `next_attempt_at` переживает перезапуск процесса в SQLite.
- Все существующие inline-клавиатуры в пользовательских чатах остаются рабочими сразу после переключения на TypeScript-версию.
- `TelegramGateway` изолирует доменную и outbox-логику от деталей `grammY`, упрощая интеграционное тестирование доставки и ошибок Telegram.
