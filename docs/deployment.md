# Развёртывание и эксплуатация ClashBot

Руководство описывает требования к хосту, устройство Docker-сборки, CI/CD-публикацию в GHCR, настройку сервера, резервное копирование SQLite и локальный запуск через SSH-туннель.

## 1. Требования к серверу

- **ОС**: `Ubuntu 24.04 LTS`;
- **Ресурсы**: от 1 vCPU, 1–2 ГБ RAM;
- **Сеть**: статический IPv4 (указывается в ключе Clash of Clans API);
- **Пакеты на хосте**: Docker Engine с плагином `docker compose`, `sqlite3`, `gzip`, `rclone`, `openssh-server`.

Установка утилит резервного копирования на Ubuntu 24.04:

```bash
sudo apt-get update
sudo apt-get install -y sqlite3 gzip rclone
```

## 2. Docker-образ и Compose-конфигурация

### Сборка образа ([`Dockerfile`](../Dockerfile))

Multi-stage сборка на базе `node:24-slim` (контекст ограничен белым списком в [`.dockerignore`](../.dockerignore)):

| Этап | База | Что выполняется |
| --- | --- | --- |
| `builder` | `node:24-slim` | Ставит `python3`, `make`, `g++`, `ca-certificates` (для нативного `better-sqlite3`) и `pnpm@12.21.0`; выполняет `pnpm install --frozen-lockfile`, `pnpm build` и `pnpm prune --prod` |
| `runtime` | `node:24-slim` | `NODE_ENV=production`, `WORKDIR /app`; копирует `package.json`, production `node_modules`, `dist/`, `migrations/`, `resources/telegram/attack_guides.json`; создаёт `/app/data` с владельцем `node:node` и переключается на `USER node` (UID/GID `1000:1000`); `ENTRYPOINT ["node", "dist/cli.js"]`, `CMD ["config.json"]` |

> **Права контейнера:** процесс внутри контейнера работает от непривилегированного встроенного пользователя `node` (UID/GID `1000:1000`). Каталог `./data` на хосте должен быть доступен на запись для `1000:1000`, а `./config.json` — на чтение (`644`).

### Сервис в [`docker-compose.yml`](../docker-compose.yml)

| Параметр | Значение | Назначение |
| --- | --- | --- |
| `image` | `ghcr.io/flacicz/clashbot:${CLASHBOT_IMAGE_TAG:-latest}` | Образ из GHCR с переопределением тега через `.env` |
| `restart` | `unless-stopped` | Автоперезапуск при сбое и перезагрузке хоста |
| `stop_grace_period` | `30s` | Внешний таймаут Compose; внутри приложения `ShutdownCoordinator` завершает циклы за `15s` |
| `env_file` | `.env` | Токены и переменные окружения |
| `volumes` | `./config.json:/app/config.json:ro`, `./data:/app/data` | Конфигурация (read-only) и персистентная SQLite БД |
| `logging` | `json-file` (`max-size: 10m`, `max-file: 3`) | Ротация JSON-логов `pino` из `stdout` силами Docker |

## 3. CI/CD и публикация в GHCR

