import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    ClansRepo,
    Database,
    MigratorManager,
    RaidRepo,
    TransactionManager,
} from '../../src/database/index.js';
import { APPLICATION_EVENT_TYPES, type RaidsEndedEvent } from '../../src/events/index.js';
import type {
    RaidMemberStats,
    RaidReference,
    RaidReportData,
    RaidSlacker,
    RaidStats,
} from '../../src/models/raid.js';
import {
    RaidsComparisonFormatter,
    RaidsEndedFormatter,
    RaidsViolationsFormatter,
    type ClanNameReader,
    type RaidEndedReportReader,
    type RaidViolationsReader,
} from '../../src/reports/index.js';
import { expectMatchesGolden } from './goldenHelper.js';

const SAMPLE_RAID_REF: RaidReference = {
    raidId: 17,
};

const SAMPLE_RAIDS_ENDED_EVENT: RaidsEndedEvent = {
    type: APPLICATION_EVENT_TYPES.raidsEnded,
    clanTag: '#2J8PJ9VLG',
    raidReference: SAMPLE_RAID_REF,
};

describe('RaidsEndedFormatter (golden parity)', () => {
    it('exposes EventType and eventType "raids_ended"', () => {
        expect(RaidsEndedFormatter.EventType).toBe('raids_ended');
        expect(RaidsEndedFormatter.eventType).toBe('raids_ended');
    });

    it('matches C++ golden snapshot for regular best member and format(event) idempotency', () => {
        const stats: RaidStats = {
            totalLoot: 100000,
            raidsCompleted: 1,
            totalAttacks: 10,
            enemyDistrictsDestroyed: 2,
            offensiveReward: 500,
            defensiveReward: 200,
        };
        const bestMembers: RaidMemberStats[] = [
            {
                playerTag: '#9CJRC2LLC',
                playerName: 'Flacicz',
                attacksCount: 3,
                bonusAttacks: 0,
                totalLoot: 50000,
            },
        ];
        const reportData: RaidReportData = {
            clanTag: '#2J8PJ9VLG',
            clanName: 'aurus',
            stats,
            bestMembers,
        };

        const direct = RaidsEndedFormatter.buildReport(reportData);
        expectMatchesGolden(direct, 'raidsEnded', 'regular-best-member');

        const clanNameReader: ClanNameReader = {
            getClanNameByTag(tag) {
                expect(tag).toBe('#2J8PJ9VLG');
                return 'aurus';
            },
        };
        const raidReader: RaidEndedReportReader = {
            getRaidStats(ref) {
                expect(ref).toEqual(SAMPLE_RAID_REF);
                return stats;
            },
            getBestRaidMembers(ref) {
                expect(ref).toEqual(SAMPLE_RAID_REF);
                return bestMembers;
            },
        };

        const formatter = new RaidsEndedFormatter(clanNameReader, raidReader);
        expect(formatter.format(SAMPLE_RAIDS_ENDED_EVENT)).toBe(direct);
        expect(formatter.format(SAMPLE_RAIDS_ENDED_EVENT)).toBe(direct);
    });

    it('matches C++ golden snapshot for members with and without bonus attacks (0, 1, 6 attacks)', () => {
        const reportData: RaidReportData = {
            clanTag: '#2J8PJ9VLG',
            clanName: 'aurus',
            stats: {
                totalLoot: 160000,
                raidsCompleted: 2,
                totalAttacks: 14,
                enemyDistrictsDestroyed: 3,
                offensiveReward: 700,
                defensiveReward: 250,
            },
            bestMembers: [
                {
                    playerTag: '#PLAYER1',
                    playerName: 'Flacicz',
                    attacksCount: 0,
                    bonusAttacks: 0,
                    totalLoot: 50000,
                },
                {
                    playerTag: '#PLAYER2',
                    playerName: 'Alex',
                    attacksCount: 1,
                    bonusAttacks: 1,
                    totalLoot: 60000,
                },
                {
                    playerTag: '#PLAYER3',
                    playerName: 'ТУРАН',
                    attacksCount: 6,
                    bonusAttacks: 1,
                    totalLoot: 70000,
                },
            ],
        };

        expectMatchesGolden(
            RaidsEndedFormatter.buildReport(reportData),
            'raidsEnded',
            'members-with-and-without-bonus-attacks',
        );
    });

    it('matches C++ golden snapshot for zero statistics without best members', () => {
        const reportData: RaidReportData = {
            clanTag: '#2J8PJ9VLG',
            clanName: 'aurus',
            stats: {
                totalLoot: 0,
                raidsCompleted: 0,
                totalAttacks: 0,
                enemyDistrictsDestroyed: 0,
                offensiveReward: 0,
                defensiveReward: 0,
            },
            bestMembers: [],
        };

        expectMatchesGolden(
            RaidsEndedFormatter.buildReport(reportData),
            'raidsEnded',
            'zero-stats-without-best-members',
        );
    });

    it('matches C++ golden snapshot for HTML escaping and 2/4/5 attack declensions', () => {
        const reportData: RaidReportData = {
            clanTag: '#<2J8PJ9VLG&>',
            clanName: 'aurus & <clan>',
            stats: {
                totalLoot: 50000,
                raidsCompleted: 1,
                totalAttacks: 3,
                enemyDistrictsDestroyed: 1,
                offensiveReward: 100,
                defensiveReward: 50,
            },
            bestMembers: [
                {
                    playerTag: '#PLAYER1',
                    playerName: '《ТУРАН&》',
                    attacksCount: 2,
                    bonusAttacks: 0,
                    totalLoot: 50000,
                },
                {
                    playerTag: '#PLAYER2',
                    playerName: 'Alex > &',
                    attacksCount: 4,
                    bonusAttacks: 1,
                    totalLoot: 60000,
                },
                {
                    playerTag: '#PLAYER3',
                    playerName: '<Hero>',
                    attacksCount: 5,
                    bonusAttacks: 0,
                    totalLoot: 45000,
                },
            ],
        };

        expectMatchesGolden(
            RaidsEndedFormatter.buildReport(reportData),
            'raidsEnded',
            'html-escaping',
        );
    });
});

