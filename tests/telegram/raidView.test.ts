import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    ClansRepo,
    Database,
    MigratorManager,
    RaidRepo,
    SubscriptionRepo,
    TransactionManager,
    type ActiveRaidEligibleMember,
    type ActiveRaidSnapshot,
} from '../../src/database/index.js';
import {
    countTelegramHtmlVisibleLength,
    TELEGRAM_HARD_MAX_VISIBLE_LENGTH,
} from '../../src/notifications/htmlMessageSplitter.js';
import {
    formatRaidView,
    loadRaidViewData,
    PENDING_CLAN_SYNC_NAME,
    type RaidViewData,
} from '../../src/telegram/index.js';
import { expectMatchesGolden } from '../reports/goldenHelper.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');

// 2026-11-14 12:48:00 UTC = 2026-11-14 15:48:00 UTC+3
const BASE_NOW = Date.UTC(2026, 10, 14, 12, 48, 0) / 1000;
// 2026-11-16 04:00:00 UTC = 2026-11-16 07:00:00 UTC+3 (1 д 15 ч 12 мин after BASE_NOW)
const RAID_END_TIME = Date.UTC(2026, 10, 16, 4, 0, 0) / 1000;
// 2026-11-13 04:00:00 UTC
const RAID_START_TIME = Date.UTC(2026, 10, 13, 4, 0, 0) / 1000;

