import { Writable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseError } from '../../src/common/errors.js';
import { Database, ForeignKeysGuard, isForeignKeysEnabled } from '../../src/database/index.js';
import { createLogger } from '../../src/logging/logger.js';

describe('ForeignKeysGuard', () => {
    const openDatabases: Database[] = [];

    function trackDb(db: Database): Database {
        openDatabases.push(db);
        return db;
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('disables foreign keys on construction and restores them on restore()', () => {
        const db = trackDb(new Database(':memory:'));
        expect(isForeignKeysEnabled(db.connection)).toBe(true);

        const guard = new ForeignKeysGuard(db);
        expect(isForeignKeysEnabled(db.connection)).toBe(false);

        guard.restore();
        expect(isForeignKeysEnabled(db.connection)).toBe(true);

        // Calling restore() again is a safe no-op.
        guard.restore();
        expect(isForeignKeysEnabled(db.connection)).toBe(true);
    });

    it('does nothing when foreign keys are already disabled', () => {
        const db = trackDb(new Database(':memory:'));
        db.exec('PRAGMA foreign_keys = OFF;');

        const guard = new ForeignKeysGuard(db);
        expect(isForeignKeysEnabled(db.connection)).toBe(false);

        guard.restore();
        expect(isForeignKeysEnabled(db.connection)).toBe(false);
    });

    it('rejects construction when database is closed or inside an active transaction', () => {
        const closedDb = trackDb(new Database(':memory:'));
        closedDb.close();
        expect(() => new ForeignKeysGuard(closedDb)).toThrow(DatabaseError);

        const txDb = trackDb(new Database(':memory:'));
        txDb.exec('BEGIN IMMEDIATE;');
        try {
            expect(() => new ForeignKeysGuard(txDb)).toThrow(DatabaseError);
            expect(isForeignKeysEnabled(txDb.connection)).toBe(true);
        } finally {
            txDb.exec('ROLLBACK;');
        }
    });

    it('throws from restore() when called inside a transaction or after close', () => {
        const txDb = trackDb(new Database(':memory:'));
        const txGuard = new ForeignKeysGuard(txDb);
        txDb.exec('BEGIN IMMEDIATE;');
        try {
            expect(() => {
                txGuard.restore();
            }).toThrow(DatabaseError);
        } finally {
            txDb.exec('ROLLBACK;');
        }
        txGuard.restore();
        expect(isForeignKeysEnabled(txDb.connection)).toBe(true);

        const closedDb = trackDb(new Database(':memory:'));
        const closedGuard = new ForeignKeysGuard(closedDb);
        closedDb.close();
        expect(() => {
            closedGuard.restore();
        }).toThrow(DatabaseError);
    });

    it('logs and suppresses errors in restoreBestEffort()', () => {
        const chunks: string[] = [];
        const stream = new Writable({
            write(chunk: Buffer | string, _encoding, callback) {
                chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
                callback();
            },
        });
        const logger = createLogger({ destination: stream, level: 'error', pretty: false });

        const db = trackDb(new Database(':memory:'));
        const guard = new ForeignKeysGuard(db, logger);
        db.close();

        expect(() => {
            guard.restoreBestEffort();
        }).not.toThrow();

        const output = chunks.join('');
        expect(output).toContain('Failed to restore foreign key enforcement');
    });
});
