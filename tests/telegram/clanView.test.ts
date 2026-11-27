import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    CLAN_SIDES,
    ClansRepo,
    ClanwarRepo,
    Database,
    MigratorManager,
    SubscriptionRepo,
    TransactionManager,
    WAR_TYPES,
    type ClanwarAttack,
    type ClanwarMember,
} from '../../src/database/index.js';
import type { ActiveClanMember, Player } from '../../src/models/clan.js';
import { getPresetCategories } from '../../src/models/subscription.js';
import {
    countTelegramHtmlVisibleLength,
    TELEGRAM_HARD_MAX_VISIBLE_LENGTH,
} from '../../src/notifications/htmlMessageSplitter.js';
import {
    formatClanCardView,
    formatClanReliabilityView,
    formatClanRosterView,
    loadClanCardViewData,
    loadClanReliabilityViewData,
    loadClanRosterViewData,
    PENDING_CLAN_SYNC_NAME,
    resolveWarLeagueLabel,
    type ClanCardViewData,
    type ClanRosterViewData,
} from '../../src/telegram/index.js';
import { expectMatchesGolden } from '../reports/goldenHelper.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');

// 2026-11-14 12:48:00 UTC = 2026-11-14 15:48:00 UTC+3
const BASE_NOW = Date.UTC(2026, 10, 14, 12, 48, 0) / 1000;

function createMigratedDb(): {
    db: Database;
    clansRepo: ClansRepo;
    clanwarRepo: ClanwarRepo;
    subscriptionRepo: SubscriptionRepo;
} {
    const db = new Database(':memory:');
    const tx = new TransactionManager(db);
    new MigratorManager(db, tx).migrate(REAL_MIGRATIONS_PATH);

    return {
        db,
        clansRepo: new ClansRepo(db),
        clanwarRepo: new ClanwarRepo(db),
        subscriptionRepo: new SubscriptionRepo(db),
    };
}

function seedClanWithSnapshot(
    db: Database,
    clansRepo: ClansRepo,
    params: {
        clanTag: string;
        clanName: string;
        clanLevel?: number;
        membersCount?: number;
        isWarLogPublic?: boolean;
        warLeagueId?: number;
        snapshotAt?: number;
    },
): void {
    clansRepo.saveClan({
        tag: params.clanTag,
        name: params.clanName,
        description: '',
        locationId: 0,
        locationName: '',
        chatLanguageId: 0,
        chatLanguage: '',
        isFamilyFriendly: false,
    });
    clansRepo.saveClanSnapshot({
        clanTag: params.clanTag,
        type: 'open',
        membersCount: params.membersCount ?? 25,
        clanLevel: params.clanLevel ?? 15,
        clanPoints: 30000,
        clanBuilderBasePoints: 15000,
        clanCapitalPoints: 5000,
        capitalHallLevel: 8,
        capitalLeagueId: 0,
        requiredTrophies: 0,
        requiredBuilderBaseTrophies: 0,
        requiredTownhallLevel: 1,
        warFrequency: 'always',
        isWarLogPublic: params.isWarLogPublic ?? true,
        warWinStreak: 3,
        warWins: 50,
        warTies: 2,
        warLosses: 10,
        warLeagueId: params.warLeagueId ?? 48000015,
    });
    db.connection
        .prepare(`UPDATE clan_snapshots SET created_at = ? WHERE clan_tag = ?;`)
        .run(params.snapshotAt ?? BASE_NOW - 7 * 60, params.clanTag);
}

function seedCompletedRegularWar(
    clanwarRepo: ClanwarRepo,
    params: {
        clanTag: string;
        warUID: string;
        prepTime: number;
        observedAt: number;
        homeMembers: readonly ClanwarMember[];
        opponentMembers: readonly ClanwarMember[];
        attacks: readonly ClanwarAttack[];
    },
): void {
    clanwarRepo.saveCompleteClanwarData(
        {
            warUID: params.warUID,
            clanTag: params.clanTag,
            state: 'warEnded',
            warType: WAR_TYPES.regular,
            teamSize: params.homeMembers.length,
            attacksPerMember: 2,
            preparationStartTime: params.prepTime,
            startTime: params.prepTime + 86_400,
            endTime: params.prepTime + 2 * 86_400,
            seasonId: null,
            roundNumber: null,
        },
        {
            home: {
                side: CLAN_SIDES.home,
                clanTag: params.clanTag,
                clanName: 'Клан',
                clanLevel: 18,
                attacksCount: params.attacks.length,
                stars: 10,
                destructionPercentage: 90,
            },
            opponent: {
                side: CLAN_SIDES.opponent,
                clanTag: '#OPP',
                clanName: 'Соперник',
                clanLevel: 16,
                attacksCount: 5,
                stars: 8,
                destructionPercentage: 75,
            },
        },
        params.attacks,
        {
            home: params.homeMembers,
            opponent: params.opponentMembers,
        },
        params.observedAt,
    );
}

