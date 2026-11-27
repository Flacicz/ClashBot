import type { ClanwarOutcomeValue, ClanwarWarStats } from '../database/repos/clanwarRepo.js';

export interface ClanwarHistoricalAverages {
    readonly warsCount: number;
    readonly averageStarsPerAttack: number;
    readonly averageDestructionPerAttack: number;
    readonly averageAttacksUsed: number;
    readonly averageMaxAttacks: number;
    readonly averageMissedAttacks: number;
    readonly averagePlayersWithoutAttacks: number;
    readonly averagePlayersWithOneAttack: number;
    readonly averageFirstAttacksNotOnMirror: number;
    readonly averageMissedAttacksRate: number;
    readonly averagePlayersWithoutAttacksRate: number;
    readonly averagePlayersWithOneAttackRate: number;
    readonly averageFirstAttacksNotOnMirrorRate: number;
}

export const ClanwarPerformanceTrend = {
    Better: 'better',
    Worse: 'worse',
    Similar: 'similar',
} as const;

export type ClanwarPerformanceTrendValue =
    (typeof ClanwarPerformanceTrend)[keyof typeof ClanwarPerformanceTrend];

export interface ClanwarPerformanceComparison {
    readonly trend: ClanwarPerformanceTrendValue;
    readonly improvedMetrics: number;
    readonly worsenedMetrics: number;
    readonly unchangedMetrics: number;
    readonly totalMetrics: number;
    readonly improvedMetricsRate: number;
    readonly worsenedMetricsRate: number;
    readonly unchangedMetricsRate: number;
}

export interface ClanwarComparisonOptions {
    readonly mirrorRuleEnabled?: boolean;
}

export interface ClanwarComparisonData {
    readonly currentWar: ClanwarWarStats;
    readonly previousWar: ClanwarWarStats | null;
    readonly previousWarsAverage: ClanwarHistoricalAverages | null;
    readonly performanceComparison: ClanwarPerformanceComparison | null;
    readonly recentWarResults: readonly ClanwarOutcomeValue[];
    readonly mirrorRuleEnabled?: boolean;
}

const AVERAGE_WARS_COUNT = 3;

function calculateRate(value: number, total: number): number {
    if (total <= 0) {
        return 0.0;
    }
    return value / total;
}

export function calculateHistoricalAverages(
    previousWars: readonly ClanwarWarStats[],
): ClanwarHistoricalAverages | null {
    if (previousWars.length === 0) {
        return null;
    }

    let totalAttackStars = 0;
    let totalAttacks = 0;
    let totalMaxAttacks = 0;
    let totalDestruction = 0;
    let totalMissedAttacks = 0;
    let totalPlayersWithoutAttacks = 0;
    let totalPlayersWithOneAttack = 0;
    let totalFirstAttacksNotOnMirror = 0;
    let totalTeamSize = 0;
    let totalParticipantsWithAttacks = 0;

    for (const war of previousWars) {
        totalAttackStars += war.totalAttackStars;
        totalAttacks += war.attacksUsed;
        totalMaxAttacks += war.maxAttacks;
        totalDestruction += war.averageDestructionPerAttack * war.attacksUsed;
        totalMissedAttacks += war.maxAttacks - war.attacksUsed;
        totalPlayersWithoutAttacks += war.disciplineStats.playersWithoutAttacks;
        totalPlayersWithOneAttack += war.disciplineStats.playersWithOneAttack;
        totalFirstAttacksNotOnMirror += war.disciplineStats.firstAttacksNotOnMirror;
        totalTeamSize += war.teamSize;
        totalParticipantsWithAttacks += war.teamSize - war.disciplineStats.playersWithoutAttacks;
    }

    const warCount = previousWars.length;

    return {
        warsCount: warCount,
        averageStarsPerAttack: totalAttacks === 0 ? 0.0 : totalAttackStars / totalAttacks,
        averageDestructionPerAttack: totalAttacks === 0 ? 0.0 : totalDestruction / totalAttacks,
        averageAttacksUsed: totalAttacks / warCount,
        averageMaxAttacks: totalMaxAttacks / warCount,
        averageMissedAttacks: totalMissedAttacks / warCount,
        averagePlayersWithoutAttacks: totalPlayersWithoutAttacks / warCount,
        averagePlayersWithOneAttack: totalPlayersWithOneAttack / warCount,
        averageFirstAttacksNotOnMirror: totalFirstAttacksNotOnMirror / warCount,
        averageMissedAttacksRate: calculateRate(totalMissedAttacks, totalMaxAttacks),
        averagePlayersWithoutAttacksRate: calculateRate(totalPlayersWithoutAttacks, totalTeamSize),
        averagePlayersWithOneAttackRate: calculateRate(totalPlayersWithOneAttack, totalTeamSize),
        averageFirstAttacksNotOnMirrorRate: calculateRate(
            totalFirstAttacksNotOnMirror,
            totalParticipantsWithAttacks,
        ),
    };
}

