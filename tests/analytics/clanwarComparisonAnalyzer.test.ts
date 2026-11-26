import { describe, expect, it } from 'vitest';

import {
    buildComparisonData,
    calculateHistoricalAverages,
    ClanwarPerformanceTrend,
    compareWithHistoricalAverage,
    type ClanwarHistoricalAverages,
} from '../../src/analytics/index.js';
import {
    ClanwarOutcome,
    type ClanwarOutcomeValue,
    type ClanwarWarStats,
} from '../../src/database/repos/clanwarRepo.js';

function makeWarStats(overrides: Partial<ClanwarWarStats> = {}): ClanwarWarStats {
    const homeDestruction = overrides.homeDestruction ?? 90.0;
    return {
        homeStars: 0,
        opponentStars: 0,
        homeDestruction,
        opponentDestruction: 0.0,
        result: ClanwarOutcome.Victory,
        maxAttacks: 30,
        attacksUsed: 30,
        teamSize: 15,
        totalAttackStars: 75,
        averageStarsPerAttack: 2.5,
        averageDestructionPerAttack: overrides.averageDestructionPerAttack ?? homeDestruction,
        disciplineStats: {
            playersWithoutAttacks: 0,
            playersWithOneAttack: 0,
            firstAttacksNotOnMirror: 0,
        },
        homeClanTag: '#HOME',
        homeClanName: 'Aurus',
        opponentClanTag: '#OPP',
        opponentClanName: 'Rival',
        ...overrides,
    };
}

function makeHistoricalAverages(
    overrides: Partial<ClanwarHistoricalAverages> = {},
): ClanwarHistoricalAverages {
    return {
        warsCount: 3,
        averageStarsPerAttack: 2.0,
        averageDestructionPerAttack: 80.0,
        averageAttacksUsed: 30.0,
        averageMaxAttacks: 30.0,
        averageMissedAttacks: 0.0,
        averagePlayersWithoutAttacks: 0.0,
        averagePlayersWithOneAttack: 0.0,
        averageFirstAttacksNotOnMirror: 0.0,
        averageMissedAttacksRate: 0.0,
        averagePlayersWithoutAttacksRate: 0.0,
        averagePlayersWithOneAttackRate: 0.0,
        averageFirstAttacksNotOnMirrorRate: 0.0,
        ...overrides,
    };
}

