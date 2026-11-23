import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseError, DomainError } from '../../src/common/errors.js';
import {
    Database,
    DEFAULT_INITIAL_DELAY_MS,
    DEFAULT_MAX_ATTEMPTS,
    RetryPolicy,
    TransactionManager,
    defaultSleepSync,
} from '../../src/database/index.js';

function createTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('RetryPolicy', () => {
    it('uses linear backoff with 3 attempts and 100ms initial delay by default', () => {
        const policy = new RetryPolicy();

        expect(policy.maxAttempts).toBe(DEFAULT_MAX_ATTEMPTS);
        expect(policy.maxAttempts).toBe(3);
        expect(DEFAULT_INITIAL_DELAY_MS).toBe(100);
        expect(policy.delayForAttempt(0)).toBe(0);
        expect(policy.delayForAttempt(1)).toBe(100);
        expect(policy.delayForAttempt(2)).toBe(200);
        expect(policy.delayForAttempt(3)).toBe(300);
    });

    it('supports exponential backoff and caps delay at maxDelayMs', () => {
        const policy = new RetryPolicy({
            maxAttempts: 5,
            initialDelayMs: 50,
            maxDelayMs: 150,
            backoffStrategy: 'exponential',
        });

        expect(policy.delayForAttempt(1)).toBe(50);
        expect(policy.delayForAttempt(2)).toBe(100);
        expect(policy.delayForAttempt(3)).toBe(150);
        expect(policy.delayForAttempt(4)).toBe(150);
    });

    it('validates constructor parameters', () => {
        expect(() => new RetryPolicy({ maxAttempts: 0 })).toThrow(RangeError);
        expect(() => new RetryPolicy({ initialDelayMs: -1 })).toThrow(RangeError);
        expect(() => new RetryPolicy({ maxDelayMs: -1 })).toThrow(RangeError);
        expect(() => new RetryPolicy({ initialDelayMs: 200, maxDelayMs: 100 })).toThrow(RangeError);
    });
});

