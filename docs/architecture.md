# Архитектура ClashBot

## Назначение

ClashBot — автономное C++20-приложение, которое периодически синхронизирует данные одного или нескольких кланов Clash
of Clans, сохраняет их в SQLite и публикует сообщения в Telegram.

Внешние источники данных:

- официальный Clash of Clans API — информация о клане, текущей войне, CWL и последнем рейдовом выходном;
- Telegram Bot API — отправка сообщений, inline-клавиатуры, callback-запросы и long polling входящих обновлений.

Событийная часть проекта является внутренней и оперативной: события представлены типом std::variant, живут в памяти и
не сохраняются в отдельный event log.

## Конфигурация и секреты

### config.json

Файл содержит только несекретные настройки:

| Путь | Тип | Назначение |
| --- | --- | --- |
| api.use_tunnel | bool | использовать ли tunnel_base_url вместо base_url |
| api.tunnel_base_url | string | URL локального SSH-туннеля, например https://localhost:8080/v1 |
| api.base_url | string | прямой URL Clash of Clans API |
| database.path | string | путь к SQLite-файлу |
| database.migrations_path | string | каталог SQL-миграций |
| telegram.attack_guides_path | string | путь к JSON-каталогу гайдов |

Значения по умолчанию задаются в src/config/ConfigLoader.cpp, но для запуска рекомендуется явно указать все пути.
Пути разрешаются относительно текущего рабочего каталога процесса, а не относительно каталога конфигурационного файла.

### Секреты

Обязательные переменные окружения:

- SUPERCELL_TOKEN — токен Clash of Clans API;
- TELEGRAM_TOKEN — токен Telegram-бота.

main.cpp ищет .env рядом с переданным config.json. Файл необязателен. Config::loadDotEnv устанавливает только те
переменные, которых ещё нет в окружении, поэтому переменные процесса, Docker или CI/CD имеют приоритет.

Значения .env должны иметь простой формат KEY=value; пустые строки и строки, начинающиеся с #, пропускаются. Загрузчик
не поддерживает произвольное экранирование или многострочные значения.

### Подключение к Clash of Clans API

APIClient конкатенирует выбранный базовый URL с endpoint'ом и отправляет:

```
Authorization: Bearer <SUPERCELL_TOKEN>
Accept: Application/json
```

Таймаут HTTP-запроса — 20 секунд. Для прямого соединения TLS проверяется; для выбранного туннельного URL проверка TLS
отключена, поскольку туннель использует локальный HTTPS endpoint.

Используемые endpoint'ы:

| Метод | Endpoint | Результат |
| --- | --- | --- |
| GET | /clans/{tag} | CompleteClanData |
| GET | /clans/{tag}/capitalraidseasons?limit=1 | последнее доступное событие рейдов |
| GET | /clans/{tag}/currentwar | текущая обычная война |
| GET | /clans/{tag}/currentwar/leaguegroup | текущий сезон и раунды CWL |
| GET | /clanwarleagues/wars/{tag} | детали отдельного раунда CWL |

APIClient преобразует HTTP-ошибки в ApiException: сеть, 404, rate limit 429, доступ 403, некорректный JSON и
неожиданный ответ. Сервисы отдельно обрабатывают отсутствие активной войны или лиги.

## Запуск приложения

src/main.cpp выполняет следующие шаги:

1. настраивает цветной console sink и rotating file sink logs/bot.log (5 МБ, 3 файла);
2. регистрирует обработчики SIGINT и SIGTERM;
3. определяет путь к конфигурации: аргумент командной строки или ../config.json;
4. загружает .env из каталога конфигурации, если файл существует;
5. валидирует JSON-настройки и обязательные токены;
6. открывает SQLite и включает foreign_keys, WAL и synchronous = NORMAL;
7. создаёт MigratorManager и применяет миграции;
8. создаёт API-клиенты, репозитории, форматтеры, NotificationService и EventDispatcher;
9. запускает поток синхронизации ClanManager;
10. запускает поток TelegramBotService;
11. ждёт сигнал остановки и последовательно останавливает оба потока.

Остановка через stop() и stopLoop() будит условные переменные, поэтому приложение не обязано ждать окончания
15-минутного интервала. Уже выполняющийся сетевой запрос завершается отдельно, с учётом своего таймаута.

## Слои проекта

### Domain models

Доменные модели находятся в include/models и src/models. Они преобразуют JSON API в типизированные структуры:

- Clan, Player, ClanSnapshot, PlayerSnapshot;
- Clanwar, ClanwarClan, ClanwarMember, ClanwarAttack;
- ClanwarsLeagueSeason, ClanwarsLeagueMember;
- ClanRaid, PlayerRaidSnapshot;
- агрегаты CompleteClanData, CompleteClanwarData, CompleteClanwarsLeagueData, CompleteRaidData;
- структуры отчётов и результатов сравнительной аналитики.