describe('resolveWarLeagueLabel', () => {
    it('maps known CWL warLeagueIds to Russian labels and returns null for unknown/unranked IDs', () => {
        expect(resolveWarLeagueLabel(48000001)).toBe('Бронзовая лига III');
        expect(resolveWarLeagueLabel(48000011)).toBe('Хрустальная лига II');
        expect(resolveWarLeagueLabel(48000015)).toBe('Лига мастеров I');
        expect(resolveWarLeagueLabel(48000018)).toBe('Лига чемпионов I');

        expect(resolveWarLeagueLabel(null)).toBeNull();
        expect(resolveWarLeagueLabel(undefined)).toBeNull();
        expect(resolveWarLeagueLabel(0)).toBeNull();
        expect(resolveWarLeagueLabel(48000000)).toBeNull();
        expect(resolveWarLeagueLabel(48000099)).toBeNull();
    });
});

describe('clanView golden formatting', () => {
    it('matches golden for clan card with public war log, CWL league, and players preset', () => {
        const data: ClanCardViewData = {
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            latestSnapshot: {
                clanTag: '#2PPLQ',
                membersCount: 42,
                clanLevel: 18,
                isWarLogPublic: true,
                warLeagueId: 48000015,
                createdAt: BASE_NOW - 7 * 60,
            },
            categories: getPresetCategories('players'),
            mirrorRuleEnabled: false,
            timezoneOffsetHours: 3,
        };

        expectMatchesGolden(formatClanCardView(data, BASE_NOW), 'clanView', 'card-public-players');
    });

    it('matches golden for clan card with private war log, HTML escaping, management preset, custom UTC+5, mirror ON, and stale >1h', () => {
        const data: ClanCardViewData = {
            clanTag: '#2PPLQ',
            clanName: 'Alpha & <Co>',
            latestSnapshot: {
                clanTag: '#2PPLQ',
                membersCount: 31,
                clanLevel: 12,
                isWarLogPublic: false,
                warLeagueId: 0,
                createdAt: BASE_NOW - 75 * 60,
            },
            categories: getPresetCategories('management'),
            mirrorRuleEnabled: true,
            timezoneOffsetHours: 5,
        };

        expectMatchesGolden(
            formatClanCardView(data, BASE_NOW),
            'clanView',
            'card-private-management-stale',
        );
    });

    it('matches golden for clan card with custom notification categories and negative UTC offset', () => {
        const data: ClanCardViewData = {
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            latestSnapshot: {
                clanTag: '#2PPLQ',
                membersCount: 25,
                clanLevel: 10,
                isWarLogPublic: true,
                warLeagueId: 48000011,
                createdAt: BASE_NOW - 5 * 60,
            },
            categories: {
                summaries: true,
                reminders: false,
                roster: false,
                discipline: true,
                system: false,
            },
            mirrorRuleEnabled: true,
            timezoneOffsetHours: -4,
        };

        expectMatchesGolden(formatClanCardView(data, BASE_NOW), 'clanView', 'card-custom-preset');
    });

    it('matches golden for pending sync clan without snapshot and hides placeholder name', () => {
        const data: ClanCardViewData = {
            clanTag: '#2PPLQ',
            clanName: PENDING_CLAN_SYNC_NAME,
            latestSnapshot: null,
            categories: getPresetCategories('players'),
            mirrorRuleEnabled: false,
            timezoneOffsetHours: 3,
        };

        const output = formatClanCardView(data, BASE_NOW);
        expectMatchesGolden(output, 'clanView', 'card-pending-sync');
        expect(output).not.toContain(PENDING_CLAN_SYNC_NAME);
    });

    it('matches golden for active roster grouped by role with duplicate nicks across roles and HTML escaping', () => {
        const members: ActiveClanMember[] = [
            {
                playerTag: '#P1',
                playerName: 'Лидер',
                role: 'leader',
                townHallLevel: 17,
                clanRank: 1,
                snapshotCreatedAt: BASE_NOW - 7 * 60,
            },
            {
                playerTag: '#P2',
                playerName: 'Алекс',
                role: 'coLeader',
                townHallLevel: 16,
                clanRank: 2,
                snapshotCreatedAt: BASE_NOW - 7 * 60,
            },
            {
                playerTag: '#P3',
                playerName: '<Зам>',
                role: 'coLeader',
                townHallLevel: 16,
                clanRank: 3,
                snapshotCreatedAt: BASE_NOW - 7 * 60,
            },
            {
                playerTag: '#P4',
                playerName: 'Старейшина & Co',
                role: 'admin',
                townHallLevel: 15,
                clanRank: 4,
                snapshotCreatedAt: BASE_NOW - 7 * 60,
            },
            {
                playerTag: '#P5',
                playerName: 'Алекс',
                role: 'member',
                townHallLevel: 14,
                clanRank: 5,
                snapshotCreatedAt: BASE_NOW - 7 * 60,
            },
            {
                playerTag: '#P6',
                playerName: 'Новичок',
                role: 'member',
                townHallLevel: 13,
                clanRank: 6,
                snapshotCreatedAt: BASE_NOW - 7 * 60,
            },
        ];

        const data: ClanRosterViewData = {
            clanTag: '#2PPLQ',
            clanName: 'Alpha & <Co>',
            members,
            updatedAt: BASE_NOW - 7 * 60,
        };

        expectMatchesGolden(
            formatClanRosterView(data, BASE_NOW),
            'clanView',
            'roster-grouped-duplicates-html',
        );
    });

    it('keeps a 50-player active roster (max-length nicknames, duplicates, HTML chars) within Telegram 4096-char limit', () => {
        const members: ActiveClanMember[] = Array.from({ length: 50 }, (_, idx) => {
            const role =
                idx === 0 ? 'leader' : idx < 6 ? 'coLeader' : idx < 16 ? 'admin' : 'member';
            const playerName =
                idx < 8 ? 'DuplicateName15' : `Member_${String(idx + 1).padStart(2, '0')}<>&`;
            return {
                playerTag: `#PYLQGRJC${String(idx).padStart(2, '0')}`,
                playerName,
                role,
                townHallLevel: 17 - (idx % 6),
                clanRank: idx + 1,
                snapshotCreatedAt: BASE_NOW - 2 * 3600,
            };
        });

        const output = formatClanRosterView(
            { clanTag: '#2PPLQ', clanName: 'Клан', members, updatedAt: BASE_NOW - 2 * 3600 },
            BASE_NOW,
        );

        expect(countTelegramHtmlVisibleLength(output)).toBeLessThanOrEqual(
            TELEGRAM_HARD_MAX_VISIBLE_LENGTH,
        );
        expect(output).toContain('Глава (1):');
        expect(output).toContain('Соруководители (5):');
        expect(output).toContain('Старейшины (10):');
        expect(output).toContain('Участники (34):');
        expect(output).toContain('DuplicateName15 (#PYLQGRJC00) TH17');
        expect(output).toContain('&lt;&gt;&amp;');
    });

    it('safely caps oversized reliability report (>4096 visible chars) within Telegram limit with balanced HTML', () => {
        const hugeLines = Array.from(
            { length: 65 },
            (_, idx) =>
                `• Player_${String(idx + 1)} &amp; &lt;Tag&gt; — состав 5/5 · атаки 10 · ⭐ 2.80 · 💥 96.50% · в последней КВ`,
        ).join('\n');
        const hugeReport = `📋 <b>НАДЁЖНОСТЬ СОСТАВА</b>\nСтатистика за последние 5 КВ\n\n✅ <b>СТАБИЛЬНЫЕ</b>\n${hugeLines}`;

        const output = formatClanReliabilityView(
            {
                kind: 'report',
                clanTag: '#2PPLQ',
                clanName: 'Клан',
                reportHtml: hugeReport,
                updatedAt: BASE_NOW - 10 * 60,
            },
            BASE_NOW,
        );

        expect(countTelegramHtmlVisibleLength(output)).toBeLessThanOrEqual(
            TELEGRAM_HARD_MAX_VISIBLE_LENGTH,
        );
        expect(output).toContain('отчёт сокращён из-за лимита Telegram');
        expect(output).toContain('🔄 обновлено 10 мин назад');
    });
});

