import type { RaidComparisonStats } from '../models/raid.js';

export interface RaidHistoricalAverages {
    readonly raidsCount: number;
    readonly averageLootPerUsedAttack: number;
    readonly averageParticipantsWithAllAttacksUsedRate: number;
    readonly averageParticipantsWithoutAttacksRate: number;
    readonly averageAttackUsageRate: number;
    readonly averageActiveParticipants: number;
    readonly averageEligibleParticipants: number;
    readonly averageParticipantsWithAllAttacksUsed: number;
    readonly averageParticipantsWithoutAttacks: number;
    readonly averageUsedAttacks: number;
    readonly averageAvailableAttacks: number;
    readonly averageExternalUsedAttacks: number;
    readonly averageExternalParticipants: number;
    readonly averageTotalLoot: number;
    readonly averageRaidsCompleted: number;
    readonly averageEnemyDistrictsDestroyed: number;
    readonly averageOffensiveReward: number;
    readonly averageDefensiveReward: number;
}

export const RaidPerformanceTrend = {
    Better: 'better',
    Worse: 'worse',
    Similar: 'similar',
} as const;

export type RaidPerformanceTrendValue =
    (typeof RaidPerformanceTrend)[keyof typeof RaidPerformanceTrend];

export interface RaidPerformanceComparison {
    readonly trend: RaidPerformanceTrendValue;
    readonly improvedMetrics: number;
    readonly worsenedMetrics: number;
    readonly unchangedMetrics: number;
    readonly totalMetrics: number;
    readonly improvedMetricsRate: number;
    readonly worsenedMetricsRate: number;
    readonly unchangedMetricsRate: number;
}

export interface RaidComparisonData {
    readonly clanTag: string;
    readonly clanName: string;
    readonly currentRaid: RaidComparisonStats;
    readonly previousRaid: RaidComparisonStats | null;
    readonly previousRaidsAverage: RaidHistoricalAverages | null;
    readonly performanceComparison: RaidPerformanceComparison | null;
}

const AVERAGE_RAIDS_COUNT = 3;

function calculateRate(value: number, total: number): number {
    if (total <= 0) {
        return 0.0;
    }
    return value / total;
}

function calculateTotalUsedAttacks(raid: RaidComparisonStats): number {
    return raid.usedAttacks + raid.externalUsedAttacks;
}

function calculateLootPerUsedAttack(raid: RaidComparisonStats): number {
    return calculateRate(raid.totalLoot, calculateTotalUsedAttacks(raid));
}

export function calculateRaidHistoricalAverages(
    previousRaids: readonly RaidComparisonStats[],
): RaidHistoricalAverages | null {
    if (previousRaids.length === 0) {
        return null;
    }

    let totalLoot = 0;
    let totalUsedAttacks = 0;
    let totalAllUsedAttacks = 0;
    let totalExternalUsedAttacks = 0;
    let totalExternalParticipants = 0;
    let totalActiveParticipants = 0;
    let totalEligibleParticipants = 0;
    let totalParticipantsWithAllAttacksUsed = 0;
    let totalParticipantsWithoutAttacks = 0;
    let totalAvailableAttacks = 0;

    let totalRaidsCompleted = 0;
    let totalEnemyDistrictsDestroyed = 0;
    let totalOffensiveReward = 0;
    let totalDefensiveReward = 0;

    for (const raid of previousRaids) {
        totalLoot += raid.totalLoot;
        totalUsedAttacks += raid.usedAttacks;
        totalAllUsedAttacks += calculateTotalUsedAttacks(raid);
        totalExternalUsedAttacks += raid.externalUsedAttacks;
        totalExternalParticipants += raid.externalParticipants;
        totalActiveParticipants += raid.activeParticipants;
        totalEligibleParticipants += raid.eligibleParticipants;
        totalParticipantsWithAllAttacksUsed += raid.participantsWithAllAttacksUsed;
        totalParticipantsWithoutAttacks += raid.participantsWithoutAttacks;
        totalAvailableAttacks += raid.availableAttacks;

        totalRaidsCompleted += raid.raidsCompleted;
        totalEnemyDistrictsDestroyed += raid.enemyDistrictsDestroyed;
        totalOffensiveReward += raid.offensiveReward;
        totalDefensiveReward += raid.defensiveReward;
    }

    const raidsCount = previousRaids.length;

    return {
        raidsCount,
        averageLootPerUsedAttack: calculateRate(totalLoot, totalAllUsedAttacks),
        averageParticipantsWithAllAttacksUsedRate: calculateRate(
            totalParticipantsWithAllAttacksUsed,
            totalActiveParticipants,
        ),
        averageParticipantsWithoutAttacksRate: calculateRate(
            totalParticipantsWithoutAttacks,
            totalEligibleParticipants,
        ),
        averageAttackUsageRate: calculateRate(totalUsedAttacks, totalAvailableAttacks),
        averageActiveParticipants: totalActiveParticipants / raidsCount,
        averageEligibleParticipants: totalEligibleParticipants / raidsCount,
        averageParticipantsWithAllAttacksUsed: totalParticipantsWithAllAttacksUsed / raidsCount,
        averageParticipantsWithoutAttacks: totalParticipantsWithoutAttacks / raidsCount,
        averageUsedAttacks: totalUsedAttacks / raidsCount,
        averageAvailableAttacks: totalAvailableAttacks / raidsCount,
        averageExternalUsedAttacks: totalExternalUsedAttacks / raidsCount,
        averageExternalParticipants: totalExternalParticipants / raidsCount,
        averageTotalLoot: totalLoot / raidsCount,
        averageRaidsCompleted: totalRaidsCompleted / raidsCount,
        averageEnemyDistrictsDestroyed: totalEnemyDistrictsDestroyed / raidsCount,
        averageOffensiveReward: totalOffensiveReward / raidsCount,
        averageDefensiveReward: totalDefensiveReward / raidsCount,
    };
}

