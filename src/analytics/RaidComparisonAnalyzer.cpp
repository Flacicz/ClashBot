#include "analytics/RaidComparisonAnalyzer.h"

#include <algorithm>

namespace
{
    double calculateRate(const double value, const double total)
    {
        if (total <= 0) return 0.0;
        return value / total;
    }

    double calculateLootPerUsedAttack(const RaidComparisonStats& raid)
    {
        return calculateRate(raid.totalLoot, raid.usedAttacks);
    }
}

std::optional<RaidHistoricalAverages> raids_analytics::calculateHistoricalAverages(
    const std::span<const RaidComparisonStats> previousRaids)
{
    if (previousRaids.empty()) return std::nullopt;

    double totalLoot = 0;
    double totalUsedAttacks = 0;
    double totalActiveParticipants = 0;
    double totalEligibleParticipants = 0;
    double totalParticipantsWithAllAttacksUsed = 0;
    double totalParticipantsWithoutAttacks = 0;
    double totalAvailableAttacks = 0;

    double totalRaidsCompleted = 0;
    double totalEnemyDistrictsDestroyed = 0;
    double totalOffensiveReward = 0;
    double totalDefensiveReward = 0;

    for (const auto& raid : previousRaids)
    {
        totalLoot += raid.totalLoot;
        totalUsedAttacks += raid.usedAttacks;
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

    const auto raidsCount = static_cast<double>(previousRaids.size());

    return RaidHistoricalAverages{
        .raidsCount = static_cast<int>(raidsCount),
        .averageLootPerUsedAttack = calculateRate(totalLoot, totalUsedAttacks),
        .averageParticipantsWithAllAttacksUsedRate =
        calculateRate(
            totalParticipantsWithAllAttacksUsed,
            totalActiveParticipants
        ),
        .averageParticipantsWithoutAttacksRate =
        calculateRate(
            totalParticipantsWithoutAttacks,
            totalEligibleParticipants
        ),
        .averageAttackUsageRate = calculateRate(
            totalUsedAttacks,
            totalAvailableAttacks
        ),
        .averageActiveParticipants = totalActiveParticipants / raidsCount,
        .averageEligibleParticipants = totalEligibleParticipants / raidsCount,
        .averageParticipantsWithAllAttacksUsed =
        totalParticipantsWithAllAttacksUsed / raidsCount,
        .averageParticipantsWithoutAttacks = totalParticipantsWithoutAttacks / raidsCount,
        .averageUsedAttacks = totalUsedAttacks / raidsCount,
        .averageAvailableAttacks = totalAvailableAttacks / raidsCount,
        .averageTotalLoot = totalLoot / raidsCount,
        .averageRaidsCompleted = totalRaidsCompleted / raidsCount,
        .averageEnemyDistrictsDestroyed = totalEnemyDistrictsDestroyed / raidsCount,
        .averageOffensiveReward = totalOffensiveReward / raidsCount,
        .averageDefensiveReward = totalDefensiveReward / raidsCount
    };
}

RaidComparisonData raids_analytics::buildComparisonData(
    const RaidComparisonStats& currentRaid,
    const std::vector<RaidComparisonStats>& previousRaids)
{
    RaidComparisonData comparisonData{
        .currentRaid = currentRaid
    };

    if (!previousRaids.empty())
    {
        comparisonData.previousRaid = previousRaids.front();
    }

    constexpr std::size_t AVERAGE_RAIDS_COUNT = 3;
    const auto averageRaidsCount = std::min(AVERAGE_RAIDS_COUNT, previousRaids.size());
    const auto averageRaids = std::span(previousRaids).first(averageRaidsCount);

    comparisonData.previousRaidsAverage = calculateHistoricalAverages(averageRaids);

    if (comparisonData.previousRaidsAverage.has_value())
    {
        comparisonData.performanceComparison = compareWithHistoricalAverage(
            currentRaid,
            comparisonData.previousRaidsAverage.value()
        );
    }

    return comparisonData;
}

RaidPerformanceComparison raids_analytics::compareWithHistoricalAverage(
    const RaidComparisonStats& currentRaid,
    const RaidHistoricalAverages& historicalAverages)
{
    const auto currentLootPerUsedAttack = calculateLootPerUsedAttack(currentRaid);
    const auto currentParticipantsWithAllAttacksUsedRate = calculateRate(
        currentRaid.participantsWithAllAttacksUsed,
        currentRaid.activeParticipants
    );
    const auto currentParticipantsWithoutAttacksRate = calculateRate(
        currentRaid.participantsWithoutAttacks,
        currentRaid.eligibleParticipants
    );

    int improvedMetrics = 0;
    int worsenedMetrics = 0;
    int unchangedMetrics = 0;

    const auto compareHigherIsBetter =
        [&improvedMetrics, &worsenedMetrics, &unchangedMetrics](
        const double currentValue,
        const double historicalValue)
    {
        if (currentValue > historicalValue)
        {
            ++improvedMetrics;
        }
        else if (currentValue < historicalValue)
        {
            ++worsenedMetrics;
        }
        else
        {
            ++unchangedMetrics;
        }
    };

    const auto compareLowerIsBetter =
        [&improvedMetrics, &worsenedMetrics, &unchangedMetrics](
        const double currentValue,
        const double historicalValue)
    {
        if (currentValue < historicalValue)
        {
            ++improvedMetrics;
        }
        else if (currentValue > historicalValue)
        {
            ++worsenedMetrics;
        }
        else
        {
            ++unchangedMetrics;
        }
    };

    compareHigherIsBetter(
        currentLootPerUsedAttack,
        historicalAverages.averageLootPerUsedAttack
    );
    compareHigherIsBetter(
        currentParticipantsWithAllAttacksUsedRate,
        historicalAverages.averageParticipantsWithAllAttacksUsedRate
    );
    compareLowerIsBetter(
        currentParticipantsWithoutAttacksRate,
        historicalAverages.averageParticipantsWithoutAttacksRate
    );

    const auto totalMetrics = improvedMetrics + worsenedMetrics + unchangedMetrics;
    const auto makeComparison = [&](const RaidPerformanceTrend trend)
    {
        return RaidPerformanceComparison{
            .trend = trend,
            .improvedMetrics = improvedMetrics,
            .worsenedMetrics = worsenedMetrics,
            .unchangedMetrics = unchangedMetrics,
            .totalMetrics = totalMetrics,
            .improvedMetricsRate = calculateRate(improvedMetrics, totalMetrics),
            .worsenedMetricsRate = calculateRate(worsenedMetrics, totalMetrics),
            .unchangedMetricsRate = calculateRate(unchangedMetrics, totalMetrics)
        };
    };

    if (improvedMetrics > worsenedMetrics)
    {
        return makeComparison(RaidPerformanceTrend::Better);
    }

    if (worsenedMetrics > improvedMetrics)
    {
        return makeComparison(RaidPerformanceTrend::Worse);
    }

    return makeComparison(RaidPerformanceTrend::Similar);
}
