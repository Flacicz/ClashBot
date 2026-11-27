import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    CLAN_SIDES,
    ClansRepo,
    ClanwarOutcome,
    ClanwarRepo,
    ClanwarsLeagueRepo,
    Database,
    MigratorManager,
    SubscriptionRepo,
    TransactionManager,
    WAR_TYPES,
    type ActiveWarMemberAttackCount,
    type ActiveWarSnapshot,
} from '../../src/database/index.js';
import {
    countTelegramHtmlVisibleLength,
    TELEGRAM_HARD_MAX_VISIBLE_LENGTH,
} from '../../src/notifications/htmlMessageSplitter.js';
import {
    formatViewClanNotSubscribedText,
    formatViewNoClansText,
    formatWarView,
    loadWarViewData,
    PENDING_CLAN_SYNC_NAME,
    resolveViewClanSubscription,
    type WarViewData,
} from '../../src/telegram/index.js';
import { expectMatchesGolden } from '../reports/goldenHelper.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');

// 2026-11-14 12:48:00 UTC = 2026-11-14 15:48:00 UTC+3
const BASE_NOW = Date.UTC(2026, 10, 14, 12, 48, 0) / 1000;
// 2026-11-14 18:00:00 UTC = 2026-11-14 21:00:00 UTC+3 (5 ч 12 мин after BASE_NOW)
const FIVE_HOURS_TWELVE_LATER = Date.UTC(2026, 10, 14, 18, 0, 0) / 1000;

function createMigratedDb(): {
    db: Database;
    clansRepo: ClansRepo;
    clanwarRepo: ClanwarRepo;
    cwlRepo: ClanwarsLeagueRepo;
    subscriptionRepo: SubscriptionRepo;
} {
    const db = new Database(':memory:');
    const tx = new TransactionManager(db);
    new MigratorManager(db, tx).migrate(REAL_MIGRATIONS_PATH);

    return {
        db,
        clansRepo: new ClansRepo(db),
        clanwarRepo: new ClanwarRepo(db),
        cwlRepo: new ClanwarsLeagueRepo(db),
        subscriptionRepo: new SubscriptionRepo(db),
    };
}

function makeActiveWarSnapshot(overrides?: Partial<ActiveWarSnapshot>): ActiveWarSnapshot {
    const members: ActiveWarMemberAttackCount[] = [
        { playerTag: '#P1', playerName: 'Ник1', mapPosition: 1, attacksUsed: 0 },
        { playerTag: '#P2', playerName: 'Ник2', mapPosition: 2, attacksUsed: 0 },
        { playerTag: '#P3', playerName: 'Ник3', mapPosition: 3, attacksUsed: 0 },
        { playerTag: '#P4', playerName: 'Ник4', mapPosition: 4, attacksUsed: 1 },
        { playerTag: '#P5', playerName: 'Ник5', mapPosition: 5, attacksUsed: 1 },
        { playerTag: '#P6', playerName: 'Ник6', mapPosition: 6, attacksUsed: 1 },
        { playerTag: '#P7', playerName: 'Ник7', mapPosition: 7, attacksUsed: 1 },
        ...Array.from({ length: 18 }, (_, index) => ({
            playerTag: `#PF${String(index + 1)}`,
            playerName: `Готов${String(index + 1)}`,
            mapPosition: index + 8,
            attacksUsed: 2,
        })),
    ];

    return {
        warId: 1,
        clanTag: '#2PPLQ',
        state: 'inWar',
        warType: WAR_TYPES.regular,
        teamSize: 25,
        attacksPerMember: 2,
        preparationStartTime: BASE_NOW - 30 * 3600,
        startTime: BASE_NOW - 18 * 3600,
        endTime: FIVE_HOURS_TWELVE_LATER,
        seasonId: null,
        roundNumber: null,
        lastObservedAt: BASE_NOW - 7 * 60,
        home: {
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            stars: 28,
            destructionPercentage: 78.4,
        },
        opponent: {
            clanTag: '#OPP1',
            clanName: 'Соперник',
            stars: 25,
            destructionPercentage: 70.1,
        },
        homeMembers: members,
        ...overrides,
    };
}

