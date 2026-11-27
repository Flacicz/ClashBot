import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    CLAN_SIDES,
    ClansRepo,
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
    formatCwlView,
    loadCwlViewData,
    PENDING_CLAN_SYNC_NAME,
    type CwlViewData,
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

function makeActiveCwlSnapshot(overrides?: Partial<ActiveWarSnapshot>): ActiveWarSnapshot {
    const members: ActiveWarMemberAttackCount[] = [
        { playerTag: '#P1', playerName: 'Ник1', mapPosition: 1, attacksUsed: 0 },
        { playerTag: '#P2', playerName: 'Ник2', mapPosition: 2, attacksUsed: 0 },
        { playerTag: '#P3', playerName: 'Ник3', mapPosition: 3, attacksUsed: 0 },
        { playerTag: '#P4', playerName: 'Ник4', mapPosition: 4, attacksUsed: 0 },
        ...Array.from({ length: 11 }, (_, index) => ({
            playerTag: `#PF${String(index + 1)}`,
            playerName: `Готов${String(index + 1)}`,
            mapPosition: index + 5,
            attacksUsed: 1,
        })),
    ];

    return {
        warId: 10,
        clanTag: '#2PPLQ',
        state: 'inWar',
        warType: WAR_TYPES.cwl,
        teamSize: 15,
        attacksPerMember: 1,
        preparationStartTime: BASE_NOW - 30 * 3600,
        startTime: BASE_NOW - 18 * 3600,
        endTime: FIVE_HOURS_TWELVE_LATER,
        seasonId: 1,
        roundNumber: 3,
        lastObservedAt: BASE_NOW - 7 * 60,
        home: {
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            stars: 24,
            destructionPercentage: 68.5,
        },
        opponent: {
            clanTag: '#OPP1',
            clanName: 'Соперник',
            stars: 21,
            destructionPercentage: 61.2,
        },
        homeMembers: members,
        ...overrides,
    };
}

