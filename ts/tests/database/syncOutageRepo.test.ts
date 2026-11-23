import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseError } from '../../src/common/errors.js';
import {
    Database,
    MigratorManager,
    SyncOutageRepo,
    TransactionManager,
} from '../../src/database/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../../src/database/migrations');

function createMigratedDb(): Database {
    const db = new Database(':memory:');
    const txManager = new TransactionManager(db);
    const migrator = new MigratorManager(db, txManager);
    migrator.migrate(REAL_MIGRATIONS_PATH);
    return db;
}

function seedClan(db: Database, clanTag: string): void {
    db.connection
        .prepare('INSERT INTO clans (tag, name, tracking_enabled) VALUES (?, ?, 1);')
        .run(clanTag, 'Test Clan');
}

describe('SyncOutageRepo', () => {
    const openDatabases: Database[] = [];

    function setup(): { db: Database; repo: SyncOutageRepo } {
        const db = createMigratedDb();
        openDatabases.push(db);
        return { db, repo: new SyncOutageRepo(db) };
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('opens one outage per (clan_tag, service_name), increments failure_count, and opens a new ID after recovery', () => {
        const { db, repo } = setup();
        seedClan(db, '#CLAN1');

        expect(repo.getOpenOutageId('#CLAN1', 'ClanInfoService')).toBeNull();

        const first = repo.recordFailure('#CLAN1', 'ClanInfoService');
        expect(first.failureCount).toBe(1);
        expect(repo.getOpenOutageId('#CLAN1', 'ClanInfoService')).toBe(first.id);

        const second = repo.recordFailure('#CLAN1', 'ClanInfoService');
        expect(second).toEqual({ id: first.id, failureCount: 2 });

        const third = repo.recordFailure('#CLAN1', 'ClanInfoService');
        expect(third).toEqual({ id: first.id, failureCount: 3 });

        // Close the episode.
        expect(repo.markRecovered(first.id)).toBe(true);
        expect(repo.getOpenOutageId('#CLAN1', 'ClanInfoService')).toBeNull();

        // Repeated markRecovered is idempotent.
        expect(repo.markRecovered(first.id)).toBe(false);

        // Next failure after recovery creates a new episode with a strictly new ID.
        const nextEpisode = repo.recordFailure('#CLAN1', 'ClanInfoService');
        expect(nextEpisode.id).toBeGreaterThan(first.id);
        expect(nextEpisode.failureCount).toBe(1);
        expect(repo.getOpenOutageId('#CLAN1', 'ClanInfoService')).toBe(nextEpisode.id);

        const totalRows = db.connection
            .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM sync_outages;')
            .get();
        expect(totalRows?.count).toBe(2);
    });

    it('tracks independent open outages per service_name and clan_tag', () => {
        const { db, repo } = setup();
        seedClan(db, '#CLAN1');
        seedClan(db, '#CLAN2');

        const infoOutage = repo.recordFailure('#CLAN1', 'ClanInfoService');
        const warOutage = repo.recordFailure('#CLAN1', 'ClanwarService');
        const cwlOutage = repo.recordFailure('#CLAN1', 'ClanwarLeagueService');
        const raidOutage = repo.recordFailure('#CLAN1', 'RaidService');
        const otherClanOutage = repo.recordFailure('#CLAN2', 'ClanInfoService');

        const ids = new Set([
            infoOutage.id,
            warOutage.id,
            cwlOutage.id,
            raidOutage.id,
            otherClanOutage.id,
        ]);
        expect(ids.size).toBe(5);

        repo.markRecovered(warOutage.id);
        expect(repo.getOpenOutageId('#CLAN1', 'ClanwarService')).toBeNull();
        expect(repo.getOpenOutageId('#CLAN1', 'ClanInfoService')).toBe(infoOutage.id);
        expect(repo.getOpenOutageId('#CLAN2', 'ClanInfoService')).toBe(otherClanOutage.id);
    });

    it('throws DatabaseError when recording a failure for a non-existent clan', () => {
        const { repo } = setup();

        expect(() => {
            repo.recordFailure('#MISSING', 'ClanInfoService');
        }).toThrow(DatabaseError);
    });
});
