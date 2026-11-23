import { DatabaseError } from '../common/errors.js';
import { type Logger } from '../logging/logger.js';
import { type Database, type SqliteConnection } from './database.js';
import { toDatabaseError } from './sqliteErrors.js';

export function isForeignKeysEnabled(connection: SqliteConnection): boolean {
    let rawValue: unknown;
    try {
        rawValue = connection.pragma('foreign_keys', { simple: true });
    } catch (error: unknown) {
        throw toDatabaseError(error, 'Failed to read PRAGMA foreign_keys');
    }

    if (typeof rawValue !== 'number') {
        throw new DatabaseError(`Unexpected PRAGMA foreign_keys value: ${String(rawValue)}`, {
            sqliteCode: 'SQLITE_ERROR',
        });
    }

    return rawValue !== 0;
}

export function requireForeignKeysEnabled(connection: SqliteConnection): void {
    if (!isForeignKeysEnabled(connection)) {
        throw new DatabaseError('Migration requires foreign key enforcement', {
            sqliteCode: 'SQLITE_MISUSE',
        });
    }
}

function setForeignKeys(connection: SqliteConnection, enabled: boolean): void {
    try {
        connection.pragma(enabled ? 'foreign_keys = ON' : 'foreign_keys = OFF');
    } catch (error: unknown) {
        throw toDatabaseError(
            error,
            `Failed to ${enabled ? 'enable' : 'disable'} PRAGMA foreign_keys`,
        );
    }

    if (isForeignKeysEnabled(connection) !== enabled) {
        throw new DatabaseError(
            `SQLite did not ${enabled ? 'enable' : 'disable'} foreign key enforcement`,
            { sqliteCode: 'SQLITE_ERROR' },
        );
    }
}

export class ForeignKeysGuard {
    private readonly db: Database;
    private readonly logger?: Logger;
    private readonly wasEnabled: boolean;
    private restorePending = false;

    constructor(db: Database, logger?: Logger) {
        this.db = db;
        if (logger !== undefined) {
            this.logger = logger;
        }

        if (!this.db.isOpen) {
            throw new DatabaseError('ForeignKeysGuard received a closed database connection', {
                sqliteCode: 'SQLITE_MISUSE',
            });
        }

        const connection = this.db.connection;
        this.wasEnabled = isForeignKeysEnabled(connection);

        if (!this.wasEnabled) {
            return;
        }

        if (connection.inTransaction) {
            throw new DatabaseError(
                'ForeignKeysGuard must be created outside an active transaction',
                { sqliteCode: 'SQLITE_MISUSE' },
            );
        }

        try {
            setForeignKeys(connection, false);
            this.restorePending = true;
        } catch (error: unknown) {
            try {
                setForeignKeys(connection, true);
            } catch (restoreError: unknown) {
                this.logger?.error(
                    { err: restoreError },
                    'Failed to restore foreign key enforcement after guard construction failed',
                );
            }
            throw error;
        }
    }

    restore(): void {
        if (!this.restorePending) {
            return;
        }

        if (!this.db.isOpen) {
            throw new DatabaseError(
                'Failed to restore foreign key enforcement: database connection is closed',
                { sqliteCode: 'SQLITE_MISUSE' },
            );
        }

        const connection = this.db.connection;
        if (connection.inTransaction) {
            throw new DatabaseError(
                'ForeignKeysGuard cannot restore foreign key enforcement while a transaction is active',
                { sqliteCode: 'SQLITE_MISUSE' },
            );
        }

        setForeignKeys(connection, this.wasEnabled);
        this.restorePending = false;
    }

    restoreBestEffort(): void {
        if (!this.restorePending) {
            return;
        }

        try {
            this.restore();
        } catch (error: unknown) {
            this.logger?.error({ err: error }, 'Failed to restore foreign key enforcement');
        }
    }
}