describe('cwlView golden formatting', () => {
    it('matches golden for active CWL round (inWar) with players who have not attacked', () => {
        const data: CwlViewData = {
            kind: 'in_war',
            war: makeActiveCwlSnapshot(),
            seasonSummary: {
                seasonLabel: '2026-11',
                completedRounds: 2,
                victories: 2,
                defeats: 0,
                draws: 0,
                totalStars: 78,
            },
            timezoneOffsetHours: 3,
        };

        const output = formatCwlView(data, BASE_NOW);
        expectMatchesGolden(output, 'cwlView', 'in-war-active');
        expect(output.toLowerCase()).not.toContain('нарушен');
    });

    it('matches golden for active CWL round when all attacks are used', () => {
        const data: CwlViewData = {
            kind: 'in_war',
            war: makeActiveCwlSnapshot({
                endTime: BASE_NOW + 90 * 60,
                lastObservedAt: BASE_NOW - 3 * 60,
                home: {
                    clanTag: '#2PPLQ',
                    clanName: 'Клан',
                    stars: 39,
                    destructionPercentage: 91.4,
                },
                opponent: {
                    clanTag: '#OPP1',
                    clanName: 'Соперник',
                    stars: 34,
                    destructionPercentage: 84.0,
                },
                homeMembers: Array.from({ length: 15 }, (_, idx) => ({
                    playerTag: `#P${String(idx + 1)}`,
                    playerName: `Игрок${String(idx + 1)}`,
                    mapPosition: idx + 1,
                    attacksUsed: 1,
                })),
            }),
            seasonSummary: {
                seasonLabel: '2026-11',
                completedRounds: 2,
                victories: 1,
                defeats: 1,
                draws: 0,
                totalStars: 71,
            },
            timezoneOffsetHours: 3,
        };

        expectMatchesGolden(formatCwlView(data, BASE_NOW), 'cwlView', 'in-war-all-used');
    });

    it('matches golden for duplicate nicknames, HTML escaping, draw outcome, and custom UTC offset', () => {
        const data: CwlViewData = {
            kind: 'in_war',
            war: makeActiveCwlSnapshot({
                teamSize: 5,
                roundNumber: 2,
                endTime: BASE_NOW + 45 * 60,
                lastObservedAt: BASE_NOW - 12 * 60,
                home: {
                    clanTag: '#2PPLQ',
                    clanName: 'Alpha & <Co>',
                    stars: 12,
                    destructionPercentage: 64.0,
                },
                opponent: {
                    clanTag: '#OPP1',
                    clanName: '<Enemy>',
                    stars: 9,
                    destructionPercentage: 52.5,
                },
                homeMembers: [
                    { playerTag: '#P1', playerName: 'Alex', mapPosition: 1, attacksUsed: 0 },
                    { playerTag: '#P9', playerName: '<Hero>', mapPosition: 2, attacksUsed: 0 },
                    { playerTag: '#P2', playerName: 'Alex', mapPosition: 3, attacksUsed: 0 },
                    { playerTag: '#P3', playerName: 'Done1', mapPosition: 4, attacksUsed: 1 },
                    { playerTag: '#P4', playerName: 'Done2', mapPosition: 5, attacksUsed: 1 },
                ],
            }),
            seasonSummary: {
                seasonLabel: '2026-11 <S1>',
                completedRounds: 1,
                victories: 0,
                defeats: 0,
                draws: 1,
                totalStars: 35,
            },
            timezoneOffsetHours: 5,
        };

        expectMatchesGolden(
            formatCwlView(data, BASE_NOW),
            'cwlView',
            'in-war-duplicate-nicks-and-html',
        );
    });

    it('matches golden for round number gap (#43: round 5/7 with only 3 completed rounds)', () => {
        const data: CwlViewData = {
            kind: 'in_war',
            war: makeActiveCwlSnapshot({
                roundNumber: 5,
                home: {
                    clanTag: '#2PPLQ',
                    clanName: 'Клан',
                    stars: 28,
                    destructionPercentage: 74.2,
                },
                opponent: {
                    clanTag: '#OPP5',
                    clanName: 'Соперник',
                    stars: 26,
                    destructionPercentage: 71.8,
                },
                homeMembers: [
                    { playerTag: '#P1', playerName: 'Ник1', mapPosition: 1, attacksUsed: 0 },
                    { playerTag: '#P2', playerName: 'Ник2', mapPosition: 2, attacksUsed: 0 },
                    { playerTag: '#P3', playerName: 'Ник3', mapPosition: 3, attacksUsed: 0 },
                    ...Array.from({ length: 12 }, (_, idx) => ({
                        playerTag: `#PF${String(idx + 1)}`,
                        playerName: `Готов${String(idx + 1)}`,
                        mapPosition: idx + 4,
                        attacksUsed: 1,
                    })),
                ],
            }),
            seasonSummary: {
                seasonLabel: '2026-11',
                completedRounds: 3,
                victories: 2,
                defeats: 1,
                draws: 0,
                totalStars: 111,
            },
            timezoneOffsetHours: 3,
        };

        expectMatchesGolden(formatCwlView(data, BASE_NOW), 'cwlView', 'in-war-round-gap');
    });

    it('matches golden for stale active CWL round (>1h old)', () => {
        const data: CwlViewData = {
            kind: 'in_war',
            war: makeActiveCwlSnapshot({
                roundNumber: 4,
                endTime: BASE_NOW + 2 * 3600,
                lastObservedAt: BASE_NOW - 75 * 60,
                home: {
                    clanTag: '#2PPLQ',
                    clanName: 'Клан',
                    stars: 18,
                    destructionPercentage: 55.0,
                },
                opponent: {
                    clanTag: '#OPP4',
                    clanName: 'Соперник',
                    stars: 15,
                    destructionPercentage: 48.2,
                },
                homeMembers: [
                    { playerTag: '#P1', playerName: 'Ник1', mapPosition: 1, attacksUsed: 0 },
                    { playerTag: '#P2', playerName: 'Ник2', mapPosition: 2, attacksUsed: 0 },
                    ...Array.from({ length: 8 }, (_, idx) => ({
                        playerTag: `#PF${String(idx + 1)}`,
                        playerName: `Готов${String(idx + 1)}`,
                        mapPosition: idx + 3,
                        attacksUsed: 1,
                    })),
                ],
            }),
            seasonSummary: {
                seasonLabel: '2026-11',
                completedRounds: 3,
                victories: 2,
                defeats: 1,
                draws: 0,
                totalStars: 104,
            },
            timezoneOffsetHours: 3,
        };

        expectMatchesGolden(formatCwlView(data, BASE_NOW), 'cwlView', 'in-war-stale');
    });

    it('matches golden for preparation day with and without completed rounds', () => {
        const midSeasonPrep: CwlViewData = {
            kind: 'preparation',
            war: makeActiveCwlSnapshot({
                state: 'preparation',
                roundNumber: 4,
                startTime: FIVE_HOURS_TWELVE_LATER,
                endTime: FIVE_HOURS_TWELVE_LATER + 24 * 3600,
                lastObservedAt: BASE_NOW - 7 * 60,
            }),
            seasonSummary: {
                seasonLabel: '2026-11',
                completedRounds: 3,
                victories: 2,
                defeats: 1,
                draws: 0,
                totalStars: 110,
            },
            timezoneOffsetHours: 3,
        };
        expectMatchesGolden(formatCwlView(midSeasonPrep, BASE_NOW), 'cwlView', 'preparation');

        const firstRoundPrep: CwlViewData = {
            kind: 'preparation',
            war: makeActiveCwlSnapshot({
                state: 'preparation',
                roundNumber: 1,
                startTime: FIVE_HOURS_TWELVE_LATER,
                endTime: FIVE_HOURS_TWELVE_LATER + 24 * 3600,
                lastObservedAt: BASE_NOW - 7 * 60,
            }),
            seasonSummary: {
                seasonLabel: '2026-11',
                completedRounds: 0,
                victories: 0,
                defeats: 0,
                draws: 0,
                totalStars: 0,
            },
            timezoneOffsetHours: 3,
        };
        expectMatchesGolden(
            formatCwlView(firstRoundPrep, BASE_NOW),
            'cwlView',
            'preparation-first-round',
        );
    });

    it('matches golden for off-season state (no active CWL)', () => {
        const data: CwlViewData = {
            kind: 'no_cwl',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            updatedAt: BASE_NOW - 7 * 60,
        };

        expectMatchesGolden(formatCwlView(data, BASE_NOW), 'cwlView', 'no-cwl');
    });

    it('keeps a 30-player CWL roster (max-length nicknames, duplicates, HTML chars) strictly within Telegram 4096-character limit', () => {
        const thirtyMembers: ActiveWarMemberAttackCount[] = Array.from({ length: 30 }, (_, idx) => {
            const nickname =
                idx < 8 ? 'DuplicateName15' : `Player_${String(idx + 1).padStart(2, '0')}<>&`;
            return {
                playerTag: `#PYLQGRJC${String(idx).padStart(2, '0')}`,
                playerName: nickname,
                mapPosition: idx + 1,
                attacksUsed: 0,
            };
        });

        const data: CwlViewData = {
            kind: 'in_war',
            war: makeActiveCwlSnapshot({
                teamSize: 30,
                roundNumber: 7,
                lastObservedAt: BASE_NOW - 2 * 3600,
                homeMembers: thirtyMembers,
            }),
            seasonSummary: {
                seasonLabel: '2026-11',
                completedRounds: 6,
                victories: 4,
                defeats: 1,
                draws: 1,
                totalStars: 412,
            },
            timezoneOffsetHours: 3,
        };

        const output = formatCwlView(data, BASE_NOW);
        expect(countTelegramHtmlVisibleLength(output)).toBeLessThanOrEqual(
            TELEGRAM_HARD_MAX_VISIBLE_LENGTH,
        );
        expect(output.length).toBeLessThanOrEqual(TELEGRAM_HARD_MAX_VISIBLE_LENGTH);
        expect(output).toContain('Ещё не атаковали (30):');
        expect(output).toContain('DuplicateName15 (#PYLQGRJC00)');
        expect(output).toContain('&lt;&gt;&amp;');
        expect(output.toLowerCase()).not.toContain('нарушен');
    });

    it('hides pending synchronization placeholder clan name and handles missing season/round metadata gracefully', () => {
        const noCwl = formatCwlView(
            {
                kind: 'no_cwl',
                clanTag: '#2PPLQ',
                clanName: PENDING_CLAN_SYNC_NAME,
                updatedAt: null,
            },
            BASE_NOW,
        );
        expect(noCwl).toContain('🏆 <b>ЛВК: #2PPLQ</b>');
        expect(noCwl).not.toContain(PENDING_CLAN_SYNC_NAME);
        expect(noCwl).toContain('🔄 данные ещё не синхронизированы');

        const missingMeta = formatCwlView(
            {
                kind: 'in_war',
                war: makeActiveCwlSnapshot({
                    seasonId: null,
                    roundNumber: null,
                    homeMembers: [],
                }),
                seasonSummary: {
                    seasonLabel: null,
                    completedRounds: 0,
                    victories: 0,
                    defeats: 0,
                    draws: 0,
                    totalStars: 0,
                },
                timezoneOffsetHours: 3,
            },
            BASE_NOW,
        );
        expect(missingMeta).toContain('🏆 <b>ЛВК: Клан vs Соперник</b>');
        expect(missingMeta).not.toContain('0/7');
        expect(missingMeta).toContain('✅ Отбились: 0');
        expect(missingMeta).not.toContain('все атаки использованы');
    });
});

