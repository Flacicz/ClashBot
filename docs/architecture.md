# Архитектура ClashBot

## Назначение и стек

ClashBot — автономный сервис мониторинга кланов Clash of Clans. Он периодически забирает данные из официального Clash of Clans API, хранит состояние и историю в SQLite и доставляет уведомления в Telegram.

- **Среда выполнения**: Node.js 24 LTS (`engines.node >= 24.0.0`), TypeScript (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), ESM (`"type": "module"`), пакетный менеджер `pnpm`.
- **Ключевые библиотеки**: `better-sqlite3` (SQLite), `grammY` (Telegram Bot API), `undici` (HTTP-клиент CoC API), `zod` (валидация конфигов, API-ответов и payload событий), `pino` / `pino-pretty` (логирование), `Vitest` (тестирование).
- **Модель исполнения**: один процесс Node.js с одним event loop и одним общим соединением SQLite ([ADR-0001](adr/0001-typescript-nodejs-stack.md), [ADR-0002](adr/0002-single-loop-better-sqlite3.md)).

## Границы модулей `src/`

Точки входа и модули в `src/` разделены по слоям:

| Путь | Назначение | Границы и зависимости |
| --- | --- | --- |
| `src/cli.ts`, `src/main.ts`, `src/index.ts` | CLI-вход `dist/cli.js`, оркестрация `main()`, публичный barrel-экспорт | Инициализирует логгер, `ShutdownCoordinator`, конфиг и `Application`; завершает процесс с кодом `0` или `1` |
| `src/app/` | Composition root (`application.ts`) и остановка (`shutdownCoordinator.ts`) | Собирает зависимости, запускает 4 цикла, управляет `AbortSignal` и общим бюджетом остановки |
| `src/config/` | Схема (`configSchema.ts`) и загрузка конфига/секретов (`loadConfig.ts`) | Валидирует `config.json`, `.env` и обязательные переменные окружения через `zod` |
| `src/api/` | HTTP-клиент CoC API (`cocApiClient.ts`), ошибки, схемы `zod`, мапперы и парсер времени | Не знает о SQLite и Telegram; преобразует ответы API в доменные модели |
| `src/models/` | Типы предметной области (`clan.ts`, `raid.ts`) | Чистые структуры данных; реэкспортирует базовые модели из `src/api/models.ts` |
| `src/services/` | Оркестрация синхронизации (`ClanManager`, `SyncService`, 4 сервиса, `reminders.ts`) | Вызывает API вне транзакций, пишет в БД через репозитории и `DomainEventRecorder` внутри транзакции |
| `src/database/` | `Database`, `TransactionManager`, `MigratorManager`, `ForeignKeysGuard`, `RetryPolicy` | Инкапсулирует соединение `better-sqlite3`, `PRAGMA`, транзакции и миграции |
| `src/database/repos/` | 8 предметных репозиториев, `BaseRepository`, `repoHelpers.ts` | Единственный слой с SQL-запросами; преобразует ошибки SQLite в `DatabaseError` |
| `src/events/` | Дискриминируемое объединение `ApplicationEvent` и стабильные ключи `getApplicationEventKey` | Чистые типы и функции ключей дедупликации; не зависят от БД и форматтеров |
| `src/domainEvents/` | Сериализация/десериализация payload, `eventNotificationPolicy`, `DomainEventRecorder`, `DomainEventWorker` | Записывает доменные события в одной транзакции с источником; материализует их в outbox |
| `src/analytics/` | Сравнительные и ростерные анализаторы (`clanwar*`, `raid*`) | Чистые вычисления поверх данных из репозиториев и моделей |
| `src/reports/` | HTML-форматтеры отчётов, нарушений, напоминаний и системных алертов | Формируют текст уведомлений; не отправляют сообщения и не управляют транзакциями |
| `src/notifications/` | `NotificationService`, `NotificationWorker`, `TelegramGateway` (`GrammyTelegramGateway`) | Материализует события в таблицу `notifications` и доставляет outbox через `TelegramGateway` |
| `src/telegram/` | `TelegramBotService`, парсер команд/callback, клавиатуры, `AttackGuideCatalog` | Обрабатывает входящие команды/кнопки через `grammY`; управляет подписками в транзакциях |
| `src/logging/` | Конфигурация `pino` (`logger.ts`) | Единая точка создания логгера и санитизации секретов |
| `src/common/` | Иерархия `AppError`, `Clock` (`SystemClock`/`FakeClock`), `formatUtils.ts` | Общие утилиты без зависимостей от слоёв приложения |

