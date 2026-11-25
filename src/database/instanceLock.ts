import fs from 'node:fs';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';

import { InstanceLockError } from '../common/errors.js';
import { type Logger } from '../logging/logger.js';
import { extractSqliteCode, isSqliteBusyCode, toDatabaseError } from './sqliteErrors.js';

export const INSTANCE_LOCK_SUFFIX = '.lock';

export interface DatabaseInstanceLockOptions {
    readonly logger?: Logger;
}

export interface DatabaseInstanceLock {
    readonly databasePath: string;
    /** Путь к файлу блокировки или `null` для in-memory/временной БД. */
    readonly lockPath: string | null;
    readonly isLocked: boolean;
    /** Освобождает блокировку (идемпотентно). */
    release(): void;
}

/**
 * Реестр активных файловых блокировок в текущем процессе.
 *
 * Закрывает две задачи:
 * 1. Немедленно отклоняет повторный запуск в том же процессе с `InstanceLockError`.
 * 2. Исключает повторное открытие/закрытие того же inode в одном процессе на POSIX
 *    (где `close()` любого fd того же файла снимает `fcntl`-блокировки процесса).
 */
const activeInProcessLocks = new Set<string>();

function isInMemoryDatabasePath(databasePath: string): boolean {
    return databasePath === ':memory:' || databasePath.trim().length === 0;
}

function resolveCanonicalLockInfo(databasePath: string): {
    readonly lockPath: string;
    readonly canonicalKey: string;
} {
    const resolvedDbPath = path.resolve(databasePath);
    let canonicalDbPath = resolvedDbPath;

    try {
        canonicalDbPath = fs.realpathSync.native(resolvedDbPath);
    } catch {
        const dir = path.dirname(resolvedDbPath);
        const base = path.basename(resolvedDbPath);
        try {
            canonicalDbPath = path.join(fs.realpathSync.native(dir), base);
        } catch {
            // Родительский каталог может отсутствовать — дальнейшее открытие вернёт DatabaseError.
        }
    }

    const lockPath = `${canonicalDbPath}${INSTANCE_LOCK_SUFFIX}`;
    const canonicalKey = process.platform === 'win32' ? lockPath.toLowerCase() : lockPath;
    return { lockPath, canonicalKey };
}

function isLockContentionError(error: unknown): boolean {
    const code = extractSqliteCode(error);
    return (
        isSqliteBusyCode(code) ||
        code === 'SQLITE_LOCKED' ||
        (code?.startsWith('SQLITE_LOCKED_') ?? false)
    );
}

/**
 * Возвращает канонический путь к sidecar lock-файлу (`<dbPath>.lock`) или `null` для `:memory:`.
 */
export function resolveInstanceLockPath(databasePath: string): string | null {
    if (isInMemoryDatabasePath(databasePath)) {
        return null;
    }
    return resolveCanonicalLockInfo(databasePath).lockPath;
}

/**
 * Захватывает эксклюзивную блокировку на отдельный sidecar-файл `<databasePath>.lock`,
 * гарантируя запуск не более одного экземпляра ClashBot на одну файловую SQLite-базу.
 *
 * Механизм опирается на файловые блокировки ОС (`fcntl` на Linux / `LockFileEx` на Windows)
 * через `better-sqlite3` (`PRAGMA locking_mode = EXCLUSIVE` + открытая `BEGIN EXCLUSIVE` без записи
 * страниц):
 * - не конфликтует с `journal_mode = WAL` и онлайн-бэкапом `scripts/backup-sqlite.sh`, так как
 *   блокирует отдельный файл `<databasePath>.lock`, а не саму БД;
 * - при штатной остановке освобождается через `release()`;
 * - при аварийном падении (`SIGKILL`, OOM, перезагрузке) ядро ОС автоматически снимает блокировку,
 *   поэтому ручная очистка `.lock`-файла не требуется (сам файл не удаляется во избежание гонки
 *   inode при пересоздании).
 */
export function acquireDatabaseInstanceLock(
    databasePath: string,
    options: DatabaseInstanceLockOptions = {},
): DatabaseInstanceLock {
    const { logger } = options;

    if (isInMemoryDatabasePath(databasePath)) {
        let locked = true;
        return {
            databasePath,
            lockPath: null,
            get isLocked(): boolean {
                return locked;
            },
            release(): void {
                locked = false;
            },
        };
    }

    const { lockPath, canonicalKey } = resolveCanonicalLockInfo(databasePath);

    if (activeInProcessLocks.has(canonicalKey)) {
        throw new InstanceLockError(databasePath, lockPath);
    }

    let lockDb: BetterSqlite3.Database;
    try {
        lockDb = new BetterSqlite3(lockPath, { timeout: 0 });
    } catch (error: unknown) {
        if (isLockContentionError(error)) {
            throw new InstanceLockError(databasePath, lockPath, { cause: error });
        }
        throw toDatabaseError(
            error,
            `[Lock] Failed to open single-instance lock file (databasePath = ${databasePath}, lockPath = ${lockPath})`,
            { databasePath, lockPath },
        );
    }

    try {
        lockDb.pragma('busy_timeout = 0');
        lockDb.pragma('locking_mode = EXCLUSIVE');
        lockDb.exec('BEGIN EXCLUSIVE');
    } catch (error: unknown) {
        try {
            lockDb.close();
        } catch {
            // Игнорируем ошибку закрытия при пробросе исходной ошибки захвата блокировки.
        }
        if (isLockContentionError(error)) {
            throw new InstanceLockError(databasePath, lockPath, { cause: error });
        }
        throw toDatabaseError(
            error,
            `[Lock] Failed to acquire single-instance lock (databasePath = ${databasePath}, lockPath = ${lockPath})`,
            { databasePath, lockPath },
        );
    }

    activeInProcessLocks.add(canonicalKey);
    logger?.info({ databasePath, lockPath }, '[Lock] Single-instance database lock acquired');

    let released = false;
    return {
        databasePath,
        lockPath,
        get isLocked(): boolean {
            return !released && lockDb.open;
        },
        release(): void {
            if (released) {
                return;
            }
            released = true;
            try {
                if (lockDb.open) {
                    try {
                        if (lockDb.inTransaction) {
                            lockDb.exec('ROLLBACK');
                        }
                    } finally {
                        lockDb.close();
                    }
                }
                logger?.info(
                    { databasePath, lockPath },
                    '[Lock] Single-instance database lock released',
                );
            } catch (error: unknown) {
                throw toDatabaseError(
                    error,
                    `[Lock] Failed to release single-instance lock (databasePath = ${databasePath}, lockPath = ${lockPath})`,
                    { databasePath, lockPath },
                );
            } finally {
                activeInProcessLocks.delete(canonicalKey);
            }
        },
    };
}