function createMigratedDb(): {
    db: Database;
    clansRepo: ClansRepo;
    raidRepo: RaidRepo;
    subscriptionRepo: SubscriptionRepo;
} {
    const db = new Database(':memory:');
    const tx = new TransactionManager(db);
    new MigratorManager(db, tx).migrate(REAL_MIGRATIONS_PATH);

    return {
        db,
        clansRepo: new ClansRepo(db),
        raidRepo: new RaidRepo(db),
        subscriptionRepo: new SubscriptionRepo(db),
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

function makeActiveRaidSnapshot(overrides?: Partial<ActiveRaidSnapshot>): ActiveRaidSnapshot {
    const eligibleMembers: ActiveRaidEligibleMember[] = [
        { playerTag: '#P1', playerName: 'Ник1', attacksCount: 0, bonusAttacks: 0 },
        { playerTag: '#P2', playerName: 'Ник2', attacksCount: 0, bonusAttacks: 0 },
        { playerTag: '#P3', playerName: 'Ник3', attacksCount: 2, bonusAttacks: 0 },
        { playerTag: '#P4', playerName: 'Ник4', attacksCount: 3, bonusAttacks: 1 },
        { playerTag: '#P5', playerName: 'Ник5', attacksCount: 5, bonusAttacks: 1 },
        { playerTag: '#PF1', playerName: 'Готов1', attacksCount: 6, bonusAttacks: 1 },
        { playerTag: '#PF2', playerName: 'Готов2', attacksCount: 6, bonusAttacks: 1 },
        { playerTag: '#PF3', playerName: 'Готов3', attacksCount: 5, bonusAttacks: 0 },
        { playerTag: '#PF4', playerName: 'Готов4', attacksCount: 5, bonusAttacks: 0 },
        { playerTag: '#PF5', playerName: 'Готов5', attacksCount: 5, bonusAttacks: 0 },
    ];

    return {
        raidId: 1,
        clanTag: '#2PPLQ',
        startTime: RAID_START_TIME,
        endTime: RAID_END_TIME,
        state: 'ongoing',
        totalLoot: 124_500,
        raidsCompleted: 7,
        totalAttacks: 37,
        enemyDistrictsDestroyed: 38,
        lastObservedAt: BASE_NOW - 7 * 60,
        eligibleMembers,
        ...overrides,
    };
}

describe('raidView golden formatting', () => {
    it('matches golden for active raid with zero attacks, partial attacks, and bonus attack (5/6)', () => {
        const data: RaidViewData = {
            kind: 'ongoing',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            raid: makeActiveRaidSnapshot(),
            timezoneOffsetHours: 3,
        };

        const output = formatRaidView(data, BASE_NOW);
        expectMatchesGolden(output, 'raidView', 'ongoing-active');
        expect(output.toLowerCase()).not.toContain('нарушен');
    });

    it('matches golden when all eligible players finished all attacks', () => {
        const data: RaidViewData = {
            kind: 'ongoing',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            raid: makeActiveRaidSnapshot({
                endTime: BASE_NOW + 90 * 60,
                totalLoot: 98_400,
                totalAttacks: 27,
                enemyDistrictsDestroyed: 24,
                lastObservedAt: BASE_NOW - 3 * 60,
                eligibleMembers: [
                    { playerTag: '#P1', playerName: 'Игрок1', attacksCount: 6, bonusAttacks: 1 },
                    { playerTag: '#P2', playerName: 'Игрок2', attacksCount: 6, bonusAttacks: 1 },
                    { playerTag: '#P3', playerName: 'Игрок3', attacksCount: 5, bonusAttacks: 0 },
                    { playerTag: '#P4', playerName: 'Игрок4', attacksCount: 5, bonusAttacks: 0 },
                    { playerTag: '#P5', playerName: 'Игрок5', attacksCount: 5, bonusAttacks: 0 },
                ],
            }),
            timezoneOffsetHours: 3,
        };

        expectMatchesGolden(formatRaidView(data, BASE_NOW), 'raidView', 'ongoing-all-used');
    });

    it('matches golden for duplicate nicknames across sections, HTML escaping, and custom UTC offset', () => {
        const data: RaidViewData = {
            kind: 'ongoing',
            clanTag: '#2PPLQ',
            clanName: 'Alpha & <Co>',
            raid: makeActiveRaidSnapshot({
                endTime: BASE_NOW + 45 * 60,
                totalLoot: 41_250,
                totalAttacks: 14,
                enemyDistrictsDestroyed: 12,
                lastObservedAt: BASE_NOW - 12 * 60,
                eligibleMembers: [
                    { playerTag: '#P1', playerName: 'Alex', attacksCount: 0, bonusAttacks: 0 },
                    { playerTag: '#P9', playerName: '<Hero>', attacksCount: 0, bonusAttacks: 0 },
                    { playerTag: '#P2', playerName: 'Alex', attacksCount: 3, bonusAttacks: 1 },
                    { playerTag: '#P3', playerName: 'Bob & Co', attacksCount: 5, bonusAttacks: 1 },
                    { playerTag: '#P4', playerName: 'Done', attacksCount: 6, bonusAttacks: 1 },
                ],
            }),
            timezoneOffsetHours: 5,
        };

        expectMatchesGolden(
            formatRaidView(data, BASE_NOW),
            'raidView',
            'ongoing-duplicate-nicks-and-html',
        );
    });

    it('matches golden for stale active raid (>1h old)', () => {
        const data: RaidViewData = {
            kind: 'ongoing',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            raid: makeActiveRaidSnapshot({
                endTime: BASE_NOW + 2 * 3600,
                totalLoot: 60_000,
                totalAttacks: 16,
                enemyDistrictsDestroyed: 19,
                lastObservedAt: BASE_NOW - 75 * 60,
                eligibleMembers: [
                    { playerTag: '#P1', playerName: 'Ник1', attacksCount: 0, bonusAttacks: 0 },
                    { playerTag: '#P2', playerName: 'Ник2', attacksCount: 0, bonusAttacks: 0 },
                    { playerTag: '#P3', playerName: 'Ник3', attacksCount: 6, bonusAttacks: 1 },
                    { playerTag: '#P4', playerName: 'Ник4', attacksCount: 5, bonusAttacks: 0 },
                    { playerTag: '#P5', playerName: 'Ник5', attacksCount: 5, bonusAttacks: 0 },
                ],
            }),
            timezoneOffsetHours: 3,
        };

        expectMatchesGolden(formatRaidView(data, BASE_NOW), 'raidView', 'ongoing-stale');
    });

    it('matches golden for no active raid with and without completed raid history', () => {
        const withHistory: RaidViewData = {
            kind: 'no_raid',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            lastCompletedRaid: {
                raidId: 10,
                clanTag: '#2PPLQ',
                startTime: Date.UTC(2026, 10, 6, 4, 0, 0) / 1000,
                endTime: Date.UTC(2026, 10, 9, 4, 0, 0) / 1000,
                totalLoot: 124_500,
                raidsCompleted: 8,
                totalAttacks: 180,
                enemyDistrictsDestroyed: 38,
                lastObservedAt: Date.UTC(2026, 10, 9, 4, 5, 0) / 1000,
            },
            timezoneOffsetHours: 3,
            updatedAt: BASE_NOW - 7 * 60,
        };

        expectMatchesGolden(
            formatRaidView(withHistory, BASE_NOW),
            'raidView',
            'no-raid-with-history',
        );

        const withoutHistory: RaidViewData = {
            kind: 'no_raid',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            lastCompletedRaid: null,
            timezoneOffsetHours: 3,
            updatedAt: BASE_NOW - 7 * 60,
        };

        expectMatchesGolden(
            formatRaidView(withoutHistory, BASE_NOW),
            'raidView',
            'no-raid-without-history',
        );
    });

    it('keeps a full 50-player raid roster (max-length nicknames, duplicates, HTML chars) strictly within Telegram 4096-character limit', () => {
        const fiftyMembers: ActiveRaidEligibleMember[] = Array.from({ length: 50 }, (_, idx) => {
            const hasPartial = idx % 2 === 1;
            const nickname =
                idx < 10 ? 'DuplicateName15' : `Player_${String(idx + 1).padStart(2, '0')}<>&`;
            return {
                playerTag: `#PYLQGRJC${String(idx).padStart(2, '0')}`,
                playerName: nickname,
                attacksCount: hasPartial ? 5 : 0,
                bonusAttacks: hasPartial ? 1 : 0,
            };
        });

        const data: RaidViewData = {
            kind: 'ongoing',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            raid: makeActiveRaidSnapshot({
                lastObservedAt: BASE_NOW - 2 * 3600,
                eligibleMembers: fiftyMembers,
            }),
            timezoneOffsetHours: 3,
        };

        const output = formatRaidView(data, BASE_NOW);
        expect(countTelegramHtmlVisibleLength(output)).toBeLessThanOrEqual(
            TELEGRAM_HARD_MAX_VISIBLE_LENGTH,
        );
        expect(output.length).toBeLessThanOrEqual(TELEGRAM_HARD_MAX_VISIBLE_LENGTH);
        expect(output).toContain('Без атак (25):');
        expect(output).toContain('Не все атаки (25):');
        expect(output).toContain('DuplicateName15 (#PYLQGRJC00)');
        expect(output).toContain('DuplicateName15 (#PYLQGRJC01) 5/6');
        expect(output).toContain('&lt;&gt;&amp;');
        expect(output.toLowerCase()).not.toContain('нарушен');
    });

    it('hides pending synchronization placeholder clan name and handles empty eligible cohort gracefully', () => {
        const noRaidOutput = formatRaidView(
            {
                kind: 'no_raid',
                clanTag: '#2PPLQ',
                clanName: PENDING_CLAN_SYNC_NAME,
                lastCompletedRaid: null,
                timezoneOffsetHours: 3,
                updatedAt: null,
            },
            BASE_NOW,
        );

        expect(noRaidOutput).toContain('🏰 <b>Рейд: #2PPLQ</b>');
        expect(noRaidOutput).not.toContain(PENDING_CLAN_SYNC_NAME);
        expect(noRaidOutput).toContain('🔄 данные ещё не синхронизированы');

        const emptyCohortOutput = formatRaidView(
            {
                kind: 'ongoing',
                clanTag: '#2PPLQ',
                clanName: 'Клан',
                raid: makeActiveRaidSnapshot({
                    totalAttacks: 18,
                    eligibleMembers: [],
                }),
                timezoneOffsetHours: 3,
            },
            BASE_NOW,
        );
        expect(emptyCohortOutput).toContain('Атаки: 18');
        expect(emptyCohortOutput).toContain('✅ Отбились: 0');
        expect(emptyCohortOutput).not.toContain('все атаки использованы');
    });
});

describe('SQLite loadRaidViewData and eligible cohort rules', () => {
    const dbs: Database[] = [];

    afterEach(() => {
        while (dbs.length > 0) {
            dbs.pop()?.close();
        }
    });

    it('loads raid states from SQLite, enforces #47 cohort rules, ignores expired/incomplete raids, and ignores private war log', () => {
        const { db, clansRepo, raidRepo, subscriptionRepo } = createMigratedDb();
        dbs.push(db);

        clansRepo.saveClan({
            tag: '#2PPLQ',
            name: 'Клан',
            description: '',
            locationId: 0,
            locationName: '',
            chatLanguageId: 0,
            chatLanguage: '',
            isFamilyFriendly: false,
        });
        clansRepo.saveClanSnapshot({
            clanTag: '#2PPLQ',
            type: 'open',
            membersCount: 10,
            clanLevel: 12,
            clanPoints: 20000,
            clanBuilderBasePoints: 10000,
            clanCapitalPoints: 5000,
            capitalHallLevel: 8,
            capitalLeagueId: 0,
            requiredTrophies: 0,
            requiredBuilderBaseTrophies: 0,
            requiredTownhallLevel: 1,
            warFrequency: 'always',
            isWarLogPublic: false, // private war log must NOT block /raid
            warWinStreak: 0,
            warWins: 10,
            warTies: 0,
            warLosses: 5,
            warLeagueId: 0,
        });
        db.connection
            .prepare(`UPDATE clan_snapshots SET created_at = ? WHERE clan_tag = '#2PPLQ';`)
            .run(BASE_NOW - 7 * 60);

        subscriptionRepo.saveTelegramChat(100, 0, 'Test');
        subscriptionRepo.subscribeToChat(100, 0, '#2PPLQ', 'players');
        const sub = subscriptionRepo.getSubscriptionSummary(100, 0, '#2PPLQ');
        expect(sub).not.toBeNull();
        if (sub === null) {
            return;
        }

        // 1. Stuck expired ongoing raid (end_time <= BASE_NOW, is_complete = 0) -> neither active nor completed history
        raidRepo.saveCompleteRaidData(
            {
                clanTag: '#2PPLQ',
                startTime: BASE_NOW - 10 * 86_400,
                endTime: BASE_NOW - 7 * 86_400,
                state: 'ongoing',
                totalLoot: 50_000,
                raidsCompleted: 3,
                totalAttacks: 20,
                enemyDistrictsDestroyed: 15,
                offensiveReward: 600,
                defensiveReward: 100,
            },
            [],
            BASE_NOW - 7 * 86_400,
        );

        const noRaidEmpty = loadRaidViewData({ raidRepo, clansRepo }, sub, BASE_NOW);
        expect(noRaidEmpty.kind).toBe('no_raid');
        if (noRaidEmpty.kind === 'no_raid') {
            expect(noRaidEmpty.lastCompletedRaid).toBeNull();
            expect(noRaidEmpty.updatedAt).toBe(BASE_NOW - 7 * 60);
        }

        // 2. Add a completed past raid -> shown as lastCompletedRaid
        const prevEndTime = Date.UTC(2026, 10, 9, 4, 0, 0) / 1000;
        raidRepo.saveCompleteRaidData(
            {
                clanTag: '#2PPLQ',
                startTime: prevEndTime - 3 * 86_400,
                endTime: prevEndTime,
                state: 'ended',
                totalLoot: 124_500,
                raidsCompleted: 8,
                totalAttacks: 180,
                enemyDistrictsDestroyed: 38,
                offensiveReward: 1200,
                defensiveReward: 300,
            },
            [],
            prevEndTime + 300,
        );

        const noRaidWithHistory = loadRaidViewData({ raidRepo, clansRepo }, sub, BASE_NOW);
        expect(noRaidWithHistory.kind).toBe('no_raid');
        if (noRaidWithHistory.kind === 'no_raid') {
            expect(noRaidWithHistory.lastCompletedRaid?.totalLoot).toBe(124_500);
            expect(noRaidWithHistory.lastCompletedRaid?.enemyDistrictsDestroyed).toBe(38);
            expect(noRaidWithHistory.updatedAt).toBe(BASE_NOW - 7 * 60);
        }

        // 3. Add active ongoing raid with mixed cohort:
        //    - #BEFORE_ZERO: joined before start, no snapshot -> 0/5 (included in Без атак)
        //    - #AT_START_BONUS: joined exactly at start, 5 attacks + 1 bonus -> 5/6 (included in Не все атаки)
        //    - #BEFORE_DONE: joined before start, 5 attacks + 0 bonus -> 5/5 (included in Отбились)
        //    - #LATE_JOINER: joined AFTER start, 0 attacks -> EXCLUDED
        //    - #LATE_ATTACKER: joined AFTER start, 2 attacks -> EXCLUDED
        //    - #LEFT_EARLY: joined before start, left before end -> EXCLUDED
        //    - #GUEST: no membership, 6 attacks -> EXCLUDED
        clansRepo.savePlayers([
            { tag: '#BEFORE_ZERO', name: 'НеАтаковал', clanTag: '#2PPLQ' },
            { tag: '#AT_START_BONUS', name: 'СБонусом', clanTag: '#2PPLQ' },
            { tag: '#BEFORE_DONE', name: 'Молодец', clanTag: '#2PPLQ' },
            { tag: '#LATE_JOINER', name: 'НовичокНоль', clanTag: '#2PPLQ' },
            { tag: '#LATE_ATTACKER', name: 'НовичокДва', clanTag: '#2PPLQ' },
            { tag: '#LEFT_EARLY', name: 'Вышедший', clanTag: '#2PPLQ' },
        ]);
        clansRepo.insertMinimal('#GUEST', 'Гость');

        insertMembership(db, '#2PPLQ', '#BEFORE_ZERO', RAID_START_TIME - 1000, null);
        insertMembership(db, '#2PPLQ', '#AT_START_BONUS', RAID_START_TIME, null);
        insertMembership(db, '#2PPLQ', '#BEFORE_DONE', RAID_START_TIME - 500, null);
        insertMembership(db, '#2PPLQ', '#LATE_JOINER', RAID_START_TIME + 1, null);
        insertMembership(db, '#2PPLQ', '#LATE_ATTACKER', RAID_START_TIME + 3600, null);
        insertMembership(db, '#2PPLQ', '#LEFT_EARLY', RAID_START_TIME - 1000, BASE_NOW - 60);

        raidRepo.saveCompleteRaidData(
            {
                clanTag: '#2PPLQ',
                startTime: RAID_START_TIME,
                endTime: RAID_END_TIME,
                state: 'ongoing',
                totalLoot: 75_000,
                raidsCompleted: 5,
                totalAttacks: 18, // 5 + 5 + 2 + 6
                enemyDistrictsDestroyed: 22,
                offensiveReward: 800,
                defensiveReward: 200,
            },
            [
                {
                    playerTag: '#AT_START_BONUS',
                    attacksCount: 5,
                    bonusAttack: 1,
                    totalLoot: 22_000,
                },
                { playerTag: '#BEFORE_DONE', attacksCount: 5, bonusAttack: 0, totalLoot: 20_000 },
                { playerTag: '#LATE_ATTACKER', attacksCount: 2, bonusAttack: 0, totalLoot: 8_000 },
                { playerTag: '#GUEST', attacksCount: 6, bonusAttack: 1, totalLoot: 25_000 },
            ],
            BASE_NOW - 5 * 60,
        );

        const active = loadRaidViewData({ raidRepo, clansRepo }, sub, BASE_NOW);
        expect(active.kind).toBe('ongoing');
        if (active.kind !== 'ongoing') {
            return;
        }

        expect(active.raid.eligibleMembers).toEqual([
            {
                playerTag: '#BEFORE_ZERO',
                playerName: 'НеАтаковал',
                attacksCount: 0,
                bonusAttacks: 0,
            },
            {
                playerTag: '#BEFORE_DONE',
                playerName: 'Молодец',
                attacksCount: 5,
                bonusAttacks: 0,
            },
            {
                playerTag: '#AT_START_BONUS',
                playerName: 'СБонусом',
                attacksCount: 5,
                bonusAttacks: 1,
            },
        ]);

        const rendered = formatRaidView(active, BASE_NOW);
        expect(rendered).toContain('💰 75 000 золота · 🏘 Разрушено районов: 22');
        // Cohort attacks: 0 + 5 + 5 = 10; available: 5 + 5 + 6 = 16
        expect(rendered).toContain('Атаки: 10/16');
        expect(rendered).toContain('Без атак (1): НеАтаковал');
        expect(rendered).toContain('Не все атаки (1): СБонусом 5/6');
        expect(rendered).toContain('✅ Отбились: 1');
        expect(rendered).not.toContain('НовичокНоль');
        expect(rendered).not.toContain('НовичокДва');
        expect(rendered).not.toContain('Вышедший');
        expect(rendered).not.toContain('Гость');
        expect(rendered).toContain('🔄 обновлено 5 мин назад');
    });
});