## Композиция и жизненный цикл

### Запуск (`src/cli.ts` → `src/main.ts` → `src/app/application.ts`)

1. `src/cli.ts` передаёт `process.argv.slice(2)` в `main()` и завершает процесс с возвращённым кодом (`EXIT_OK = 0`, `EXIT_FAILURE = 1`).
2. `main()` создаёт корневой логгер (`createLogger()`), `ShutdownCoordinator` и подписывается на сигналы `SIGINT` и `SIGTERM`.
3. `loadConfigFromArgs()` читает `config.json` (или путь из `argv[0]`) и `.env`.
4. `createApplication()` инициализирует компоненты в строгом порядке (при ошибке уже открытые ресурсы закрываются в обратном порядке через `cleanups`):
   - открывает единственное соединение `Database` и применяет миграции `MigratorManager.migrate()`;
   - загружает каталог видео-гайдов `loadAttackGuideCatalog()`;
   - создаёт `CocApiClient` с привязкой к `coordinator.signal`;
   - создаёт 8 репозиториев (`ClansRepo`, `ClanwarRepo`, `ClanwarsLeagueRepo`, `RaidRepo`, `SubscriptionRepo`, `DomainEventsRepo`, `NotificationRepo`, `SyncOutageRepo`);
   - собирает `NotificationWorker`, `NotificationService`, `DomainEventWorker` и `DomainEventRecorder`;
   - создаёт сервисы синхронизации в фиксированном порядке: `ClanInfoService`, `ClanwarService`, `RaidService`, `ClanwarLeagueService`;
   - создаёт `ClanManager` и `TelegramBotService`;
   - регистрирует `closers` (`sqlite`, `cocHttpPool`) и `stopActions` (`domainEventWorker`, `telegramBotService`, `notificationWorker`).
5. `app.start()` запускает 4 асинхронных цикла через `coordinator.startLoop()`:
   - `syncLoop` → `clanManager.syncAll(signal)`
   - `notificationWorker` → `notificationWorker.run(signal)`
   - `telegramBotService` → `telegramBotService.start(signal)`
   - `domainEventWorker` → `domainEventWorker.run(signal)`

### Остановка (`src/app/shutdownCoordinator.ts`)

`ShutdownCoordinator` использует единый `AbortController` и бюджет остановки `DEFAULT_SHUTDOWN_BUDGET_MS = 15_000` (15 секунд; при деплое в Compose `stop_grace_period: 30s`).

1. При `SIGINT`, `SIGTERM`, вызове `shutdown()` или необработанной ошибке любого цикла (`crashed = true`) отменяется общий `AbortSignal`.
2. Одновременно запускаются зарегистрированные `stopActions` (`domainEventWorker.requestStop()`, `telegramBotService.stop()`, `notificationWorker.requestStop()`) и ожидание завершения всех 4 циклов.
3. После завершения циклов последовательно вызываются `closers` в обратном порядке регистрации: сначала `cocHttpPool` (`cocApiClient.close()`), затем `sqlite` (`db.close()`).
4. При превышении 15-секундного бюджета координатор пишет запись уровня `fatal`, сбрасывает буфер логгера (`logger.flush()`) и принудительно завершает процесс с кодом `1`.

## Конфигурация и секреты (`src/config/`)

### `config.json` (`src/config/configSchema.ts`)

Конфигурационный файл содержит только несекретные параметры и валидируется схемой `jsonConfigSchema` (`zod`):

| Ключ JSON | Поле `AppConfig` | Тип | Значение по умолчанию | Назначение |
| --- | --- | --- | --- | --- |
| `api.use_tunnel` | `useTunnel` | `boolean` | `false` | Использовать `tunnel_base_url` вместо `base_url` |
| `api.tunnel_base_url` | `tunnelBaseUrl` | `string` | `'https://localhost:8080/v1'` | URL локального SSH-туннеля (обязательно непустой при `use_tunnel: true`) |
| `api.base_url` | `baseUrl` | `string` | `'https://api.clashofclans.com/v1/'` | Прямой базовый URL Clash of Clans API (непустой) |
| `database.path` | `databasePath` | `string` | `'data/database.sqlite'` | Путь к файлу SQLite (непустой) |
| `database.migrations_path` | `migrationPath` | `string` | `'migrations'` | Каталог `.sql`-миграций (непустой) |
| `telegram.attack_guides_path` | `attackGuidesPath` | `string` | `'resources/telegram/attack_guides.json'` | Путь к JSON-каталогу видео-гайдов (непустой) |