export function compareWithHistoricalAverage(
    currentWar: ClanwarWarStats,
    historicalAverages: ClanwarHistoricalAverages,
    options?: ClanwarComparisonOptions,
): ClanwarPerformanceComparison {
    const mirrorRuleEnabled = options?.mirrorRuleEnabled ?? true;
    const currentPlayersWithoutAttacks = currentWar.disciplineStats.playersWithoutAttacks;

    const currentPlayersWithoutAttacksRate = calculateRate(
        currentPlayersWithoutAttacks,
        currentWar.teamSize,
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

    compareHigherIsBetter(
        currentWar.averageStarsPerAttack,
        historicalAverages.averageStarsPerAttack,
    );
    compareHigherIsBetter(
        currentWar.averageDestructionPerAttack,
        historicalAverages.averageDestructionPerAttack,
    );
    // The missed-attacks rate is kept as an activity context metric in the
    // report. It describes overall attack usage and is not part of the
    // primary score.
    compareLowerIsBetter(
        currentPlayersWithoutAttacksRate,
        historicalAverages.averagePlayersWithoutAttacksRate,
    );
    if (mirrorRuleEnabled) {
        const currentFirstAttacksNotOnMirror = currentWar.disciplineStats.firstAttacksNotOnMirror;
        const currentFirstAttacksNotOnMirrorRate = calculateRate(
            currentFirstAttacksNotOnMirror,
            currentWar.teamSize - currentWar.disciplineStats.playersWithoutAttacks,
        );
        compareLowerIsBetter(
            currentFirstAttacksNotOnMirrorRate,
            historicalAverages.averageFirstAttacksNotOnMirrorRate,
        );
    }

    const totalMetrics = improvedMetrics + worsenedMetrics + unchangedMetrics;

    let trend: ClanwarPerformanceTrendValue = ClanwarPerformanceTrend.Similar;
    if (improvedMetrics > worsenedMetrics) {
        trend = ClanwarPerformanceTrend.Better;
    } else if (worsenedMetrics > improvedMetrics) {
        trend = ClanwarPerformanceTrend.Worse;
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

export function buildComparisonData(
    currentWar: ClanwarWarStats,
    previousWars: readonly ClanwarWarStats[],
    options?: ClanwarComparisonOptions,
): ClanwarComparisonData {
    const mirrorRuleEnabled = options?.mirrorRuleEnabled ?? true;
    const previousWar = previousWars[0] ?? null;

    const averageWars = previousWars.slice(0, AVERAGE_WARS_COUNT);
    const previousWarsAverage = calculateHistoricalAverages(averageWars);
    const performanceComparison =
        previousWarsAverage !== null
            ? compareWithHistoricalAverage(currentWar, previousWarsAverage, { mirrorRuleEnabled })
            : null;

    const recentWarResults: ClanwarOutcomeValue[] = [];
    for (let index = previousWars.length - 1; index >= 0; index -= 1) {
        const war = previousWars[index];
        if (war !== undefined) {
            recentWarResults.push(war.result);
        }
    }
    recentWarResults.push(currentWar.result);

    return {
        currentWar,
        previousWar,
        previousWarsAverage,
        performanceComparison,
        recentWarResults,
        mirrorRuleEnabled,
    };
}