describe('TransactionManager', () => {
    const tempDirs: string[] = [];
    const openDatabases: Database[] = [];

    function trackDb(db: Database): Database {
        openDatabases.push(db);
        return db;
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop();
            if (dir !== undefined) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('commits synchronous operations and returns their value', () => {
        const db = trackDb(new Database(':memory:'));
        db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);');
        const transactions = new TransactionManager(db);

        const insertedId = transactions.retryInTransaction(() => {
            expect(db.inTransaction).toBe(true);
            const result = db.connection
                .prepare('INSERT INTO items (name) VALUES (?);')
                .run('alpha');
            return Number(result.lastInsertRowid);
        });

        expect(db.inTransaction).toBe(false);
        expect(insertedId).toBe(1);
        const row = db.connection
            .prepare<[number], { name: string }>('SELECT name FROM items WHERE id = ?;')
            .get(insertedId);
        expect(row?.name).toBe('alpha');
    });

    it('rolls back partial changes on SQLite error and wraps in DatabaseError', () => {
        const db = trackDb(new Database(':memory:'));
        db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);');
        const transactions = new TransactionManager(db);

        expect(() => {
            transactions.retryInTransaction(() => {
                db.connection.prepare('INSERT INTO items (name) VALUES (?);').run('partial');
                db.connection.exec('INSERT INTO table_that_does_not_exist VALUES (1);');
            });
        }).toThrow(DatabaseError);

        expect(db.inTransaction).toBe(false);
        const count = db.connection
            .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM items;')
            .get();
        expect(count?.count).toBe(0);
    });

    it('rolls back partial changes and rethrows domain errors untouched without retrying', () => {
        const db = trackDb(new Database(':memory:'));
        db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);');
        const sleeps: number[] = [];
        const transactions = new TransactionManager(db, {
            sleepSync: (ms) => sleeps.push(ms),
        });

        let attempts = 0;
        const domainError = new DomainError('invalid domain state');

        expect(() =>
            transactions.retryInTransaction(() => {
                attempts += 1;
                db.connection.prepare('INSERT INTO items (name) VALUES (?);').run('rolled-back');
                throw domainError;
            }),
        ).toThrow(domainError);

        expect(attempts).toBe(1);
        expect(sleeps).toEqual([]);
        expect(db.inTransaction).toBe(false);
        const count = db.connection
            .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM items;')
            .get();
        expect(count?.count).toBe(0);
    });

    it('retries up to 3 attempts on SQLITE_BUSY with linear 100ms backoff and succeeds', () => {
        const db = trackDb(new Database(':memory:'));
        db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);');
        const sleeps: number[] = [];
        const transactions = new TransactionManager(db, {
            sleepSync: (ms) => sleeps.push(ms),
        });

        let attempts = 0;
        const result = transactions.retryInTransaction(() => {
            attempts += 1;
            db.connection
                .prepare('INSERT INTO items (name) VALUES (?);')
                .run(`try-${String(attempts)}`);
            if (attempts === 1) {
                throw new BetterSqlite3.SqliteError('database is locked', 'SQLITE_BUSY');
            }
            if (attempts === 2) {
                throw new DatabaseError('snapshot busy', { sqliteCode: 'SQLITE_BUSY_SNAPSHOT' });
            }
            return 'ok';
        });

        expect(result).toBe('ok');
        expect(attempts).toBe(3);
        expect(sleeps).toEqual([100, 200]);

        const rows = db.connection
            .prepare<[], { name: string }>('SELECT name FROM items ORDER BY id;')
            .all();
        expect(rows).toEqual([{ name: 'try-3' }]);
    });

    it('throws DatabaseError after exhausting max attempts on persistent SQLITE_BUSY', () => {
        const db = trackDb(new Database(':memory:'));
        const sleeps: number[] = [];
        const transactions = new TransactionManager(db, {
            sleepSync: (ms) => sleeps.push(ms),
        });

        let attempts = 0;
        let caught: unknown;
        try {
            transactions.retryInTransaction(() => {
                attempts += 1;
                throw new BetterSqlite3.SqliteError('database is locked', 'SQLITE_BUSY');
            });
        } catch (error: unknown) {
            caught = error;
        }

        expect(attempts).toBe(3);
        expect(sleeps).toEqual([100, 200]);
        expect(caught).toBeInstanceOf(DatabaseError);
        expect((caught as DatabaseError).isBusy()).toBe(true);
    });

    it('uses BEGIN IMMEDIATE and retries real SQLITE_BUSY contention between WAL connections', () => {
        const dir = createTempDir('clashbot-tx-busy-');
        tempDirs.push(dir);
        const dbPath = path.join(dir, 'busy.sqlite');

        const holder = trackDb(new Database(dbPath, { busyTimeoutMs: 0 }));
        holder.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);');
        const contender = trackDb(new Database(dbPath, { busyTimeoutMs: 0 }));

        // Acquire write lock with BEGIN IMMEDIATE on holder connection
        holder.exec('BEGIN IMMEDIATE;');
        try {
            const sleeps: number[] = [];
            const transactions = new TransactionManager(contender, {
                sleepSync: (ms) => {
                    sleeps.push(ms);
                    // Release holder lock after first busy retry delay
                    if (sleeps.length === 1) {
                        holder.exec('COMMIT;');
                    }
                },
            });

            transactions.retryInTransaction(() => {
                contender.connection
                    .prepare('INSERT INTO items (name) VALUES (?);')
                    .run('after-lock');
            });

            expect(sleeps).toEqual([100]);
            const rows = contender.connection
                .prepare<[], { name: string }>('SELECT name FROM items;')
                .all();
            expect(rows).toEqual([{ name: 'after-lock' }]);
        } finally {
            if (holder.inTransaction) {
                holder.exec('ROLLBACK;');
            }
        }
    });

    it('rejects async callbacks at runtime and rolls back changes', () => {
        const db = trackDb(new Database(':memory:'));
        db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);');
        const transactions = new TransactionManager(db);

        const asyncCallback = (async (): Promise<string> => {
            db.connection.prepare('INSERT INTO items (name) VALUES (?);').run('async-bad');
            return await Promise.resolve('nope');
        }) as unknown as () => string;

        expect(() => transactions.retryInTransaction(asyncCallback)).toThrow(DatabaseError);
        expect(db.inTransaction).toBe(false);
        const count = db.connection
            .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM items;')
            .get();
        expect(count?.count).toBe(0);
    });

    it('reports connection ownership accurately via managesConnection', () => {
        const first = trackDb(new Database(':memory:'));
        const second = trackDb(new Database(':memory:'));
        const transactions = new TransactionManager(first);

        expect(transactions.managesConnection(first)).toBe(true);
        expect(transactions.managesConnection(first.connection)).toBe(true);
        expect(transactions.managesConnection(second)).toBe(false);
        expect(transactions.managesConnection(second.connection)).toBe(false);
    });

    it('supports explicit beginTransaction/commit/rollback and rejects double commit', () => {
        const db = trackDb(new Database(':memory:'));
        db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);');
        const transactions = new TransactionManager(db);

        const rolledBack = transactions.beginTransaction();
        db.connection.prepare('INSERT INTO items (name) VALUES (?);').run('discarded');
        rolledBack.rollback();
        rolledBack.rollback(); // idempotent

        const committed = transactions.beginTransaction();
        db.connection.prepare('INSERT INTO items (name) VALUES (?);').run('saved');
        committed.commit();
        expect(() => {
            committed.commit();
        }).toThrow(DatabaseError);

        const rows = db.connection.prepare<[], { name: string }>('SELECT name FROM items;').all();
        expect(rows).toEqual([{ name: 'saved' }]);
    });

    it('performs synchronous sleep via defaultSleepSync', () => {
        expect(() => {
            defaultSleepSync(0);
        }).not.toThrow();

        const start = Date.now();
        defaultSleepSync(15);
        expect(Date.now() - start).toBeGreaterThanOrEqual(10);
    });
});