describe('warView golden formatting', () => {
    it('matches golden for active regular war (inWar)', () => {
        const data: WarViewData = {
            kind: 'in_war',
            war: makeActiveWarSnapshot(),
            timezoneOffsetHours: 3,
        };

        const output = formatWarView(data, BASE_NOW);
        expectMatchesGolden(output, 'warView', 'in-war-active');
        expect(output.toLowerCase()).not.toContain('нарушен');
    });

    it('matches golden for active war when all attacks are used', () => {
        const data: WarViewData = {
            kind: 'in_war',
            war: makeActiveWarSnapshot({
                teamSize: 5,
                endTime: BASE_NOW + 90 * 60,
                lastObservedAt: BASE_NOW - 3 * 60,
                home: {
                    clanTag: '#2PPLQ',
                    clanName: 'Клан',
                    stars: 15,
                    destructionPercentage: 96.0,
                },
                opponent: {
                    clanTag: '#OPP1',
                    clanName: 'Соперник',
                    stars: 12,
                    destructionPercentage: 81.5,
                },
                homeMembers: Array.from({ length: 5 }, (_, idx) => ({
                    playerTag: `#P${String(idx + 1)}`,
                    playerName: `Игрок${String(idx + 1)}`,
                    mapPosition: idx + 1,
                    attacksUsed: 2,
                })),
            }),
            timezoneOffsetHours: 3,
        };

        expectMatchesGolden(formatWarView(data, BASE_NOW), 'warView', 'in-war-all-used');
    });

    it('matches golden for duplicate nicknames across sections, HTML escaping, and custom UTC offset', () => {
        const data: WarViewData = {
            kind: 'in_war',
            war: makeActiveWarSnapshot({
                teamSize: 5,
                endTime: BASE_NOW + 45 * 60,
                lastObservedAt: BASE_NOW - 12 * 60,
                home: {
                    clanTag: '#2PPLQ',
                    clanName: 'Alpha & <Co>',
                    stars: 10,
                    destructionPercentage: 62.5,
                },
                opponent: {
                    clanTag: '#OPP1',
                    clanName: '<Enemy>',
                    stars: 8,
                    destructionPercentage: 50.0,
                },
                homeMembers: [
                    { playerTag: '#P1', playerName: 'Alex', mapPosition: 1, attacksUsed: 0 },
                    { playerTag: '#P9', playerName: '<Hero>', mapPosition: 2, attacksUsed: 0 },
                    { playerTag: '#P2', playerName: 'Alex', mapPosition: 3, attacksUsed: 1 },
                    { playerTag: '#P3', playerName: 'Bob & Co', mapPosition: 4, attacksUsed: 1 },
                    { playerTag: '#P4', playerName: 'Done', mapPosition: 5, attacksUsed: 2 },
                ],
            }),
            timezoneOffsetHours: 5,
        };

        expectMatchesGolden(
            formatWarView(data, BASE_NOW),
            'warView',
            'in-war-duplicate-nicks-and-html',
        );
    });

    it('matches golden for stale active war (>1h old)', () => {
        const data: WarViewData = {
            kind: 'in_war',
            war: makeActiveWarSnapshot({
                teamSize: 5,
                endTime: BASE_NOW + 2 * 3600,
                lastObservedAt: BASE_NOW - 75 * 60,
                home: {
                    clanTag: '#2PPLQ',
                    clanName: 'Клан',
                    stars: 12,
                    destructionPercentage: 55.0,
                },
                opponent: {
                    clanTag: '#OPP1',
                    clanName: 'Соперник',
                    stars: 10,
                    destructionPercentage: 48.2,
                },
                homeMembers: [
                    { playerTag: '#P1', playerName: 'Ник1', mapPosition: 1, attacksUsed: 0 },
                    { playerTag: '#P2', playerName: 'Ник2', mapPosition: 2, attacksUsed: 0 },
                    { playerTag: '#P3', playerName: 'Ник3', mapPosition: 3, attacksUsed: 2 },
                    { playerTag: '#P4', playerName: 'Ник4', mapPosition: 4, attacksUsed: 2 },
                    { playerTag: '#P5', playerName: 'Ник5', mapPosition: 5, attacksUsed: 2 },
                ],
            }),
            timezoneOffsetHours: 3,
        };

        expectMatchesGolden(formatWarView(data, BASE_NOW), 'warView', 'in-war-stale');
    });

    it('matches golden for preparation day', () => {
        const data: WarViewData = {
            kind: 'preparation',
            war: makeActiveWarSnapshot({
                state: 'preparation',
                startTime: FIVE_HOURS_TWELVE_LATER,
                endTime: FIVE_HOURS_TWELVE_LATER + 24 * 3600,
                lastObservedAt: BASE_NOW - 7 * 60,
            }),
            timezoneOffsetHours: 3,
        };

        expectMatchesGolden(formatWarView(data, BASE_NOW), 'warView', 'preparation');
    });

    it('matches golden for no active war with and without completed war history', () => {
        const withHistory: WarViewData = {
            kind: 'no_war',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            lastCompletedWar: {
                warId: 10,
                clanTag: '#2PPLQ',
                endTime: Date.UTC(2026, 10, 12, 15, 0, 0) / 1000,
                lastObservedAt: Date.UTC(2026, 10, 12, 15, 5, 0) / 1000,
                home: {
                    clanTag: '#2PPLQ',
                    clanName: 'Клан',
                    stars: 42,
                    destructionPercentage: 78.4,
                },
                opponent: {
                    clanTag: '#OPP1',
                    clanName: 'Соперник',
                    stars: 38,
                    destructionPercentage: 70.1,
                },
                outcome: ClanwarOutcome.Victory,
            },
            timezoneOffsetHours: 3,
            updatedAt: BASE_NOW - 7 * 60,
        };

        expectMatchesGolden(formatWarView(withHistory, BASE_NOW), 'warView', 'no-war-with-history');

        const withoutHistory: WarViewData = {
            kind: 'no_war',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            lastCompletedWar: null,
            timezoneOffsetHours: 3,
            updatedAt: BASE_NOW - 7 * 60,
        };

        expectMatchesGolden(
            formatWarView(withoutHistory, BASE_NOW),
            'warView',
            'no-war-without-history',
        );
    });

    it('matches golden for active CWL and private war log states', () => {
        const cwl: WarViewData = {
            kind: 'cwl',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            updatedAt: BASE_NOW - 5 * 60,
        };
        expectMatchesGolden(formatWarView(cwl, BASE_NOW), 'warView', 'cwl-active');

        const privateLog: WarViewData = {
            kind: 'private_war_log',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            updatedAt: BASE_NOW - 9 * 60,
        };
        expectMatchesGolden(formatWarView(privateLog, BASE_NOW), 'warView', 'private-war-log');
    });

    it('keeps a full 50-player war roster (max-length nicknames, duplicates, HTML chars) strictly within Telegram 4096-character limit', () => {
        const fiftyMembers: ActiveWarMemberAttackCount[] = Array.from({ length: 50 }, (_, idx) => {
            const group = idx % 2;
            const nickname =
                idx < 10 ? 'DuplicateName15' : `Player_${String(idx + 1).padStart(2, '0')}<>&`;
            return {
                playerTag: `#PYLQGRJC${String(idx).padStart(2, '0')}`,
                playerName: nickname,
                mapPosition: idx + 1,
                attacksUsed: group,
            };
        });

        const data: WarViewData = {
            kind: 'in_war',
            war: makeActiveWarSnapshot({
                teamSize: 50,
                lastObservedAt: BASE_NOW - 2 * 3600,
                homeMembers: fiftyMembers,
            }),
            timezoneOffsetHours: 3,
        };

        const output = formatWarView(data, BASE_NOW);
        expect(countTelegramHtmlVisibleLength(output)).toBeLessThanOrEqual(
            TELEGRAM_HARD_MAX_VISIBLE_LENGTH,
        );
        expect(output.length).toBeLessThanOrEqual(TELEGRAM_HARD_MAX_VISIBLE_LENGTH);
        expect(output).toContain('Без атак (25):');
        expect(output).toContain('1 из 2 (25):');
        expect(output).toContain('DuplicateName15 (#PYLQGRJC00)');
        expect(output).toContain('&lt;&gt;&amp;');
        expect(output.toLowerCase()).not.toContain('нарушен');
    });

    it('hides pending synchronization placeholder clan name in headers', () => {
        const output = formatWarView(
            {
                kind: 'no_war',
                clanTag: '#2PPLQ',
                clanName: PENDING_CLAN_SYNC_NAME,
                lastCompletedWar: null,
                timezoneOffsetHours: 3,
                updatedAt: null,
            },
            BASE_NOW,
        );

        expect(output).toContain('⚔️ <b>КВ: #2PPLQ</b>');
        expect(output).not.toContain(PENDING_CLAN_SYNC_NAME);
        expect(output).toContain('🔄 данные ещё не синхронизированы');
    });
});

