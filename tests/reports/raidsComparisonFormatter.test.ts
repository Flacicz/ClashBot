import { describe, expect, it, vi } from 'vitest';

import {
    buildRaidComparisonData,
    RaidPerformanceTrend,
    type RaidComparisonData,
    type RaidHistoricalAverages,
    type RaidPerformanceComparison,
    type RaidPerformanceTrendValue,
} from '../../src/analytics/index.js';
import type { ClansRepo, RaidRepo } from '../../src/database/index.js';
import { APPLICATION_EVENT_TYPES, type RaidsEndedEvent } from '../../src/events/index.js';
import type { RaidComparisonStats, RaidReference } from '../../src/models/raid.js';
import {
    RaidsComparisonFormatter,
    type ClanNameReader,
    type RaidComparisonReader,
} from '../../src/reports/index.js';
import { expectMatchesGolden } from './goldenHelper.js';

function makeRaidStats(
    startTime: number,
    totalLoot: number,
    raidsCompleted: number,
    usedAttacks: number,
    availableAttacks: number,
    activeParticipants: number,
    eligibleParticipants: number,
    participantsWithAllAttacksUsed: number,
    participantsWithoutAttacks: number,
    enemyDistrictsDestroyed: number,
    offensiveReward: number,
    defensiveReward: number,
): RaidComparisonStats {
    return {
        startTime,
        totalLoot,
        raidsCompleted,
        usedAttacks,
        availableAttacks,
        activeParticipants,
        eligibleParticipants,
        participantsWithAllAttacksUsed,
        participantsWithoutAttacks,
        enemyDistrictsDestroyed,
        offensiveReward,
        defensiveReward,
    };
}

function makeCurrentRaid(): RaidComparisonStats {
    return makeRaidStats(86_400, 1_312_000, 9, 96, 120, 20, 24, 13, 4, 12, 1_850, 640);
}

function makePreviousRaid(): RaidComparisonStats {
    return makeRaidStats(1, 1_180_000, 7, 84, 120, 18, 24, 10, 6, 10, 1_720, 590);
}

function makeHistoricalAverages(raidsCount = 3): RaidHistoricalAverages {
    return {
        raidsCount,
        averageLootPerUsedAttack: 13_850.0,
        averageParticipantsWithAllAttacksUsedRate: 10.5 / 18.7,
        averageParticipantsWithoutAttacksRate: 5.3 / 23.7,
        averageAttackUsageRate: 88.9 / 120.0,
        averageActiveParticipants: 18.7,
        averageEligibleParticipants: 23.7,
        averageParticipantsWithAllAttacksUsed: 10.5,
        averageParticipantsWithoutAttacks: 5.3,
        averageUsedAttacks: 88.9,
        averageAvailableAttacks: 120.0,
        averageTotalLoot: 1_130_000.0,
        averageRaidsCompleted: 7.3,
        averageEnemyDistrictsDestroyed: 9.3,
        averageOffensiveReward: 1_650.0,
        averageDefensiveReward: 560.0,
    };
}

function makePerformance(
    trend: RaidPerformanceTrendValue,
    improvedMetrics = 2,
    worsenedMetrics = 1,
    unchangedMetrics = 0,
    totalMetrics = 3,
): RaidPerformanceComparison {
    return {
        trend,
        improvedMetrics,
        worsenedMetrics,
        unchangedMetrics,
        totalMetrics,
        improvedMetricsRate: improvedMetrics / totalMetrics,
        worsenedMetricsRate: worsenedMetrics / totalMetrics,
        unchangedMetricsRate: unchangedMetrics / totalMetrics,
    };
}

function makeComparisonData(
    currentRaid: RaidComparisonStats,
    previousRaid: RaidComparisonStats,
): RaidComparisonData {
    return {
        clanTag: '#2J8PJ9VLG',
        clanName: 'aurus',
        currentRaid,
        previousRaid,
        previousRaidsAverage: null,
        performanceComparison: null,
    };
}

function makeFullComparisonData(): RaidComparisonData {
    return {
        clanTag: '#2J8PJ9VLG',
        clanName: 'aurus',
        currentRaid: makeCurrentRaid(),
        previousRaid: makePreviousRaid(),
        previousRaidsAverage: makeHistoricalAverages(),
        performanceComparison: makePerformance(RaidPerformanceTrend.Better),
    };
}

