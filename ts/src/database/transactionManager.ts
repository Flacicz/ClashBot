import { DatabaseError } from '../common/errors.js';
import { type Logger } from '../logging/logger.js';
import { Database, type SqliteConnection } from './database.js';
import { RetryPolicy } from './retryPolicy.js';
import { isSqliteBusyError, isSqliteError, toDatabaseError } from './sqliteErrors.js';

const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

export function defaultSleepSync(ms: number): void {
    if (ms <= 0) {
        return;
    }
    Atomics.wait(SLEEP_BUFFER, 0, 0, ms);
}

function unwrapConnection(source: Database | SqliteConnection): SqliteConnection {
    return source instanceof Database ? source.connection : source;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        typeof (value as { then?: unknown }).then === 'function'
    );
}

export class TransactionGuard {
    private committed = false;
    private finished = false;
    private readonly connection: SqliteConnection;
    private readonly logger?: Logger;

    constructor(connection: SqliteConnection, logger?: Logger) {
        this.connection = connection;
        if (logger !== undefined) {
            this.logger = logger;
        }

        try {
            this.connection.exec('BEGIN IMMEDIATE;');
        } catch (error: unknown) {
            this.finished = true;
            throw toDatabaseError(
                error,
                '[TransactionGuard] Failed to begin IMMEDIATE transaction',
            );
        }
    }

    commit(): void {
        if (this.finished) {
            throw new DatabaseError('[TransactionGuard] Transaction has already finished', {
                sqliteCode: 'SQLITE_MISUSE',
            });
        }

        try {
            this.connection.exec('COMMIT;');
            this.committed = true;
            this.finished = true;
        } catch (error: unknown) {
            throw toDatabaseError(error, '[TransactionGuard] Failed to commit transaction');
        }
    }

    rollback(): void {
        if (this.finished || this.committed) {
            return;
        }
        this.finished = true;

        if (!this.connection.open || !this.connection.inTransaction) {
            return;
        }

        try {
            this.connection.exec('ROLLBACK;');
        } catch (error: unknown) {
            this.logger?.error({ err: error }, 'Failed to rollback SQLite transaction');
        }
    }
}

export interface TransactionManagerOptions {
    readonly retryPolicy?: RetryPolicy;
    readonly sleepSync?: (ms: number) => void;
    readonly logger?: Logger;
}

export class TransactionManager {
    private readonly connection: SqliteConnection;
    private readonly retryPolicy: RetryPolicy;
    private readonly sleepSync: (ms: number) => void;
    private readonly logger?: Logger;

    constructor(
        connectionOrDb: Database | SqliteConnection,
        options: TransactionManagerOptions = {},
    ) {
        this.connection = unwrapConnection(connectionOrDb);
        this.retryPolicy = options.retryPolicy ?? new RetryPolicy();
        this.sleepSync = options.sleepSync ?? defaultSleepSync;
        if (options.logger !== undefined) {
            this.logger = options.logger;
        }
    }

    managesConnection(other: Database | SqliteConnection): boolean {
        return unwrapConnection(other) === this.connection;
    }

    beginTransaction(): TransactionGuard {
        return new TransactionGuard(this.connection, this.logger);
    }

    retryInTransaction<T>(
        operation: () => T,
        ..._syncOnlyCheck: [T] extends [never]
            ? []
            : [T] extends [PromiseLike<unknown>]
              ? [error: 'Transaction operations must be synchronous and cannot return a Promise']
              : []
    ): T {
        let attempt = 1;

        for (;;) {
            let guard: TransactionGuard | undefined;
            try {
                guard = this.beginTransaction();
                const result = operation();
                if (isPromiseLike(result)) {
                    // Prevent unhandled rejection if the caller passed a rejecting async function.
                    result.then(
                        () => undefined,
                        () => undefined,
                    );
                    throw new DatabaseError(
                        '[TransactionManager] Transaction operations must be synchronous and cannot return a Promise',
                        { sqliteCode: 'SQLITE_MISUSE' },
                    );
                }
                guard.commit();
                return result;
            } catch (error: unknown) {
                guard?.rollback();

                if (isSqliteBusyError(error) && attempt < this.retryPolicy.maxAttempts) {
                    const delayMs = this.retryPolicy.delayForAttempt(attempt);
                    if (delayMs > 0) {
                        this.sleepSync(delayMs);
                    }
                    attempt += 1;
                    continue;
                }

                if (isSqliteError(error)) {
                    throw toDatabaseError(error, '[TransactionManager] SQLite transaction failed');
                }

                throw error;
            }
        }
    }
}
