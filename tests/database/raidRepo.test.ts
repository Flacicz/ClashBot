import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseError } from '../../src/common/errors.js';
import {
    ClansRepo,
    Database,
    MigratorManager,
    RaidRepo,
    TransactionManager,
} from '../../src/database/index.js';
import type { ClanRaid, PlayerRaidSnapshot } from '../../src/models/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');

function makeRaid(overrides: Partial<ClanRaid> = {}): ClanRaid {
    return {
        clanTag: '#CLAN1',
        startTime: 1_700_000_000,
        endTime: 1_700_259_200,
        state: 'ended',
        totalLoot: 120_000,
        raidsCompleted: 10,
        totalAttacks: 60,
        enemyDistrictsDestroyed: 55,
        offensiveReward: 1200,
        defensiveReward: 300,
        ...overrides,
    };
}

describe('RaidRepo', () => {
    const openDatabases: Database[] = [];

    function createMigratedDb(): {
        db: Database;
        tx: TransactionManager;
        clansRepo: ClansRepo;
        raidRepo: RaidRepo;
    } {
        const db = new Database(':memory:');
        openDatabases.push(db);
        const tx = new TransactionManager(db);
        const migrator = new MigratorManager(db, tx);
        migrator.migrate(REAL_MIGRATIONS_PATH);
        return {
            db,
            tx,
            clansRepo: new ClansRepo(db),
            raidRepo: new RaidRepo(db),
        };
    }

    function insertMembership(
        db: Database,
        clanTag: string,
        playerTag: string,
        joinedAt: number,
        leftAt: number | null = null,
    ): void {
        db.connection
            .prepare(
                'INSERT INTO clan_memberships (clan_tag, player_tag, joined_at, left_at) VALUES (?, ?, ?, ?)',
            )
            .run(clanTag, playerTag, joinedAt, leftAt);
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('saves and idempotently updates raid and player snapshots by unique keys', () => {
        const { db, tx, clansRepo, raidRepo } = createMigratedDb();

        clansRepo.insertMinimalClan('#CLAN1');
        clansRepo.savePlayers([
            { tag: '#P1', name: 'Alice', clanTag: '#CLAN1' },
            { tag: '#P2', name: 'Bob', clanTag: '#CLAN1' },
        ]);

        const initialSnapshots: PlayerRaidSnapshot[] = [
            { playerTag: '#P1', attacksCount: 3, bonusAttack: 0, totalLoot: 12_000 },
            { playerTag: '#P2', attacksCount: 5, bonusAttack: 1, totalLoot: 22_000 },
        ];

        const firstRef = tx.retryInTransaction(() =>
            raidRepo.saveCompleteRaidData(
                makeRaid({
                    state: 'ongoing',
                    totalLoot: 34_000,
                    raidsCompleted: 3,
                    totalAttacks: 8,
                    enemyDistrictsDestroyed: 10,
                    offensiveReward: 400,
                    defensiveReward: 100,
                }),
                initialSnapshots,
            ),
        );

        // Saving empty snapshot list is a no-op
        raidRepo.saveRaidPlayerSnapshots(firstRef, []);

        // Idempotent re-save on same (clan_tag, start_time) updates stats and keeps same raidId
        const secondRef = tx.retryInTransaction(() =>
            raidRepo.saveCompleteRaidData(
                makeRaid({
                    state: 'ended',
                    endTime: 1_700_999_999,
                    totalLoot: 50_000,
                    raidsCompleted: 5,
                    totalAttacks: 12,
                    enemyDistrictsDestroyed: 18,
                    offensiveReward: 900,
                    defensiveReward: 250,
                }),
                [
                    { playerTag: '#P1', attacksCount: 6, bonusAttack: 1, totalLoot: 28_000 },
                    { playerTag: '#P2', attacksCount: 6, bonusAttack: 1, totalLoot: 22_000 },
                ],
            ),
        );

        expect(secondRef).toEqual(firstRef);
        expect(raidRepo.getRaidStats(firstRef)).toEqual({
            totalLoot: 50_000,
            raidsCompleted: 5,
            totalAttacks: 12,
            enemyDistrictsDestroyed: 18,
            offensiveReward: 900,
            defensiveReward: 250,
        });

        // Verify no duplicate rows and that ON CONFLICT preserves initial state & end_time (C++ parity)
        const raidRow = db.connection
            .prepare('SELECT COUNT(*) AS cnt, state, end_time FROM clan_raids WHERE clan_tag = ?')
            .get('#CLAN1') as { cnt: number; state: string; end_time: number };
        expect(raidRow).toEqual({ cnt: 1, state: 'ongoing', end_time: 1_700_259_200 });

        const snapshotCount = db.connection
            .prepare('SELECT COUNT(*) AS cnt FROM player_raid_snapshots WHERE raid_id = ?')
            .get(firstRef.raidId) as { cnt: number };
        expect(snapshotCount.cnt).toBe(2);
    });

    it('throws DatabaseError for missing raid or FK violations', () => {
        const { raidRepo } = createMigratedDb();

        expect(() => raidRepo.getRaidStats({ raidId: 999 })).toThrow(DatabaseError);
        expect(() => raidRepo.getRaidComparisonStats({ raidId: 999 })).toThrow(DatabaseError);
        expect(() => raidRepo.saveRaid(makeRaid({ clanTag: '#NO_CLAN' }))).toThrow(DatabaseError);
    });

    it('returns top 3 best raid members ordered by total_loot DESC, player_tag ASC', () => {
        const { clansRepo, raidRepo } = createMigratedDb();

        clansRepo.insertMinimalClan('#CLAN1');
        clansRepo.savePlayers([
            { tag: '#P4', name: 'Delta', clanTag: '#CLAN1' },
            { tag: '#P2', name: 'Bravo', clanTag: '#CLAN1' },
            { tag: '#P1', name: 'Alpha', clanTag: '#CLAN1' },
            { tag: '#P3', name: 'Charlie', clanTag: '#CLAN1' },
        ]);

        const raidRef = raidRepo.saveCompleteRaidData(makeRaid(), [
            { playerTag: '#P4', attacksCount: 6, bonusAttack: 1, totalLoot: 30_000 },
            { playerTag: '#P2', attacksCount: 6, bonusAttack: 1, totalLoot: 25_000 },
            { playerTag: '#P1', attacksCount: 5, bonusAttack: 0, totalLoot: 25_000 },
            { playerTag: '#P3', attacksCount: 5, bonusAttack: 0, totalLoot: 10_000 },
        ]);

        expect(raidRepo.getBestRaidMembers(raidRef)).toEqual([
            {
                playerTag: '#P4',
                playerName: 'Delta',
                attacksCount: 6,
                bonusAttacks: 1,
                totalLoot: 30_000,
            },
            {
                playerTag: '#P1',
                playerName: 'Alpha',
                attacksCount: 5,
                bonusAttacks: 0,
                totalLoot: 25_000,
            },
            {
                playerTag: '#P2',
                playerName: 'Bravo',
                attacksCount: 6,
                bonusAttacks: 1,
                totalLoot: 25_000,
            },
        ]);

        // Empty raid returns []
        const emptyRef = raidRepo.saveRaid(makeRaid({ startTime: 1_701_000_000 }));
        expect(raidRepo.getBestRaidMembers(emptyRef)).toEqual([]);
    });

    it('computes raid slackers and comparison stats using active membership at raid end_time', () => {
        const { db, clansRepo, raidRepo } = createMigratedDb();

        const startTime = 1_700_000_000;
        const endTime = 1_700_259_200;

        clansRepo.insertMinimalClan('#CLAN1');
        clansRepo.savePlayers([
            { tag: '#FULL', name: 'FullAttacks', clanTag: '#CLAN1' },
            { tag: '#BONUS_MISS', name: 'MissedBonus', clanTag: '#CLAN1' },
            { tag: '#PARTIAL', name: 'Partial', clanTag: '#CLAN1' },
            { tag: '#NOSNAP', name: 'ZeroAttacks', clanTag: '#CLAN1' },
            { tag: '#LEFT_EARLY', name: 'LeftBeforeEnd', clanTag: '#CLAN1' },
            { tag: '#LEFT_AFTER', name: 'LeftAfterEnd', clanTag: '#CLAN1' },
            { tag: '#JOINED_LATE', name: 'JoinedAfterEnd', clanTag: '#CLAN1' },
        ]);

        // Eligible at endTime: #FULL, #BONUS_MISS, #PARTIAL, #NOSNAP, #LEFT_AFTER (5 eligible)
        insertMembership(db, '#CLAN1', '#FULL', startTime - 1000, null);
        insertMembership(db, '#CLAN1', '#BONUS_MISS', startTime - 1000, null);
        insertMembership(db, '#CLAN1', '#PARTIAL', startTime - 1000, null);
        insertMembership(db, '#CLAN1', '#NOSNAP', startTime - 1000, null);
        insertMembership(db, '#CLAN1', '#LEFT_AFTER', startTime - 1000, endTime);
        // Not eligible at endTime:
        insertMembership(db, '#CLAN1', '#LEFT_EARLY', startTime - 1000, endTime - 1);
        insertMembership(db, '#CLAN1', '#JOINED_LATE', endTime + 1, null);

        const raidRef = raidRepo.saveCompleteRaidData(
            makeRaid({
                startTime,
                endTime,
                totalLoot: 90_000,
                raidsCompleted: 8,
                totalAttacks: 23,
                enemyDistrictsDestroyed: 40,
                offensiveReward: 1100,
                defensiveReward: 250,
            }),
            [
                // Eligible, finished all 6 (5 + 1 bonus)
                { playerTag: '#FULL', attacksCount: 6, bonusAttack: 1, totalLoot: 30_000 },
                // Eligible, did 5 but earned bonus attack (5 < 5 + 1 => slacker)
                { playerTag: '#BONUS_MISS', attacksCount: 5, bonusAttack: 1, totalLoot: 25_000 },
                // Eligible, did 2/5 => slacker
                { playerTag: '#PARTIAL', attacksCount: 2, bonusAttack: 0, totalLoot: 10_000 },
                // Left before raid end, did 5/5 => active participant & all attacks used, but NOT eligible
                { playerTag: '#LEFT_EARLY', attacksCount: 5, bonusAttack: 0, totalLoot: 20_000 },
                // Left at endTime, did 5/5 => eligible & finished all attacks
                { playerTag: '#LEFT_AFTER', attacksCount: 5, bonusAttack: 0, totalLoot: 5_000 },
                // #NOSNAP has no snapshot row => eligible slacker with 0/5
            ],
        );

        // Slackers: #NOSNAP (0/5), #PARTIAL (2/5), #BONUS_MISS (5/6)
        // Ordered by attacks_done ASC, p.name ASC
        expect(raidRepo.getRaidSlackers(raidRef)).toEqual([
            { playerTag: '#NOSNAP', playerName: 'ZeroAttacks', attacksCount: 0, bonusAttacks: 0 },
            { playerTag: '#PARTIAL', playerName: 'Partial', attacksCount: 2, bonusAttacks: 0 },
            {
                playerTag: '#BONUS_MISS',
                playerName: 'MissedBonus',
                attacksCount: 5,
                bonusAttacks: 1,
            },
        ]);

        // Comparison stats:
        // usedAttacks = 6 + 5 + 2 + 5 + 5 = 23
        // availableAttacks (eligible only):
        //   #FULL(6) + #BONUS_MISS(6) + #PARTIAL(5) + #NOSNAP(5) + #LEFT_AFTER(5) = 27
        // activeParticipants = 5 (snapshots count)
        // eligibleParticipants = 5 (#FULL, #BONUS_MISS, #PARTIAL, #NOSNAP, #LEFT_AFTER)
        // participantsWithAllAttacksUsed = 3 (#FULL 6>=6, #LEFT_EARLY 5>=5, #LEFT_AFTER 5>=5)
        // participantsWithoutAttacks = 1 (#NOSNAP)
        expect(raidRepo.getRaidComparisonStats(raidRef)).toEqual({
            startTime,
            totalLoot: 90_000,
            raidsCompleted: 8,
            usedAttacks: 23,
            availableAttacks: 27,
            activeParticipants: 5,
            eligibleParticipants: 5,
            participantsWithAllAttacksUsed: 3,
            participantsWithoutAttacks: 1,
            enemyDistrictsDestroyed: 40,
            offensiveReward: 1100,
            defensiveReward: 250,
        });
    });

    it('returns zeroed comparison stats for a raid with no snapshots and no eligible members', () => {
        const { clansRepo, raidRepo } = createMigratedDb();

        clansRepo.insertMinimalClan('#CLAN1');
        const raidRef = raidRepo.saveRaid(
            makeRaid({
                startTime: 1_700_000_000,
                totalLoot: 0,
                raidsCompleted: 0,
                totalAttacks: 0,
                enemyDistrictsDestroyed: 0,
                offensiveReward: 0,
                defensiveReward: 0,
            }),
        );

        expect(raidRepo.getRaidSlackers(raidRef)).toEqual([]);
        expect(raidRepo.getRaidComparisonStats(raidRef)).toEqual({
            startTime: 1_700_000_000,
            totalLoot: 0,
            raidsCompleted: 0,
            usedAttacks: 0,
            availableAttacks: 0,
            activeParticipants: 0,
            eligibleParticipants: 0,
            participantsWithAllAttacksUsed: 0,
            participantsWithoutAttacks: 0,
            enemyDistrictsDestroyed: 0,
            offensiveReward: 0,
            defensiveReward: 0,
        });
    });

    it('loads previous raids for the same clan ordered by start_time DESC with limit handling', () => {
        const { clansRepo, raidRepo } = createMigratedDb();

        clansRepo.insertMinimalClan('#CLAN1');
        clansRepo.insertMinimalClan('#CLAN2');

        const r1 = raidRepo.saveRaid(makeRaid({ clanTag: '#CLAN1', startTime: 1000 }));
        const r2 = raidRepo.saveRaid(makeRaid({ clanTag: '#CLAN1', startTime: 2000 }));
        const r3 = raidRepo.saveRaid(makeRaid({ clanTag: '#CLAN1', startTime: 3000 }));
        const r4 = raidRepo.saveRaid(makeRaid({ clanTag: '#CLAN1', startTime: 4000 }));
        const r5 = raidRepo.saveRaid(makeRaid({ clanTag: '#CLAN1', startTime: 5000 }));
        // Another clan's raid must not leak into #CLAN1 history
        raidRepo.saveRaid(makeRaid({ clanTag: '#CLAN2', startTime: 3500 }));

        // Empty history for oldest raid
        expect(raidRepo.getPreviousRaids(r1, 3)).toEqual([]);

        // Non-positive limits return []
        expect(raidRepo.getPreviousRaids(r4, 0)).toEqual([]);
        expect(raidRepo.getPreviousRaids(r4, -2)).toEqual([]);

        // Limit 1 returns immediate previous raid
        expect(raidRepo.getPreviousRaids(r4, 1)).toEqual([r3]);

        // Limit 3 returns up to 3 previous raids ordered newest first, excluding r5 (future) and #CLAN2
        expect(raidRepo.getPreviousRaids(r4, 3)).toEqual([r3, r2, r1]);
        expect(raidRepo.getPreviousRaids(r5, 3)).toEqual([r4, r3, r2]);

        // Unknown raidId returns []
        expect(raidRepo.getPreviousRaids({ raidId: 9999 }, 3)).toEqual([]);
    });
});
