# ClashBot

ClashBot — фоновый сервис на C++20 для мониторинга кланов Clash of Clans. Он получает данные из официального API
Clash of Clans, сохраняет текущее состояние и историю в SQLite, формирует отчёты и отправляет их в Telegram.

Сервис поддерживает несколько кланов, несколько Telegram-чатов и форумных тем. Список отслеживаемых кланов и подписки
хранятся в базе данных, поэтому добавление клана не требует изменения конфигурации или перезапуска приложения.

Проект находится в активной разработке. Доступные возможности и ограничения перечислены ниже и в
[`docs/roadmap.md`](docs/roadmap.md).

## Что умеет сервис

- собирает информацию о клане и периодические снимки состава и характеристик игроков;
- фиксирует вступления, выходы и изменения ролей игроков;
- сохраняет текущие войны, раунды CWL и рейдовые выходные вместе с атаками и участниками;
- отправляет отчёты о завершённых войнах, раундах CWL и рейдах;
- отправляет сравнительную динамику обычных войн и рейдов;
- формирует управленческие отчёты о пропусках атак, атаках не по зеркалу и надёжности состава;
- отправляет напоминания о начале и приближении окончания войн, раундов CWL и рейдовых выходных;
- разделяет назначения на аудитории `players` и `management`;
- поддерживает Telegram-меню видео-гайдов для ратуш TH7–TH18;
- применяет SQL-миграции автоматически при запуске;
- повторно использует SQLite WAL и транзакции для согласованной записи данных.

Отчёты и напоминания отправляются только в назначения, подписанные на соответствующий клан и аудиторию.

## Как работает цикл

При запуске приложение открывает SQLite, применяет неприменённые миграции, загружает каталог гайдов и запускает два
фоновых потока:

1. `ClanManager` перечитывает из базы отслеживаемые кланы.
2. Для каждого клана последовательно запускаются `ClanInfoService`, `ClanwarService`, `RaidService` и
   `ClanwarLeagueService`.
3. Каждый сервис получает данные через `APIClient`, сохраняет их одной транзакцией и возвращает `SyncResult` с
   доменными событиями.
4. `EventDispatcher` сразу после успешного сервиса передаёт события в `NotificationService`.
5. `NotificationService` строит сообщения форматтерами и отправляет их в Telegram через `TelegramNotifier`.
6. После цикла синхронизации менеджер ждёт 15 минут. При остановке ожидание прерывается сразу.

Для каждого сервиса и клана предусмотрены три попытки синхронизации с паузами 2 и 4 секунды. После неудачного цикла
управленческой аудитории отправляется одно предупреждение о сбое; после успешной синхронизации отправляется сообщение о
восстановлении. Напоминания вычисляются во время синхронизации, поэтому их доставка может быть отложена примерно до
длительности цикла.

## Структура репозитория

``` text
include/                 публичные заголовки компонентов
src/                     реализация приложения
src/database/migrations  последовательные SQL-миграции
tests/                    unit- и integration-тесты
resources/telegram/      JSON-каталог видео-гайдов
docs/                    архитектура, БД, отчёты, Telegram и roadmap
research/                исследовательские материалы, не необходимые для запуска
scripts/                 вспомогательные скрипты Docker-деплоя и SSH-туннеля
CMakeLists.txt           цели сборки и зависимости
Dockerfile               multi-stage Docker-сборка
vcpkg.json               manifest-зависимости vcpkg
```

Основные цели CMake:

- `ClashBotCore` — статическая библиотека доменных моделей, репозиториев, аналитики, форматтеров и Telegram-утилит;
- `ClashBot` — исполняемое приложение;
- `ClashBotTests` — unit-тесты;
- `ClashBotIntegrationTests` — интеграционные тесты сервисов, миграций, уведомлений и Telegram-бота.

Подробная карта компонентов находится в [`docs/architecture.md`](docs/architecture.md).

## Требования

### Для локальной разработки на Windows

- Windows x64 и MSVC с поддержкой C++20;
- CMake 3.24 или новее;
- Ninja или другой генератор CMake;
- Git;
- vcpkg с доступным toolchain-файлом.

Зависимости из `vcpkg.json`: `cpr`, `fmt`, `spdlog`, `nlohmann-json`, `sqlite3`. GoogleTest загружается CMake через
`FetchContent`, поэтому первая конфигурация требует доступа к исходному архиву GoogleTest и пакетному реестру vcpkg.

### Для Docker

Dockerfile собирает и тестирует проект в Ubuntu 24.04, затем копирует в runtime-образ только бинарник, миграции и
ресурсы. База и логи должны монтироваться с хоста.

## Конфигурация и секреты

Создайте в рабочем каталоге файл `config.json`. Секреты в него не записываются:

``` json
{
  "api": {
    "use_tunnel": false,
    "tunnel_base_url": "https://localhost:8080/v1",
    "base_url": "https://api.clashofclans.com/v1"
  },
  "database": {
    "path": "data/database.sqlite",
    "migrations_path": "src/database/migrations"
  },
  "telegram": {
    "attack_guides_path": "resources/telegram/attack_guides.json"
  }
}
```

Пути из JSON разрешаются относительно текущего рабочего каталога процесса. Для Docker используйте абсолютные пути:

``` json
{
  "api": {
    "use_tunnel": false,
    "tunnel_base_url": "https://localhost:8080/v1",
    "base_url": "https://api.clashofclans.com/v1"
  },
  "database": {
    "path": "/app/data/database.sqlite",
    "migrations_path": "/app/migrations"
  },
  "telegram": {
    "attack_guides_path": "/app/resources/telegram/attack_guides.json"
  }
}
```

Рядом с переданным `config.json` можно создать `.env`:

``` env
SUPERCELL_TOKEN=<CLASH_OF_CLANS_API_TOKEN>
TELEGRAM_TOKEN=<TELEGRAM_BOT_TOKEN>
```

Приложение загружает `.env` только если файл существует. Уже заданные переменные окружения имеют приоритет: загрузчик
не перезаписывает их. Не добавляйте `.env`, реальные токены, локальную базу или `config.json` с окруженческими путями
в Git.

`api.use_tunnel` выбирает URL для запросов Clash of Clans API:

- `false` — `base_url`, TLS-проверка включена;
- `true` — `tunnel_base_url`, TLS-проверка отключена для локального HTTPS-туннеля.

Официальный API получает токен в заголовке `Authorization: Bearer SUPERCELL_TOKEN`. Приложение использует следующие
endpoint'ы: `/clans/{tag}`, `/clans/{tag}/capitalraidseasons?limit=1`, `/clans/{tag}/currentwar`,
`/clans/{tag}/currentwar/leaguegroup` и `/clanwarleagues/wars/{tag}`.

Подробные правила конфигурации и жизненный цикл базы описаны в [`docs/architecture.md`](docs/architecture.md) и
[`docs/database.md`](docs/database.md).

## Telegram

Telegram используется для доставки уведомлений и для входящего интерактивного меню. Бот получает обновления методом
`getUpdates` в long polling с таймаутом 2 секунды.

Команды:

``` text
/start
/link #CLAN_TAG
/unlink #CLAN_TAG
```

Тег принимается с `#` или без него, нормализуется к верхнему регистру и должен содержать от 3 до 15 символов из
алфавита Clash of Clans `0289PYLQGRJCUV`.

В личном чате `/link` создаёт подписку `management`. В `group` или `supergroup` создаётся подписка `players`, но
управлять подключением могут только администратор или создатель группы; бот должен иметь возможность вызвать
`getChatMember`. В форумной теме сохраняется пара `(chat_id, message_thread_id)`, поэтому уведомления приходят в ту же
тему.

`/start` открывает меню с разделами:

- `🎥 Гайды по атакам` — ратуша TH7–TH18 → стратегия → гайд → YouTube-ссылка;
- `🔗 Подключить клан` — инструкция `/link`;
- `📋 Мои кланы` — подписки текущего чата, темы и аудитории;
- `❌ Отключить клан` — удаление выбранной подписки;
- `❓ Помощь` — команды и правила доступа.

Кнопки каталога работают через callback-запросы и редактируют сообщение меню. Каталог читается при старте из
`telegram.attack_guides_path`; его формат описан в [`docs/telegram.md`](docs/telegram.md).

## Локальная сборка и запуск

Из корня проекта подготовьте vcpkg:

``` powershell
$env:VCPKG_ROOT = "C:\path\to\vcpkg"
New-Item -ItemType Directory -Force data, logs
```

Сконфигурируйте и соберите Debug-вариант:

``` powershell
cmake -S . -B cmake-build-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug -DVCPKG_TARGET_TRIPLET=x64-windows -DCMAKE_TOOLCHAIN_FILE="$env:VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake"
cmake --build cmake-build-debug
```

Запустите все тесты, зарегистрированные CTest:

``` powershell
ctest --test-dir cmake-build-debug --output-on-failure
```

В состав тестов входят unit-тесты моделей, аналитики, форматтеров и Telegram-компонентов, а также интеграционные тесты
SQLite, миграций, сервисов синхронизации, уведомлений и Telegram-бота. Тесты используют фиктивные API-клиенты и не
требуют настоящих токенов.

Запуск приложения из корня проекта:

``` powershell
.\cmake-build-debug\ClashBot.exe .\config.json
```