Время API приводится к Unix timestamp. При выводе в Telegram utils::formatUnixToLocalDateTime отображает время в
московском часовом поясе UTC+3.

### API layer

APIClient отвечает за HTTP-запросы к Clash of Clans API и не знает о SQLite, Telegram-подписках или форматировании
сообщений. TelegramApiClient отдельно инкапсулирует вызовы sendMessage, editMessageText, answerCallbackQuery,
getChatMember и getUpdates.

### Service layer

Все фоновые сервисы реализуют ISyncService:

| Сервис | Данные | События |
| --- | --- | --- |
| ClanInfoService | клан, игроки, snapshots, членство | вход, выход, изменение роли |
| ClanwarService | текущая обычная война, стороны, участники, атаки | reminders, завершение войны |
| RaidService | последний рейд и snapshots участников | reminders, завершение рейда |
| ClanwarLeagueService | сезон CWL, участники и найденные раунды | reminders, завершение раунда |

Каждый сервис делает одну транзакцию записи. ClanwarService и ClanwarLeagueService возвращают успешный пустой
результат, если для обработки пока нет активной войны или раунда. RaidService считает отсутствие доступного рейда
ошибкой синхронизации, чтобы сработал retry. Ошибка получения данных или записи возвращается как SyncResult::error.

### ClanManager

ClanManager координирует сервисы и не содержит SQL-запросов конкретных предметных областей:

1. перед каждым циклом вызывает ClansRepo::getTrackedClans();
2. для каждого тега запускает сервисы в порядке, заданном main.cpp;
3. повторяет неуспешный сервис до трёх раз, с паузами 2 и 4 секунды;
4. после успешного результата передаёт его события в EventDispatcher;
5. после каждой пары «клан + сервис» переходит к следующей;
6. после полного цикла ждёт 15 минут.

Статус сбоя хранится в памяти по ключу serviceName + "_" + clanTag. Предупреждение о сбое отправляется один раз до
восстановления; успешный результат сбрасывает счётчик и разрешает новое предупреждение в будущем. Если не удалось
загрузить список кланов из БД, менеджер пишет ошибку и повторяет попытку через 30 секунд.

### Repository layer

Репозитории скрывают SQL и преобразование sqlite3_stmt в доменные структуры:

- ClansRepo — кланы, игроки, snapshots и история членства;
- ClanwarRepo — войны, стороны, участники, атаки и выборки для отчётов;
- ClanwarsLeagueRepo — сезоны CWL и зарегистрированные участники;
- RaidRepo — рейды, snapshots участников и сравнительные выборки;
- SubscriptionRepo — Telegram-назначения и подписки;
- NotificationRepo — журнал дедупликации сообщений.

Сервисы и Telegram-бот получают репозитории через ссылки и не формируют SQL самостоятельно.

### Database layer

Database открывает один SQLite connection и создаёт экземпляры всех репозиториев. При открытии включаются:

