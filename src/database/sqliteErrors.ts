import BetterSqlite3 from 'better-sqlite3';

import { DatabaseError } from '../common/errors.js';

export type BetterSqliteError = InstanceType<typeof BetterSqlite3.SqliteError>;

export function isSqliteError(error: unknown): error is BetterSqliteError {
    return error instanceof BetterSqlite3.SqliteError;
}

export function isSqliteBusyCode(code: string | undefined): boolean {
    return code === 'SQLITE_BUSY' || (code?.startsWith('SQLITE_BUSY_') ?? false);
}

export function extractSqliteCode(error: unknown): string | undefined {
    if (error instanceof DatabaseError) {
        return error.sqliteCode;
    }
    if (isSqliteError(error)) {
        return error.code;
    }
    return undefined;
}

export function isSqliteBusyError(error: unknown): boolean {
    if (error instanceof DatabaseError) {
        return error.isBusy();
    }
    if (isSqliteError(error)) {
        return isSqliteBusyCode(error.code);
    }
    return false;
}

export function toDatabaseError(
    error: unknown,
    messagePrefix: string,
    context?: Readonly<Record<string, unknown>>,
): DatabaseError {
    if (error instanceof DatabaseError) {
        return error;
    }

    const sqliteCode = extractSqliteCode(error);
    const details = error instanceof Error ? error.message : String(error);
    const message = details.length > 0 ? `${messagePrefix}: ${details}` : messagePrefix;

    return new DatabaseError(message, {
        cause: error,
        ...(sqliteCode !== undefined ? { sqliteCode } : {}),
        ...(context !== undefined ? { context } : {}),
    });
}
