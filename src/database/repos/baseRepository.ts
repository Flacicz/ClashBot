import { DatabaseError } from '../../common/errors.js';
import { Database, type SqliteConnection } from '../database.js';
import { toDatabaseError } from '../sqliteErrors.js';

export type SqlBindValue = string | number | bigint | Buffer | null;
export type SqlRow = Readonly<Record<string, unknown>>;

export function getString(row: SqlRow, column: string): string {
    const value = row[column];
    return typeof value === 'string' ? value : '';
}

export function getNumber(row: SqlRow, column: string): number {
    const value = row[column];
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'bigint') {
        return Number(value);
    }
    return 0;
}

export class BaseRepository {
    private readonly source: Database | SqliteConnection;
    protected readonly repoName: string;

    constructor(connectionOrDb: Database | SqliteConnection, repoName: string) {
        this.source = connectionOrDb;
        this.repoName = repoName;
    }

    protected get connection(): SqliteConnection {
        return this.source instanceof Database ? this.source.connection : this.source;
    }

    protected query<TResult>(
        sql: string,
        operation: string,
        context: string,
        mapper: (row: SqlRow) => TResult,
        ...params: readonly SqlBindValue[]
    ): TResult[] {
        try {
            const stmt = this.connection.prepare(sql);
            const rows = stmt.all(...params) as SqlRow[];
            return rows.map((row) => mapper(row));
        } catch (error: unknown) {
            throw this.wrapError(error, operation, context);
        }
    }

    protected queryOne<TResult>(
        sql: string,
        operation: string,
        context: string,
        mapper: (row: SqlRow) => TResult,
        ...params: readonly SqlBindValue[]
    ): TResult {
        try {
            const stmt = this.connection.prepare(sql);
            const row = stmt.get(...params) as SqlRow | undefined;
            if (row === undefined) {
                throw new DatabaseError(
                    `[${this.repoName}] Failed to ${operation} (${context}): row not found`,
                    { context: { repo: this.repoName, operation, details: context } },
                );
            }
            return mapper(row);
        } catch (error: unknown) {
            throw this.wrapError(error, operation, context);
        }
    }

    protected queryOptional<TResult>(
        sql: string,
        operation: string,
        context: string,
        mapper: (row: SqlRow) => TResult,
        ...params: readonly SqlBindValue[]
    ): TResult | undefined {
        try {
            const stmt = this.connection.prepare(sql);
            const row = stmt.get(...params) as SqlRow | undefined;
            if (row === undefined) {
                return undefined;
            }
            return mapper(row);
        } catch (error: unknown) {
            throw this.wrapError(error, operation, context);
        }
    }

    protected execute(
        sql: string,
        operation: string,
        context: string,
        ...params: readonly SqlBindValue[]
    ): void {
        try {
            const stmt = this.connection.prepare(sql);
            stmt.run(...params);
        } catch (error: unknown) {
            throw this.wrapError(error, operation, context);
        }
    }

    private wrapError(error: unknown, operation: string, context: string): DatabaseError {
        return toDatabaseError(error, `[${this.repoName}] Failed to ${operation} (${context})`, {
            repo: this.repoName,
            operation,
            details: context,
        });
    }
}