describe('RaidsViolationsFormatter (golden parity)', () => {
    it('exposes EventType and eventType "raids_violations"', () => {
        expect(RaidsViolationsFormatter.EventType).toBe('raids_violations');
        expect(RaidsViolationsFormatter.eventType).toBe('raids_violations');
    });

    it('matches C++ golden snapshot when there are no violations', () => {
        const slackers: RaidSlacker[] = [
            {
                playerTag: '#9CJRC2LLC',
                playerName: 'Flacicz',
                attacksCount: 5,
                bonusAttacks: 0,
            },
        ];

        expectMatchesGolden(
            RaidsViolationsFormatter.buildReport('#2J8PJ9VLG', slackers),
            'raidsViolations',
            'no-violations',
        );

        expectMatchesGolden(
            RaidsViolationsFormatter.buildReport('#2J8PJ9VLG', []),
            'raidsViolations',
            'no-violations',
        );
    });

    it('matches C++ golden snapshot for incomplete and missing attacks and format(event) idempotency', () => {
        const slackers: RaidSlacker[] = [
            { playerTag: '#PLAYER1', playerName: 'Alex', attacksCount: 4, bonusAttacks: 0 },
            { playerTag: '#PLAYER2', playerName: 'ТУРАН', attacksCount: 0, bonusAttacks: 1 },
            { playerTag: '#PLAYER3', playerName: 'Full Player', attacksCount: 6, bonusAttacks: 1 },
        ];

        const direct = RaidsViolationsFormatter.buildReport('#2J8PJ9VLG', slackers);
        expectMatchesGolden(direct, 'raidsViolations', 'incomplete-and-no-attacks');

        const reader: RaidViolationsReader = {
            getRaidSlackers(ref) {
                expect(ref).toEqual(SAMPLE_RAID_REF);
                return slackers;
            },
        };
        const formatter = new RaidsViolationsFormatter(reader);
        expect(formatter.format(SAMPLE_RAIDS_ENDED_EVENT)).toBe(direct);
        expect(formatter.format(SAMPLE_RAIDS_ENDED_EVENT)).toBe(direct);
    });

    it('matches C++ golden snapshot when using bonus attacks in attack limit (5 + bonus_attacks)', () => {
        const slackers: RaidSlacker[] = [
            {
                playerTag: '#9CJRC2LLC',
                playerName: 'Flacicz',
                attacksCount: 5,
                bonusAttacks: 1,
            },
        ];

        expectMatchesGolden(
            RaidsViolationsFormatter.buildReport('#2J8PJ9VLG', slackers),
            'raidsViolations',
            'only-incomplete-with-bonus',
        );
    });

    it('matches C++ golden snapshot when reporting only players without attacks', () => {
        const slackers: RaidSlacker[] = [
            {
                playerTag: '#9CJRC2LLC',
                playerName: 'Flacicz',
                attacksCount: 0,
                bonusAttacks: 0,
            },
        ];

        expectMatchesGolden(
            RaidsViolationsFormatter.buildReport('#2J8PJ9VLG', slackers),
            'raidsViolations',
            'only-no-attacks',
        );
    });

    it('matches C++ golden snapshot for HTML escaping including CJK angle brackets', () => {
        const slackers: RaidSlacker[] = [
            {
                playerTag: '#<9CJRC2LLC&>',
                playerName: '《ТУРАН》 <&>',
                attacksCount: 4,
                bonusAttacks: 0,
            },
            {
                playerTag: '#PLAYER2',
                playerName: 'Alex & <Zero>',
                attacksCount: 0,
                bonusAttacks: 1,
            },
        ];

        expectMatchesGolden(
            RaidsViolationsFormatter.buildReport('#<2J8PJ9VLG&>', slackers),
            'raidsViolations',
            'html-escaping',
        );
    });
});

