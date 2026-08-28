#include "analytics/RaidComparisonAnalyzer.h"

#include <gtest/gtest.h>

#include <vector>

namespace
{
    RaidComparisonStats makeRaidStats(
        const long long startTime,
        const int totalLoot,
        const int raidsCompleted,
        const int usedAttacks,
        const int availableAttacks,
        const int activeParticipants,
        const int eligibleParticipants,
        const int participantsWithAllAttacksUsed,
        const int participantsWithoutAttacks,
        const int enemyDistrictsDestroyed = 0,
        const int offensiveReward = 0,
        const int defensiveReward = 0)
    {
        return RaidComparisonStats{
            .startTime = startTime,
            .totalLoot = totalLoot,
            .raidsCompleted = raidsCompleted,
            .usedAttacks = usedAttacks,
            .availableAttacks = availableAttacks,
            .activeParticipants = activeParticipants,
            .eligibleParticipants = eligibleParticipants,
            .participantsWithAllAttacksUsed = participantsWithAllAttacksUsed,
            .participantsWithoutAttacks = participantsWithoutAttacks,
            .enemyDistrictsDestroyed = enemyDistrictsDestroyed,
            .offensiveReward = offensiveReward,
            .defensiveReward = defensiveReward
        };
    }

    RaidHistoricalAverages makeHistoricalAverages(
        const double averageLootPerUsedAttack,
        const double averageParticipantsWithAllAttacksUsedRate,
        const double averageParticipantsWithoutAttacksRate)
    {
        return RaidHistoricalAverages{
            .raidsCount = 3,
            .averageLootPerUsedAttack = averageLootPerUsedAttack,
            .averageParticipantsWithAllAttacksUsedRate =
            averageParticipantsWithAllAttacksUsedRate,
            .averageParticipantsWithoutAttacksRate = averageParticipantsWithoutAttacksRate,
            .averageAttackUsageRate = 0.0,
            .averageActiveParticipants = 0.0,
            .averageEligibleParticipants = 0.0,
            .averageParticipantsWithAllAttacksUsed = 0.0,
            .averageParticipantsWithoutAttacks = 0.0,
            .averageUsedAttacks = 0.0,
            .averageAvailableAttacks = 0.0,
            .averageTotalLoot = 0.0,
            .averageRaidsCompleted = 0.0,
            .averageEnemyDistrictsDestroyed = 0.0,
            .averageOffensiveReward = 0.0,
            .averageDefensiveReward = 0.0
        };
    }
}

TEST(RaidComparisonAnalyzerTest, ReturnsNulloptForEmptyHistoricalData)
{
    const std::vector<RaidComparisonStats> previousRaids;

    EXPECT_FALSE(raids_analytics::calculateHistoricalAverages(previousRaids).has_value());
}

TEST(RaidComparisonAnalyzerTest, CalculatesHistoricalAverages)
{
    const std::vector<RaidComparisonStats> previousRaids{
        makeRaidStats(1, 1000, 1, 10, 20, 4, 5, 2, 1, 10, 100, 50),
        makeRaidStats(2, 2400, 2, 20, 30, 5, 6, 4, 0, 12, 120, 60)
    };

    const auto averages = raids_analytics::calculateHistoricalAverages(previousRaids);

    ASSERT_TRUE(averages.has_value());
    EXPECT_EQ(2, averages->raidsCount);
    EXPECT_DOUBLE_EQ(3400.0 / 30.0, averages->averageLootPerUsedAttack);
    EXPECT_DOUBLE_EQ(6.0 / 9.0, averages->averageParticipantsWithAllAttacksUsedRate);
    EXPECT_DOUBLE_EQ(1.0 / 11.0, averages->averageParticipantsWithoutAttacksRate);
    EXPECT_DOUBLE_EQ(30.0 / 50.0, averages->averageAttackUsageRate);
    EXPECT_DOUBLE_EQ(4.5, averages->averageActiveParticipants);
    EXPECT_DOUBLE_EQ(5.5, averages->averageEligibleParticipants);
    EXPECT_DOUBLE_EQ(3.0, averages->averageParticipantsWithAllAttacksUsed);
    EXPECT_DOUBLE_EQ(0.5, averages->averageParticipantsWithoutAttacks);
    EXPECT_DOUBLE_EQ(15.0, averages->averageUsedAttacks);
    EXPECT_DOUBLE_EQ(25.0, averages->averageAvailableAttacks);
    EXPECT_DOUBLE_EQ(1700.0, averages->averageTotalLoot);
    EXPECT_DOUBLE_EQ(1.5, averages->averageRaidsCompleted);
    EXPECT_DOUBLE_EQ(11.0, averages->averageEnemyDistrictsDestroyed);
    EXPECT_DOUBLE_EQ(110.0, averages->averageOffensiveReward);
    EXPECT_DOUBLE_EQ(55.0, averages->averageDefensiveReward);
}

