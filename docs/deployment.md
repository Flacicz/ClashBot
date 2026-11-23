# Развёртывание и эксплуатация на сервере

Руководство описывает запуск ClashBot на VPS через готовый Docker-образ из GitHub Container Registry (GHCR), обновление через Docker Compose, ежедневное резервное копирование SQLite и проверку восстановления.

## Требования к серверу

- ОС: `Ubuntu 24.04 LTS`;
- ресурсы: от 1 vCPU, 1–2 ГБ RAM;
- сеть: статический IPv4 (указывается в настройках ключа Clash of Clans API);
- пакеты на хосте: Docker Engine с плагином `docker compose`, `sqlite3`, `gzip`, `rclone`, `openssh-server`.

Установка вспомогательных утилит для бэкапов на Ubuntu 24.04:

```bash
sudo apt-get update
sudo apt-get install -y sqlite3 gzip rclone
```

## Подготовка каталога и конфигурации

Рекомендуемый каталог развёртывания на сервере — `/opt/clashbot` (или `~/clashbot`):

```bash
mkdir -p /opt/clashbot/data /opt/clashbot/backups /opt/clashbot/scripts
cd /opt/clashbot
```

Скопируйте из репозитория (или скачайте через `curl`) файлы:

- `docker-compose.yml`
- `config.example.json` → `config.json`
- `.env.example` → `.env`
- `scripts/backup-sqlite.sh` → `scripts/backup-sqlite.sh`

Выдайте права на запуск скрипта и ограничьте доступ к секретам:

```bash
chmod +x scripts/backup-sqlite.sh
chmod 600 .env
```

Заполните `.env` без кавычек и с окончаниями строк LF:

```env
SUPERCELL_TOKEN=<CLASH_OF_CLANS_API_TOKEN>
TELEGRAM_TOKEN=<TELEGRAM_BOT_TOKEN>
```

Проверьте `config.json` (значения из `config.example.json` уже настроены под пути внутри контейнера):