Относительные пути внутри `config.json` разрешаются относительно текущего рабочего каталога процесса (`process.cwd()`), а не каталога `config.json`. Шаблон файла — [`config.example.json`](../config.example.json).

### Переменные окружения и `.env` (`src/config/loadConfig.ts`)

`loadConfigFromArgs()` берёт путь к конфигу из `argv[0]` или `DEFAULT_CONFIG_PATH = 'config.json'`. Файл `.env` ищется в одном каталоге с `config.json` (`path.dirname(path.resolve(configPath))`) и не является обязательным:

- `parseDotEnv` принимает строки вида `KEY=value` (пустые строки и `#` пропускаются, `\r` обрезается; экранирование и многострочные значения не поддерживаются).
- `loadDotEnv` записывает в окружение только те ключи, которые ещё не заданы (переменные процесса/контейнера имеют приоритет над `.env`).

Обязательные секреты (`envSecretsSchema`):
- `SUPERCELL_TOKEN` — Bearer-токен Clash of Clans API (непустая строка);
- `TELEGRAM_TOKEN` — токен бота Telegram (непустая строка).

Опциональные переменные окружения логгера (`src/logging/logger.ts`):
- `LOG_LEVEL` — `fatal | error | warn | info | debug | trace | silent` (по умолчанию `info`);
- `LOG_FORMAT` — значение `pretty` включает `pino-pretty` (по умолчанию JSON в `stdout`).

## Клиент Clash of Clans API (`src/api/`)

`CocApiClient` (`src/api/cocApiClient.ts`) использует `undici` (`fetch` + `Agent`) с таймаутом `DEFAULT_COC_API_TIMEOUT_MS = 20_000` (20 секунд) на запрос и двойным связыванием `AbortSignal` (общего сигнала остановки и сигнала вызова).

- **Заголовки**: `Authorization: Bearer <SUPERCELL_TOKEN>`, `Accept: Application/json`.
- **TLS и туннель**: при `useTunnel: false` используется стандартный `Agent` с проверкой TLS; при `useTunnel: true` создаётся изолированный `Agent({ connect: { rejectUnauthorized: false } })` только для клиента туннеля.
- **Теги и URL**: `encodeClanTag` гарантирует префикс `#` и URL-кодирование; `buildEndpointUrl` нормализует слэши на стыке `baseUrl` и пути.

Используемые endpoint'ы (`ClashOfClansApi`):

| Метод клиента | Endpoint | Поведение при `404` / отсутствии данных |
| --- | --- | --- |
| `getCompleteClanData` | `GET /clans/{tag}` | `404` → `null` |
| `getCompleteRaidData` | `GET /clans/{tag}/capitalraidseasons?limit=1` | `404`, пустой `items: []` или `state === 'scheduled'` → `null` |
| `getCompleteClanwarData` | `GET /clans/{tag}/currentwar` | `state === 'notInWar'` → `null`; `403` пробрасывается как `CocApiError` |
| `getCompleteClanwarsLeagueData` | `GET /clans/{tag}/currentwar/leaguegroup` + раунды `GET /clanwarleagues/wars/{warTag}` | `404` на группе или неактивном сезоне → `null`; пропускает `warTag === '#0'` и выбирает первый найденный раунд с участием целевого клана |

Все ответы `200 OK` валидируются схемами `zod` (`src/api/schemas.ts`). Ошибки классифицируются в `CocApiError` (`src/api/errors.ts`) со следующими `kind`:
- **Повторяемые (`retryable: true`)**: `network`, `timeout`, `rate_limit` (HTTP `429` с разбором заголовка `Retry-After`), `server_error` (`5xx`).
- **Неповторяемые (`retryable: false`)**: `forbidden` (`403`), `not_found` (`404`), `unexpected_status`, `invalid_json`, `invalid_schema`.