describe('SQLite loadCwlViewData', () => {
    const dbs: Database[] = [];

    afterEach(() => {
        while (dbs.length > 0) {
            dbs.pop()?.close();
        }
    });

    it('loads CWL states from SQLite with round gaps (#43), current-round roster only, inWar priority over preparation, and works with private war log', () => {
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
            membersCount: 30,
            clanLevel: 14,
            clanPoints: 25000,
            clanBuilderBasePoints: 10000,
            clanCapitalPoints: 5000,
            capitalHallLevel: 8,
            capitalLeagueId: 0,
            requiredTrophies: 0,
            requiredBuilderBaseTrophies: 0,
            requiredTownhallLevel: 1,
            warFrequency: 'always',
            isWarLogPublic: false, // Closed war log MUST NOT block CWL view
            warWinStreak: 0,
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
        expect(sub.isWarLogPublic).toBe(false);

        // 1. Off-season initially
        const offSeason = loadCwlViewData(
            { clanwarRepo, clanwarsLeagueRepo: cwlRepo, clansRepo },
            sub,
            BASE_NOW,
        );
        expect(offSeason).toEqual({
            kind: 'no_cwl',
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            updatedAt: BASE_NOW - 7 * 60,
        });

        // 2. Seed season with 4 roster members in cwl_season_members, but only 2 in the round war_members
        const cwlSeasonId = cwlRepo.saveCompleteCWLData(
            { clanTag: '#2PPLQ', seasonId: '2026-11' },
            [
                {
                    clanTag: '#2PPLQ',
                    seasonId: '2026-11',
                    playerTag: '#P1',
                    playerName: 'Игрок1',
                    townhallLevel: 16,
                },
                {
                    clanTag: '#2PPLQ',
                    seasonId: '2026-11',
                    playerTag: '#P2',
                    playerName: 'Игрок2',
                    townhallLevel: 16,
                },
                {
                    clanTag: '#2PPLQ',
                    seasonId: '2026-11',
                    playerTag: '#BENCH1',
                    playerName: 'Запасной1',
                    townhallLevel: 15,
                },
                {
                    clanTag: '#2PPLQ',
                    seasonId: '2026-11',
                    playerTag: '#BENCH2',
                    playerName: 'Запасной2',
                    townhallLevel: 15,
                },
            ],
        );

        // Round 1 (ended, victory)
        clanwarRepo.saveCompleteClanwarData(
            {
                warUID: '#2PPLQ_#2PPLQ_#OPP1_100',
                clanTag: '#2PPLQ',
                state: 'warEnded',
                warType: WAR_TYPES.cwl,
                teamSize: 15,
                attacksPerMember: 1,
                preparationStartTime: BASE_NOW - 5 * 86_400,
                startTime: BASE_NOW - 4 * 86_400,
                endTime: BASE_NOW - 3 * 86_400,
                seasonId: cwlSeasonId,
                roundNumber: 1,
            },
            {
                home: {
                    side: CLAN_SIDES.home,
                    clanTag: '#2PPLQ',
                    clanName: 'Клан',
                    clanLevel: 14,
                    attacksCount: 15,
                    stars: 40,
                    destructionPercentage: 92.0,
                },
                opponent: {
                    side: CLAN_SIDES.opponent,
                    clanTag: '#OPP1',
                    clanName: 'Соперник 1',
                    clanLevel: 13,
                    attacksCount: 14,
                    stars: 35,
                    destructionPercentage: 85.0,
                },
            },
            [],
            { home: [], opponent: [] },
            BASE_NOW - 3 * 86_400,
        );

        // Round 2 was skipped by API (#43); Round 3 ended as defeat (equal stars, lower destruction)
        clanwarRepo.saveCompleteClanwarData(
            {
                warUID: '#2PPLQ_#2PPLQ_#OPP3_300',
                clanTag: '#2PPLQ',
                state: 'warEnded',
                warType: WAR_TYPES.cwl,
                teamSize: 15,
                attacksPerMember: 1,
                preparationStartTime: BASE_NOW - 3 * 86_400,
                startTime: BASE_NOW - 2 * 86_400,
                endTime: BASE_NOW - 1 * 86_400,
                seasonId: cwlSeasonId,
                roundNumber: 3,
            },
            {
                home: {
                    side: CLAN_SIDES.home,
                    clanTag: '#2PPLQ',
                    clanName: 'Клан',
                    clanLevel: 14,
                    attacksCount: 15,
                    stars: 34,
                    destructionPercentage: 81.0,
                },
                opponent: {
                    side: CLAN_SIDES.opponent,
                    clanTag: '#OPP3',
                    clanName: 'Соперник 3',
                    clanLevel: 14,
                    attacksCount: 15,
                    stars: 34,
                    destructionPercentage: 84.5,
                },
            },
            [],
            { home: [], opponent: [] },
            BASE_NOW - 1 * 86_400,
        );

        // Round 4 (active inWar) AND Round 5 (preparation simultaneously, as in real CWL!)
        clanwarRepo.saveCompleteClanwarData(
            {
                warUID: '#2PPLQ_#2PPLQ_#OPP5_500',
                clanTag: '#2PPLQ',
                state: 'preparation',
                warType: WAR_TYPES.cwl,
                teamSize: 15,
                attacksPerMember: 1,
                preparationStartTime: BASE_NOW - 6 * 3600,
                startTime: FIVE_HOURS_TWELVE_LATER,
                endTime: FIVE_HOURS_TWELVE_LATER + 24 * 3600,
                seasonId: cwlSeasonId,
                roundNumber: 5,
            },
            {
                home: {
                    side: CLAN_SIDES.home,
                    clanTag: '#2PPLQ',
                    clanName: 'Клан',
                    clanLevel: 14,
                    attacksCount: 0,
                    stars: 0,
                    destructionPercentage: 0,
                },
                opponent: {
                    side: CLAN_SIDES.opponent,
                    clanTag: '#OPP5',
                    clanName: 'Соперник 5',
                    clanLevel: 14,
                    attacksCount: 0,
                    stars: 0,
                    destructionPercentage: 0,
                },
            },
            [],
            { home: [], opponent: [] },
            BASE_NOW - 4 * 60,
        );

        // Before Round 4 is inserted, Round 5 preparation is returned
        const prepState = loadCwlViewData(
            { clanwarRepo, clanwarsLeagueRepo: cwlRepo, clansRepo },
            sub,
            BASE_NOW,
        );
        expect(prepState.kind).toBe('preparation');
        if (prepState.kind === 'preparation') {
            expect(prepState.war.roundNumber).toBe(5);
            expect(prepState.seasonSummary).toEqual({
                seasonLabel: '2026-11',
                completedRounds: 2,
                victories: 1,
                defeats: 1,
                draws: 0,
                totalStars: 74,
            });
        }

        // Now insert Round 4 inWar -> must take priority over Round 5 preparation
        clanwarRepo.saveCompleteClanwarData(
            {
                warUID: '#2PPLQ_#2PPLQ_#OPP4_400',
                clanTag: '#2PPLQ',
                state: 'inWar',
                warType: WAR_TYPES.cwl,
                teamSize: 2,
                attacksPerMember: 1,
                preparationStartTime: BASE_NOW - 30 * 3600,
                startTime: BASE_NOW - 18 * 3600,
                endTime: FIVE_HOURS_TWELVE_LATER,
                seasonId: cwlSeasonId,
                roundNumber: 4,
            },
            {
                home: {
                    side: CLAN_SIDES.home,
                    clanTag: '#2PPLQ',
                    clanName: 'Клан',
                    clanLevel: 14,
                    attacksCount: 1,
                    stars: 3,
                    destructionPercentage: 50.0,
                },
                opponent: {
                    side: CLAN_SIDES.opponent,
                    clanTag: '#OPP4',
                    clanName: 'Соперник 4',
                    clanLevel: 14,
                    attacksCount: 1,
                    stars: 2,
                    destructionPercentage: 45.0,
                },
            },
            [
                {
                    attackerTag: '#P1',
                    defenderTag: '#E1',
                    attackerClanTag: '#2PPLQ',
                    defenderClanTag: '#OPP4',
                    attackerPosition: 1,
                    defenderPosition: 1,
                    stars: 3,
                    destructionPercentage: 100,
                    orderNum: 1,
                    duration: 105,
                },
            ],
            {
                home: [
                    {
                        clanTag: '#2PPLQ',
                        playerTag: '#P1',
                        playerName: 'Игрок1',
                        townhallLevel: 16,
                        mapPosition: 1,
                    },
                    {
                        clanTag: '#2PPLQ',
                        playerTag: '#P2',
                        playerName: 'Игрок2',
                        townhallLevel: 16,
                        mapPosition: 2,
                    },
                ],
                opponent: [],
            },
            BASE_NOW - 5 * 60,
        );

        const inWarState = loadCwlViewData(
            { clanwarRepo, clanwarsLeagueRepo: cwlRepo, clansRepo },
            sub,
            BASE_NOW,
        );
        expect(inWarState.kind).toBe('in_war');
        if (inWarState.kind === 'in_war') {
            expect(inWarState.war.roundNumber).toBe(4);
            expect(inWarState.war.homeMembers.map((m) => m.playerTag)).toEqual(['#P1', '#P2']);
            expect(inWarState.seasonSummary).toEqual({
                seasonLabel: '2026-11',
                completedRounds: 2,
                victories: 1,
                defeats: 1,
                draws: 0,
                totalStars: 74,
            });
        }

        const formatted = formatCwlView(inWarState, BASE_NOW);
        expect(formatted).toContain('ЛВК 2026-11 · раунд 4/7: Клан vs Соперник 4');
        expect(formatted).toContain('Ещё не атаковали (1): Игрок2');
        expect(formatted).not.toContain('Запасной1');
        expect(formatted).not.toContain('Запасной2');
        expect(formatted).toContain('✅ Отбились: 1');
        expect(formatted).toContain(
            '📊 Сезон (сыграно 2): победы 1 / поражения 1 / ничьи 0 · ⭐ 74',
        );
    });
});
