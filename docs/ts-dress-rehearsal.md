# Чеклист пробного прогона (Dress Rehearsal) и отката TypeScript-версии

Руководство описывает безопасный пробный прогон Docker-образа TypeScript-версии (`ts/Dockerfile`) поверх копии продовой базы SQLite перед переключением сервера (cutover, тикет `#36`), а также фиксацию точек отката и процедуру быстрого возврата на C++-версию.

> [!CAUTION]
> Пробный прогон, работу с реальными токенами, продовой базой и VPS выполняет только человек. Никогда не запускайте второй экземпляр бота с продовым `TELEGRAM_TOKEN` (это ломает long polling `getUpdates`) и не монтируйте рабочую БД напрямую.

## 1. Снятие консистентной копии продовой БД

1. На сервере снимите онлайн-бэкап без остановки C++-контейнера (см. [`docs/deployment.md`](deployment.md#ежедневный-бэкап-sqlite-и-выгрузка-в-облако)):

   ```bash
   cd /opt/clashbot
   ./scripts/backup-sqlite.sh --local-only
   ```

2. Скопируйте свежий архив `backups/clashbot_*.sqlite.gz` на локальную машину в изолированный каталог `dress-rehearsal/`:

   ```bash
   mkdir -p dress-rehearsal/data
   gunzip -c clashbot_YYYYMMDD_HHMMSS.sqlite.gz > dress-rehearsal/data/database.sqlite
   ```

3. Проверьте целостность копии, версию схемы и отсутствие посторонних файлов `-wal`/`-shm`:

   ```bash
   rm -f dress-rehearsal/data/database.sqlite-wal dress-rehearsal/data/database.sqlite-shm
   sqlite3 dress-rehearsal/data/database.sqlite "PRAGMA integrity_check;"
   sqlite3 dress-rehearsal/data/database.sqlite "SELECT MAX(version) FROM schema_migrations;"
   ```

   Ожидаемый результат: `ok` и версия схемы `12`.

4. Зафиксируйте исходные счётчики записей для последующей проверки отсутствия дублей:

   ```bash
   sqlite3 dress-rehearsal/data/database.sqlite "
     SELECT 'clans', COUNT(*) FROM clans
     UNION ALL SELECT 'subscriptions', COUNT(*) FROM clan_subscriptions
     UNION ALL SELECT 'domain_events', COUNT(*) FROM domain_events
     UNION ALL SELECT 'notifications', COUNT(*) FROM notifications;
   "
   ```

## 2. Изолированная конфигурация и SSH-туннель

1. Создайте `dress-rehearsal/.env` (LF, права `chmod 600`) с рабочим `SUPERCELL_TOKEN` и **отдельным тестовым** `TELEGRAM_TOKEN`:

   ```env
   SUPERCELL_TOKEN=<CLASH_OF_CLANS_API_TOKEN>
   TELEGRAM_TOKEN=<TEST_TELEGRAM_BOT_TOKEN>
   ```

2. Создайте `dress-rehearsal/config.json` на основе [`config.example.json`](../config.example.json), сохранив стандартные пути внутри контейнера (`/app/...`) и включив туннель к CoC API:

   ```json
   {
     "api": {
       "use_tunnel": true,
       "tunnel_base_url": "https://host.docker.internal:8080/v1",
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

   > [!NOTE]
   > На Linux при запуске контейнера с `--network host` используйте `"tunnel_base_url": "https://localhost:8080/v1"`.

3. Откройте SSH-туннель к CoC API через VPS (ключ CoC API привязан к IP сервера):

   ```bash
   ssh -N -L 8080:api.clashofclans.com:443 <user>@<vps-ip>
   ```

   Либо на Linux/WSL используйте `./scripts/startTunnel.sh <user>@<vps-ip>`.

## 3. Сборка и запуск TS-контейнера на 1–2 цикла синхронизации

1. Соберите образ из корня репозитория:

   ```bash
   docker build -f ts/Dockerfile -t clashbot-ts:dress-rehearsal .
   ```

2. Запустите контейнер с теми же точками монтирования, что и в [`docker-compose.yml`](../docker-compose.yml):

   ```bash
   docker run -d \
     --name clashbot-ts-rehearsal \
     --env-file ./dress-rehearsal/.env \
     -v "$(pwd)/dress-rehearsal/config.json:/app/config.json:ro" \
     -v "$(pwd)/dress-rehearsal/data:/app/data" \
     --add-host=host.docker.internal:host-gateway \
     clashbot-ts:dress-rehearsal
   ```

3. Отслеживайте логи в `stdout` и дайте боту отработать **1–2 полных цикла синхронизации** отслеживаемых кланов:

   ```bash
   docker logs -f clashbot-ts-rehearsal
   ```

## 4. Чеклист проверок во время пробного прогона

Отметьте каждый пункт перед переходом к cutover:

- [ ] **Старт и миграции**: контейнер поднялся поверх существующего формата `config.json` и `.env` без изменения путей; в логах есть `[DB] Database migrations completed successfully` и `[Main] Application startup completed successfully`, повторного применения миграций `001`–`012` не произошло.
- [ ] **Чистота JSON-логов в `stdout`**: все строки являются валидным JSON (`pino`), отсутствуют `fatal`, необработанные исключения и утечки секретов (`SUPERCELL_TOKEN`, `TELEGRAM_TOKEN`).
- [ ] **Команды и гайды в тестовом Telegram-боте**:
  - [ ] `/start` открывает главное меню;
  - [ ] каталог гайдов из `/app/resources/telegram/attack_guides.json` открывается и корректно навигируется по уровням ратуши и стратегиям;
  - [ ] `/link #ТЕГ` в тестовом Telegram-назначении создаёт подписку (и новое поколение подписки), а в группе проверяет права администратора;
  - [ ] кнопка «📋 Мои кланы» отображает подключённые отслеживаемые кланы;
  - [ ] `/unlink #ТЕГ` завершает активное поколение подписки.
- [ ] **Синхронизация и отсутствие дублей**:
  - [ ] за 1–2 цикла синхронизации отслеживаемые кланы успешно опрашиваются через CoC API;
  - [ ] не появились дублирующиеся доменные события (`domain_events`) и уведомления (`notifications`) для уже завершённых войн, CWL, рейдов и ранее отправленных напоминаний;
  - [ ] накопленная история из продовой БД (подписки, войны, CWL, рейды, получатели событий) читается без ошибок.
- [ ] **Штатная остановка по `SIGTERM` (≤ 15 с)**:

  ```bash
  time docker stop -t 15 clashbot-ts-rehearsal
  docker inspect --format='ExitCode={{.State.ExitCode}}' clashbot-ts-rehearsal
  docker logs --tail 20 clashbot-ts-rehearsal
  ```

  - [ ] контейнер остановился менее чем за 15 секунд с `ExitCode=0`;
  - [ ] в логах зафиксировано `[Main] Shutdown completed successfully`;
  - [ ] `sqlite3 dress-rehearsal/data/database.sqlite "PRAGMA integrity_check;"` возвращает `ok`.

- [ ] **Очистка после прогона**: удалите тестовый контейнер и локальную копию БД (`docker rm clashbot-ts-rehearsal` и `rm -rf dress-rehearsal`).

## 5. Подготовка отката и переключение на сервере (Cutover)

Выполняется человеком при переходе на TS-образ в тикете `#36`:

1. **Зафиксируйте текущий C++-тег в GHCR (`sha-<cpp>`)**:

   ```bash
   # На сервере: проверьте текущий образ/дайджест перед обновлением
   docker inspect --format='{{.Config.Image}} {{index .RepoDigests 0}}' clashbot
   ```

   Запишите короткий SHA текущего C++-коммита (`sha-<cpp>`), опубликованного в `ghcr.io/flacicz/clashbot:sha-<cpp>`.

2. **Создайте git-тег `v1-cpp`** на последнем коммите C++-версии в `main` до слияния cutover-PR:

   ```bash
   git checkout main
   git pull --ff-only origin main
   git tag -a v1-cpp -m "Last C++20 release before TypeScript cutover"
   git push origin v1-cpp
   ```

3. **Снимите свежий бэкап SQLite на VPS** непосредственно перед обновлением:

   ```bash
   cd /opt/clashbot
   ./scripts/backup-sqlite.sh
   ```

4. **Переключение после merge cutover-PR** (когда `ghcr.io/flacicz/clashbot:latest` собран из TS):

   ```bash
   cd /opt/clashbot
   docker compose pull
   docker compose up -d
   docker compose logs -f clashbot
   ```

   Проверьте отсутствие ошибок в логах, работу `/start` → «📋 Мои кланы» и завершение первого цикла синхронизации.

## 6. Быстрый откат (Rollback)

Схема SQLite (`001`–`012`) полностью обратно совместима между C++ и TypeScript-версиями, поэтому откат занимает ~10 секунд без изменения `config.json` и `.env`:

```bash
cd /opt/clashbot
CLASHBOT_IMAGE_TAG=sha-<cpp> docker compose up -d
docker compose logs -f clashbot
```

Для закрепления отката в `.env` добавьте строку `CLASHBOT_IMAGE_TAG=sha-<cpp>`. Если требуется восстановить саму базу SQLite из пред-релизного бэкапа, выполните шаги из раздела [«Проверка восстановления (Recovery Drill)»](deployment.md#проверка-восстановления-recovery-drill).