Временные метки API в формате `YYYYMMDDTHHMMSS[.fff]Z` преобразуются в Unix timestamp в секундах (`src/api/timeParser.ts`). Форматирование дат для сообщений Telegram выполняется в `UTC+3` (`formatUnixToMoscowDateTime` в `src/common/formatUtils.ts`).

## Цикл синхронизации (`ClanManager` и `SyncService`)

### Сервисы синхронизации

Все фоновые синхронизаторы реализуют интерфейс `SyncService` (`getServiceName()`, `updateData(clanTag, signal)`):

1. `ClanInfoService` — запрашивает состав и параметры клана; в одной транзакции сохраняет клан, игроков и снимки (`clans`, `players`, `clan_snapshots`, `player_snapshots`), обновляет `clan_memberships` и порождает события входа, выхода и смены игровой роли. При самой первой синхронизации клана (`activeMemberships.length === 0 && latestPlayerStates.length === 0`) события не генерируются (`isInitialSync`), чтобы не рассылать весь стартовый состав. Пустой ответ `null` трактуется как ошибка синхронизации.
2. `ClanwarService` — синхронизирует текущую обычную войну (`wars`, `war_clans`, `war_members`, `attacks`). Ответ `notInWar` и закрытый журнал войн (`403`, если это не `accessDenied.invalidIp` и не `invalid authorization`) считаются штатным успешным результатом без записи сбоя.
3. `RaidService` — запрашивает последний доступный рейдовый уикенд. Перед сохранением `player_raid_snapshots` гарантирует наличие записей игроков через `clansRepo.insertMinimal()` в той же транзакции. Штатное отсутствие данных рейда (`null`: `404`, пустой `items: []` или `state === 'scheduled'`) считается успешным пустым результатом без ретраев и без записи сбоя.
4. `ClanwarLeagueService` — синхронизирует сезон CWL, состав и все найденные раунды. Отсутствие активного сезона (`null`) считается штатным успешным результатом.

### Оркестрация в `ClanManager` (`src/services/clanManager.ts`)

| Параметр | Значение по умолчанию | Назначение |
| --- | --- | --- |
| `cycleIntervalMs` | `15 * 60 * 1000` (15 мин) | Пауза между полными циклами синхронизации |
| `clanLoadRetryDelayMs` | `30 * 1000` (30 с) | Пауза при `DatabaseError` во время чтения списка отслеживаемых кланов |
| `retryPolicy` | `maxAttempts = 3`, `initialDelayMs = 2000`, `linear` | Повторы отдельного сервиса (задержка `2 с` перед 2-й и `2 с` перед 3-й попыткой) |

На каждой итерации `syncAll()`:
1. Загружает активные теги кланов через `clansRepo.getTrackedClans()` (`tracking_enabled = 1`).
2. Последовательно обходит пары `(clanTag, service)`.
3. Прерывание по `AbortSignal` выбрасывает `AbortError` и завершает цикл без инкремента сбоев.
4. Если сервис исчерпал попытки (`!result.successFlag`), `ClanManager` в отдельной транзакции регистрирует/инкрементирует открытый эпизод в `sync_outages` и записывает `SyncFailureEvent`.
5. При успешном результате (`result.successFlag`) проверяется открытый эпизод `sync_outages`; если он был открыт, эпизод закрывается (`recovered_at`) и в той же транзакции записывается `SyncRecoveryEvent`.

## Кросс-слойные инварианты и поток событий

Сквозная цепочка доставки работает поверх двух SQLite-очередей без внешнего брокера сообщений ([ADR-0005](adr/0005-transactional-outbox-and-subscription-generations.md)):

```text
SyncService / ClanManager
  └─► TransactionManager.retryInTransaction()
        ├─ запись доменного состояния (wars / raids / players / sync_outages)
        └─ DomainEventRecorder.recordAll() ──► domain_events + domain_event_destinations (с subscription_id)
                                                     │
                                                     ▼ (commit; worker опрашивает раз в 1 с или по notify)
DomainEventWorker
  └─► TransactionManager.retryInTransaction()
        ├─ перепроверка pending-статуса destination
        ├─ десериализация payload (zod) → NotificationService.materialize() (форматтеры + аналитика)
        ├─ запись в outbox notifications (ON CONFLICT DO NOTHING)
        └─ markMaterialized(destinationId) ──► пробуждение NotificationWorker.notify()
                                                     │
                                                     ▼ (commit; вне транзакции)
NotificationWorker
  ├─ перепроверка pending-статуса уведомления
  ├─ HTTP sendMessage через TelegramGateway (grammY Api)
  └─ markAsSent / reschedule (exponential + retry_after) / markAsFailed
```

