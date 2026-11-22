import { Database, type SqliteConnection } from '../database.js';
import { toDatabaseError } from '../sqliteErrors.js';

export type DatabaseSource = Database | SqliteConnection;

export function getConnection(source: DatabaseSource): SqliteConnection {
    return source instanceof Database ? source.connection : source;
}

export function runRepoQuery<T>(
    repoName: string,
    action: string,
    context: Readonly<Record<string, unknown>>,
    operation: () => T,
): T {
    try {
        return operation();
    } catch (error: unknown) {
        throw toDatabaseError(error, `[${repoName}] Failed to ${action}`, context);
    }
}