```json
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

Базовый URL CoC используется для запросов через `CocApiClient`. Для сервера с разрешённым IP используйте `"use_tunnel": false`.

## Публикация образа и доступ к GHCR

[Workflow](../.github/workflows/docker-publish.yml) запускает проверки TypeScript, unit-, integration- и golden-тесты, а
также сборку и smoke-тест [Docker-образа](../Dockerfile). После успешных проверок на `main` он публикует проверенный образ
`ghcr.io/flacicz/clashbot` с двумя тегами:

- `latest` — последняя успешно опубликованная сборка `main`;
- `sha-<short>` — сборка конкретного коммита для фиксации версии или отката.

### Публичный пакет (рекомендуемый вариант)

В настройках пакета на GitHub (`Package settings → Change visibility → Public`) образ можно сделать публичным — в нём нет секретов, только скомпилированный JavaScript, production-зависимости, миграции и открытый каталог гайдов. В этом случае авторизация на VPS не нужна: `docker compose pull` работает без токена.

### Приватный пакет

Если пакет в GHCR остаётся приватным, создайте Personal Access Token (classic) с правом `read:packages` и выполните вход на сервере один раз:

```bash
echo "<GHCR_READ_PACKAGES_PAT>" | docker login ghcr.io -u <github-username> --password-stdin
```

## Запуск, обновление и откат

Первый запуск из каталога `/opt/clashbot`:

```bash
docker compose pull
docker compose up -d
```

Проверка состояния и логов:

```bash
docker compose ps
docker compose logs -f clashbot
```

При первом запуске с пустым каталогом `./data` приложение создаст `data/database.sqlite` и автоматически применит все SQL-миграции из `/app/migrations` внутри контейнера.

### Логи

Pino пишет JSON в stdout. Логи смотрят командой `docker compose logs clashbot`. Их ротацию задаёт Docker Compose
(три файла до 10 МБ каждый). Сообщения Telegram форматируют время в UTC+3.

### Штатное обновление

```bash
cd /opt/clashbot
docker compose pull
docker compose up -d
```

### Переход с C++ на TypeScript

После публикации TypeScript-образа из `main` обновите `docker-compose.yml`, сохранив действующие `.env`, `config.json`
и каталог `data/`. Новый Compose оставляет `stop_grace_period: 30s` и пишет логи через Docker.
Снимите свежий онлайн-бэкап перед переключением:

```bash
cd /opt/clashbot
./scripts/backup-sqlite.sh --local-only
CLASHBOT_IMAGE_TAG=latest docker compose pull clashbot
CLASHBOT_IMAGE_TAG=latest docker compose up -d clashbot
docker compose logs -f clashbot
```

Убедитесь, что опубликованный образ запустился, миграции прошли и завершился первый цикл синхронизации.
Если в `.env` закреплён C++-тег, после проверки задайте там `CLASHBOT_IMAGE_TAG=latest` или тег проверенной TypeScript-сборки.

### Откат к C++-версии

Точка отката — `ghcr.io/flacicz/clashbot:sha-d10b3f5`. Исходники этого релиза сохранены в git-теге `v1-cpp`.
Тот же файл SQLite совместим с обеими версиями по [ADR-0004](adr/0004-sqlite-drop-in-compatibility.md).
Используйте текущие пути `/app/data/database.sqlite`, `/app/migrations` и `/app/resources/telegram/attack_guides.json`.

```bash
cd /opt/clashbot
CLASHBOT_IMAGE_TAG=sha-d10b3f5 docker compose pull clashbot
CLASHBOT_IMAGE_TAG=sha-d10b3f5 docker compose up -d clashbot
docker compose logs -f clashbot
```

Для сохранения отката при последующих обновлениях закрепите `CLASHBOT_IMAGE_TAG=sha-d10b3f5` в `.env`. Процедура
восстановления снимка нужна при повреждении SQLite или потере данных. Для штатного отката образа используется текущая
база. Результат пробного прогона описан в [тикете #36](https://github.com/Flacicz/ClashBot/issues/36).

## Ежедневный бэкап SQLite и выгрузка в облако

ClashBot работает с SQLite в режиме `WAL` (`PRAGMA journal_mode = WAL`). Простое копирование файла `database.sqlite` во время работы контейнера может дать несогласованный снимок без изменений из `-wal`.

Скрипт [`scripts/backup-sqlite.sh`](../scripts/backup-sqlite.sh):

1. снимает консистентный онлайн-снимок без остановки бота через `sqlite3 -cmd ".timeout 5000" ... ".backup ..."`;
2. проверяет целостность снимка командой `PRAGMA integrity_check;` (ожидается `ok`);
3. сжимает файл через `gzip` и проверяет архив `gzip -t`;
4. выгружает новый архив в облако через `rclone copy` (без удаления существующих облачных копий при локальном сбое);
5. сохраняет на сервере 14 самых свежих архивов `clashbot_YYYYMMDD_HHMMSS.sqlite.gz`, удаляя более старые.

### Настройка rclone и тестовый прогон

Настройте удалённое хранилище интерактивно:

```bash
rclone config
```

Проверьте локальный бэкап (без выгрузки в облако) и полный прогон:

```bash
cd /opt/clashbot
./scripts/backup-sqlite.sh --local-only
RCLONE_REMOTE="gdrive:clashbot-backups" ./scripts/backup-sqlite.sh
```

### Расписание через cron

Откройте `crontab` пользователя с доступом к `/opt/clashbot/data` (если контейнер запускается от `root`, настройте `sudo crontab -e`):

```cron
0 3 * * * cd /opt/clashbot && DB_PATH=/opt/clashbot/data/database.sqlite BACKUP_DIR=/opt/clashbot/backups RCLONE_REMOTE=gdrive:clashbot-backups /opt/clashbot/scripts/backup-sqlite.sh >> /var/log/clashbot-backup.log 2>&1
```

## Проверка восстановления (Recovery Drill)

После первого запуска и при смене сервера обязательно проверьте, что бэкап реально восстанавливается:

1. Выберите нужный архив (локально в `./backups` или скачайте из облака):

   ```bash
   rclone copy "gdrive:clashbot-backups/clashbot_20261119_030000.sqlite.gz" /tmp/
   gzip -t /tmp/clashbot_20261119_030000.sqlite.gz
   gunzip -c /tmp/clashbot_20261119_030000.sqlite.gz > /tmp/restored.sqlite
   sqlite3 /tmp/restored.sqlite "PRAGMA integrity_check;"
   ```

   Вывод должен быть строго `ok`.

2. Остановите контейнер перед заменой файла базы:

   ```bash
   cd /opt/clashbot
   docker compose stop clashbot
   ```

3. Сохраните текущую базу на случай отката и **обязательно удалите старые файлы WAL/SHM** (иначе SQLite при запуске применит старый WAL поверх восстановленной базы):

   ```bash
   mv data/database.sqlite data/database.sqlite.before-restore
   rm -f data/database.sqlite-wal data/database.sqlite-shm
   cp /tmp/restored.sqlite data/database.sqlite
   ```

4. Запустите контейнер и проверьте работу:

   ```bash
   docker compose up -d
   docker compose logs -f clashbot
   ```

   Убедитесь, что в логах нет ошибок миграций и SQLite, а команда `/start` → `📋 Мои кланы` в Telegram возвращает ожидаемые подписки. После проверки удалите `/tmp/restored.sqlite` и `data/database.sqlite.before-restore`.

## Локальный запуск и SSH-туннель

Для локальной отладки используйте **отдельного тестового Telegram-бота** и отдельную локальную базу — запуск двух экземпляров с одним `TELEGRAM_TOKEN` ломает long polling `getUpdates`.

Поскольку ключ Clash of Clans API привязан к статическому IP сервера, локально запросы к CoC API можно пробросить через SSH-туннель на VPS:

- В **Windows PowerShell** (встроенный OpenSSH):

  ```powershell
  ssh -N -L 8080:api.clashofclans.com:443 <user>@<vps-ip>
  ```

- В **Linux / WSL** можно использовать [`scripts/startTunnel.sh`](../scripts/startTunnel.sh):

  ```bash
  ./scripts/startTunnel.sh <user>@<vps-ip>
  # или через переменную окружения:
  CLASHBOT_SSH_HOST=<user>@<vps-ip> ./scripts/startTunnel.sh
  ```

В локальном `config.json` установите `"use_tunnel": true` и `"tunnel_base_url": "https://localhost:8080/v1"`.