Ключевые системные инварианты:
- **Атомарность событий и снимка получателей**: `domain_events` и `domain_event_destinations` (включая `subscription_id` поколения подписки) сохраняются в той же транзакции, что и изменение состояния клана/войны/рейда/сбоя.
- **Чистые транзакции**: транзакции в `TransactionManager` строго синхронны (`better-sqlite3`, проверка на `PromiseLike` на уровне типов и в runtime); сетевые вызовы CoC API и Telegram выполняются только за пределами транзакций.
- **Один активный процесс на файл БД**: ни `DomainEventWorker`, ни `NotificationWorker` не имеют распределённого `lease/claim` механизма. Одновременно должен запускаться только один процесс ClashBot на один файл SQLite.
- **Семантика доставки `at-least-once`**: при падении процесса после успешного `sendMessage`, но до `markAsSent`, уведомление может быть отправлено повторно; отмена подписки через `/unlink` отменяет `pending` записи по `subscription_id`, но не отзывает уже отправленный HTTP-запрос.

Детальные контракты слоёв вынесены в SSOT-документы:
- схема SQLite, миграции `001`–`012`, `PRAGMA` и контракты репозиториев → [`docs/database.md`](database.md);
- каталог `ApplicationEvent`, payload, матрица доставки по аудиториям, контрольные точки, форматтеры и дедупликация → [`docs/reports.md`](reports.md);
- входящий бот `TelegramBotService`, команды `/start`, `/link`, `/unlink`, права, форумные темы и `TelegramGateway` → [`docs/telegram.md`](telegram.md).

## Логирование и обработка ошибок

- **Логирование (`src/logging/logger.ts`)**: `pino` пишет структурированные логи в `stdout` (JSON по умолчанию для контейнера, `pino-pretty` при `LOG_FORMAT=pretty`). Настроено редактирование полей (`supercellToken`, `telegramToken`, `authorization`, `headers.authorization` и вложенных вариантов) и санитизация секретов (`Bearer ...`, `bot<id>:<token>`, актуальных значений `SUPERCELL_TOKEN` / `TELEGRAM_TOKEN`) в сериализаторах `err` / `error`.
- **Иерархия ошибок (`src/common/errors.ts`)**: базовый `AppError` (`code`, `context`, `cause`) и специализированные `ConfigError`, `ValidationError`, `AbortError`, `DatabaseError` (с `sqliteCode` и `isBusy()`), `DomainError`, `ExternalApiError` (`statusCode`, `retryable`).
- **Реакция на сбои**: ошибка отдельного сервиса синхронизации не валит приложение — она фиксируется в `SyncResult` и `sync_outages`. Неперехваченное исключение в любом из 4 фоновых циклов (`syncLoop`, `domainEventWorker`, `notificationWorker`, `telegramBotService`) логируется с уровнем `fatal` и инициирует остановку процесса с кодом возврата `1`.
- **Восстановление в воркерах**: `DomainEventWorker` (пачки до 100, опрос раз в 1 с) при ошибке материализации переносит destination экспоненциальным backoff (от 1 с до 3600 с), на 5-й ошибке пишет алерт уровня `error`, но оставляет строку `pending` для дальнейших повторов. Политика доставки `NotificationWorker` описана в [`docs/reports.md`](reports.md) и [`docs/telegram.md`](telegram.md).

## Смежные документы

- [`GLOSSARY.md`](../GLOSSARY.md) — канонические термины предметной области.
- [`docs/database.md`](database.md) — SQLite, транзакции, миграции и репозитории.
- [`docs/reports.md`](reports.md) — события, отчёты, напоминания и outbox-политика.
- [`docs/telegram.md`](telegram.md) — `TelegramBotService`, права, форумные темы и `TelegramGateway`.
- [`docs/deployment.md`](deployment.md) — Docker, GHCR, деплой, SSH-туннель и бэкапы SQLite.
- [`docs/roadmap.md`](roadmap.md) — подтверждённое состояние AS-IS и известные ограничения.
- [`docs/adr/`](adr/0001-typescript-nodejs-stack.md) — зафиксированные архитектурные решения (`0001`–`0005`).