По умолчанию лог пишется в `logs/bot.log` и дублируется в консоль. Используется ротация файла при размере 5 МБ с
хранением трёх файлов. Для отладки запускайте приложение с отдельной базой и тестовыми непустыми токенами; реальные
сетевые запросы не выполняются, пока в базе нет отслеживаемых кланов.

### SSH-туннель

Туннель нужен только при `use_tunnel: true`. Скрипт [`scripts/startTunnel.sh`](scripts/startTunnel.sh) рассчитан на
WSL/Linux и содержит окруженческие значения удалённого сервера, которые перед использованием нужно заменить. Он
пробрасывает локальный порт `8080` к `api.clashofclans.com:443`; пример URL в конфигурации —
`https://localhost:8080/v1`.

## Docker-развёртывание

Соберите образ на машине, где доступен Docker:

```powershell
docker build -t clashbot:latest .
docker save -o clashbot.tar clashbot:latest
```

На сервере подготовьте каталог и файлы `config.json` и `.env`, затем загрузите образ:

``` bash
mkdir -p ~/clashbot/data ~/clashbot/logs
docker load -i ~/clashbot/clashbot.tar
```

Пример запуска:

``` bash
docker run -d \
  --name clashbot \
  --restart unless-stopped \
  --env-file "$HOME/clashbot/.env" \
  -v "$HOME/clashbot/config.json:/app/config.json:ro" \
  -v "$HOME/clashbot/data:/app/data" \
  -v "$HOME/clashbot/logs:/app/logs" \
  clashbot:latest
```

В образе уже находятся бинарник `/app/ClashBot`, миграции `/app/migrations` и каталог `/app/resources`. При запуске
миграции применяются автоматически. Конфигурация монтируется только для чтения, а `data` и `logs` остаются на хосте.

Проверка контейнера:

``` bash
docker ps
docker logs -f clashbot
```

Скрипт [`scripts/deployProject.sh`](scripts/deployProject.sh) автоматизирует похожий сценарий, но сейчас содержит
жёстко заданные локальный путь проекта, SSH-сервер и удалённый каталог. Перед использованием отредактируйте эти
значения и подготовьте `.env` на сервере.

## Ручное администрирование SQLite

Обычный способ подключения — команда `/link`. Ручная работа с SQLite нужна для диагностики, восстановления или массовой
настройки. Перед изменениями остановите приложение, сделайте резервную копию базы и учитывайте, что SQLite работает в
режиме WAL.

Текущая схема использует таблицы `clans`, `players`, `clan_memberships`, `clan_snapshots`, `player_snapshots`, `wars`,
`war_clans`, `war_members`, `attacks`, `cwl_seasons`, `cwl_season_members`, `clan_raids`,
`player_raid_snapshots`, `telegram_chats`, `clan_subscriptions`, `notifications` и `schema_migrations`.

Минимальный пример ручной подписки:

``` sql
INSERT INTO clans (tag, name)
VALUES ('#CLAN_TAG', 'Clan name');

INSERT INTO telegram_chats (chat_id, message_thread_id, title)
VALUES (-1000000000000, 0, 'Telegram group');

INSERT INTO clan_subscriptions
    (clan_tag, chat_id, message_thread_id, audience)
VALUES ('#CLAN_TAG', -1000000000000, 0, 'players');
```

Для forum topic укажите её `message_thread_id` вместо `0`. Допустимы только аудитории `players` и `management`. Если
последняя подписка клана удалена, `tracking_enabled` становится `0`; исторические данные при этом не удаляются.

Полное описание внешних ключей, индексов, миграций и дедупликации находится в [`docs/database.md`](docs/database.md).

## Ограничения текущей версии

- синхронизация и напоминания работают с фиксированным циклом 15 минут;
- Telegram поддерживает `/start`, `/link`, `/unlink`, меню гайдов и список подключённых кланов, но не команды просмотра
  произвольной статистики;
- подписки разделяются только на `players` и `management`, отдельные настройки категорий отчётов не реализованы;
- события вступления, выхода, изменения роли и сбоя/восстановления не дедуплицируются таблицей `notifications`;
- события существуют только в памяти текущего цикла и не записываются в отдельный event log;
- отчёты используют не все поля, которые собираются из API;
- критерии нарушений и расписание напоминаний не настраиваются для отдельного клана;
- API и Telegram должны быть доступны приложению на выход. Сам сервис не предоставляет веб-панель или публичный REST API.

## Документация

- [Архитектура и жизненный цикл](docs/architecture.md)
- [Схема SQLite и миграции](docs/database.md)
- [События и отчёты](docs/reports.md)
- [Telegram-интеграция](docs/telegram.md)
- [Текущее состояние и roadmap](docs/roadmap.md)

## Правовая информация

This material is unofficial and is not endorsed by Supercell. For more information see
[Supercell's Fan Content Policy](https://supercell.com/en/fan-content-policy/).
