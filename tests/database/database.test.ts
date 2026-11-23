import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseError } from '../../src/common/errors.js';
import { Database, SQLITE_BUSY_TIMEOUT_MS } from '../../src/database/index.js';

function createTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('Database', () => {
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

    it('opens an in-memory database with required PRAGMAs', () => {
        const db = trackDb(new Database(':memory:'));

        expect(db.isOpen).toBe(true);
        expect(db.inTransaction).toBe(false);
        expect(db.path).toBe(':memory:');

        expect(db.connection.pragma('foreign_keys', { simple: true })).toBe(1);
        expect(db.connection.pragma('synchronous', { simple: true })).toBe(1); // NORMAL
        expect(db.connection.pragma('busy_timeout', { simple: true })).toBe(SQLITE_BUSY_TIMEOUT_MS);
    });

    it('opens a file-backed database with WAL journal mode and required PRAGMAs', () => {
        const dir = createTempDir('clashbot-db-test-');
        tempDirs.push(dir);
        const dbPath = path.join(dir, 'test.sqlite');

        const db = trackDb(new Database(dbPath));

        expect(db.isOpen).toBe(true);
        expect(db.connection.pragma('foreign_keys', { simple: true })).toBe(1);
        expect(db.connection.pragma('journal_mode', { simple: true })).toBe('wal');
        expect(db.connection.pragma('synchronous', { simple: true })).toBe(1);
        expect(db.connection.pragma('busy_timeout', { simple: true })).toBe(5000);
    });

    it('allows configuring custom busyTimeoutMs', () => {
        const db = trackDb(new Database(':memory:', { busyTimeoutMs: 250 }));

        expect(db.connection.pragma('busy_timeout', { simple: true })).toBe(250);
    });

    it('rejects negative or non-integer busyTimeoutMs', () => {
        expect(() => new Database(':memory:', { busyTimeoutMs: -1 })).toThrow(RangeError);
        expect(() => new Database(':memory:', { busyTimeoutMs: 1.5 })).toThrow(RangeError);
    });

    it('throws DatabaseError when opening a path inside a non-existent directory', () => {
        const missingPath = path.join(os.tmpdir(), 'clashbot-nonexistent-dir-99999', 'db.sqlite');

        expect(() => new Database(missingPath)).toThrow(DatabaseError);
    });

    it('closes idempotently and rejects connection access after close', () => {
        const db = trackDb(new Database(':memory:'));

        db.close();
        expect(db.isOpen).toBe(false);
        expect(() => {
            db.close();
        }).not.toThrow();

        expect(() => db.connection).toThrow(DatabaseError);
        expect(() => {
            db.exec('SELECT 1;');
        }).toThrow(DatabaseError);
    });
});