[Workflow `.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) запускается на `ubuntu-24.04` при `pull_request` и `push` в `main` (а также вручную через `workflow_dispatch`):

1. **`diff-hygiene`**: проверяет `git diff --check` (пробелы, окончания строк, маркеры конфликтов).
2. **`ts-checks`**: на Node.js 24 и `pnpm` выполняет `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`.
3. **`ts-docker`**: собирает образ (`docker build -t clashbot-ts:ci .`) и прогоняет smoke-тест контейнера:
   - поднимает локальную TCP-заглушку для `api.telegram.org:443` (`--network host`, `--add-host api.telegram.org:127.0.0.1`) с тестовыми токенами и временными `config.json` и `data/`;
   - ждёт в логах `[Main] Bot is running`, проверяет запуск процесса от непривилегированного пользователя (`id -u` == `1000`), отправляет `docker stop -t 15` и проверяет остановку за `<= 15` секунд с `ExitCode=0`;
   - проверяет пустой `stderr`, валидный JSON `pino` в `stdout`, наличие маркеров старта, миграций и остановки, отсутствие утечки токенов;
   - проверяет на созданной БД `PRAGMA integrity_check` (`ok`) и 13 применённых миграций (`013_*`).
4. **`publish`** (только на `push` в `main` репозитория `Flacicz/ClashBot` после успеха всех проверок): публикует проверенный образ в `ghcr.io/flacicz/clashbot` с двумя тегами — `sha-<7chars>` и `latest`.

Локальная проверка Docker-сборки:

```bash
docker build -t clashbot:local .
```

### Доступ сервера к GHCR

- **Публичный пакет** (рекомендуется, так как образ не содержит секретов): `docker compose pull` работает без авторизации.
- **Приватный пакет**: выполните однократный вход с Personal Access Token (`read:packages`):

```bash
echo "<GHCR_READ_PACKAGES_PAT>" | docker login ghcr.io -u <github-username> --password-stdin
```

## 4. Подготовка каталога, конфигурации и запуск на сервере

Рекомендуемый каталог развёртывания — `/opt/clashbot` (или `~/clashbot`):

```bash
mkdir -p /opt/clashbot/data /opt/clashbot/backups /opt/clashbot/scripts
cd /opt/clashbot
```

Скопируйте из репозитория файлы:

- [`docker-compose.yml`](../docker-compose.yml)
- [`config.example.json`](../config.example.json) → `config.json`
- [`.env.example`](../.env.example) → `.env`
- [`scripts/backup-sqlite.sh`](../scripts/backup-sqlite.sh) → `scripts/backup-sqlite.sh`

Выдайте права (контейнер работает от `USER node` с UID/GID `1000:1000`):

```bash
chmod +x scripts/backup-sqlite.sh
chmod 600 .env
chmod 644 config.json
sudo chown -R 1000:1000 /opt/clashbot/data
```

Заполните `.env` в формате `KEY=value` без кавычек и с окончаниями строк LF:

```env
SUPERCELL_TOKEN=<CLASH_OF_CLANS_API_TOKEN>
TELEGRAM_TOKEN=<TELEGRAM_BOT_TOKEN>
# Необязательно для фиксации версии или отката:
# CLASHBOT_IMAGE_TAG=sha-0123456
```

Полный справочник ключей `config.json`, значений по умолчанию и правил валидации `configSchema.ts` находится в [`docs/architecture.md`](architecture.md). На сервере для Compose-контейнера шаблон [`config.example.json`](../config.example.json) уже настроен на внутренние пути `/app/data/database.sqlite`, `/app/migrations`, `/app/resources/telegram/attack_guides.json` и `"use_tunnel": false`.

### Запуск, логи и обновление

Первый запуск и проверка:

```bash
cd /opt/clashbot
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f clashbot
```

При пустом `./data` приложение создаёт `data/database.sqlite` и применяет SQL-миграции из `/app/migrations` внутри контейнера. `pino` пишет структурированный JSON в `stdout`; сообщения в Telegram форматируют даты в `UTC+3`.

Штатное обновление:

```bash
cd /opt/clashbot
./scripts/backup-sqlite.sh --local-only
docker compose pull
docker compose up -d
```

> **Одноразовая миграция прав при обновлении со старого образа (где контейнер работал от `root`):** чтобы `better-sqlite3` не получил ошибку `SQLITE_READONLY` на существующей базе, остановите контейнер, передайте владельца каталога `./data` пользователю `1000:1000` и запустите контейнер снова:
>
> ```bash
> cd /opt/clashbot
> docker compose stop clashbot
> sudo chown -R 1000:1000 ./data
> docker compose pull
> docker compose up -d
> ```

Откат на предыдущую сборку (при неизменной схеме БД): задайте `CLASHBOT_IMAGE_TAG=sha-<short>` в `.env` (или перед командой) и выполните `docker compose pull && docker compose up -d`. Если более новая версия уже применила несовместимую миграцию, дополнительно восстановите предрелизный снимок БД по процедуре Recovery Drill.

## 5. Резервное копирование SQLite (`scripts/backup-sqlite.sh`)

ClashBot работает с SQLite в режиме `WAL` (`PRAGMA journal_mode = WAL`), поэтому прямое копирование `database.sqlite` во время работы контейнера может дать несогласованный файл без изменений из `-wal`.

Скрипт [`scripts/backup-sqlite.sh`](../scripts/backup-sqlite.sh):

1. защищается от параллельного запуска через `flock -n` (`$BACKUP_DIR/.backup.lock`);
2. снимает онлайн-снимок без остановки контейнера через `sqlite3 -cmd ".timeout 5000" "$DB_PATH" ".backup ..."`;
3. проверяет снимок командой `PRAGMA integrity_check;` (требуется `ok`);
4. сжимает снимок через `gzip` и проверяет архив `gzip -t`;
5. при запуске без `--local-only` выгружает архив через `rclone copy` в `$RCLONE_REMOTE`;
6. хранит локально `RETENTION_COUNT` (по умолчанию `14`) самых свежих архивов `clashbot_YYYYMMDD_HHMMSS.sqlite.gz`.

Переменные окружения и флаги скрипта:

| Параметр | По умолчанию | Описание |
| --- | --- | --- |
| `--local-only` | `false` | Пропустить выгрузку в `rclone` |
| `DB_PATH` | `./data/database.sqlite` | Путь к исходной БД SQLite |
| `BACKUP_DIR` | `./backups` | Каталог локальных архивов |
| `RETENTION_COUNT` | `14` | Число сохраняемых локальных архивов |
| `RCLONE_REMOTE` | — | Удалённый путь `rclone` (обязателен без `--local-only`) |

Настройка `rclone` и тестовый прогон:

```bash
rclone config
cd /opt/clashbot
./scripts/backup-sqlite.sh --local-only
RCLONE_REMOTE="gdrive:clashbot-backups" ./scripts/backup-sqlite.sh
```

Ежедневный запуск через `cron` (настройте в `crontab` пользователя с правами на `/opt/clashbot/data`, например пользователя с UID `1000` или через `sudo crontab -e`):

```cron
0 3 * * * cd /opt/clashbot && DB_PATH=/opt/clashbot/data/database.sqlite BACKUP_DIR=/opt/clashbot/backups RCLONE_REMOTE=gdrive:clashbot-backups /opt/clashbot/scripts/backup-sqlite.sh >> /var/log/clashbot-backup.log 2>&1
```

## 6. Проверка восстановления (Recovery Drill)

Обязательно выполняйте проверку после первичного деплоя и при переносе на новый сервер:

1. Скачайте и проверьте архив:

   ```bash
   rclone copy "gdrive:clashbot-backups/clashbot_20261119_030000.sqlite.gz" /tmp/
   gzip -t /tmp/clashbot_20261119_030000.sqlite.gz
   gunzip -c /tmp/clashbot_20261119_030000.sqlite.gz > /tmp/restored.sqlite
   sqlite3 /tmp/restored.sqlite "PRAGMA integrity_check;"
   ```

   Ожидаемый вывод: `ok`.

2. Остановите контейнер перед заменой БД:

   ```bash
   cd /opt/clashbot
   docker compose stop clashbot
   ```

3. Сохраните текущую БД и **обязательно удалите файлы `-wal` и `-shm`** (иначе SQLite при старте применит старый WAL поверх восстановленного снимка):

   ```bash
   mv data/database.sqlite data/database.sqlite.before-restore
   rm -f data/database.sqlite-wal data/database.sqlite-shm
   cp /tmp/restored.sqlite data/database.sqlite
   sudo chown 1000:1000 data/database.sqlite
   ```

4. Запустите контейнер и проверьте результат:

   ```bash
   docker compose up -d
   docker compose logs -f clashbot
   ```

   Убедитесь, что миграции и запуск прошли без ошибок, а команда `/start` → `📋 Мои кланы` в Telegram возвращает ожидаемые **подписки**. После проверки удалите `/tmp/restored.sqlite` и `data/database.sqlite.before-restore`.

## 7. Локальная разработка, проверки и SSH-туннель

Требования для локальной работы без Docker (см. [`package.json`](../package.json)): Node.js `>=24.0.0`, `pnpm@12.21.0`.

Основные команды из корня репозитория:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
git diff --check
```

Локальный запуск собранного приложения:

```bash
node dist/cli.js config.local.json
# или через скрипт package.json:
pnpm start config.local.json
```

> **Важно:** для локальной отладки используйте **отдельный тестовый `TELEGRAM_TOKEN`** и отдельную локальную SQLite БД. Запуск двух экземпляров с одним `TELEGRAM_TOKEN` ломает long polling `getUpdates`. Файл `.env` автоматически загружается из каталога переданного `config.json` (если переменные ещё не заданы в окружении). Для читаемых логов локально можно задать `LOG_FORMAT=pretty` и `LOG_LEVEL=debug`.

### SSH-туннель к Clash of Clans API

Так как токен Supercell привязан к статическому IP сервера, при локальной разработке трафик можно пробрасывать через VPS:

- **Windows PowerShell**:

  ```powershell
  ssh -N -L 8080:api.clashofclans.com:443 <user>@<vps-ip>
  ```

- **Linux / WSL** ([`scripts/startTunnel.sh`](../scripts/startTunnel.sh)):

  ```bash
  ./scripts/startTunnel.sh <user>@<vps-ip>
  # или через переменную окружения:
  CLASHBOT_SSH_HOST=<user>@<vps-ip> ./scripts/startTunnel.sh
  ```

  Скрипт поддерживает переменные `LOCAL_PORT` (`8080`), `REMOTE_HOST` (`api.clashofclans.com`), `REMOTE_PORT` (`443`) и `TUNNEL_DURATION_SEC` (`3600`).

В локальном `config.json` включите `"use_tunnel": true` и укажите `"tunnel_base_url": "https://localhost:8080/v1"` (при локальном запуске внутри Docker используйте `https://host.docker.internal:8080/v1`). При `use_tunnel: true` `CocApiClient` отключает проверку TLS только в изолированном `undici` `Agent` для запросов к CoC API.