describe('RaidsComparisonFormatter (golden parity)', () => {
    it('exposes EventType and eventType "raids_comparison"', () => {
        expect(RaidsComparisonFormatter.EventType).toBe('raids_comparison');
        expect(RaidsComparisonFormatter.eventType).toBe('raids_comparison');
    });

    it('returns empty string when there is no previous raid', () => {
        const data = buildRaidComparisonData(makeCurrentRaid(), []);
        expect(RaidsComparisonFormatter.buildReport(data)).toBe('');
    });

    it('matches C++ golden snapshot: 1 previous raid, Better, HTML escaping', () => {
        const currentRaid = makeRaidStats(
            1_710_000_000,
            1_312_000,
            9,
            96,
            120,
            20,
            24,
            13,
            4,
            12,
            1_850,
            640,
        );
        const prevRaid1 = makeRaidStats(
            1_709_395_200,
            1_180_000,
            7,
            84,
            120,
            18,
            24,
            10,
            6,
            10,
            1_720,
            590,
        );
        const data: RaidComparisonData = {
            ...buildRaidComparisonData(currentRaid, [prevRaid1]),
            clanTag: '#<2J8PJ9VLG&>',
            clanName: 'Aurus & <Clan>',
        };

        expectMatchesGolden(
            RaidsComparisonFormatter.buildReport(data),
            'raidsComparison',
            'one-previous-raid-better',
        );
    });

    it('matches C++ golden snapshot: 2 previous raids, Worse', () => {
        const currentRaid = makeRaidStats(
            1_710_000_000,
            960_000,
            6,
            80,
            125,
            17,
            25,
            8,
            8,
            28,
            1_320,
            480,
        );
        const prevRaid1 = makeRaidStats(
            1_709_395_200,
            1_250_000,
            8,
            95,
            120,
            20,
            24,
            14,
            4,
            36,
            1_750,
            610,
        );
        const prevRaid2 = makeRaidStats(
            1_708_790_400,
            1_310_000,
            9,
            100,
            120,
            21,
            24,
            15,
            3,
            39,
            1_820,
            630,
        );
        const data: RaidComparisonData = {
            ...buildRaidComparisonData(currentRaid, [prevRaid1, prevRaid2]),
            clanTag: '#2J8PJ9VLG',
            clanName: 'aurus',
        };

        expectMatchesGolden(
            RaidsComparisonFormatter.buildReport(data),
            'raidsComparison',
            'two-previous-raids-worse',
        );
    });

    it('matches C++ golden snapshot: 3 previous raids, Better (fractional historical averages)', () => {
        expectMatchesGolden(
            RaidsComparisonFormatter.buildReport(makeFullComparisonData()),
            'raidsComparison',
            'three-previous-raids-better',
        );
    });

    it('matches C++ golden snapshot: 4 previous raids (average capped at 3)', () => {
        const currentRaid = makeRaidStats(
            1_710_000_000,
            1_400_000,
            10,
            100,
            120,
            20,
            24,
            15,
            4,
            42,
            1_900,
            660,
        );
        const prevRaid1 = makeRaidStats(
            1_709_395_200,
            1_200_000,
            8,
            90,
            120,
            19,
            24,
            12,
            5,
            35,
            1_700,
            600,
        );
        const prevRaid2 = makeRaidStats(
            1_708_790_400,
            1_150_000,
            7,
            85,
            115,
            18,
            23,
            11,
            5,
            33,
            1_650,
            580,
        );
        const prevRaid3 = makeRaidStats(
            1_708_185_600,
            1_250_000,
            9,
            95,
            125,
            20,
            25,
            13,
            5,
            37,
            1_750,
            620,
        );
        const prevRaid4Excluded = makeRaidStats(
            1_707_580_800,
            100_000,
            1,
            10,
            120,
            2,
            24,
            0,
            22,
            3,
            100,
            50,
        );

        const data: RaidComparisonData = {
            ...buildRaidComparisonData(currentRaid, [
                prevRaid1,
                prevRaid2,
                prevRaid3,
                prevRaid4Excluded,
            ]),
            clanTag: '#2J8PJ9VLG',
            clanName: 'aurus',
        };

        expectMatchesGolden(
            RaidsComparisonFormatter.buildReport(data),
            'raidsComparison',
            'four-previous-raids-capped-at-three',
        );
    });

    it('matches C++ golden snapshot: 3 previous raids, Similar tie (1v1v1)', () => {
        const currentRaid = makeRaidStats(
            1_710_000_000,
            1_500_000,
            8,
            100,
            120,
            20,
            24,
            10,
            6,
            35,
            1_750,
            600,
        );
        const prevRaid1 = makeRaidStats(
            1_709_395_200,
            1_200_000,
            8,
            100,
            120,
            20,
            24,
            12,
            6,
            34,
            1_700,
            600,
        );
        const prevRaid2 = makeRaidStats(
            1_708_790_400,
            1_200_000,
            8,
            100,
            120,
            20,
            24,
            12,
            6,
            36,
            1_800,
            600,
        );
        const prevRaid3 = makeRaidStats(
            1_708_185_600,
            1_200_000,
            8,
            100,
            120,
            20,
            24,
            12,
            6,
            35,
            1_750,
            600,
        );

        const data: RaidComparisonData = {
            ...buildRaidComparisonData(currentRaid, [prevRaid1, prevRaid2, prevRaid3]),
            clanTag: '#2J8PJ9VLG',
            clanName: 'aurus',
        };

        expectMatchesGolden(
            RaidsComparisonFormatter.buildReport(data),
            'raidsComparison',
            'three-previous-raids-similar-tie',
        );
    });

    it('matches C++ golden snapshot: zero attacks and zero participants', () => {
        const emptyRaid = makeRaidStats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        const data: RaidComparisonData = {
            ...buildRaidComparisonData(emptyRaid, [emptyRaid]),
            clanTag: '#2J8PJ9VLG',
            clanName: 'aurus',
        };

        expectMatchesGolden(
            RaidsComparisonFormatter.buildReport(data),
            'raidsComparison',
            'zero-attacks-and-zero-participants',
        );
    });

    it('matches C++ golden snapshot: all metrics equal (Similar)', () => {
        const raid = makeRaidStats(
            1_710_000_000,
            1_200_000,
            8,
            96,
            120,
            20,
            24,
            12,
            4,
            34,
            1_680,
            590,
        );
        const data: RaidComparisonData = {
            ...buildRaidComparisonData(raid, [raid]),
            clanTag: '#2J8PJ9VLG',
            clanName: 'aurus',
        };

        expectMatchesGolden(
            RaidsComparisonFormatter.buildReport(data),
            'raidsComparison',
            'all-metrics-equal',
        );
    });

    it('formats RaidsEndedEvent via readers idempotently and requests limit=3', () => {
        const currentRef: RaidReference = { raidId: 10 };
        const prevRef: RaidReference = { raidId: 9 };
        const raidStats = makeRaidStats(
            1_710_000_000,
            1_200_000,
            8,
            96,
            120,
            20,
            24,
            12,
            4,
            34,
            1_680,
            590,
        );

        const getClanNameByTag = vi.fn(() => 'aurus');
        const getPreviousRaids = vi.fn(() => [prevRef]);
        const getRaidComparisonStats = vi.fn(() => raidStats);

        const clansReader: ClanNameReader = { getClanNameByTag };
        const raidReader: RaidComparisonReader = {
            getRaidComparisonStats,
            getPreviousRaids,
        };

        const formatter = new RaidsComparisonFormatter(clansReader, raidReader);
        const event: RaidsEndedEvent = {
            type: APPLICATION_EVENT_TYPES.raidsEnded,
            clanTag: '#2J8PJ9VLG',
            raidReference: currentRef,
        };

        const first = formatter.format(event);
        const second = formatter.format(event);

        expect(getPreviousRaids).toHaveBeenCalledWith(currentRef, 3);
        expect(first).toBe(second);
        expectMatchesGolden(first, 'raidsComparison', 'all-metrics-equal');
    });

    it('formats historical average count with correct Russian declension (1, 2, 3, 5, 11)', () => {
        const cases = [
            {
                count: 1,
                expectedLabel: '📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 1 ПРЕДЫДУЩИЙ РЕЙД</b>\n',
                expectedPeriod: 'за последний рейд',
            },
            {
                count: 2,
                expectedLabel: '📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 2 ПРЕДЫДУЩИХ РЕЙДА</b>\n',
                expectedPeriod: 'за последние 2 рейда',
            },
            {
                count: 3,
                expectedLabel: '📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 3 ПРЕДЫДУЩИХ РЕЙДА</b>\n',
                expectedPeriod: 'за последние 3 рейда',
            },
            {
                count: 5,
                expectedLabel: '📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 5 ПРЕДЫДУЩИХ РЕЙДОВ</b>\n',
                expectedPeriod: 'за последние 5 рейдов',
            },
            {
                count: 11,
                expectedLabel: '📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 11 ПРЕДЫДУЩИХ РЕЙДОВ</b>\n',
                expectedPeriod: 'за последние 11 рейдов',
            },
        ] as const;

        for (const testCase of cases) {
            const comparisonData: RaidComparisonData = {
                ...makeFullComparisonData(),
                previousRaidsAverage: makeHistoricalAverages(testCase.count),
            };

            const report = RaidsComparisonFormatter.buildReport(comparisonData);
            expect(report).toContain(testCase.expectedLabel);
            expect(report).toContain(`✅ Динамика лучше среднего ${testCase.expectedPeriod}\n`);
        }
    });

    it('omits historical comparison and performance when previousRaidsAverage or performanceComparison is missing', () => {
        const withoutAverages = makeComparisonData(makeCurrentRaid(), makePreviousRaid());
        const reportWithoutAverages = RaidsComparisonFormatter.buildReport(withoutAverages);

        expect(reportWithoutAverages).not.toContain('📉 <b>СРАВНЕНИЕ СО СРЕДНИМ');
        expect(reportWithoutAverages).not.toContain('Итог по ');
        expect(reportWithoutAverages.endsWith('\n')).toBe(false);

        const withoutPerformance: RaidComparisonData = {
            ...makeFullComparisonData(),
            performanceComparison: null,
        };
        const reportWithoutPerformance = RaidsComparisonFormatter.buildReport(withoutPerformance);
        expect(reportWithoutPerformance).toContain(
            '📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 3 ПРЕДЫДУЩИХ РЕЙДА</b>',
        );
        expect(reportWithoutPerformance).not.toContain('Динамика ');
        expect(reportWithoutPerformance).not.toContain('Итог по ');
    });

    it('does not produce negative incomplete participant count when participantsWithAllAttacksUsed exceeds activeParticipants', () => {
        const currentRaid: RaidComparisonStats = {
            ...makeCurrentRaid(),
            activeParticipants: 3,
            participantsWithAllAttacksUsed: 5,
        };
        const previousRaid: RaidComparisonStats = {
            ...makePreviousRaid(),
            activeParticipants: 3,
            participantsWithAllAttacksUsed: 2,
        };

        const report = RaidsComparisonFormatter.buildReport(
            makeComparisonData(currentRaid, previousRaid),
        );

        expect(report).toContain(
            'Использовали не все атаки\n' +
                '(среди активных участников):\n' +
                '33.3% → 0.0% (−33.3 п.п.; 1/3 → 0/3; ✅ лучше)',
        );
    });

    it('formats integral and fractional historical averages accurately', () => {
        const comparisonData: RaidComparisonData = {
            ...makeFullComparisonData(),
            currentRaid: {
                ...makeCurrentRaid(),
                totalLoot: 1_234_568,
                raidsCompleted: 8,
                enemyDistrictsDestroyed: 10,
                offensiveReward: 2_345,
                defensiveReward: 0,
            },
            previousRaidsAverage: {
                ...makeHistoricalAverages(),
                averageTotalLoot: 1_234_567.0,
                averageRaidsCompleted: 7.0,
                averageEnemyDistrictsDestroyed: 9.5,
                averageOffensiveReward: 1_234.0,
                averageDefensiveReward: 0.0,
                averageParticipantsWithAllAttacksUsed: 10.0,
                averageActiveParticipants: 20.0,
                averageParticipantsWithoutAttacks: 4.0,
                averageEligibleParticipants: 24.0,
                averageParticipantsWithAllAttacksUsedRate: 0.5,
            },
        };

        const report = RaidsComparisonFormatter.buildReport(comparisonData);
        expect(report).toContain(
            'Полностью использовали доступные атаки\n' +
                '(среди активных участников):\n' +
                '50.0% → 65.0% (+15.0 п.п.; 10/20 → 13/20; ✅ лучше)',
        );
        expect(report).toContain('Заработано золота:\n1 234 567 → 1 234 568 (+1)');
        expect(report).toContain('Завершено рейдов:\n7 → 8 (+1.0)');
        expect(report).toContain('Уничтожено районов:\n9.5 → 10 (+0.5)');
        expect(report).toContain('Награда за нападение:\n1 234 → 2 345 (+1 111)');
        expect(report).toContain('Награда за оборону:\n0 → 0 (0)');
    });

    it('accepts ClansRepo and RaidRepo structurally as readers', () => {
        const assertClansAssignable = (repo: ClansRepo): ClanNameReader => repo;
        const assertRaidAssignable = (repo: RaidRepo): RaidComparisonReader => repo;
        expect(typeof assertClansAssignable).toBe('function');
        expect(typeof assertRaidAssignable).toBe('function');
    });
});
