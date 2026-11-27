import fs from 'node:fs';
import path from 'node:path';

import { DatabaseError } from '../common/errors.js';
import { type Logger } from '../logging/logger.js';
import { type Database } from './database.js';
import { ForeignKeysGuard, requireForeignKeysEnabled } from './foreignKeysGuard.js';
import { toDatabaseError } from './sqliteErrors.js';
import { type TransactionManager } from './transactionManager.js';

export const LEGACY_REBUILD_MIGRATION_VERSION = '003_clan_info_schema_v1_to_v2.sql';
export const SUBSCRIPTION_PRESETS_MIGRATION_VERSION = '016_subscription_presets_and_categories.sql';

const FOREIGN_KEY_REBUILD_MIGRATIONS = new Set<string>([
    LEGACY_REBUILD_MIGRATION_VERSION,
    SUBSCRIPTION_PRESETS_MIGRATION_VERSION,
]);

interface ForeignKeyViolationRow {
    readonly table: string;
    readonly rowid: number | null;
    readonly parent: string;
    readonly fkid: number;
}

export interface MigratorManagerOptions {
    readonly logger?: Logger;
}

function compareLexicographically(left: string, right: string): number {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
}

export class MigratorManager {
    private readonly db: Database;
    private readonly transactionManager: TransactionManager;
    private readonly logger?: Logger;

    constructor(
        db: Database,
        transactionManager: TransactionManager,
        options: MigratorManagerOptions = {},
    ) {
        if (!transactionManager.managesConnection(db)) {
            throw new DatabaseError(
                'MigratorManager and TransactionManager must use the same SQLite connection',
                { sqliteCode: 'SQLITE_MISUSE' },
            );
        }

        this.db = db;
        this.transactionManager = transactionManager;
        if (options.logger !== undefined) {
            this.logger = options.logger;
        }
    }

    migrate(migrationsPath: string): void {
        this.createMigrationTable();

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(migrationsPath, { withFileTypes: true });
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[MigratorManager] Failed to read migrations directory '${migrationsPath}'`,
                { migrationsPath },
            );
        }

        const filenames: string[] = [];
        for (const entry of entries) {
            if (entry.isFile() && path.extname(entry.name) === '.sql') {
                filenames.push(entry.name);
            } else {
                throw new DatabaseError(
                    `[MigratorManager] Unexpected non-SQL file in migrations directory '${migrationsPath}': '${entry.name}'`,
                    { context: { migrationsPath, entryName: entry.name } },
                );
            }
        }

        filenames.sort(compareLexicographically);

        for (const filename of filenames) {
            this.applyMigrationIfNeeded(filename, path.join(migrationsPath, filename));
        }
    }

    private createMigrationTable(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations(
                version TEXT NOT NULL,
                applied_at INTEGER DEFAULT (strftime('%s', 'now'))
            );
        `);
    }

    private isMigrationApplied(version: string): boolean {
        try {
            const row = this.db.connection
                .prepare<[string], { version: string }>(
                    'SELECT version FROM schema_migrations WHERE version = ?;',
                )
                .get(version);
            return row !== undefined;
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[MigratorManager] Failed to check migration version (version = ${version})`,
                { version },
            );
        }
    }

    private executeMigrationBody(filePath: string): void {
        let migrationSql: string;
        try {
            migrationSql = fs.readFileSync(filePath, 'utf8');
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[MigratorManager] Failed to read migration file: ${filePath}`,
                { filePath },
            );
        }

        try {
            this.db.connection.exec(migrationSql);
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[MigratorManager] Failed to execute migration file: ${filePath}`,
                { filePath },
            );
        }
    }

    private checkForeignKeys(): void {
        let violations: ForeignKeyViolationRow[];
        try {
            violations = this.db.connection.pragma('foreign_key_check') as ForeignKeyViolationRow[];
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                '[MigratorManager] Failed to run PRAGMA foreign_key_check',
            );
        }

        const firstViolation = violations[0];
        if (firstViolation !== undefined) {
            throw new DatabaseError(
                `[MigratorManager] Foreign key violation in table '${firstViolation.table}', parent table '${firstViolation.parent}', constraint ${String(firstViolation.fkid)}`,
                {
                    sqliteCode: 'SQLITE_CONSTRAINT',
                    context: {
                        table: firstViolation.table,
                        rowid: firstViolation.rowid,
                        parent: firstViolation.parent,
                        fkid: firstViolation.fkid,
                    },
                },
            );
        }
    }

    private insertMigrationVersion(version: string): void {
        try {
            this.db.connection
                .prepare('INSERT INTO schema_migrations(version) VALUES (?);')
                .run(version);
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[MigratorManager] Failed to save migration version (version = ${version})`,
                { version },
            );
        }
    }

    private applyMigrationIfNeeded(version: string, filePath: string): void {
        const needsForeignKeyRebuild = FOREIGN_KEY_REBUILD_MIGRATIONS.has(version);
        let foreignKeysGuard: ForeignKeysGuard | undefined;

        if (needsForeignKeyRebuild) {
            foreignKeysGuard = new ForeignKeysGuard(this.db, this.logger);
        } else {
            requireForeignKeysEnabled(this.db.connection);
        }

        let transactionSucceeded = false;
        try {
            this.transactionManager.retryInTransaction(() => {
                if (this.isMigrationApplied(version)) {
                    return;
                }

                this.executeMigrationBody(filePath);
                this.checkForeignKeys();
                this.insertMigrationVersion(version);
            });
            transactionSucceeded = true;
        } finally {
            if (foreignKeysGuard !== undefined) {
                if (transactionSucceeded) {
                    foreignKeysGuard.restore();
                } else {
                    foreignKeysGuard.restoreBestEffort();
                }
            }
        }
    }
}