describe('viewCommon resolution and SQLite loadWarViewData', () => {
    const dbs: Database[] = [];

    afterEach(() => {
        while (dbs.length > 0) {
            dbs.pop()?.close();
        }
    });

    it('resolves 0, 1, and >1 clan subscriptions with and without explicit tag', () => {
        const { db, clansRepo, subscriptionRepo } = createMigratedDb();
        dbs.push(db);

        expect(resolveViewClanSubscription([], null)).toEqual({ status: 'no_clans' });
        expect(resolveViewClanSubscription([], '#2PPLQ')).toEqual({
            status: 'not_subscribed',
            clanTag: '#2PPLQ',
        });
        expect(formatViewNoClansText()).toContain('/link #ТЕГ_КЛАНА');
        expect(formatViewClanNotSubscribedText('#2PPLQ')).toBe(
            'Клан #2PPLQ не подключён в этом чате',
        );

        clansRepo.insertMinimalClan('#2PPLQ');
        clansRepo.insertMinimalClan('#999888');
        subscriptionRepo.saveTelegramChat(100, 0, 'Test Chat');
        subscriptionRepo.subscribeToChat(100, 0, '#2PPLQ', 'players');

        const singleList = subscriptionRepo.getSubscriptionSummariesForDestination(100, 0);
        expect(resolveViewClanSubscription(singleList, null)).toEqual({
            status: 'ready',
            subscription: singleList[0],
        });
        expect(resolveViewClanSubscription(singleList, '#999888')).toEqual({
            status: 'not_subscribed',
            clanTag: '#999888',
        });

        subscriptionRepo.subscribeToChat(100, 0, '#999888', 'players');
        const multiList = subscriptionRepo.getSubscriptionSummariesForDestination(100, 0);
        expect(resolveViewClanSubscription(multiList, null)).toEqual({
            status: 'select_clan',
            subscriptions: multiList,
        });
        expect(resolveViewClanSubscription(multiList, '#999888')).toEqual({
            status: 'ready',
            subscription: multiList[1],
        });
    });

    it('loads war states from SQLite with proper priority and ignores incomplete or expired wars', () => {
        const { db, clansRepo, clanwarRepo, cwlRepo, subscriptionRepo } = createMigratedDb();
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
            membersCount: 25,
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
            isWarLogPublic: true,
            warWinStreak: 3,
            warWins: 50,
            warTies: 2,
            warLosses: 10,
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

        // 1. Expired stuck inWar + incomplete ended war -> should NOT be treated as active or completed history
        clanwarRepo.saveCompleteClanwarData(
            {
                warUID: '#2PPLQ_#2PPLQ_#OLD1_100',
                clanTag: '#2PPLQ',
                state: 'inWar',
                warType: WAR_TYPES.regular,
                teamSize: 10,
                attacksPerMember: 2,
                preparationStartTime: BASE_NOW - 10 * 86_400,
                startTime: BASE_NOW - 9 * 86_400,
                endTime: BASE_NOW - 8 * 86_400,
                seasonId: null,
                roundNumber: null,
            },
            {
                home: {
                    side: CLAN_SIDES.home,
                    clanTag: '#2PPLQ',
                    clanName: 'Клан',
                    clanLevel: 12,
                    attacksCount: 0,
                    stars: 0,
                    destructionPercentage: 0,
                },
                opponent: {
                    side: CLAN_SIDES.opponent,
                    clanTag: '#OLD1',
                    clanName: 'Old',
                    clanLevel: 10,
                    attacksCount: 0,
                    stars: 0,
                    destructionPercentage: 0,
                },
            },
            [],
            { home: [], opponent: [] },
            BASE_NOW - 8 * 86_400,
        );

        const noWarEmpty = loadWarViewData({ clanwarRepo, clansRepo }, sub, BASE_NOW);
        expect(noWarEmpty.kind).toBe('no_war');
        if (noWarEmpty.kind === 'no_war') {
            expect(noWarEmpty.lastCompletedWar).toBeNull();
            expect(noWarEmpty.updatedAt).toBe(BASE_NOW - 7 * 60);
        }

        // 2. Add a completed regular war -> shown as lastCompletedWar when not in war
        clanwarRepo.saveCompleteClanwarData(
            {
                warUID: '#2PPLQ_#2PPLQ_#OPP1_200',
                clanTag: '#2PPLQ',
                state: 'warEnded',
                warType: WAR_TYPES.regular,
                teamSize: 15,
                attacksPerMember: 2,
                preparationStartTime: BASE_NOW - 5 * 86_400,
                startTime: BASE_NOW - 4 * 86_400,
                endTime: Date.UTC(2026, 10, 12, 15, 0, 0) / 1000,
                seasonId: null,
                roundNumber: null,
            },
            {
                home: {
                    side: CLAN_SIDES.home,
                    clanTag: '#2PPLQ',
                    clanName: 'Клан',
                    clanLevel: 12,
                    attacksCount: 28,
                    stars: 42,
                    destructionPercentage: 78.4,
                },
                opponent: {
                    side: CLAN_SIDES.opponent,
                    clanTag: '#OPP1',
                    clanName: 'Соперник',
                    clanLevel: 11,
                    attacksCount: 26,
                    stars: 38,
                    destructionPercentage: 70.1,
                },
            },
            [],
            { home: [], opponent: [] },
            BASE_NOW - 2 * 86_400,
        );

        const noWarWithHistory = loadWarViewData({ clanwarRepo, clansRepo }, sub, BASE_NOW);
        expect(noWarWithHistory.kind).toBe('no_war');
        if (noWarWithHistory.kind === 'no_war') {
            expect(noWarWithHistory.lastCompletedWar?.outcome).toBe(ClanwarOutcome.Victory);
            expect(noWarWithHistory.updatedAt).toBe(BASE_NOW - 7 * 60);
        }

        // 3. Add active CWL round -> detected as 'cwl'
        const seasonId = cwlRepo.saveCWLSeason({ clanTag: '#2PPLQ', seasonId: '2026-11' });
        clanwarRepo.saveCompleteClanwarData(
            {
                warUID: '#2PPLQ_#2PPLQ_#CWL1_300',
                clanTag: '#2PPLQ',
                state: 'inWar',
                warType: WAR_TYPES.cwl,
                teamSize: 15,
                attacksPerMember: 1,
                preparationStartTime: BASE_NOW - 25 * 3600,
                startTime: BASE_NOW - 1 * 3600,
                endTime: BASE_NOW + 23 * 3600,
                seasonId,
                roundNumber: 2,
            },
            {
                home: {
                    side: CLAN_SIDES.home,
                    clanTag: '#2PPLQ',
                    clanName: 'Клан',
                    clanLevel: 12,
                    attacksCount: 5,
                    stars: 12,
                    destructionPercentage: 30,
                },
                opponent: {
                    side: CLAN_SIDES.opponent,
                    clanTag: '#CWL1',
                    clanName: 'CWL Opponent',
                    clanLevel: 12,
                    attacksCount: 4,
                    stars: 10,
                    destructionPercentage: 25,
                },
            },
            [],
            { home: [], opponent: [] },
            BASE_NOW - 5 * 60,
        );

        const cwlState = loadWarViewData({ clanwarRepo, clansRepo }, sub, BASE_NOW);
        expect(cwlState).toEqual({
            kind: 'cwl',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            updatedAt: BASE_NOW - 5 * 60,
        });

        // 4. Private war log takes precedence on /war
        const privateSub = { ...sub, isWarLogPublic: false };
        const privateState = loadWarViewData({ clanwarRepo, clansRepo }, privateSub, BASE_NOW);
        expect(privateState).toEqual({
            kind: 'private_war_log',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            updatedAt: BASE_NOW - 7 * 60,
        });
    });
});
