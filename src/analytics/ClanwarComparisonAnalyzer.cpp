#include "analytics/ClanwarComparisonAnalyzer.h"

#include <algorithm>

namespace
{
    double calculateRate(const int value, const int total)
    {
        if (total <= 0) return 0.0;
        return static_cast<double>(value) / total;
    }
}

std::optional<ClanwarHistoricalAverages> clanwar_analytics::calculateHistoricalAverages(
    const std::span<const ClanwarWarStats> previousWars)
{
    if (previousWars.empty()) return std::nullopt;

    double totalAttackStars = 0;
    double totalAttacks = 0;
    double totalDestruction = 0;
    double totalMissedAttacks = 0;
    double totalPlayersWithoutAttacks = 0;
    double totalPlayersWithOneAttack = 0;
    double totalFirstAttacksNotOnMirror = 0;
    double totalMissedAttacksRate = 0;
    double totalPlayersWithoutAttacksRate = 0;
    double totalPlayersWithOneAttackRate = 0;
    double totalFirstAttacksNotOnMirrorRate = 0;

    for (const auto& war : previousWars)
    {
        totalAttackStars += war.totalAttackStars;
        totalAttacks += war.attacksUsed;
        totalDestruction += war.homeDestruction;
        totalMissedAttacks += war.maxAttacks - war.attacksUsed;
        totalPlayersWithoutAttacks += war.disciplineStats.playersWithoutAttacks;
        totalPlayersWithOneAttack += war.disciplineStats.playersWithOneAttack;
        totalFirstAttacksNotOnMirror += war.disciplineStats.firstAttacksNotOnMirror;

        totalMissedAttacksRate += calculateRate(
            war.maxAttacks - war.attacksUsed,
            war.maxAttacks
        );
        totalPlayersWithoutAttacksRate += calculateRate(
            war.disciplineStats.playersWithoutAttacks,
            war.teamSize
        );
        totalPlayersWithOneAttackRate += calculateRate(
            war.disciplineStats.playersWithOneAttack,
            war.teamSize
        );
        totalFirstAttacksNotOnMirrorRate += calculateRate(
            war.disciplineStats.firstAttacksNotOnMirror,
            war.teamSize - war.disciplineStats.playersWithoutAttacks
        );
    }

    const auto warCount = static_cast<double>(previousWars.size());

    return ClanwarHistoricalAverages{
        .warsCount = static_cast<int>(warCount),
        .averageStarsPerAttack = totalAttacks == 0
                                     ? 0.0
                                     : totalAttackStars / totalAttacks,
        .averageDestruction = totalDestruction / warCount,
        .averageMissedAttacks = totalMissedAttacks / warCount,
        .averagePlayersWithoutAttacks = totalPlayersWithoutAttacks / warCount,
        .averagePlayersWithOneAttack = totalPlayersWithOneAttack / warCount,
        .averageFirstAttacksNotOnMirror = totalFirstAttacksNotOnMirror / warCount,
        .averageMissedAttacksRate = totalMissedAttacksRate / warCount,
        .averagePlayersWithoutAttacksRate =
        totalPlayersWithoutAttacksRate / warCount,
        .averagePlayersWithOneAttackRate = totalPlayersWithOneAttackRate / warCount,
        .averageFirstAttacksNotOnMirrorRate =
        totalFirstAttacksNotOnMirrorRate / warCount
    };
}

ClanwarComparisonData clanwar_analytics::buildComparisonData(
    const ClanwarWarStats& currentWar,
    const std::vector<ClanwarWarStats>& previousWars)
{
    ClanwarComparisonData comparisonData{
        .currentWar = currentWar
    };

    if (!previousWars.empty())
    {
        comparisonData.previousWar = previousWars.front();
    }

    constexpr std::size_t AVERAGE_WARS_COUNT = 3;
    const auto averageWarsCount = std::min(AVERAGE_WARS_COUNT, previousWars.size());
    const auto averageWars = std::span(previousWars)
        .first(averageWarsCount);

    comparisonData.previousWarsAverage = calculateHistoricalAverages(averageWars);

    if (comparisonData.previousWarsAverage.has_value())
    {
        comparisonData.performanceComparison = compareWithHistoricalAverage(
            currentWar,
            comparisonData.previousWarsAverage.value()
        );
    }

    comparisonData.recentWarResults.reserve(previousWars.size() + 1);

    for (auto it = previousWars.rbegin(); it != previousWars.rend(); ++it)
    {
        comparisonData.recentWarResults.push_back(it->result);
    }

    comparisonData.recentWarResults.push_back(currentWar.result);

    return comparisonData;
}

ClanwarPerformanceComparison clanwar_analytics::compareWithHistoricalAverage(
    const ClanwarWarStats& currentWar,
    const ClanwarHistoricalAverages& historicalAverages)
{
    const auto currentPlayersWithoutAttacks =
        currentWar.disciplineStats.playersWithoutAttacks;
    const auto currentFirstAttacksNotOnMirror =
        currentWar.disciplineStats.firstAttacksNotOnMirror;

    const auto currentPlayersWithoutAttacksRate = calculateRate(
        currentPlayersWithoutAttacks,
        currentWar.teamSize
    );
    const auto currentFirstAttacksNotOnMirrorRate = calculateRate(
        currentFirstAttacksNotOnMirror,
        currentWar.teamSize - currentWar.disciplineStats.playersWithoutAttacks
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
        currentWar.averageStarsPerAttack,
        historicalAverages.averageStarsPerAttack
    );
    compareHigherIsBetter(
        currentWar.homeDestruction,
        historicalAverages.averageDestruction
    );
    // The missed-attacks rate is kept as an activity context metric in the
    // report. It describes overall attack usage and is not part of the
    // primary score.
    compareLowerIsBetter(
        currentPlayersWithoutAttacksRate,
        historicalAverages.averagePlayersWithoutAttacksRate
    );
    compareLowerIsBetter(
        currentFirstAttacksNotOnMirrorRate,
        historicalAverages.averageFirstAttacksNotOnMirrorRate
    );

    const auto totalMetrics = improvedMetrics + worsenedMetrics + unchangedMetrics;
    const auto makeComparison = [&](const ClanwarPerformanceTrend trend)
    {
        return ClanwarPerformanceComparison{
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
        return makeComparison(ClanwarPerformanceTrend::Better);
    }

    if (worsenedMetrics > improvedMetrics)
    {
        return makeComparison(ClanwarPerformanceTrend::Worse);
    }

    return makeComparison(ClanwarPerformanceTrend::Similar);
}
