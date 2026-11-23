import BetterSqlite3 from 'better-sqlite3';

import { DatabaseError } from '../common/errors.js';
import { type Logger } from '../logging/logger.js';
import { toDatabaseError } from './sqliteErrors.js';

export type SqliteConnection = BetterSqlite3.Database;

export const SQLITE_BUSY_TIMEOUT_MS = 5000;

export interface DatabaseOptions {
    readonly logger?: Logger;
    readonly busyTimeoutMs?: number;
}

export class Database {
    readonly path: string;
    private readonly connection_: SqliteConnection;
    private readonly logger?: Logger;

    constructor(dbPath: string, options: DatabaseOptions = {}) {
        const busyTimeoutMs = options.busyTimeoutMs ?? SQLITE_BUSY_TIMEOUT_MS;
        if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
            throw new RangeError(
                `Database busyTimeoutMs must be a non-negative integer, got ${String(busyTimeoutMs)}`,
            );
        }

        this.path = dbPath;
        if (options.logger !== undefined) {
            this.logger = options.logger;
        }

        let db: SqliteConnection;
        try {
            db = new BetterSqlite3(dbPath, { timeout: busyTimeoutMs });
        } catch (error: unknown) {
            throw toDatabaseError(error, `[DB] Failed to open database (path = ${dbPath})`, {
                path: dbPath,
            });
        }

        try {
            db.pragma(`busy_timeout = ${String(busyTimeoutMs)}`);
            db.pragma('foreign_keys = ON');
            db.pragma('journal_mode = WAL');
            db.pragma('synchronous = NORMAL');
        } catch (error: unknown) {
            try {
                db.close();
            } catch {
                // Ignore close failure while propagating initialization error.
            }
            throw toDatabaseError(
                error,
                `[DB] Failed to configure SQLite PRAGMAs (path = ${dbPath})`,
                { path: dbPath },
            );
        }

        this.connection_ = db;
        this.logger?.info({ path: dbPath }, '[DB] Database successfully opened');
    }

    get connection(): SqliteConnection {
        if (!this.connection_.open) {
            throw new DatabaseError('[DB] Database connection is closed', {
                sqliteCode: 'SQLITE_MISUSE',
                context: { path: this.path },
            });
        }
        return this.connection_;
    }

    get isOpen(): boolean {
        return this.connection_.open;
    }

    get inTransaction(): boolean {
        return this.connection_.open && this.connection_.inTransaction;
    }

    exec(sql: string): void {
        try {
            this.connection.exec(sql);
        } catch (error: unknown) {
            throw toDatabaseError(error, '[DB] Failed to execute SQL', { sql });
        }
    }

    close(): void {
        if (!this.connection_.open) {
            return;
        }
        try {
            this.connection_.close();
            this.logger?.info({ path: this.path }, '[DB] Database closed');
        } catch (error: unknown) {
            throw toDatabaseError(error, `[DB] Failed to close database (path = ${this.path})`, {
                path: this.path,
            });
        }
    }
}