describe('SQLite clanView loaders and reliability golden tests', () => {
    const openDbs: Database[] = [];

    afterEach(() => {
        while (openDbs.length > 0) {
            openDbs.pop()?.close();
        }
    });

    it('loads reliability report from SQLite matching golden in both mirror_rule_enabled modes and respects 5-war cap', () => {
        const { db, clansRepo, clanwarRepo, subscriptionRepo } = createMigratedDb();
        openDbs.push(db);

        seedClanWithSnapshot(db, clansRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            clanLevel: 18,
            membersCount: 4,
            isWarLogPublic: true,
            warLeagueId: 48000015,
            snapshotAt: BASE_NOW - 7 * 60,
        });

        const players: Player[] = [
            { tag: '#P1', name: 'Стабильный', clanTag: '#2PPLQ' },
            { tag: '#P2', name: 'НеПоЗеркалу', clanTag: '#2PPLQ' },
            { tag: '#P3', name: 'Прогульщик', clanTag: '#2PPLQ' },
            { tag: '#P4', name: 'Запасной', clanTag: '#2PPLQ' },
        ];
        clansRepo.savePlayers(players);
        clansRepo.saveMembershipChanges({ leftPlayers: [], joinedPlayers: players });

        const oppMembers: ClanwarMember[] = [
            {
                clanTag: '#OPP',
                playerTag: '#O1',
                playerName: 'Opp1',
                townhallLevel: 16,
                mapPosition: 1,
            },
            {
                clanTag: '#OPP',
                playerTag: '#O2',
                playerName: 'Opp2',
                townhallLevel: 16,
                mapPosition: 2,
            },
            {
                clanTag: '#OPP',
                playerTag: '#O3',
                playerName: 'Opp3',
                townhallLevel: 15,
                mapPosition: 3,
            },
        ];

        // War 1 (older): #P1 and #P2 both attack mirror cleanly
        seedCompletedRegularWar(clanwarRepo, {
            clanTag: '#2PPLQ',
            warUID: '#2PPLQ_#2PPLQ_#OPP_1000',
            prepTime: BASE_NOW - 8 * 86_400,
            observedAt: BASE_NOW - 6 * 86_400,
            homeMembers: [
                {
                    clanTag: '#2PPLQ',
                    playerTag: '#P1',
                    playerName: 'Стабильный',
                    townhallLevel: 16,
                    mapPosition: 1,
                },
                {
                    clanTag: '#2PPLQ',
                    playerTag: '#P2',
                    playerName: 'НеПоЗеркалу',
                    townhallLevel: 16,
                    mapPosition: 2,
                },
            ],
            opponentMembers: oppMembers.slice(0, 2),
            attacks: [
                {
                    attackerTag: '#P1',
                    defenderTag: '#O1',
                    attackerClanTag: '#2PPLQ',
                    defenderClanTag: '#OPP',
                    attackerPosition: 1,
                    defenderPosition: 1,
                    stars: 3,
                    destructionPercentage: 100,
                    orderNum: 1,
                    duration: 90,
                },
                {
                    attackerTag: '#P1',
                    defenderTag: '#O2',
                    attackerClanTag: '#2PPLQ',
                    defenderClanTag: '#OPP',
                    attackerPosition: 1,
                    defenderPosition: 2,
                    stars: 3,
                    destructionPercentage: 100,
                    orderNum: 2,
                    duration: 95,
                },
                {
                    attackerTag: '#P2',
                    defenderTag: '#O2',
                    attackerClanTag: '#2PPLQ',
                    defenderClanTag: '#OPP',
                    attackerPosition: 2,
                    defenderPosition: 2,
                    stars: 2,
                    destructionPercentage: 85,
                    orderNum: 3,
                    duration: 110,
                },
                {
                    attackerTag: '#P2',
                    defenderTag: '#O1',
                    attackerClanTag: '#2PPLQ',
                    defenderClanTag: '#OPP',
                    attackerPosition: 2,
                    defenderPosition: 1,
                    stars: 3,
                    destructionPercentage: 95,
                    orderNum: 4,
                    duration: 115,
                },
            ],
        });

        // War 2 (newest): #P1 clean, #P2 first attack NOT on mirror (#O3 instead of #O2), #P3 0 attacks
        seedCompletedRegularWar(clanwarRepo, {
            clanTag: '#2PPLQ',
            warUID: '#2PPLQ_#2PPLQ_#OPP_2000',
            prepTime: BASE_NOW - 3 * 86_400,
            observedAt: BASE_NOW - 1 * 86_400,
            homeMembers: [
                {
                    clanTag: '#2PPLQ',
                    playerTag: '#P1',
                    playerName: 'Стабильный',
                    townhallLevel: 16,
                    mapPosition: 1,
                },
                {
                    clanTag: '#2PPLQ',
                    playerTag: '#P2',
                    playerName: 'НеПоЗеркалу',
                    townhallLevel: 16,
                    mapPosition: 2,
                },
                {
                    clanTag: '#2PPLQ',
                    playerTag: '#P3',
                    playerName: 'Прогульщик',
                    townhallLevel: 15,
                    mapPosition: 3,
                },
            ],
            opponentMembers: oppMembers,
            attacks: [
                {
                    attackerTag: '#P1',
                    defenderTag: '#O1',
                    attackerClanTag: '#2PPLQ',
                    defenderClanTag: '#OPP',
                    attackerPosition: 1,
                    defenderPosition: 1,
                    stars: 3,
                    destructionPercentage: 100,
                    orderNum: 1,
                    duration: 80,
                },
                {
                    attackerTag: '#P1',
                    defenderTag: '#O2',
                    attackerClanTag: '#2PPLQ',
                    defenderClanTag: '#OPP',
                    attackerPosition: 1,
                    defenderPosition: 2,
                    stars: 3,
                    destructionPercentage: 100,
                    orderNum: 2,
                    duration: 85,
                },
                {
                    attackerTag: '#P2',
                    defenderTag: '#O3',
                    attackerClanTag: '#2PPLQ',
                    defenderClanTag: '#OPP',
                    attackerPosition: 2,
                    defenderPosition: 3,
                    stars: 3,
                    destructionPercentage: 100,
                    orderNum: 3,
                    duration: 100,
                },
                {
                    attackerTag: '#P2',
                    defenderTag: '#O2',
                    attackerClanTag: '#2PPLQ',
                    defenderClanTag: '#OPP',
                    attackerPosition: 2,
                    defenderPosition: 2,
                    stars: 2,
                    destructionPercentage: 80,
                    orderNum: 4,
                    duration: 105,
                },
            ],
        });

        subscriptionRepo.saveTelegramChat(100, 0, 'Mirror On Chat');
        subscriptionRepo.subscribeToChat(100, 0, '#2PPLQ', {
            preset: 'management',
            mirrorRuleEnabled: true,
        });
        subscriptionRepo.saveTelegramChat(200, 0, 'Mirror Off Chat');
        subscriptionRepo.subscribeToChat(200, 0, '#2PPLQ', {
            preset: 'management',
            mirrorRuleEnabled: false,
        });

        const subMirrorOn = subscriptionRepo.getSubscriptionSummary(100, 0, '#2PPLQ');
        const subMirrorOff = subscriptionRepo.getSubscriptionSummary(200, 0, '#2PPLQ');
        expect(subMirrorOn).not.toBeNull();
        expect(subMirrorOff).not.toBeNull();
        if (subMirrorOn === null || subMirrorOff === null) {
            return;
        }

        const reportOn = formatClanReliabilityView(
            loadClanReliabilityViewData({ clansRepo, clanwarRepo }, subMirrorOn),
            BASE_NOW,
        );
        expectMatchesGolden(reportOn, 'clanView', 'reliability-mirror-enabled');

        const reportOff = formatClanReliabilityView(
            loadClanReliabilityViewData({ clansRepo, clanwarRepo }, subMirrorOff),
            BASE_NOW,
        );
        expectMatchesGolden(reportOff, 'clanView', 'reliability-mirror-disabled');

        // Verify card & roster loaders round-trip from SQLite too
        const cardData = loadClanCardViewData({ clansRepo }, subMirrorOn);
        expect(cardData.latestSnapshot?.clanLevel).toBe(18);
        expect(cardData.latestSnapshot?.warLeagueId).toBe(48000015);
        expect(cardData.mirrorRuleEnabled).toBe(true);

        const rosterData = loadClanRosterViewData({ clansRepo }, subMirrorOn);
        expect(rosterData.members).toHaveLength(4);
    });

    it('matches golden when there are no completed regular wars and war log is private', () => {
        const { db, clansRepo, clanwarRepo, subscriptionRepo } = createMigratedDb();
        openDbs.push(db);

        seedClanWithSnapshot(db, clansRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            isWarLogPublic: false,
            snapshotAt: BASE_NOW - 7 * 60,
        });

        subscriptionRepo.saveTelegramChat(100, 0, 'Private Chat');
        subscriptionRepo.subscribeToChat(100, 0, '#2PPLQ', 'management');
        const sub = subscriptionRepo.getSubscriptionSummary(100, 0, '#2PPLQ');
        expect(sub).not.toBeNull();
        if (sub === null) {
            return;
        }

        const emptyData = loadClanReliabilityViewData({ clansRepo, clanwarRepo }, sub);
        expect(emptyData.kind).toBe('empty');
        expectMatchesGolden(
            formatClanReliabilityView(emptyData, BASE_NOW),
            'clanView',
            'reliability-no-completed-wars',
        );
    });

    it('caps reliability calculation at the last 5 completed regular wars when 6 exist in SQLite', () => {
        const { db, clansRepo, clanwarRepo, subscriptionRepo } = createMigratedDb();
        openDbs.push(db);

        seedClanWithSnapshot(db, clansRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            snapshotAt: BASE_NOW - 5 * 60,
        });
        const member: Player = { tag: '#P1', name: 'Veteran', clanTag: '#2PPLQ' };
        clansRepo.savePlayers([member]);
        clansRepo.saveMembershipChanges({ leftPlayers: [], joinedPlayers: [member] });

        for (let i = 1; i <= 6; i += 1) {
            seedCompletedRegularWar(clanwarRepo, {
                clanTag: '#2PPLQ',
                warUID: `#2PPLQ_#2PPLQ_#OPP_${String(i)}`,
                prepTime: BASE_NOW - (20 - i * 2) * 86_400,
                observedAt: BASE_NOW - (19 - i * 2) * 86_400,
                homeMembers: [
                    {
                        clanTag: '#2PPLQ',
                        playerTag: '#P1',
                        playerName: 'Veteran',
                        townhallLevel: 16,
                        mapPosition: 1,
                    },
                ],
                opponentMembers: [
                    {
                        clanTag: '#OPP',
                        playerTag: '#O1',
                        playerName: 'Opp1',
                        townhallLevel: 16,
                        mapPosition: 1,
                    },
                ],
                attacks: [
                    {
                        attackerTag: '#P1',
                        defenderTag: '#O1',
                        attackerClanTag: '#2PPLQ',
                        defenderClanTag: '#OPP',
                        attackerPosition: 1,
                        defenderPosition: 1,
                        stars: 3,
                        destructionPercentage: 100,
                        orderNum: 1,
                        duration: 90,
                    },
                    {
                        attackerTag: '#P1',
                        defenderTag: '#O1',
                        attackerClanTag: '#2PPLQ',
                        defenderClanTag: '#OPP',
                        attackerPosition: 1,
                        defenderPosition: 1,
                        stars: 3,
                        destructionPercentage: 100,
                        orderNum: 2,
                        duration: 95,
                    },
                ],
            });
        }

        subscriptionRepo.saveTelegramChat(100, 0, 'Test');
        subscriptionRepo.subscribeToChat(100, 0, '#2PPLQ', 'management');
        const sub = subscriptionRepo.getSubscriptionSummary(100, 0, '#2PPLQ');
        expect(sub).not.toBeNull();
        if (sub === null) {
            return;
        }

        const rendered = formatClanReliabilityView(
            loadClanReliabilityViewData({ clansRepo, clanwarRepo }, sub),
            BASE_NOW,
        );
        expect(rendered).toContain('Статистика за последние 5 КВ');
        expect(rendered).toContain('состав 5/5 · атаки 10');
    });
});