describe('Raid formatters end-to-end integration with SQLite RaidRepo and ClansRepo', () => {
    const migrationsPath = path.resolve(import.meta.dirname, '../../migrations');
    let database: Database | undefined;

    afterEach(() => {
        database?.close();
        database = undefined;
    });

    it('formats ended raid, excludes players who left before raid end from violations, and builds comparison on real SQLite', () => {
        database = new Database(':memory:');
        const tx = new TransactionManager(database);
        const migrator = new MigratorManager(database, tx);
        migrator.migrate(migrationsPath);

        const clansRepo = new ClansRepo(database);
        const raidRepo = new RaidRepo(database);

        const clanTag = '#2J8PJ9VLG';
        clansRepo.insertMinimalClan(clanTag);
        database.connection
            .prepare('UPDATE clans SET name = ? WHERE tag = ?;')
            .run('aurus', clanTag);

        // Players:
        // #P1 (Flacicz): active member, 5 + 1 = 6 attacks (full)
        // #P2 (Alex): active member, 4/5 attacks (incomplete)
        // #P3 (ТУРАН): active member, 0/5 attacks (no attacks)
        // #P4 (Leaver): left at 1500 < end_time 2000, 1/5 attacks (excluded from violations!)
        clansRepo.savePlayers([
            { tag: '#P1', name: 'Flacicz', clanTag },
            { tag: '#P2', name: 'Alex', clanTag },
            { tag: '#P3', name: 'ТУРАН', clanTag },
            { tag: '#P4', name: 'Leaver', clanTag },
        ]);

        const insertMembership = database.connection.prepare(`
            INSERT INTO clan_memberships (clan_tag, player_tag, joined_at, left_at)
            VALUES (?, ?, ?, ?);
        `);
        insertMembership.run(clanTag, '#P1', 500, null);
        insertMembership.run(clanTag, '#P2', 500, null);
        insertMembership.run(clanTag, '#P3', 500, null);
        insertMembership.run(clanTag, '#P4', 500, 1500); // left before raid end_time=2000

        // Previous raid (start_time=100, end_time=900)
        raidRepo.saveCompleteRaidData(
            {
                clanTag,
                startTime: 100,
                endTime: 900,
                state: 'ended',
                totalLoot: 90000,
                raidsCompleted: 2,
                totalAttacks: 10,
                enemyDistrictsDestroyed: 5,
                offensiveReward: 400,
                defensiveReward: 150,
            },
            [
                { playerTag: '#P1', attacksCount: 5, bonusAttack: 0, totalLoot: 50000 },
                { playerTag: '#P2', attacksCount: 5, bonusAttack: 0, totalLoot: 40000 },
            ],
        );

        // Current raid (start_time=1000, end_time=2000)
        const currentRaidRef = raidRepo.saveCompleteRaidData(
            {
                clanTag,
                startTime: 1000,
                endTime: 2000,
                state: 'ended',
                totalLoot: 115000,
                raidsCompleted: 3,
                totalAttacks: 11,
                enemyDistrictsDestroyed: 7,
                offensiveReward: 550,
                defensiveReward: 210,
            },
            [
                { playerTag: '#P1', attacksCount: 6, bonusAttack: 1, totalLoot: 70000 },
                { playerTag: '#P2', attacksCount: 4, bonusAttack: 0, totalLoot: 35000 },
                { playerTag: '#P4', attacksCount: 1, bonusAttack: 0, totalLoot: 10000 },
            ],
        );

        const endedFormatter = new RaidsEndedFormatter(clansRepo, raidRepo);
        const violationsFormatter = new RaidsViolationsFormatter(raidRepo);
        const comparisonFormatter = new RaidsComparisonFormatter(clansRepo, raidRepo);

        const event: RaidsEndedEvent = {
            type: APPLICATION_EVENT_TYPES.raidsEnded,
            clanTag,
            raidReference: currentRaidRef,
        };

        const endedReport = endedFormatter.format(event);
        expect(endedReport).toContain('🏰 <b>ОТЧЕТ ПО РЕЙДАМ</b>');
        expect(endedReport).toContain('1. Flacicz — 70000 золота, 6 атак, 1 бонусная атака');
        expect(endedReport).toContain('2. Alex — 35000 золота, 4 атаки');

        const violationsReport = violationsFormatter.format(event);
        expect(violationsReport).toContain('🟡 <b>Не использовали все атаки:</b>\n• Alex [4/5]');
        expect(violationsReport).toContain('🔴 <b>Не сделали ни одной атаки:</b>\n• ТУРАН [0/5]');
        expect(violationsReport).not.toContain('Leaver');
        expect(violationsReport).not.toContain('Flacicz');

        const comparisonReport = comparisonFormatter.format(event);
        expect(comparisonReport).toContain('📈 <b>ДИНАМИКА РЕЙДОВ</b>');
        expect(comparisonReport).toContain('📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 1 ПРЕДЫДУЩИЙ РЕЙД</b>');
        expect(comparisonFormatter.format(event)).toBe(comparisonReport);
    });

    it('excludes late joiners from violations while keeping their attacks in ended stats, and treats attacks_count = 0 snapshots identically in violations and comparison', () => {
        database = new Database(':memory:');
        const tx = new TransactionManager(database);
        const migrator = new MigratorManager(database, tx);
        migrator.migrate(migrationsPath);

        const clansRepo = new ClansRepo(database);
        const raidRepo = new RaidRepo(database);

        const clanTag = '#2J8PJ9VLG';
        clansRepo.insertMinimalClan(clanTag);
        database.connection
            .prepare('UPDATE clans SET name = ? WHERE tag = ?;')
            .run('aurus', clanTag);

        clansRepo.savePlayers([
            { tag: '#P1', name: 'Flacicz', clanTag },
            { tag: '#P2', name: 'ZeroSnapshot', clanTag },
            { tag: '#P3', name: 'LateNoAttacks', clanTag },
            { tag: '#P4', name: 'LateAttacker', clanTag },
        ]);

        const insertMembership = database.connection.prepare(`
            INSERT INTO clan_memberships (clan_tag, player_tag, joined_at, left_at)
            VALUES (?, ?, ?, ?);
        `);
        // Present before both raids
        insertMembership.run(clanTag, '#P1', 50, null);
        insertMembership.run(clanTag, '#P2', 50, null);
        // Joined after current raid start_time=1000
        insertMembership.run(clanTag, '#P3', 1500, null);
        insertMembership.run(clanTag, '#P4', 1800, null);

        // Previous raid (start_time=100, end_time=900)
        raidRepo.saveCompleteRaidData(
            {
                clanTag,
                startTime: 100,
                endTime: 900,
                state: 'ended',
                totalLoot: 80000,
                raidsCompleted: 2,
                totalAttacks: 10,
                enemyDistrictsDestroyed: 4,
                offensiveReward: 400,
                defensiveReward: 150,
            },
            [
                { playerTag: '#P1', attacksCount: 5, bonusAttack: 0, totalLoot: 45000 },
                { playerTag: '#P2', attacksCount: 5, bonusAttack: 0, totalLoot: 35000 },
            ],
        );

        // Current raid (start_time=1000, end_time=2000)
        const currentRaidRef = raidRepo.saveCompleteRaidData(
            {
                clanTag,
                startTime: 1000,
                endTime: 2000,
                state: 'ended',
                totalLoot: 75000,
                raidsCompleted: 2,
                totalAttacks: 7,
                enemyDistrictsDestroyed: 5,
                offensiveReward: 450,
                defensiveReward: 170,
            },
            [
                { playerTag: '#P1', attacksCount: 5, bonusAttack: 0, totalLoot: 50000 },
                { playerTag: '#P2', attacksCount: 0, bonusAttack: 0, totalLoot: 0 },
                { playerTag: '#P4', attacksCount: 2, bonusAttack: 0, totalLoot: 25000 },
            ],
        );

        const endedFormatter = new RaidsEndedFormatter(clansRepo, raidRepo);
        const violationsFormatter = new RaidsViolationsFormatter(raidRepo);
        const comparisonFormatter = new RaidsComparisonFormatter(clansRepo, raidRepo);

        const event: RaidsEndedEvent = {
            type: APPLICATION_EVENT_TYPES.raidsEnded,
            clanTag,
            raidReference: currentRaidRef,
        };

        const endedReport = endedFormatter.format(event);
        expect(endedReport).toContain('Использовано атак: 7');
        expect(endedReport).toContain('2. LateAttacker — 25000 золота, 2 атаки');

        const violationsReport = violationsFormatter.format(event);
        expect(violationsReport).toContain(
            '🔴 <b>Не сделали ни одной атаки:</b>\n• ZeroSnapshot [0/5]',
        );
        expect(violationsReport).not.toContain('LateNoAttacks');
        expect(violationsReport).not.toContain('LateAttacker');
        expect(violationsReport).not.toContain('Flacicz');

        const comparisonReport = comparisonFormatter.format(event);
        // Without attacks: 0/2 -> 1/2 (ZeroSnapshot counted, late joiners excluded from eligible)
        expect(comparisonReport).toContain('0/2 → 1/2');
        // Active participants: #P1 + #P4 = 2 (ZeroSnapshot with attacks_count = 0 is NOT active)
        expect(comparisonReport).toContain('2/2 → 2/2');
    });
});