```
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

Транзакции сервисов и Telegram-команд используют TransactionManager и RAII-объект TransactionGuard. Конструктор guard
выполняет BEGIN TRANSACTION; явный commit() завершает транзакцию, а деструктор выполняет ROLLBACK, если commit не был
вызван.

## Миграции

MigratorManager:

1. создаёт таблицу schema_migrations;
2. находит все файлы с расширением .sql в каталоге конфигурации;
3. сортирует их лексикографически по имени;
4. пропускает версии, уже записанные в schema_migrations;
5. выполняет каждый новый файл и записывает имя файла как version;
6. возвращает false при ошибке, после чего запуск приложения прекращается.

Текущая последовательность:

| Версия | Назначение |
| --- | --- |
| 001_initial_schema.sql | первоначальная схема |
| 002_war_schema_v1_to_v2.sql | новая схема войн и CWL |
| 003_clan_info_schema_v1_to_v2.sql | кланы, игроки, членство и snapshots |
| 004_raid_schema_v1_to_v2.sql | рейды и snapshots участников |
| 005_notifications_schema_v1_to_v2.sql | Telegram-чаты, подписки и уведомления |
| 006_telegram_topics.sql | message_thread_id для forum topics |
| 007_subscription_audience.sql | аудитории players и management |
| 008_clan_tracking.sql | флаг clans.tracking_enabled |

Миграции не переписываются после применения. Изменение схемы добавляется новым SQL-файлом с большим префиксом.

## Domain events

Тип ApplicationEvent — это std::variant из десяти типов:

| Событие | Кто создаёт | Назначение |
| --- | --- | --- |
| PlayerJoinedClanEvent | ClanInfoService | уведомление о входе |
| PlayerLeftClanEvent | ClanInfoService | уведомление о выходе |
| PlayerRoleChangedEvent | ClanInfoService | уведомление об изменении роли |
| WarEndedEvent | ClanwarService | итоговые отчёты войны |
| ClanwarsLeagueRoundEndedEvent | ClanwarLeagueService | отчёты раунда CWL |
| RaidsEndedEvent | RaidService | итоговые отчёты рейда |
| WarReminderEvent | ClanwarService, ClanwarLeagueService | три контрольные точки войны |
| RaidReminderEvent | RaidService | пять контрольных точек рейда |
| SyncFailureEvent | ClanManager | системная ошибка синхронизации |
| SyncRecoveryEvent | ClanManager | восстановление после ошибки |

Сервисы формируют события после записи данных, а EventDispatcher последовательно вызывает NotificationService. Отдельной
очереди, брокера или повторной доставки событий нет.

## Контрольные точки

Для обычной войны и каждого раунда CWL:

- начало, когда now >= startTime и now < endTime;
- шесть часов до окончания;
- один час до окончания.

Для рейдового выходного:

- начало;
- 48 часов до окончания;
- 24 часа до окончания;
- шесть часов до окончания;
- один час до окончания.

Проверка выполняется на каждом цикле. Пока контрольное окно открыто, одно и то же событие может генерироваться снова,
но дедупликация перед отправкой не даёт повторить его одному назначению.

## Reporting and notification layer

Слой отчётов разделён на форматтеры и доставку:

- форматтер получает событие, при необходимости читает дополнительные данные из репозиториев и возвращает HTML-текст;
- NotificationService выбирает форматтер, аудиторию и список Telegram-назначений;
- TelegramNotifier передаёт готовый текст в TelegramApiClient;
- TelegramBotService работает параллельно и обрабатывает пользовательские команды, не участвуя в фоновой синхронизации.

Отображение аудиторий:

- players — изменения состава и ролей, итоговые отчёты, сравнения и напоминания;
- management — нарушения, надёжность состава, сбои и восстановление синхронизации.

Подробная матрица событий и форматов находится в [reports.md](reports.md).

## TelegramBotService

TelegramBotService использует long polling с timeout = 2 секунды. После ошибки API ждёт одну секунду и продолжает работу.
Обрабатываются только обновления message и callback_query.

Поддерживаются:

- /start без аргументов;
- /link и /unlink с одним тегом клана;
- callback-навигация меню гайдов;
- просмотр подписанных кланов;
- отключение текущей подписки через кнопку.

Команда подключения в одной транзакции создаёт минимальную запись клана, сохраняет Telegram-назначение и подписку.
После удаления последней подписки назначения оно удаляется; после удаления последней подписки клана его
tracking_enabled устанавливается в 0. История клана при этом остаётся.

Каталог AttackGuideCatalog загружается один раз при старте. Обязательные поля записи описаны в [telegram.md](telegram.md).

## Идемпотентность

NotificationService использует NotificationRepo для:

- завершённых войн, CWL-раундов и рейдов;
- сравнительных и управленческих отчётов, создаваемых из этих событий;
- всех временных напоминаний.

Ключ таблицы состоит из event_type, event_id, chat_id и message_thread_id. audience в ключ не входит, но разные отчёты
используют разные event_type.

Изменения состава, изменение роли, SyncFailureEvent и SyncRecoveryEvent отправляются без проверки notifications. Если
Telegram недоступен, событие не ставится в отдельную очередь и может быть потеряно после перехода к следующему состоянию
базы.

## Логирование и ошибки

Логи пишутся с уровня info; более подробная диагностика некоторых компонентов использует debug. Ошибки внешнего API,
SQLite, JSON, Telegram и синхронизации включают имя компонента и предметный контекст.

Основные исключения:

- DatabaseException — ошибки SQLite и миграций;
- ApiException — сеть, HTTP-ответ, Telegram или некорректный JSON;
- ClashBotException — общий базовый тип.

Ошибка запуска приводит к коду EXIT_FAILURE. Ошибка одного сервиса не останавливает остальные сервисы в текущем
цикле; ошибка потока синхронизации или необработанный критический сбой переводит приложение в остановку.

## Сборка и контейнер

CMakeLists.txt собирает библиотеку ClashBotCore, приложение и два тестовых executable. Зависимости приложения поставляются
vcpkg manifest mode, а GoogleTest подключается через FetchContent.

Dockerfile использует два этапа:

1. builder на Ubuntu 24.04 устанавливает vcpkg, собирает зависимости, проект и запускает ctest;
2. runtime на Ubuntu 24.04 содержит ClashBot, /app/migrations и /app/resources.

Runtime-контейнер запускается с аргументом config.json; файл обычно монтируется с хоста как read-only, а /app/data и
/app/logs — как постоянные тома.

## Ограничения архитектуры

- события не персистентны и не гарантируют повторную доставку;
- расписание синхронизации и контрольные точки заданы в коде;
- настройки уведомлений не разделяются по отдельным типам отчётов;
- Telegram-интерфейс не показывает произвольную аналитику и не является REST API;
- один SQLite connection используется всеми компонентами приложения, поэтому длительные внешние операции внутри
  транзакции следует избегать при дальнейших изменениях.
