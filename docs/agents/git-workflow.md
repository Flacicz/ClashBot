# Git и PR workflow

Регламент работы с ветками, интеграционными PR по волнам, миграциями SQLite и Windows-средой. Общие запреты, команды проверки и Definition of Done — в [`AGENTS.md`](../../AGENTS.md).

## Pre-flight перед стартом задачи или волны

Перед созданием веток или запуском воркеров выполни в основном workspace:

```powershell
git fetch origin main; if ($LASTEXITCODE -eq 0) { git checkout main }; if ($LASTEXITCODE -eq 0) { git merge --ff-only origin/main }; if ($LASTEXITCODE -eq 0) { git status -sb }
```

**Критерий готовности:** текущая ветка — `main`, коммит совпадает с `origin/main`, рабочее дерево чистое.

## Выбор режима веток

### 1. Волновой интеграционный PR (режим по умолчанию для `/swarm` и серий тикетов)

Для серии из нескольких тикетов открывается **один** интеграционный PR на всю волну (по образцу `fix/mvp-wave-1`), чтобы исключить каскадные `Update branch` и промежуточные merge в `main`:

1. Координатор создаёт одну ветку волны от свежего `origin/main` (например, `fix/mvp-wave-<N>` или `feat/wave-<N>`) и пушит её (`git push -u origin <wave-branch>`).
2. Каждый кодер создаёт короткую ветку тикета от свежего `origin/<wave-branch>` (`fix/...`, `feat/...`, `docs/...`, `chore/...`), реализует тикет, прогоняет проверки из `AGENTS.md` и пушит ветку тикета в `origin` (или держит коммиты доступными для ревью).
3. Ревьюер проверяет дифф `origin/<wave-branch>...<ticket-branch>` по правилам [`swarm.md`](swarm.md).
4. После вердикта `APPROVE`:
   - если `<wave-branch>` успела продвинуться, пока шёл тикет, кодер подтягивает базу через `git fetch origin <wave-branch>` и `git merge origin/<wave-branch>` (без `--force`), разрешает конфликты, перепрогоняет проверки и проходит повторное ревью;
   - координатор вливает одобренную ветку тикета в `<wave-branch>` через `git merge --squash <ticket-branch>` и один коммит Conventional Commits с номером тикета (например, `fix(outbox): claim notifications with sending status (#3)`), прогоняет проверки на `<wave-branch>` и пушит её (`git push origin <wave-branch>`);
   - следующий зависимый тикет (включая следующую SQL-миграцию) стартует сразу от обновлённой `origin/<wave-branch>` без ожидания промежуточного merge в `main`.
5. По завершении волны координатор открывает **один** PR `<wave-branch> → main`:
   - перечисляет каждый закрываемый тикет отдельной строкой `Closes #<n>`;
   - заполняет сводное описание на русском по DoD из `AGENTS.md`;
   - дожидается зелёного CI (`gh pr checks <num> --watch`) и статуса `CLEAN` (`MERGEABLE`) перед передачей техлиду.

### 2. Одиночная задача (вне волны)

Для одного независимого тикета создай короткую ветку от свежего `origin/main`, выполни проверки из `AGENTS.md` и открой один PR в `main` с `Closes #<n>`.

## Актуализация открытого PR без `--force`

`main` принимает изменения через `Squash and merge`, а `--force` запрещён в `AGENTS.md`. Если `main` продвинулся вперёд, пока PR открыт:

- **Статус `BEHIND` без конфликтов:** выполни `gh pr update-branch <pr-number>`, дождись завершения CI (`gh pr checks <pr-number> --watch`) и проверь `gh pr view <pr-number> --json mergeable,mergeStateStatus`.
- **Статус `CONFLICTING`:** в ветке PR выполни `git fetch origin main` и `git merge origin/main`, разреши конфликты, перепрогони проверки из `AGENTS.md`, запушь обычным `git push` (без `--force`) и пройди повторное ревью.

**Критерий готовности передачи PR техлиду:** `mergeable == MERGEABLE`, `mergeStateStatus == CLEAN`, все проверки GitHub Actions в статусе `pass`.

## Чек-лист для новых SQL-миграций (`migrations/0NN_*.sql`)

- Добавляй строго новый файл со следующим порядковым номером; уже применённые миграции неизменны.
- Не запускай две новые миграции параллельно: вторая стартует только после вливания первой в базовую ветку (`<wave-branch>` или `main`).
- В том же изменении синхронно обнови:
  1. `.github/workflows/docker-publish.yml` — ожидаемое число миграций и префикс `0NN_*` в Docker smoke-тесте;
  2. `docs/deployment.md` и `README.md` — упоминания числа применённых миграций и последнего префикса;
  3. тесты мигратора и обратной совместимости (`tests/database/migratorManager.test.ts`, `tests/app/cppV012Compatibility.test.ts`), доказав работу на чистой БД и на upgrade уже мигрированной БД (включая backfill существующих строк).

## Среда Windows и worktree

- В Windows PowerShell 5.1 оператор `&&` не поддерживается: соединяй зависимые команды через `; if ($LASTEXITCODE -eq 0) { ... }` или запускай отдельными строками.
- В свежем `workspace: "share"` при отсутствии `node_modules` сначала выполни `pnpm install --frozen-lockfile`.
