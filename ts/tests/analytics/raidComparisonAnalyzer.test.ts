import { describe, expect, it } from 'vitest';

import {
    buildRaidComparisonData,
    calculateRaidHistoricalAverages,
    compareRaidWithHistoricalAverage,
    RaidPerformanceTrend,
    raidsAnalytics,
    type RaidHistoricalAverages,
} from '../../src/analytics/index.js';
import type { RaidComparisonStats } from '../../src/models/raid.js';

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
    enemyDistrictsDestroyed = 0,
    offensiveReward = 0,
    defensiveReward = 0,
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

function makeHistoricalAverages(
    averageLootPerUsedAttack: number,
    averageParticipantsWithAllAttacksUsedRate: number,
    averageParticipantsWithoutAttacksRate: number,
): RaidHistoricalAverages {
    return {
        raidsCount: 3,
        averageLootPerUsedAttack,
        averageParticipantsWithAllAttacksUsedRate,
        averageParticipantsWithoutAttacksRate,
        averageAttackUsageRate: 0.0,
        averageActiveParticipants: 0.0,
        averageEligibleParticipants: 0.0,
        averageParticipantsWithAllAttacksUsed: 0.0,
        averageParticipantsWithoutAttacks: 0.0,
        averageUsedAttacks: 0.0,
        averageAvailableAttacks: 0.0,
        averageTotalLoot: 0.0,
        averageRaidsCompleted: 0.0,
        averageEnemyDistrictsDestroyed: 0.0,
        averageOffensiveReward: 0.0,
        averageDefensiveReward: 0.0,
    };
}

describe('raidComparisonAnalyzer.calculateRaidHistoricalAverages', () => {
    it('returns null for empty historical data', () => {
        expect(calculateRaidHistoricalAverages([])).toBeNull();
        expect(raidsAnalytics.calculateHistoricalAverages([])).toBeNull();
    });

    it('calculates weighted and arithmetic historical averages across previous raids', () => {
        const previousRaids: RaidComparisonStats[] = [
            makeRaidStats(1, 1000, 1, 10, 20, 4, 5, 2, 1, 10, 100, 50),
            makeRaidStats(2, 2400, 2, 20, 30, 5, 6, 4, 0, 12, 120, 60),
        ];

        const averages = calculateRaidHistoricalAverages(previousRaids);
        expect(averages).not.toBeNull();
        expect(averages?.raidsCount).toBe(2);
        expect(averages?.averageLootPerUsedAttack).toBe(3400.0 / 30.0);
        expect(averages?.averageParticipantsWithAllAttacksUsedRate).toBe(6.0 / 9.0);
        expect(averages?.averageParticipantsWithoutAttacksRate).toBe(1.0 / 11.0);
        expect(averages?.averageAttackUsageRate).toBe(30.0 / 50.0);
        expect(averages?.averageActiveParticipants).toBe(4.5);
        expect(averages?.averageEligibleParticipants).toBe(5.5);
        expect(averages?.averageParticipantsWithAllAttacksUsed).toBe(3.0);
        expect(averages?.averageParticipantsWithoutAttacks).toBe(0.5);
        expect(averages?.averageUsedAttacks).toBe(15.0);
        expect(averages?.averageAvailableAttacks).toBe(25.0);
        expect(averages?.averageTotalLoot).toBe(1700.0);
        expect(averages?.averageRaidsCompleted).toBe(1.5);
        expect(averages?.averageEnemyDistrictsDestroyed).toBe(11.0);
        expect(averages?.averageOffensiveReward).toBe(110.0);
        expect(averages?.averageDefensiveReward).toBe(55.0);
    });

    it('returns zero averages when historical totals are zero without NaN or Infinity', () => {
        const previousRaids: RaidComparisonStats[] = [makeRaidStats(1, 0, 0, 0, 0, 0, 0, 0, 0)];

        const averages = calculateRaidHistoricalAverages(previousRaids);
        expect(averages).toEqual({
            raidsCount: 1,
            averageLootPerUsedAttack: 0.0,
            averageParticipantsWithAllAttacksUsedRate: 0.0,
            averageParticipantsWithoutAttacksRate: 0.0,
            averageAttackUsageRate: 0.0,
            averageActiveParticipants: 0.0,
            averageEligibleParticipants: 0.0,
            averageParticipantsWithAllAttacksUsed: 0.0,
            averageParticipantsWithoutAttacks: 0.0,
            averageUsedAttacks: 0.0,
            averageAvailableAttacks: 0.0,
            averageTotalLoot: 0.0,
            averageRaidsCompleted: 0.0,
            averageEnemyDistrictsDestroyed: 0.0,
            averageOffensiveReward: 0.0,
            averageDefensiveReward: 0.0,
        });
    });
});