export function compareRaidWithHistoricalAverage(
    currentRaid: RaidComparisonStats,
    historicalAverages: RaidHistoricalAverages,
): RaidPerformanceComparison {
    const currentLootPerUsedAttack = calculateLootPerUsedAttack(currentRaid);
    const currentParticipantsWithAllAttacksUsedRate = calculateRate(
        currentRaid.participantsWithAllAttacksUsed,
        currentRaid.activeParticipants,
    );
    const currentParticipantsWithoutAttacksRate = calculateRate(
        currentRaid.participantsWithoutAttacks,
        currentRaid.eligibleParticipants,
    );

    let improvedMetrics = 0;
    let worsenedMetrics = 0;
    let unchangedMetrics = 0;

    const compareHigherIsBetter = (currentValue: number, historicalValue: number): void => {
        if (currentValue > historicalValue) {
            improvedMetrics += 1;
        } else if (currentValue < historicalValue) {
            worsenedMetrics += 1;
        } else {
            unchangedMetrics += 1;
        }
    };

    const compareLowerIsBetter = (currentValue: number, historicalValue: number): void => {
        if (currentValue < historicalValue) {
            improvedMetrics += 1;
        } else if (currentValue > historicalValue) {
            worsenedMetrics += 1;
        } else {
            unchangedMetrics += 1;
        }
    };

    compareHigherIsBetter(currentLootPerUsedAttack, historicalAverages.averageLootPerUsedAttack);
    compareHigherIsBetter(
        currentParticipantsWithAllAttacksUsedRate,
        historicalAverages.averageParticipantsWithAllAttacksUsedRate,
    );
    compareLowerIsBetter(
        currentParticipantsWithoutAttacksRate,
        historicalAverages.averageParticipantsWithoutAttacksRate,
    );

    const totalMetrics = improvedMetrics + worsenedMetrics + unchangedMetrics;

    let trend: RaidPerformanceTrendValue = RaidPerformanceTrend.Similar;
    if (improvedMetrics > worsenedMetrics) {
        trend = RaidPerformanceTrend.Better;
    } else if (worsenedMetrics > improvedMetrics) {
        trend = RaidPerformanceTrend.Worse;
    }

    return {
        trend,
        improvedMetrics,
        worsenedMetrics,
        unchangedMetrics,
        totalMetrics,
        improvedMetricsRate: calculateRate(improvedMetrics, totalMetrics),
        worsenedMetricsRate: calculateRate(worsenedMetrics, totalMetrics),
        unchangedMetricsRate: calculateRate(unchangedMetrics, totalMetrics),
    };
}

export function buildRaidComparisonData(
    currentRaid: RaidComparisonStats,
    previousRaids: readonly RaidComparisonStats[],
): RaidComparisonData {
    const previousRaid = previousRaids[0] ?? null;

    const averageRaids = previousRaids.slice(0, AVERAGE_RAIDS_COUNT);
    const previousRaidsAverage = calculateRaidHistoricalAverages(averageRaids);
    const performanceComparison =
        previousRaidsAverage !== null
            ? compareRaidWithHistoricalAverage(currentRaid, previousRaidsAverage)
            : null;

    return {
        clanTag: '',
        clanName: '',
        currentRaid,
        previousRaid,
        previousRaidsAverage,
        performanceComparison,
    };
}

export const calculateHistoricalAverages = calculateRaidHistoricalAverages;
export const compareWithHistoricalAverage = compareRaidWithHistoricalAverage;
export const buildComparisonData = buildRaidComparisonData;

export const raidsAnalytics = {
    calculateHistoricalAverages: calculateRaidHistoricalAverages,
    buildComparisonData: buildRaidComparisonData,
    compareWithHistoricalAverage: compareRaidWithHistoricalAverage,
} as const;