TEST(RaidComparisonAnalyzerTest, BuildsComparisonDataFromPreviousRaids)
{
    const auto currentRaid = makeRaidStats(3, 3000, 3, 25, 30, 6, 7, 5, 1);
    const std::vector<RaidComparisonStats> previousRaids{
        makeRaidStats(2, 2400, 2, 20, 30, 5, 6, 4, 0),
        makeRaidStats(1, 2000, 2, 18, 25, 4, 5, 3, 1),
        makeRaidStats(0, 1800, 1, 15, 20, 3, 4, 2, 1),
        makeRaidStats(-1, 1600, 1, 12, 20, 3, 4, 1, 2)
    };

    const auto comparisonData =
        raids_analytics::buildComparisonData(currentRaid, previousRaids);

    EXPECT_EQ(currentRaid.startTime, comparisonData.currentRaid.startTime);
    ASSERT_TRUE(comparisonData.previousRaid.has_value());
    EXPECT_EQ(previousRaids.front().startTime, comparisonData.previousRaid->startTime);
    ASSERT_TRUE(comparisonData.previousRaidsAverage.has_value());
    EXPECT_EQ(3, comparisonData.previousRaidsAverage->raidsCount);
    ASSERT_TRUE(comparisonData.performanceComparison.has_value());
}

TEST(RaidComparisonAnalyzerTest, ReportsBetterPerformance)
{
    const auto currentRaid = makeRaidStats(1, 1200, 1, 100, 100, 8, 10, 8, 1);
    const auto historicalAverages = makeHistoricalAverages(10.0, 0.6, 0.2);

    const auto comparison = raids_analytics::compareWithHistoricalAverage(
        currentRaid,
        historicalAverages
    );

    EXPECT_EQ(RaidPerformanceTrend::Better, comparison.trend);
    EXPECT_EQ(3, comparison.improvedMetrics);
    EXPECT_EQ(0, comparison.worsenedMetrics);
    EXPECT_EQ(0, comparison.unchangedMetrics);
    EXPECT_DOUBLE_EQ(1.0, comparison.improvedMetricsRate);
}

TEST(RaidComparisonAnalyzerTest, ReportsWorsePerformance)
{
    const auto currentRaid = makeRaidStats(1, 800, 1, 100, 100, 8, 10, 4, 3);
    const auto historicalAverages = makeHistoricalAverages(10.0, 0.6, 0.2);

    const auto comparison = raids_analytics::compareWithHistoricalAverage(
        currentRaid,
        historicalAverages
    );

    EXPECT_EQ(RaidPerformanceTrend::Worse, comparison.trend);
    EXPECT_EQ(0, comparison.improvedMetrics);
    EXPECT_EQ(3, comparison.worsenedMetrics);
    EXPECT_EQ(0, comparison.unchangedMetrics);
    EXPECT_DOUBLE_EQ(1.0, comparison.worsenedMetricsRate);
}

TEST(RaidComparisonAnalyzerTest, ReportsSimilarPerformance)
{
    const auto currentRaid = makeRaidStats(1, 1000, 1, 100, 100, 8, 10, 6, 2);
    const auto historicalAverages = makeHistoricalAverages(10.0, 0.75, 0.2);

    const auto comparison = raids_analytics::compareWithHistoricalAverage(
        currentRaid,
        historicalAverages
    );

    EXPECT_EQ(RaidPerformanceTrend::Similar, comparison.trend);
    EXPECT_EQ(0, comparison.improvedMetrics);
    EXPECT_EQ(0, comparison.worsenedMetrics);
    EXPECT_EQ(3, comparison.unchangedMetrics);
    EXPECT_DOUBLE_EQ(1.0, comparison.unchangedMetricsRate);
}