describe('clanwarComparisonAnalyzer.calculateHistoricalAverages', () => {
    it('returns null when previousWars is empty', () => {
        expect(calculateHistoricalAverages([])).toBeNull();
    });

    it('calculates weighted historical averages for 2 previous wars', () => {
        const previousWars: ClanwarWarStats[] = [
            makeWarStats({
                homeStars: 24,
                opponentStars: 20,
                homeDestruction: 87.0,
                opponentDestruction: 80.0,
                result: ClanwarOutcome.Victory,
                maxAttacks: 30,
                attacksUsed: 28,
                teamSize: 15,
                totalAttackStars: 75,
                averageStarsPerAttack: 75.0 / 28.0,
                averageDestructionPerAttack: 85.0,
                disciplineStats: {
                    playersWithoutAttacks: 1,
                    playersWithOneAttack: 2,
                    firstAttacksNotOnMirror: 1,
                },
            }),
            makeWarStats({
                homeStars: 20,
                opponentStars: 24,
                homeDestruction: 80.0,
                opponentDestruction: 88.0,
                result: ClanwarOutcome.Defeat,
                maxAttacks: 30,
                attacksUsed: 27,
                teamSize: 15,
                totalAttackStars: 68,
                averageStarsPerAttack: 68.0 / 27.0,
                averageDestructionPerAttack: 78.0,
                disciplineStats: {
                    playersWithoutAttacks: 0,
                    playersWithOneAttack: 3,
                    firstAttacksNotOnMirror: 2,
                },
            }),
        ];

        const averages = calculateHistoricalAverages(previousWars);
        expect(averages).not.toBeNull();
        expect(averages?.warsCount).toBe(2);
        expect(averages?.averageStarsPerAttack).toBeCloseTo(2.6, 5);
        expect(averages?.averageDestructionPerAttack).toBeCloseTo(81.563636, 5);
        expect(averages?.averageMissedAttacks).toBeCloseTo(2.5, 5);
        expect(averages?.averageAttacksUsed).toBeCloseTo(27.5, 5);
        expect(averages?.averageMaxAttacks).toBeCloseTo(30.0, 5);
        expect(averages?.averagePlayersWithoutAttacks).toBeCloseTo(0.5, 5);
        expect(averages?.averagePlayersWithOneAttack).toBeCloseTo(2.5, 5);
        expect(averages?.averageFirstAttacksNotOnMirror).toBeCloseTo(1.5, 5);
        expect(averages?.averageMissedAttacksRate).toBeCloseTo(5 / 60, 5);
        expect(averages?.averagePlayersWithoutAttacksRate).toBeCloseTo(1 / 30, 5);
        expect(averages?.averagePlayersWithOneAttackRate).toBeCloseTo(5 / 30, 5);
        expect(averages?.averageFirstAttacksNotOnMirrorRate).toBeCloseTo(3 / 29, 5);
    });

    it('weights wars of different team sizes by actual attacks and roster size', () => {
        const previousWars: ClanwarWarStats[] = [
            makeWarStats({
                result: ClanwarOutcome.Draw,
                maxAttacks: 20,
                attacksUsed: 13,
                teamSize: 10,
                totalAttackStars: 35,
                averageStarsPerAttack: 35 / 13,
                averageDestructionPerAttack: 100.0,
                disciplineStats: {
                    playersWithoutAttacks: 1,
                    playersWithOneAttack: 2,
                    firstAttacksNotOnMirror: 1,
                },
            }),
            makeWarStats({
                result: ClanwarOutcome.Victory,
                maxAttacks: 30,
                attacksUsed: 28,
                teamSize: 15,
                totalAttackStars: 75,
                averageStarsPerAttack: 75 / 28,
                averageDestructionPerAttack: 87.0,
                disciplineStats: {
                    playersWithoutAttacks: 1,
                    playersWithOneAttack: 2,
                    firstAttacksNotOnMirror: 1,
                },
            }),
            makeWarStats({
                result: ClanwarOutcome.Victory,
                maxAttacks: 30,
                attacksUsed: 30,
                teamSize: 15,
                totalAttackStars: 82,
                averageStarsPerAttack: 82 / 30,
                averageDestructionPerAttack: 91.5,
                disciplineStats: {
                    playersWithoutAttacks: 0,
                    playersWithOneAttack: 1,
                    firstAttacksNotOnMirror: 0,
                },
            }),
            makeWarStats({
                result: ClanwarOutcome.Defeat,
                maxAttacks: 30,
                attacksUsed: 27,
                teamSize: 15,
                totalAttackStars: 68,
                averageStarsPerAttack: 68 / 27,
                averageDestructionPerAttack: 83.4,
                disciplineStats: {
                    playersWithoutAttacks: 1,
                    playersWithOneAttack: 3,
                    firstAttacksNotOnMirror: 2,
                },
            }),
        ];

        const averages = calculateHistoricalAverages(previousWars);
        expect(averages).not.toBeNull();
        expect(averages?.warsCount).toBe(4);
        expect(averages?.averageStarsPerAttack).toBeCloseTo(260 / 98, 6);
        expect(averages?.averageDestructionPerAttack).toBeCloseTo(89.110204, 5);
        expect(averages?.averageMissedAttacks).toBeCloseTo(3.0, 6);
        expect(averages?.averageAttacksUsed).toBeCloseTo(24.5, 6);
        expect(averages?.averageMaxAttacks).toBeCloseTo(27.5, 6);
        expect(averages?.averagePlayersWithoutAttacks).toBeCloseTo(0.75, 6);
        expect(averages?.averagePlayersWithOneAttack).toBeCloseTo(2.0, 6);
        expect(averages?.averageFirstAttacksNotOnMirror).toBeCloseTo(1.0, 6);
        expect(averages?.averageMissedAttacksRate).toBeCloseTo(12 / 110, 6);
        expect(averages?.averagePlayersWithoutAttacksRate).toBeCloseTo(3 / 55, 6);
        expect(averages?.averagePlayersWithOneAttackRate).toBeCloseTo(8 / 55, 6);
        expect(averages?.averageFirstAttacksNotOnMirrorRate).toBeCloseTo(4 / 52, 6);
    });

    it('handles wars with zero attacks and zero denominators safely without NaN', () => {
        const averages = calculateHistoricalAverages([
            makeWarStats({
                result: ClanwarOutcome.Draw,
                maxAttacks: 30,
                attacksUsed: 0,
                teamSize: 15,
                totalAttackStars: 0,
                averageStarsPerAttack: 0,
                averageDestructionPerAttack: 0,
                disciplineStats: {
                    playersWithoutAttacks: 15,
                    playersWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
            }),
        ]);

        expect(averages).toEqual({
            warsCount: 1,
            averageStarsPerAttack: 0,
            averageDestructionPerAttack: 0,
            averageAttacksUsed: 0,
            averageMaxAttacks: 30,
            averageMissedAttacks: 30,
            averagePlayersWithoutAttacks: 15,
            averagePlayersWithOneAttack: 0,
            averageFirstAttacksNotOnMirror: 0,
            averageMissedAttacksRate: 1,
            averagePlayersWithoutAttacksRate: 1,
            averagePlayersWithOneAttackRate: 0,
            averageFirstAttacksNotOnMirrorRate: 0,
        });
    });
});

describe('clanwarComparisonAnalyzer.buildComparisonData', () => {
    it('handles empty previousWars', () => {
        const currentWar = makeWarStats({ result: ClanwarOutcome.Victory });
        const data = buildComparisonData(currentWar, []);

        expect(data.currentWar).toEqual(currentWar);
        expect(data.previousWar).toBeNull();
        expect(data.previousWarsAverage).toBeNull();
        expect(data.performanceComparison).toBeNull();
        expect(data.recentWarResults).toEqual([ClanwarOutcome.Victory]);
    });

    it('caps historical average at 3 wars while keeping all recentWarResults in chronological order', () => {
        const prev1 = makeWarStats({ result: ClanwarOutcome.Victory, homeDestruction: 80.0 });
        const prev2 = makeWarStats({ result: ClanwarOutcome.Defeat, homeDestruction: 85.0 });
        const prev3 = makeWarStats({ result: ClanwarOutcome.Draw, homeDestruction: 90.0 });
        const prev4 = makeWarStats({ result: ClanwarOutcome.Victory, homeDestruction: 95.0 });
        const current = makeWarStats({ result: ClanwarOutcome.Defeat, homeDestruction: 70.0 });

        const data = buildComparisonData(current, [prev1, prev2, prev3, prev4]);

        expect(data.previousWar).toEqual(prev1);
        expect(data.previousWarsAverage?.warsCount).toBe(3);
        expect(data.previousWarsAverage?.averageDestructionPerAttack).toBeCloseTo(85.0, 5);
        expect(data.performanceComparison).not.toBeNull();
        expect(data.recentWarResults).toEqual<ClanwarOutcomeValue[]>([
            ClanwarOutcome.Victory, // prev4 (oldest)
            ClanwarOutcome.Draw, // prev3
            ClanwarOutcome.Defeat, // prev2
            ClanwarOutcome.Victory, // prev1
            ClanwarOutcome.Defeat, // current (newest)
        ]);
    });

    it('is deterministic across repeated calls with the same input', () => {
        const current = makeWarStats({
            result: ClanwarOutcome.Victory,
            averageStarsPerAttack: 2.8,
        });
        const prev = [makeWarStats({ result: ClanwarOutcome.Defeat, averageStarsPerAttack: 2.1 })];

        const first = buildComparisonData(current, prev);
        const second = buildComparisonData(current, prev);
        expect(second).toEqual(first);
    });
});

describe('clanwarComparisonAnalyzer.compareWithHistoricalAverage', () => {
    it('returns Better when all 4 metrics improve', () => {
        const current = makeWarStats({
            averageStarsPerAttack: 3.0,
            averageDestructionPerAttack: 90.0,
        });
        const avg = makeHistoricalAverages({
            averageStarsPerAttack: 2.0,
            averageDestructionPerAttack: 80.0,
            averagePlayersWithoutAttacksRate: 0.1,
            averagePlayersWithOneAttackRate: 0.1,
            averageFirstAttacksNotOnMirrorRate: 0.1,
        });

        const res = compareWithHistoricalAverage(current, avg);
        expect(res).toEqual({
            trend: ClanwarPerformanceTrend.Better,
            improvedMetrics: 4,
            worsenedMetrics: 0,
            unchangedMetrics: 0,
            totalMetrics: 4,
            improvedMetricsRate: 1.0,
            worsenedMetricsRate: 0.0,
            unchangedMetricsRate: 0.0,
        });
    });

    it('returns Worse when all 4 metrics worsen', () => {
        const current = makeWarStats({
            averageStarsPerAttack: 1.0,
            averageDestructionPerAttack: 70.0,
            disciplineStats: {
                playersWithoutAttacks: 1,
                playersWithOneAttack: 3,
                firstAttacksNotOnMirror: 2,
            },
        });
        const avg = makeHistoricalAverages({
            averageStarsPerAttack: 2.0,
            averageDestructionPerAttack: 80.0,
            averagePlayersWithoutAttacksRate: 0.0,
            averageFirstAttacksNotOnMirrorRate: 0.0,
        });

        const res = compareWithHistoricalAverage(current, avg);
        expect(res.trend).toBe(ClanwarPerformanceTrend.Worse);
        expect(res.improvedMetrics).toBe(0);
        expect(res.worsenedMetrics).toBe(4);
        expect(res.unchangedMetrics).toBe(0);
        expect(res.worsenedMetricsRate).toBe(1.0);
    });

    it('returns Similar when metrics are equal or tied (2 improved vs 2 worsened, 1 vs 1)', () => {
        const equalCurrent = makeWarStats({
            averageStarsPerAttack: 2.0,
            averageDestructionPerAttack: 80.0,
            disciplineStats: {
                playersWithoutAttacks: 0,
                playersWithOneAttack: 3,
                firstAttacksNotOnMirror: 2,
            },
        });
        const equalAvg = makeHistoricalAverages({
            averageStarsPerAttack: 2.0,
            averageDestructionPerAttack: 80.0,
            averagePlayersWithoutAttacksRate: 0.0,
            averageFirstAttacksNotOnMirrorRate: 2 / 15,
        });
        expect(compareWithHistoricalAverage(equalCurrent, equalAvg).trend).toBe(
            ClanwarPerformanceTrend.Similar,
        );

        const tie2v2 = compareWithHistoricalAverage(
            makeWarStats({
                averageStarsPerAttack: 3.0, // better
                averageDestructionPerAttack: 70.0, // worse
                disciplineStats: {
                    playersWithoutAttacks: 0, // better (0 < 0.1)
                    playersWithOneAttack: 0,
                    firstAttacksNotOnMirror: 3, // worse (0.2 > 0.1)
                },
            }),
            makeHistoricalAverages({
                averageStarsPerAttack: 2.0,
                averageDestructionPerAttack: 80.0,
                averagePlayersWithoutAttacksRate: 0.1,
                averageFirstAttacksNotOnMirrorRate: 0.1,
            }),
        );
        expect(tie2v2.trend).toBe(ClanwarPerformanceTrend.Similar);
        expect(tie2v2.improvedMetrics).toBe(2);
        expect(tie2v2.worsenedMetrics).toBe(2);
    });

    it('uses averageDestructionPerAttack rather than homeDestruction and handles zero teamSize', () => {
        const res = compareWithHistoricalAverage(
            makeWarStats({
                homeDestruction: 99.0,
                averageStarsPerAttack: 2.0,
                averageDestructionPerAttack: 75.0,
            }),
            makeHistoricalAverages({
                averageStarsPerAttack: 2.0,
                averageDestructionPerAttack: 80.0,
            }),
        );
        expect(res.trend).toBe(ClanwarPerformanceTrend.Worse);
        expect(res.worsenedMetrics).toBe(1);
        expect(res.unchangedMetrics).toBe(3);

        const zeroRes = compareWithHistoricalAverage(
            makeWarStats({
                teamSize: 0,
                maxAttacks: 0,
                attacksUsed: 0,
                averageStarsPerAttack: 0,
                averageDestructionPerAttack: 0,
            }),
            makeHistoricalAverages({
                averageStarsPerAttack: 0,
                averageDestructionPerAttack: 0,
            }),
        );
        expect(zeroRes.trend).toBe(ClanwarPerformanceTrend.Similar);
        expect(zeroRes.unchangedMetrics).toBe(4);
    });

    it('excludes firstAttacksNotOnMirrorRate from trend calculation when mirrorRuleEnabled is false (3 primary metrics)', () => {
        // 2 improved (stars, without-attacks), 1 worsened (destruction), 1 worsened (not-on-mirror)
        const current = makeWarStats({
            averageStarsPerAttack: 3.0, // better vs 2.0
            averageDestructionPerAttack: 70.0, // worse vs 80.0
            disciplineStats: {
                playersWithoutAttacks: 0, // better vs 0.1
                playersWithOneAttack: 0,
                firstAttacksNotOnMirror: 5, // worse (5/15 vs 0.1)
            },
        });
        const avg = makeHistoricalAverages({
            averageStarsPerAttack: 2.0,
            averageDestructionPerAttack: 80.0,
            averagePlayersWithoutAttacksRate: 0.1,
            averageFirstAttacksNotOnMirrorRate: 0.1,
        });

        const withMirror = compareWithHistoricalAverage(current, avg, { mirrorRuleEnabled: true });
        expect(withMirror.totalMetrics).toBe(4);
        expect(withMirror.trend).toBe(ClanwarPerformanceTrend.Similar);
        expect(withMirror.improvedMetrics).toBe(2);
        expect(withMirror.worsenedMetrics).toBe(2);

        const withoutMirror = compareWithHistoricalAverage(current, avg, {
            mirrorRuleEnabled: false,
        });
        expect(withoutMirror).toEqual({
            trend: ClanwarPerformanceTrend.Better,
            improvedMetrics: 2,
            worsenedMetrics: 1,
            unchangedMetrics: 0,
            totalMetrics: 3,
            improvedMetricsRate: 2 / 3,
            worsenedMetricsRate: 1 / 3,
            unchangedMetricsRate: 0,
        });

        const prevWar = makeWarStats({
            averageStarsPerAttack: 2.0,
            averageDestructionPerAttack: 80.0,
            disciplineStats: {
                playersWithoutAttacks: 2,
                playersWithOneAttack: 0,
                firstAttacksNotOnMirror: 0,
            },
        });
        const dataDisabled = buildComparisonData(current, [prevWar], { mirrorRuleEnabled: false });
        expect(dataDisabled.mirrorRuleEnabled).toBe(false);
        expect(dataDisabled.performanceComparison?.totalMetrics).toBe(3);
        expect(dataDisabled.performanceComparison?.trend).toBe(ClanwarPerformanceTrend.Better);
    });
});