describe('raidComparisonAnalyzer.buildRaidComparisonData', () => {
    it('builds comparison data from previous raids and caps historical average at 3 raids', () => {
        const currentRaid = makeRaidStats(3, 3000, 3, 25, 30, 6, 7, 5, 1);
        const previousRaids: RaidComparisonStats[] = [
            makeRaidStats(2, 2400, 2, 20, 30, 5, 6, 4, 0),
            makeRaidStats(1, 2000, 2, 18, 25, 4, 5, 3, 1),
            makeRaidStats(0, 1800, 1, 15, 20, 3, 4, 2, 1),
            makeRaidStats(-1, 1600, 1, 12, 20, 3, 4, 1, 2),
        ];

        const comparisonData = buildRaidComparisonData(currentRaid, previousRaids);

        expect(comparisonData.currentRaid.startTime).toBe(currentRaid.startTime);
        expect(comparisonData.previousRaid).not.toBeNull();
        expect(comparisonData.previousRaid?.startTime).toBe(2);
        expect(comparisonData.previousRaidsAverage).not.toBeNull();
        expect(comparisonData.previousRaidsAverage?.raidsCount).toBe(3);
        expect(comparisonData.performanceComparison).not.toBeNull();
    });

    it('builds comparison data without previous raids', () => {
        const currentRaid = makeRaidStats(10, 0, 0, 0, 0, 0, 0, 0, 0);
        const comparisonData = buildRaidComparisonData(currentRaid, []);

        expect(comparisonData.currentRaid.startTime).toBe(currentRaid.startTime);
        expect(comparisonData.previousRaid).toBeNull();
        expect(comparisonData.previousRaidsAverage).toBeNull();
        expect(comparisonData.performanceComparison).toBeNull();
    });

    it('is deterministic across repeated calls with the same input', () => {
        const currentRaid = makeRaidStats(3, 3000, 3, 25, 30, 6, 7, 5, 1);
        const previousRaids = [makeRaidStats(2, 2400, 2, 20, 30, 5, 6, 4, 0)];

        const first = raidsAnalytics.buildComparisonData(currentRaid, previousRaids);
        const second = raidsAnalytics.buildComparisonData(currentRaid, previousRaids);
        expect(second).toEqual(first);
    });
});

describe('raidComparisonAnalyzer.compareRaidWithHistoricalAverage', () => {
    it('reports Better performance when all 3 metrics improve', () => {
        const currentRaid = makeRaidStats(1, 1200, 1, 100, 100, 8, 10, 8, 1);
        const historicalAverages = makeHistoricalAverages(10.0, 0.6, 0.2);

        const comparison = compareRaidWithHistoricalAverage(currentRaid, historicalAverages);
        expect(comparison).toEqual({
            trend: RaidPerformanceTrend.Better,
            improvedMetrics: 3,
            worsenedMetrics: 0,
            unchangedMetrics: 0,
            totalMetrics: 3,
            improvedMetricsRate: 1.0,
            worsenedMetricsRate: 0.0,
            unchangedMetricsRate: 0.0,
        });
    });

    it('reports Worse performance when all 3 metrics worsen', () => {
        const currentRaid = makeRaidStats(1, 800, 1, 100, 100, 8, 10, 4, 3);
        const historicalAverages = makeHistoricalAverages(10.0, 0.6, 0.2);

        const comparison = compareRaidWithHistoricalAverage(currentRaid, historicalAverages);
        expect(comparison).toEqual({
            trend: RaidPerformanceTrend.Worse,
            improvedMetrics: 0,
            worsenedMetrics: 3,
            unchangedMetrics: 0,
            totalMetrics: 3,
            improvedMetricsRate: 0.0,
            worsenedMetricsRate: 1.0,
            unchangedMetricsRate: 0.0,
        });
    });

    it('reports Similar performance when all 3 metrics are unchanged or tied (1 vs 1)', () => {
        const currentRaid = makeRaidStats(1, 1000, 1, 100, 100, 8, 10, 6, 2);
        const historicalAverages = makeHistoricalAverages(10.0, 0.75, 0.2);

        const comparison = compareRaidWithHistoricalAverage(currentRaid, historicalAverages);
        expect(comparison).toEqual({
            trend: RaidPerformanceTrend.Similar,
            improvedMetrics: 0,
            worsenedMetrics: 0,
            unchangedMetrics: 3,
            totalMetrics: 3,
            improvedMetricsRate: 0.0,
            worsenedMetricsRate: 0.0,
            unchangedMetricsRate: 1.0,
        });

        // 1 improved, 1 worsened, 1 unchanged
        const tiedRaid = makeRaidStats(1, 1200, 1, 100, 100, 8, 10, 4, 2);
        const tiedComparison = raidsAnalytics.compareWithHistoricalAverage(
            tiedRaid,
            historicalAverages,
        );
        expect(tiedComparison).toEqual({
            trend: RaidPerformanceTrend.Similar,
            improvedMetrics: 1,
            worsenedMetrics: 1,
            unchangedMetrics: 1,
            totalMetrics: 3,
            improvedMetricsRate: 1.0 / 3.0,
            worsenedMetricsRate: 1.0 / 3.0,
            unchangedMetricsRate: 1.0 / 3.0,
        });
    });

    it('reports Similar performance with zero historical averages', () => {
        const currentRaid = makeRaidStats(1, 0, 0, 0, 0, 0, 0, 0, 0);
        const historicalAverages = makeHistoricalAverages(0.0, 0.0, 0.0);

        const comparison = compareRaidWithHistoricalAverage(currentRaid, historicalAverages);
        expect(comparison).toEqual({
            trend: RaidPerformanceTrend.Similar,
            improvedMetrics: 0,
            worsenedMetrics: 0,
            unchangedMetrics: 3,
            totalMetrics: 3,
            improvedMetricsRate: 0.0,
            worsenedMetricsRate: 0.0,
            unchangedMetricsRate: 1.0,
        });
    });

    it('handles zero denominators for current raid without dividing by zero', () => {
        const currentRaid = makeRaidStats(1, 100, 0, 0, 0, 0, 0, 0, 0);
        const historicalAverages = makeHistoricalAverages(10.0, 0.5, 0.2);

        const comparison = compareRaidWithHistoricalAverage(currentRaid, historicalAverages);
        expect(comparison).toEqual({
            trend: RaidPerformanceTrend.Worse,
            improvedMetrics: 1,
            worsenedMetrics: 2,
            unchangedMetrics: 0,
            totalMetrics: 3,
            improvedMetricsRate: 1.0 / 3.0,
            worsenedMetricsRate: 2.0 / 3.0,
            unchangedMetricsRate: 0.0,
        });
    });
});
