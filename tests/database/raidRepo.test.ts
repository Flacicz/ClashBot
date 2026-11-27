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

        // Verify no duplicate rows and that ON CONFLICT updates state and end_time
        const raidRow = db.connection
            .prepare('SELECT COUNT(*) AS cnt, state, end_time FROM clan_raids WHERE clan_tag = ?')
            .get('#CLAN1') as { cnt: number; state: string; end_time: number };
        expect(raidRow).toEqual({ cnt: 1, state: 'ended', end_time: 1_700_999_999 });

        const snapshotCount = db.connection
            .prepare('SELECT COUNT(*) AS cnt FROM player_raid_snapshots WHERE raid_id = ?')
            .get(firstRef.raidId) as { cnt: number };
        expect(snapshotCount.cnt).toBe(2);
    });

    it('updates state and end_time on conflict across ongoing -> ended transition and repeated saves', () => {
        const { db, tx, clansRepo, raidRepo } = createMigratedDb();

        clansRepo.insertMinimalClan('#CLAN1');

        const startTime = 1_700_000_000;
        const initialEndTime = 1_700_259_200;
        const updatedEndTime = 1_700_262_800;

        // 1. Initial save in ongoing state
        const firstRef = tx.retryInTransaction(() =>
            raidRepo.saveRaid(
                makeRaid({
                    clanTag: '#CLAN1',
                    startTime,
                    endTime: initialEndTime,
                    state: 'ongoing',
                    totalLoot: 40_000,
                    raidsCompleted: 4,
                    totalAttacks: 20,
                    enemyDistrictsDestroyed: 15,
                    offensiveReward: 500,
                    defensiveReward: 100,
                }),
            ),
        );

        const ongoingRow = db.connection
            .prepare(
                `SELECT id, clan_tag, start_time, end_time, state,
                        total_loot, raids_completed, total_attacks,
                        enemy_districts_destroyed, offensive_reward, defensive_reward
                 FROM clan_raids
                 WHERE id = ?`,
            )
            .get(firstRef.raidId);
        expect(ongoingRow).toEqual({
            id: firstRef.raidId,
            clan_tag: '#CLAN1',
            start_time: startTime,
            end_time: initialEndTime,
            state: 'ongoing',
            total_loot: 40_000,
            raids_completed: 4,
            total_attacks: 20,
            enemy_districts_destroyed: 15,
            offensive_reward: 500,
            defensive_reward: 100,
        });

        // 2. Transition ongoing -> ended with changed end_time and final stats
        const endedRef = tx.retryInTransaction(() =>
            raidRepo.saveRaid(
                makeRaid({
                    clanTag: '#CLAN1',
                    startTime,
                    endTime: updatedEndTime,
                    state: 'ended',
                    totalLoot: 120_000,
                    raidsCompleted: 10,
                    totalAttacks: 60,
                    enemyDistrictsDestroyed: 55,
                    offensiveReward: 1200,
                    defensiveReward: 300,
                }),
            ),
        );

        expect(endedRef).toEqual(firstRef);

        const endedRow = db.connection
            .prepare(
                `SELECT id, clan_tag, start_time, end_time, state,
                        total_loot, raids_completed, total_attacks,
                        enemy_districts_destroyed, offensive_reward, defensive_reward
                 FROM clan_raids
                 WHERE id = ?`,
            )
            .get(firstRef.raidId);
        expect(endedRow).toEqual({
            id: firstRef.raidId,
            clan_tag: '#CLAN1',
            start_time: startTime,
            end_time: updatedEndTime,
            state: 'ended',
            total_loot: 120_000,
            raids_completed: 10,
            total_attacks: 60,
            enemy_districts_destroyed: 55,
            offensive_reward: 1200,
            defensive_reward: 300,
        });

        // 3. Repeated idempotent save of the ended raid keeps same id, state, end_time and single row
        const repeatedRef = tx.retryInTransaction(() =>
            raidRepo.saveRaid(
                makeRaid({
                    clanTag: '#CLAN1',
                    startTime,
                    endTime: updatedEndTime,
                    state: 'ended',
                    totalLoot: 120_000,
                    raidsCompleted: 10,
                    totalAttacks: 60,
                    enemyDistrictsDestroyed: 55,
                    offensiveReward: 1200,
                    defensiveReward: 300,
                }),
            ),
        );

        expect(repeatedRef).toEqual(firstRef);

        const countRow = db.connection
            .prepare('SELECT COUNT(*) AS cnt FROM clan_raids WHERE clan_tag = ? AND start_time = ?')
            .get('#CLAN1', startTime) as { cnt: number };
        expect(countRow.cnt).toBe(1);
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

    it('returns API player names for guest participants without clan roster snapshots and preserves known names on empty updates', () => {
        const { clansRepo, raidRepo } = createMigratedDb();

        clansRepo.insertMinimalClan('#CLAN1');
        // Guest with API name (no clan_memberships, no player_snapshots)
        clansRepo.insertMinimal('#GUEST_NAMED', 'Guest Striker');
        // Guest initially saved without name, then resolved from raid API
        clansRepo.insertMinimal('#GUEST_RESOLVED');
        clansRepo.insertMinimal('#GUEST_RESOLVED', 'Resolved Guest');
        // Brand-new guest without name falls back to Unknown Player
        clansRepo.insertMinimal('#GUEST_NAMELESS');

        const raidRef = raidRepo.saveCompleteRaidData(makeRaid(), [
            {
                playerTag: '#GUEST_NAMED',
                playerName: 'Guest Striker',
                attacksCount: 6,
                bonusAttack: 1,
                totalLoot: 32_000,
            },
            {
                playerTag: '#GUEST_RESOLVED',
                playerName: 'Resolved Guest',
                attacksCount: 5,
                bonusAttack: 0,
                totalLoot: 24_000,
            },
            {
                playerTag: '#GUEST_NAMELESS',
                attacksCount: 5,
                bonusAttack: 0,
                totalLoot: 18_000,
            },
        ]);

        expect(raidRepo.getBestRaidMembers(raidRef)).toEqual([
            {
                playerTag: '#GUEST_NAMED',
                playerName: 'Guest Striker',
                attacksCount: 6,
                bonusAttacks: 1,
                totalLoot: 32_000,
            },
            {
                playerTag: '#GUEST_RESOLVED',
                playerName: 'Resolved Guest',
                attacksCount: 5,
                bonusAttacks: 0,
                totalLoot: 24_000,
            },
            {
                playerTag: '#GUEST_NAMELESS',
                playerName: 'Unknown Player',
                attacksCount: 5,
                bonusAttacks: 0,
                totalLoot: 18_000,
            },
        ]);

        // Updating known guest name updates reported current name; blank/missing name preserves it
        clansRepo.insertMinimal('#GUEST_NAMED', 'Guest Renamed');
        clansRepo.insertMinimal('#GUEST_NAMED');
        clansRepo.insertMinimal('#GUEST_NAMED', '');
        clansRepo.insertMinimal('#GUEST_NAMED', '   ');

        expect(raidRepo.getBestRaidMembers(raidRef)[0]?.playerName).toBe('Guest Renamed');
    });

    it('computes raid slackers and comparison stats using membership at raid start_time through end_time', () => {
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

        // Eligible (in clan at startTime and stayed through endTime):
        // #FULL, #BONUS_MISS, #PARTIAL, #NOSNAP, #LEFT_AFTER (5 eligible)
        insertMembership(db, '#CLAN1', '#FULL', startTime - 1000, null);
        insertMembership(db, '#CLAN1', '#BONUS_MISS', startTime - 1000, null);
        insertMembership(db, '#CLAN1', '#PARTIAL', startTime - 1000, null);
        insertMembership(db, '#CLAN1', '#NOSNAP', startTime - 1000, null);
        insertMembership(db, '#CLAN1', '#LEFT_AFTER', startTime - 1000, endTime);
        // Not eligible:
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

        // Comparison stats (cohort-only numerators and denominators; #LEFT_EARLY isolated into external context):
        // usedAttacks (eligible only) = #FULL(6) + #BONUS_MISS(5) + #PARTIAL(2) + #LEFT_AFTER(5) = 18
        // availableAttacks (eligible only):
        //   #FULL(6) + #BONUS_MISS(6) + #PARTIAL(5) + #NOSNAP(5) + #LEFT_AFTER(5) = 27
        // activeParticipants (eligible with attacks_count > 0) = 4 (#FULL, #BONUS_MISS, #PARTIAL, #LEFT_AFTER)
        // eligibleParticipants = 5 (#FULL, #BONUS_MISS, #PARTIAL, #NOSNAP, #LEFT_AFTER)
        // participantsWithAllAttacksUsed (eligible only) = 2 (#FULL 6>=6, #LEFT_AFTER 5>=5)
        // participantsWithoutAttacks = 1 (#NOSNAP)
        // externalUsedAttacks = 5 (#LEFT_EARLY), externalParticipants = 1 (#LEFT_EARLY)
        expect(raidRepo.getRaidComparisonStats(raidRef)).toEqual({
            startTime,
            totalLoot: 90_000,
            raidsCompleted: 8,
            usedAttacks: 18,
            availableAttacks: 27,
            activeParticipants: 4,
            eligibleParticipants: 5,
            participantsWithAllAttacksUsed: 2,
            participantsWithoutAttacks: 1,
            externalUsedAttacks: 5,
            externalParticipants: 1,
            enemyDistrictsDestroyed: 40,
            offensiveReward: 1100,
            defensiveReward: 250,
        });
    });

    it('excludes late joiners after raid start_time from slackers and eligible cohort while keeping their attacks in overall totals', () => {
        const { db, clansRepo, raidRepo } = createMigratedDb();

        const startTime = 1_700_000_000;
        const endTime = 1_700_259_200;

        clansRepo.insertMinimalClan('#CLAN1');
        clansRepo.savePlayers([
            { tag: '#AT_START', name: 'AtStartBoundary', clanTag: '#CLAN1' },
            { tag: '#LATE_NONE', name: 'LateNoAttacks', clanTag: '#CLAN1' },
            { tag: '#LATE_PARTIAL', name: 'LatePartial', clanTag: '#CLAN1' },
            { tag: '#LATE_END', name: 'LateAtEnd', clanTag: '#CLAN1' },
            { tag: '#REJOINED', name: 'LeftAndRejoined', clanTag: '#CLAN1' },
        ]);

        // Joined exactly at startTime => eligible
        insertMembership(db, '#CLAN1', '#AT_START', startTime, null);
        // Joined 1 second after startTime => NOT eligible
        insertMembership(db, '#CLAN1', '#LATE_NONE', startTime + 1, null);
        // Joined near endTime and did partial attacks => NOT eligible, but attacks still count in totals
        insertMembership(db, '#CLAN1', '#LATE_PARTIAL', endTime - 3600, null);
        // Joined exactly at endTime => NOT eligible
        insertMembership(db, '#CLAN1', '#LATE_END', endTime, null);
        // Left mid-raid and rejoined before endTime => NOT continuously present [startTime, endTime]
        insertMembership(db, '#CLAN1', '#REJOINED', startTime - 500, startTime + 1000);
        insertMembership(db, '#CLAN1', '#REJOINED', endTime - 1000, null);

        const raidRef = raidRepo.saveCompleteRaidData(
            makeRaid({
                startTime,
                endTime,
                totalLoot: 45_000,
                raidsCompleted: 4,
                totalAttacks: 6,
                enemyDistrictsDestroyed: 12,
                offensiveReward: 700,
                defensiveReward: 150,
            }),
            [
                // Eligible at boundary, incomplete (3/5) => slacker
                { playerTag: '#AT_START', attacksCount: 3, bonusAttack: 0, totalLoot: 20_000 },
                // Late joiner with partial attacks (2/5) => excluded from slackers, counted in overall stats
                { playerTag: '#LATE_PARTIAL', attacksCount: 2, bonusAttack: 0, totalLoot: 15_000 },
                // Rejoined player with 1 attack => excluded from slackers, counted in overall stats
                { playerTag: '#REJOINED', attacksCount: 1, bonusAttack: 0, totalLoot: 10_000 },
            ],
        );

        // Only #AT_START is obligated to play the raid
        expect(raidRepo.getRaidSlackers(raidRef)).toEqual([
            {
                playerTag: '#AT_START',
                playerName: 'AtStartBoundary',
                attacksCount: 3,
                bonusAttacks: 0,
            },
        ]);

        // Late joiner attacks remain in overall raid stats and best members
        expect(raidRepo.getRaidStats(raidRef).totalAttacks).toBe(6);
        expect(raidRepo.getBestRaidMembers(raidRef).map((m) => m.playerTag)).toEqual([
            '#AT_START',
            '#LATE_PARTIAL',
            '#REJOINED',
        ]);

        // Comparison stats keep rate numerators strictly within the eligible cohort (#AT_START)
        // and report #LATE_PARTIAL + #REJOINED attacks in external context so no share exceeds 100%
        expect(raidRepo.getRaidComparisonStats(raidRef)).toEqual({
            startTime,
            totalLoot: 45_000,
            raidsCompleted: 4,
            usedAttacks: 3,
            availableAttacks: 5,
            activeParticipants: 1,
            eligibleParticipants: 1,
            participantsWithAllAttacksUsed: 0,
            participantsWithoutAttacks: 0,
            externalUsedAttacks: 3,
            externalParticipants: 2,
            enemyDistrictsDestroyed: 12,
            offensiveReward: 700,
            defensiveReward: 150,
        });
    });

    it('isolates guest and leaver attacks into external context so no comparison share exceeds 100%', () => {
        const { db, clansRepo, raidRepo } = createMigratedDb();

        const startTime = 1_700_000_000;
        const endTime = 1_700_259_200;

        clansRepo.insertMinimalClan('#CLAN1');
        clansRepo.savePlayers([
            { tag: '#ELIG_FULL', name: 'EligibleFull', clanTag: '#CLAN1' },
            { tag: '#ELIG_PARTIAL', name: 'EligiblePartial', clanTag: '#CLAN1' },
            { tag: '#LEAVER', name: 'AttackedAndLeft', clanTag: '#CLAN1' },
            { tag: '#GUEST', name: 'VisitingGuest', clanTag: '#CLAN1' },
            { tag: '#GUEST_ZERO', name: 'GuestZeroAttacks', clanTag: '#CLAN1' },
        ]);

        // Eligible cohort: #ELIG_FULL and #ELIG_PARTIAL
        insertMembership(db, '#CLAN1', '#ELIG_FULL', startTime - 500, null);
        insertMembership(db, '#CLAN1', '#ELIG_PARTIAL', startTime - 500, null);
        // Attacked and left before endTime
        insertMembership(db, '#CLAN1', '#LEAVER', startTime - 500, endTime - 10);
        // #GUEST and #GUEST_ZERO have no clan_memberships rows for #CLAN1

        const raidRef = raidRepo.saveCompleteRaidData(
            makeRaid({
                startTime,
                endTime,
                totalLoot: 110_000,
                raidsCompleted: 6,
                totalAttacks: 21,
                enemyDistrictsDestroyed: 28,
                offensiveReward: 1_150,
                defensiveReward: 310,
            }),
            [
                { playerTag: '#ELIG_FULL', attacksCount: 6, bonusAttack: 1, totalLoot: 35_000 },
                { playerTag: '#ELIG_PARTIAL', attacksCount: 4, bonusAttack: 0, totalLoot: 20_000 },
                { playerTag: '#LEAVER', attacksCount: 5, bonusAttack: 0, totalLoot: 25_000 },
                { playerTag: '#GUEST', attacksCount: 6, bonusAttack: 1, totalLoot: 30_000 },
                { playerTag: '#GUEST_ZERO', attacksCount: 0, bonusAttack: 0, totalLoot: 0 },
            ],
        );

        const stats = raidRepo.getRaidComparisonStats(raidRef);
        expect(stats).toEqual({
            startTime,
            totalLoot: 110_000,
            raidsCompleted: 6,
            usedAttacks: 10,
            availableAttacks: 11,
            activeParticipants: 2,
            eligibleParticipants: 2,
            participantsWithAllAttacksUsed: 1,
            participantsWithoutAttacks: 0,
            externalUsedAttacks: 11,
            externalParticipants: 2,
            enemyDistrictsDestroyed: 28,
            offensiveReward: 1_150,
            defensiveReward: 310,
        });

        // Invariant: no cohort share exceeds 100%
        expect(stats.usedAttacks).toBeLessThanOrEqual(stats.availableAttacks);
        expect(stats.activeParticipants).toBeLessThanOrEqual(stats.eligibleParticipants);
        expect(stats.participantsWithAllAttacksUsed).toBeLessThanOrEqual(stats.activeParticipants);
        expect(stats.participantsWithoutAttacks).toBeLessThanOrEqual(stats.eligibleParticipants);
        expect(stats.activeParticipants + stats.participantsWithoutAttacks).toBe(
            stats.eligibleParticipants,
        );

        // Edge case: raid with 0 eligible members and only guest attacks
        const guestOnlyRaidRef = raidRepo.saveCompleteRaidData(
            makeRaid({
                startTime: startTime + 1_000_000,
                endTime: endTime + 1_000_000,
                totalLoot: 30_000,
                raidsCompleted: 2,
                totalAttacks: 6,
                enemyDistrictsDestroyed: 6,
                offensiveReward: 500,
                defensiveReward: 100,
            }),
            [{ playerTag: '#GUEST', attacksCount: 6, bonusAttack: 1, totalLoot: 30_000 }],
        );
        // Close existing memberships before guest-only raid start
        db.connection
            .prepare('UPDATE clan_memberships SET left_at = ? WHERE left_at IS NULL')
            .run(startTime + 500_000);

        expect(raidRepo.getRaidComparisonStats(guestOnlyRaidRef)).toEqual({
            startTime: startTime + 1_000_000,
            totalLoot: 30_000,
            raidsCompleted: 2,
            usedAttacks: 0,
            availableAttacks: 0,
            activeParticipants: 0,
            eligibleParticipants: 0,
            participantsWithAllAttacksUsed: 0,
            participantsWithoutAttacks: 0,
            externalUsedAttacks: 6,
            externalParticipants: 1,
            enemyDistrictsDestroyed: 6,
            offensiveReward: 500,
            defensiveReward: 100,
        });
    });

    it('treats player_raid_snapshots with attacks_count = 0 as did not attack consistently in getRaidSlackers and getRaidComparisonStats', () => {
        const { db, clansRepo, raidRepo } = createMigratedDb();

        const startTime = 1_700_000_000;
        const endTime = 1_700_259_200;

        clansRepo.insertMinimalClan('#CLAN1');
        clansRepo.savePlayers([
            { tag: '#FULL', name: 'AlphaFull', clanTag: '#CLAN1' },
            { tag: '#ZERO_SNAP', name: 'BravoZeroSnapshot', clanTag: '#CLAN1' },
            { tag: '#ZERO_SNAP_BONUS', name: 'CharlieZeroSnapshotBonus', clanTag: '#CLAN1' },
            { tag: '#NO_SNAP', name: 'DeltaNoSnapshot', clanTag: '#CLAN1' },
            { tag: '#LATE_ZERO_SNAP', name: 'EchoLateZeroSnapshot', clanTag: '#CLAN1' },
        ]);

        insertMembership(db, '#CLAN1', '#FULL', startTime - 1000, null);
        insertMembership(db, '#CLAN1', '#ZERO_SNAP', startTime - 1000, null);
        insertMembership(db, '#CLAN1', '#ZERO_SNAP_BONUS', startTime - 1000, null);
        insertMembership(db, '#CLAN1', '#NO_SNAP', startTime - 1000, null);
        // Late joiner with a zero-attack snapshot must be excluded from both slackers and comparison counts
        insertMembership(db, '#CLAN1', '#LATE_ZERO_SNAP', startTime + 60, null);

        const raidRef = raidRepo.saveCompleteRaidData(
            makeRaid({
                startTime,
                endTime,
                totalLoot: 25_000,
                raidsCompleted: 2,
                totalAttacks: 5,
                enemyDistrictsDestroyed: 8,
                offensiveReward: 600,
                defensiveReward: 100,
            }),
            [
                { playerTag: '#FULL', attacksCount: 5, bonusAttack: 0, totalLoot: 25_000 },
                { playerTag: '#ZERO_SNAP', attacksCount: 0, bonusAttack: 0, totalLoot: 0 },
                { playerTag: '#ZERO_SNAP_BONUS', attacksCount: 0, bonusAttack: 1, totalLoot: 0 },
                { playerTag: '#LATE_ZERO_SNAP', attacksCount: 0, bonusAttack: 0, totalLoot: 0 },
            ],
        );

        const slackers = raidRepo.getRaidSlackers(raidRef);
        expect(slackers).toEqual([
            {
                playerTag: '#ZERO_SNAP',
                playerName: 'BravoZeroSnapshot',
                attacksCount: 0,
                bonusAttacks: 0,
            },
            {
                playerTag: '#ZERO_SNAP_BONUS',
                playerName: 'CharlieZeroSnapshotBonus',
                attacksCount: 0,
                bonusAttacks: 1,
            },
            {
                playerTag: '#NO_SNAP',
                playerName: 'DeltaNoSnapshot',
                attacksCount: 0,
                bonusAttacks: 0,
            },
        ]);

        const stats = raidRepo.getRaidComparisonStats(raidRef);
        expect(stats).toEqual({
            startTime,
            totalLoot: 25_000,
            raidsCompleted: 2,
            usedAttacks: 5,
            // #FULL(5) + #ZERO_SNAP(5) + #ZERO_SNAP_BONUS(6) + #NO_SNAP(5) = 21
            availableAttacks: 21,
            // Only #FULL made > 0 attacks; zero-attack snapshots are NOT active participants
            activeParticipants: 1,
            eligibleParticipants: 4,
            participantsWithAllAttacksUsed: 1,
            // #ZERO_SNAP, #ZERO_SNAP_BONUS, #NO_SNAP (matches 0-attack slackers)
            participantsWithoutAttacks: 3,
            externalUsedAttacks: 0,
            externalParticipants: 0,
            enemyDistrictsDestroyed: 8,
            offensiveReward: 600,
            defensiveReward: 100,
        });

        // Consistency invariant between violations and comparison stats
        const zeroAttackSlackers = slackers.filter((slacker) => slacker.attacksCount === 0);
        expect(zeroAttackSlackers).toHaveLength(stats.participantsWithoutAttacks);
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
            externalUsedAttacks: 0,
            externalParticipants: 0,
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

    it('tracks is_complete monotonically and updates last_observed_at on every raid save', () => {
        const { db, clansRepo, raidRepo } = createMigratedDb();

        clansRepo.insertMinimalClan('#CLAN1');

        const startTime = 1_700_000_000;
        const firstRef = raidRepo.saveRaid(
            makeRaid({ clanTag: '#CLAN1', startTime, state: 'ongoing' }),
            1_700_000_100,
        );
        const ongoingRow = db.connection
            .prepare<[number], { state: string; is_complete: number; last_observed_at: number }>(
                'SELECT state, is_complete, last_observed_at FROM clan_raids WHERE id = ?;',
            )
            .get(firstRef.raidId);
        expect(ongoingRow).toEqual({
            state: 'ongoing',
            is_complete: 0,
            last_observed_at: 1_700_000_100,
        });

        const endedRef = raidRepo.saveRaid(
            makeRaid({ clanTag: '#CLAN1', startTime, state: 'ended' }),
            1_700_000_200,
        );
        expect(endedRef).toEqual(firstRef);
        const endedRow = db.connection
            .prepare<[number], { state: string; is_complete: number; last_observed_at: number }>(
                'SELECT state, is_complete, last_observed_at FROM clan_raids WHERE id = ?;',
            )
            .get(firstRef.raidId);
        expect(endedRow).toEqual({
            state: 'ended',
            is_complete: 1,
            last_observed_at: 1_700_000_200,
        });

        // Stale ongoing save must preserve is_complete = 1 and state = 'ended' while updating last_observed_at
        const staleRef = raidRepo.saveRaid(
            makeRaid({ clanTag: '#CLAN1', startTime, state: 'ongoing' }),
            1_700_000_300,
        );
        expect(staleRef).toEqual(firstRef);
        const afterStaleRow = db.connection
            .prepare<[number], { state: string; is_complete: number; last_observed_at: number }>(
                'SELECT state, is_complete, last_observed_at FROM clan_raids WHERE id = ?;',
            )
            .get(firstRef.raidId);
        expect(afterStaleRow).toEqual({
            state: 'ended',
            is_complete: 1,
            last_observed_at: 1_700_000_300,
        });
    });

    it('excludes ongoing/scheduled and is_complete = 0 raids from getPreviousRaids and counts skipped incomplete raids', () => {
        const { db, clansRepo, raidRepo } = createMigratedDb();

        clansRepo.insertMinimalClan('#CLAN1');
        clansRepo.insertMinimalClan('#CLAN2');

        // T=1000: ongoing (outside window once limit=3 complete raids are found)
        raidRepo.saveRaid(makeRaid({ clanTag: '#CLAN1', startTime: 1000, state: 'ongoing' }));
        // T=2000: ended complete
        const r1 = raidRepo.saveRaid(
            makeRaid({ clanTag: '#CLAN1', startTime: 2000, state: 'ended' }),
        );
        // T=2500: scheduled incomplete inside window
        raidRepo.saveRaid(makeRaid({ clanTag: '#CLAN1', startTime: 2500, state: 'scheduled' }));
        // T=3000: ended complete
        const r2 = raidRepo.saveRaid(
            makeRaid({ clanTag: '#CLAN1', startTime: 3000, state: 'ended' }),
        );
        // T=3500: ended but forced is_complete = 0 inside window
        const incompleteEnded = raidRepo.saveRaid(
            makeRaid({ clanTag: '#CLAN1', startTime: 3500, state: 'ended' }),
        );
        db.connection
            .prepare('UPDATE clan_raids SET is_complete = 0 WHERE id = ?;')
            .run(incompleteEnded.raidId);
        // T=4000: ended complete
        const r3 = raidRepo.saveRaid(
            makeRaid({ clanTag: '#CLAN1', startTime: 4000, state: 'ended' }),
        );
        // T=4500: ongoing inside window + another clan's ongoing raid
        raidRepo.saveRaid(makeRaid({ clanTag: '#CLAN1', startTime: 4500, state: 'ongoing' }));
        raidRepo.saveRaid(makeRaid({ clanTag: '#CLAN2', startTime: 4600, state: 'ongoing' }));
        // T=5000: current ended raid
        const current = raidRepo.saveRaid(
            makeRaid({ clanTag: '#CLAN1', startTime: 5000, state: 'ended' }),
        );
        // T=6000: future ongoing raid
        raidRepo.saveRaid(makeRaid({ clanTag: '#CLAN1', startTime: 6000, state: 'ongoing' }));

        // Limit 3 finds [r3, r2, r1] (oldest included T=2000); skips 2500, 3500, 4500 => 3 skipped (excludes T=1000)
        expect(raidRepo.getPreviousRaids(current, 3)).toEqual([r3, r2, r1]);
        expect(raidRepo.countSkippedIncompleteRaids(current, 3)).toBe(3);

        // Limit 4 has fewer complete raids than limit (3 < 4) => spans all history before current, includes T=1000 => 4 skipped
        expect(raidRepo.getPreviousRaids(current, 4)).toEqual([r3, r2, r1]);
        expect(raidRepo.countSkippedIncompleteRaids(current, 4)).toBe(4);

        // Limit 1 finds [r3] (oldest included T=4000) => skips only T=4500 => 1 skipped
        expect(raidRepo.getPreviousRaids(current, 1)).toEqual([r3]);
        expect(raidRepo.countSkippedIncompleteRaids(current, 1)).toBe(1);

        expect(raidRepo.countSkippedIncompleteRaids(current, 0)).toBe(0);
    });

    it('loads active raid with eligible cohort (#47) and latest completed raid for /raid view', () => {
        const { db, clansRepo, raidRepo } = createMigratedDb();

        const startTime = 1_700_000_000;
        const endTime = startTime + 3 * 86_400;
        const now = startTime + 86_400;

        clansRepo.insertMinimalClan('#CLAN1');
        clansRepo.insertMinimalClan('#CLAN2');

        expect(raidRepo.getActiveRaid('#CLAN1', now)).toBeNull();
        expect(raidRepo.getLatestCompletedRaid('#CLAN1')).toBeNull();

        // Incomplete ended raid and another clan's ended raid must be ignored
        const incomplete = raidRepo.saveRaid(
            makeRaid({
                clanTag: '#CLAN1',
                startTime: startTime - 14 * 86_400,
                endTime: startTime - 11 * 86_400,
                state: 'ended',
                totalLoot: 77_000,
            }),
            startTime - 11 * 86_400,
        );
        db.connection
            .prepare('UPDATE clan_raids SET is_complete = 0 WHERE id = ?;')
            .run(incomplete.raidId);
        raidRepo.saveRaid(
            makeRaid({
                clanTag: '#CLAN2',
                startTime: startTime - 7 * 86_400,
                endTime: startTime - 4 * 86_400,
                state: 'ended',
                totalLoot: 99_000,
            }),
            startTime - 4 * 86_400,
        );
        expect(raidRepo.getLatestCompletedRaid('#CLAN1')).toBeNull();

        // Completed raid for #CLAN1
        const completedRef = raidRepo.saveRaid(
            makeRaid({
                clanTag: '#CLAN1',
                startTime: startTime - 7 * 86_400,
                endTime: startTime - 4 * 86_400,
                state: 'ended',
                totalLoot: 115_000,
                raidsCompleted: 8,
                totalAttacks: 140,
                enemyDistrictsDestroyed: 33,
            }),
            startTime - 4 * 86_400 + 60,
        );
        expect(raidRepo.getLatestCompletedRaid('#CLAN1')).toEqual({
            raidId: completedRef.raidId,
            clanTag: '#CLAN1',
            startTime: startTime - 7 * 86_400,
            endTime: startTime - 4 * 86_400,
            totalLoot: 115_000,
            raidsCompleted: 8,
            totalAttacks: 140,
            enemyDistrictsDestroyed: 33,
            lastObservedAt: startTime - 4 * 86_400 + 60,
        });

        // Expired ongoing raid (end_time <= now) must NOT be returned as active
        raidRepo.saveRaid(
            makeRaid({
                clanTag: '#CLAN1',
                startTime: startTime - 21 * 86_400,
                endTime: now,
                state: 'ongoing',
            }),
            now - 10,
        );
        expect(raidRepo.getActiveRaid('#CLAN1', now)).toBeNull();

        // Active ongoing raid with eligible, late-joiner, left-early, and guest players
        clansRepo.savePlayers([
            { tag: '#P1', name: 'Bravo', clanTag: '#CLAN1' },
            { tag: '#P2', name: 'Alpha', clanTag: '#CLAN1' },
            { tag: '#P3', name: 'Alpha', clanTag: '#CLAN1' },
            { tag: '#LATE', name: 'Late', clanTag: '#CLAN1' },
            { tag: '#LEFT', name: 'Left', clanTag: '#CLAN1' },
        ]);
        clansRepo.insertMinimal('#GUEST', 'Guest');
        insertMembership(db, '#CLAN1', '#P1', startTime - 100, null);
        insertMembership(db, '#CLAN1', '#P2', startTime, null);
        insertMembership(db, '#CLAN1', '#P3', startTime - 50, null);
        insertMembership(db, '#CLAN1', '#LATE', startTime + 1, null);
        insertMembership(db, '#CLAN1', '#LEFT', startTime - 50, now - 10);

        const activeRef = raidRepo.saveCompleteRaidData(
            makeRaid({
                clanTag: '#CLAN1',
                startTime,
                endTime,
                state: 'ongoing',
                totalLoot: 64_000,
                raidsCompleted: 4,
                totalAttacks: 14,
                enemyDistrictsDestroyed: 18,
            }),
            [
                { playerTag: '#P1', attacksCount: 5, bonusAttack: 1, totalLoot: 24_000 },
                { playerTag: '#P2', attacksCount: 0, bonusAttack: 0, totalLoot: 0 },
                { playerTag: '#LATE', attacksCount: 3, bonusAttack: 0, totalLoot: 10_000 },
                { playerTag: '#GUEST', attacksCount: 6, bonusAttack: 1, totalLoot: 30_000 },
            ],
            now - 300,
        );

        expect(raidRepo.getActiveRaid('#CLAN1', now)).toEqual({
            raidId: activeRef.raidId,
            clanTag: '#CLAN1',
            startTime,
            endTime,
            state: 'ongoing',
            totalLoot: 64_000,
            raidsCompleted: 4,
            totalAttacks: 14,
            enemyDistrictsDestroyed: 18,
            lastObservedAt: now - 300,
            eligibleMembers: [
                { playerTag: '#P2', playerName: 'Alpha', attacksCount: 0, bonusAttacks: 0 },
                { playerTag: '#P3', playerName: 'Alpha', attacksCount: 0, bonusAttacks: 0 },
                { playerTag: '#P1', playerName: 'Bravo', attacksCount: 5, bonusAttacks: 1 },
            ],
        });
    });
});
