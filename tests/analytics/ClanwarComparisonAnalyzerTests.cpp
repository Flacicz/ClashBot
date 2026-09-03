#include "analytics/ClanwarComparisonAnalyzer.h"

#include <gtest/gtest.h>
#include <vector>

namespace
{
    ClanwarWarStats makeWarStats(
        const ClanwarOutcome result,
        const double homeDestruction,
        const int totalAttackStars,
        const double averageStarsPerAttack,
        const int maxAttacks = 30,
        const int attacksUsed = 30,
        const int teamSize = 15,
        const int playersWithoutAttacks = 0,
        const int playersWithOneAttack = 0,
        const int firstAttacksNotOnMirror = 0,
        const double averageDestructionPerAttack = -1.0)
    {
        return ClanwarWarStats{
            .homeStars = 0,
            .opponentStars = 0,
            .homeDestruction = homeDestruction,
            .opponentDestruction = 0.0,
            .result = result,
            .maxAttacks = maxAttacks,
            .attacksUsed = attacksUsed,
            .teamSize = teamSize,
            .totalAttackStars = totalAttackStars,
            .averageStarsPerAttack = averageStarsPerAttack,
            .averageDestructionPerAttack = averageDestructionPerAttack < 0.0
                                               ? homeDestruction
                                               : averageDestructionPerAttack,
            .disciplineStats = ClanwarDisciplineStats{
                .playersWithoutAttacks = playersWithoutAttacks,
                .playersWithOneAttack = playersWithOneAttack,
                .firstAttacksNotOnMirror = firstAttacksNotOnMirror
            }
        };
    }

    ClanwarHistoricalAverages makeHistoricalAverages(
        const double averageStarsPerAttack,
        const double averageDestructionPerAttack,
        const double averagePlayersWithoutAttacksRate,
        const double averagePlayersWithOneAttackRate,
        const double averageFirstAttacksNotOnMirrorRate)
    {
        return ClanwarHistoricalAverages{
            .warsCount = 3,
            .averageStarsPerAttack = averageStarsPerAttack,
            .averageDestructionPerAttack = averageDestructionPerAttack,
            .averageMissedAttacks = 0.0,
            .averagePlayersWithoutAttacks = 0.0,
            .averagePlayersWithOneAttack = 0.0,
            .averageFirstAttacksNotOnMirror = 0.0,
            .averageMissedAttacksRate = 0.0,
            .averagePlayersWithoutAttacksRate = averagePlayersWithoutAttacksRate,
            .averagePlayersWithOneAttackRate = averagePlayersWithOneAttackRate,
            .averageFirstAttacksNotOnMirrorRate = averageFirstAttacksNotOnMirrorRate
        };
    }
}


TEST(ClanwarAnalyzerHistoricalAveragesTest, ReturnNulloptWithEmptyPreviosWars)
{
    constexpr std::span<const ClanwarWarStats> previousWars{};

    EXPECT_EQ(std::nullopt, clanwar_analytics::calculateHistoricalAverages(previousWars));
}

TEST(ClanwarAnalyzerHistoricalAveragesTest, WarCountWithNotFullPreviosWars)
{
    const std::vector previousWars{
        ClanwarWarStats{
            .homeStars = 24,
            .opponentStars = 20,
            .homeDestruction = 87.0,
            .opponentDestruction = 80.0,
            .result = ClanwarOutcome::Victory,
            .maxAttacks = 30,
            .attacksUsed = 28,
            .teamSize = 15,
            .totalAttackStars = 75,
            .averageStarsPerAttack = 75.0 / 28.0,
            .averageDestructionPerAttack = 85.0,
            .disciplineStats = ClanwarDisciplineStats{
                .playersWithoutAttacks = 1,
                .playersWithOneAttack = 2,
                .firstAttacksNotOnMirror = 1
            }
        },
        ClanwarWarStats{
            .homeStars = 20,
            .opponentStars = 24,
            .homeDestruction = 80.0,
            .opponentDestruction = 88.0,
            .result = ClanwarOutcome::Defeat,
            .maxAttacks = 30,
            .attacksUsed = 27,
            .teamSize = 15,
            .totalAttackStars = 68,
            .averageStarsPerAttack = 68.0 / 27.0,
            .averageDestructionPerAttack = 78.0,
            .disciplineStats = ClanwarDisciplineStats{
                .playersWithoutAttacks = 0,
                .playersWithOneAttack = 3,
                .firstAttacksNotOnMirror = 2
            }
        }
    };

    const auto averages =
        clanwar_analytics::calculateHistoricalAverages(previousWars);

    ASSERT_TRUE(averages.has_value());
    EXPECT_EQ(2, averages->warsCount);

    constexpr double tolerance = 0.001;

    EXPECT_NEAR(
        2.6,
        averages->averageStarsPerAttack,
        tolerance
    );
    EXPECT_NEAR(
        81.563636,
        averages->averageDestructionPerAttack,
        tolerance
    );
    EXPECT_NEAR(
        2.5,
        averages->averageMissedAttacks,
        tolerance
    );
    EXPECT_NEAR(
        27.5,
        averages->averageAttacksUsed,
        tolerance
    );
    EXPECT_NEAR(
        30.0,
        averages->averageMaxAttacks,
        tolerance
    );
    EXPECT_NEAR(
        0.5,
        averages->averagePlayersWithoutAttacks,
        tolerance
    );
    EXPECT_NEAR(
        2.5,
        averages->averagePlayersWithOneAttack,
        tolerance
    );
    EXPECT_NEAR(
        1.5,
        averages->averageFirstAttacksNotOnMirror,
        tolerance
    );
    EXPECT_NEAR(
        0.083333,
        averages->averageMissedAttacksRate,
        tolerance
    );
    EXPECT_NEAR(
        0.033333,
        averages->averagePlayersWithoutAttacksRate,
        tolerance
    );
    EXPECT_NEAR(
        0.166667,
        averages->averagePlayersWithOneAttackRate,
        tolerance
    );
    EXPECT_NEAR(
        3.0 / 29.0,
        averages->averageFirstAttacksNotOnMirrorRate,
        tolerance
    );
}

TEST(ClanwarAnalyzerHistoricalAveragesTest, CalculatesAveragesForFourWars)
{
    const std::vector<ClanwarWarStats> previousWars{
        ClanwarWarStats{
            // Война 1
            .homeStars = 30,
            .opponentStars = 30,
            .homeDestruction = 100.00,
            .opponentDestruction = 100.00,
            .result = ClanwarOutcome::Draw,
            .maxAttacks = 20,
            .attacksUsed = 13,
            .teamSize = 10,
            .totalAttackStars = 35,
            .averageStarsPerAttack = 35.0 / 13.0,
            .averageDestructionPerAttack = 100.00,
            .disciplineStats = ClanwarDisciplineStats{
                .playersWithoutAttacks = 1,
                .playersWithOneAttack = 2,
                .firstAttacksNotOnMirror = 1
            }
        },
        ClanwarWarStats{
            // Война 2
            .homeStars = 24,
            .opponentStars = 20,
            .homeDestruction = 87.0,
            .opponentDestruction = 80.0,
            .result = ClanwarOutcome::Victory,
            .maxAttacks = 30,
            .attacksUsed = 28,
            .teamSize = 15,
            .totalAttackStars = 75,
            .averageStarsPerAttack = 75.0 / 28.0,
            .averageDestructionPerAttack = 87.0,
            .disciplineStats = ClanwarDisciplineStats{
                .playersWithoutAttacks = 1,
                .playersWithOneAttack = 2,
                .firstAttacksNotOnMirror = 1
            }
        },
        ClanwarWarStats{
            // Война 3
            .homeStars = 26,
            .opponentStars = 23,
            .homeDestruction = 91.5,
            .opponentDestruction = 86.2,
            .result = ClanwarOutcome::Victory,
            .maxAttacks = 30,
            .attacksUsed = 30,
            .teamSize = 15,
            .totalAttackStars = 82,
            .averageStarsPerAttack = 82.0 / 30.0,
            .averageDestructionPerAttack = 91.5,
            .disciplineStats = ClanwarDisciplineStats{
                .playersWithoutAttacks = 0,
                .playersWithOneAttack = 1,
                .firstAttacksNotOnMirror = 0
            }
        },
        ClanwarWarStats{
            // Война 4
            .homeStars = 21,
            .opponentStars = 24,
            .homeDestruction = 83.4,
            .opponentDestruction = 89.1,
            .result = ClanwarOutcome::Defeat,
            .maxAttacks = 30,
            .attacksUsed = 27,
            .teamSize = 15,
            .totalAttackStars = 68,
            .averageStarsPerAttack = 68.0 / 27.0,
            .averageDestructionPerAttack = 83.4,
            .disciplineStats = ClanwarDisciplineStats{
                .playersWithoutAttacks = 1,
                .playersWithOneAttack = 3,
                .firstAttacksNotOnMirror = 2
            }
        }
    };

    const auto averages =
        clanwar_analytics::calculateHistoricalAverages(previousWars);

    ASSERT_TRUE(averages.has_value());
    EXPECT_EQ(4, averages->warsCount);

    constexpr double tolerance = 0.001;

    EXPECT_NEAR(
        2.653061,
        averages->averageStarsPerAttack,
        tolerance
    );
    EXPECT_NEAR(
        89.110204,
        averages->averageDestructionPerAttack,
        tolerance
    );
    EXPECT_NEAR(
        3.0,
        averages->averageMissedAttacks,
        tolerance
    );
    EXPECT_NEAR(
        24.5,
        averages->averageAttacksUsed,
        tolerance
    );
    EXPECT_NEAR(
        27.5,
        averages->averageMaxAttacks,
        tolerance
    );
    EXPECT_NEAR(
        2.0,
        averages->averagePlayersWithOneAttack,
        tolerance
    );
    EXPECT_NEAR(
        0.75,
        averages->averagePlayersWithoutAttacks,
        tolerance
    );
    EXPECT_NEAR(
        1.0,
        averages->averageFirstAttacksNotOnMirror,
        tolerance
    );
    EXPECT_NEAR(
        12.0 / 110.0,
        averages->averageMissedAttacksRate,
        tolerance
    );
    EXPECT_NEAR(
        3.0 / 55.0,
        averages->averagePlayersWithoutAttacksRate,
        tolerance
    );
    EXPECT_NEAR(
        8.0 / 55.0,
        averages->averagePlayersWithOneAttackRate,
        tolerance
    );
    EXPECT_NEAR(
        4.0 / 52.0,
        averages->averageFirstAttacksNotOnMirrorRate,
        tolerance
    );
}

TEST(ClanwarAnalyzerHistoricalAveragesTest, HandlesWarWithoutAttacks)
{
    const std::vector previousWars{
        ClanwarWarStats{
            .homeStars = 0,
            .opponentStars = 0,
            .homeDestruction = 0.0,
            .opponentDestruction = 0.0,
            .result = ClanwarOutcome::Draw,
            .maxAttacks = 30,
            .attacksUsed = 0,
            .teamSize = 15,
            .totalAttackStars = 0,
            .averageStarsPerAttack = 0.0,
            .averageDestructionPerAttack = 0.0,
            .disciplineStats = ClanwarDisciplineStats{
                .playersWithoutAttacks = 15,
                .playersWithOneAttack = 0,
                .firstAttacksNotOnMirror = 0
            }
        }
    };

    const auto averages =
        clanwar_analytics::calculateHistoricalAverages(previousWars);

    ASSERT_TRUE(averages.has_value());
    EXPECT_EQ(1, averages->warsCount);
    EXPECT_DOUBLE_EQ(0.0, averages->averageStarsPerAttack);
    EXPECT_DOUBLE_EQ(0.0, averages->averageDestructionPerAttack);
    EXPECT_DOUBLE_EQ(30.0, averages->averageMissedAttacks);
    EXPECT_DOUBLE_EQ(0.0, averages->averageAttacksUsed);
    EXPECT_DOUBLE_EQ(30.0, averages->averageMaxAttacks);
    EXPECT_DOUBLE_EQ(15.0, averages->averagePlayersWithoutAttacks);
    EXPECT_DOUBLE_EQ(0.0, averages->averagePlayersWithOneAttack);
    EXPECT_DOUBLE_EQ(0.0, averages->averageFirstAttacksNotOnMirror);
    EXPECT_DOUBLE_EQ(1.0, averages->averageMissedAttacksRate);
    EXPECT_DOUBLE_EQ(1.0, averages->averagePlayersWithoutAttacksRate);
    EXPECT_DOUBLE_EQ(0.0, averages->averagePlayersWithOneAttackRate);
    EXPECT_DOUBLE_EQ(0.0, averages->averageFirstAttacksNotOnMirrorRate);
}

TEST(ClanwarAnalyzerComparisonDataTest, HandlesEmptyPreviousWars)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        90.0,
        75,
        2.5
    );
    const std::vector<ClanwarWarStats> previousWars;

    const auto comparisonData =
        clanwar_analytics::buildComparisonData(currentWar, previousWars);

    EXPECT_EQ(currentWar.result, comparisonData.currentWar.result);
    EXPECT_DOUBLE_EQ(
        currentWar.homeDestruction,
        comparisonData.currentWar.homeDestruction
    );
    EXPECT_FALSE(comparisonData.previousWar.has_value());
    EXPECT_FALSE(comparisonData.previousWarsAverage.has_value());
    EXPECT_FALSE(comparisonData.performanceComparison.has_value());
    ASSERT_EQ(1, comparisonData.recentWarResults.size());
    EXPECT_EQ(currentWar.result, comparisonData.recentWarResults.front());
}

TEST(ClanwarAnalyzerComparisonDataTest, BuildsDataFromPreviousWars)
{
    const auto previousWar1 = makeWarStats(
        ClanwarOutcome::Victory,
        80.0,
        60,
        2.0
    );
    const auto previousWar2 = makeWarStats(
        ClanwarOutcome::Defeat,
        85.0,
        66,
        2.2
    );
    const auto previousWar3 = makeWarStats(
        ClanwarOutcome::Draw,
        90.0,
        72,
        2.4
    );
    const auto previousWar4 = makeWarStats(
        ClanwarOutcome::Victory,
        95.0,
        78,
        2.6
    );
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Defeat,
        70.0,
        60,
        2.0
    );

    const std::vector previousWars{
        previousWar1,
        previousWar2,
        previousWar3,
        previousWar4
    };

    const auto comparisonData =
        clanwar_analytics::buildComparisonData(currentWar, previousWars);

    EXPECT_EQ(currentWar.result, comparisonData.currentWar.result);
    ASSERT_TRUE(comparisonData.previousWar.has_value());
    EXPECT_EQ(
        previousWar1.result,
        comparisonData.previousWar->result
    );
    EXPECT_DOUBLE_EQ(
        previousWar1.homeDestruction,
        comparisonData.previousWar->homeDestruction
    );

    ASSERT_TRUE(comparisonData.previousWarsAverage.has_value());
    EXPECT_EQ(3, comparisonData.previousWarsAverage->warsCount);
    EXPECT_NEAR(
        85.0,
        comparisonData.previousWarsAverage->averageDestructionPerAttack,
        0.001
    );

    ASSERT_TRUE(comparisonData.performanceComparison.has_value());

    ASSERT_EQ(5, comparisonData.recentWarResults.size());
    EXPECT_EQ(previousWar4.result, comparisonData.recentWarResults[0]);
    EXPECT_EQ(previousWar3.result, comparisonData.recentWarResults[1]);
    EXPECT_EQ(previousWar2.result, comparisonData.recentWarResults[2]);
    EXPECT_EQ(previousWar1.result, comparisonData.recentWarResults[3]);
    EXPECT_EQ(currentWar.result, comparisonData.recentWarResults[4]);
}

TEST(ClanwarAnalyzerPerformanceComparisonTest, ReturnsBetterWhenMostMetricsImprove)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        90.0,
        0,
        3.0
    );
    const auto historicalAverages = makeHistoricalAverages(
        2.0,
        80.0,
        0.1,
        0.1,
        0.1
    );

    const auto comparison = clanwar_analytics::compareWithHistoricalAverage(
        currentWar,
        historicalAverages
    );

    EXPECT_EQ(ClanwarPerformanceTrend::Better, comparison.trend);
    EXPECT_EQ(4, comparison.improvedMetrics);
    EXPECT_EQ(0, comparison.worsenedMetrics);
    EXPECT_EQ(0, comparison.unchangedMetrics);
    EXPECT_EQ(4, comparison.totalMetrics);
    EXPECT_DOUBLE_EQ(1.0, comparison.improvedMetricsRate);
    EXPECT_DOUBLE_EQ(0.0, comparison.worsenedMetricsRate);
    EXPECT_DOUBLE_EQ(0.0, comparison.unchangedMetricsRate);
}

TEST(ClanwarAnalyzerPerformanceComparisonTest, ReturnsWorseWhenMostMetricsWorsen)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Defeat,
        70.0,
        0,
        1.0,
        30,
        27,
        15,
        1,
        3,
        2
    );
    const auto historicalAverages = makeHistoricalAverages(
        2.0,
        80.0,
        0.0,
        0.0,
        0.0
    );

    const auto comparison = clanwar_analytics::compareWithHistoricalAverage(
        currentWar,
        historicalAverages
    );

    EXPECT_EQ(ClanwarPerformanceTrend::Worse, comparison.trend);
    EXPECT_EQ(0, comparison.improvedMetrics);
    EXPECT_EQ(4, comparison.worsenedMetrics);
    EXPECT_EQ(0, comparison.unchangedMetrics);
    EXPECT_EQ(4, comparison.totalMetrics);
    EXPECT_DOUBLE_EQ(0.0, comparison.improvedMetricsRate);
    EXPECT_DOUBLE_EQ(1.0, comparison.worsenedMetricsRate);
    EXPECT_DOUBLE_EQ(0.0, comparison.unchangedMetricsRate);
}

TEST(ClanwarAnalyzerPerformanceComparisonTest, ReturnsSimilarWhenMetricsAreEqual)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Draw,
        80.0,
        0,
        2.0,
        30,
        27,
        15,
        0,
        3,
        2
    );
    const auto historicalAverages = makeHistoricalAverages(
        2.0,
        80.0,
        0.0,
        0.2,
        2.0 / 15.0
    );

    const auto comparison = clanwar_analytics::compareWithHistoricalAverage(
        currentWar,
        historicalAverages
    );

    EXPECT_EQ(ClanwarPerformanceTrend::Similar, comparison.trend);
    EXPECT_EQ(0, comparison.improvedMetrics);
    EXPECT_EQ(0, comparison.worsenedMetrics);
    EXPECT_EQ(4, comparison.unchangedMetrics);
    EXPECT_EQ(4, comparison.totalMetrics);
    EXPECT_DOUBLE_EQ(0.0, comparison.improvedMetricsRate);
    EXPECT_DOUBLE_EQ(0.0, comparison.worsenedMetricsRate);
    EXPECT_DOUBLE_EQ(1.0, comparison.unchangedMetricsRate);
}

TEST(ClanwarAnalyzerPerformanceComparisonTest, ReturnsBetterWhenThreeMetricsImprove)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        90.0,
        0,
        3.0,
        30,
        30,
        15,
        0,
        0,
        0,
        70.0
    );
    const auto historicalAverages = makeHistoricalAverages(
        2.0,
        80.0,
        0.1,
        0.0,
        0.1
    );

    const auto comparison = clanwar_analytics::compareWithHistoricalAverage(
        currentWar,
        historicalAverages
    );

    EXPECT_EQ(ClanwarPerformanceTrend::Better, comparison.trend);
    EXPECT_EQ(3, comparison.improvedMetrics);
    EXPECT_EQ(1, comparison.worsenedMetrics);
    EXPECT_EQ(0, comparison.unchangedMetrics);
    EXPECT_EQ(4, comparison.totalMetrics);
}

TEST(ClanwarAnalyzerPerformanceComparisonTest, ReturnsWorseWhenThreeMetricsWorsen)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Defeat,
        90.0,
        0,
        1.0,
        30,
        30,
        15,
        3,
        0,
        3,
        90.0
    );
    const auto historicalAverages = makeHistoricalAverages(
        2.0,
        80.0,
        0.1,
        0.0,
        0.1
    );

    const auto comparison = clanwar_analytics::compareWithHistoricalAverage(
        currentWar,
        historicalAverages
    );

    EXPECT_EQ(ClanwarPerformanceTrend::Worse, comparison.trend);
    EXPECT_EQ(1, comparison.improvedMetrics);
    EXPECT_EQ(3, comparison.worsenedMetrics);
    EXPECT_EQ(0, comparison.unchangedMetrics);
    EXPECT_EQ(4, comparison.totalMetrics);
}

TEST(ClanwarAnalyzerPerformanceComparisonTest, ReturnsSimilarWhenTwoMetricsImproveAndTwoWorsen)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        90.0,
        0,
        3.0,
        30,
        30,
        15,
        0,
        0,
        3,
        70.0
    );
    const auto historicalAverages = makeHistoricalAverages(
        2.0,
        80.0,
        0.1,
        0.0,
        0.1
    );

    const auto comparison = clanwar_analytics::compareWithHistoricalAverage(
        currentWar,
        historicalAverages
    );

    EXPECT_EQ(ClanwarPerformanceTrend::Similar, comparison.trend);
    EXPECT_EQ(2, comparison.improvedMetrics);
    EXPECT_EQ(2, comparison.worsenedMetrics);
    EXPECT_EQ(0, comparison.unchangedMetrics);
    EXPECT_EQ(4, comparison.totalMetrics);
}

TEST(ClanwarAnalyzerPerformanceComparisonTest, ReturnsSimilarWhenOneMetricImprovesAndOneWorsens)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        90.0,
        0,
        3.0,
        30,
        30,
        15,
        0,
        0,
        0,
        70.0
    );
    const auto historicalAverages = makeHistoricalAverages(
        2.0,
        80.0,
        0.0,
        0.0,
        0.0
    );

    const auto comparison = clanwar_analytics::compareWithHistoricalAverage(
        currentWar,
        historicalAverages
    );

    EXPECT_EQ(ClanwarPerformanceTrend::Similar, comparison.trend);
    EXPECT_EQ(1, comparison.improvedMetrics);
    EXPECT_EQ(1, comparison.worsenedMetrics);
    EXPECT_EQ(2, comparison.unchangedMetrics);
    EXPECT_EQ(4, comparison.totalMetrics);
}

TEST(ClanwarAnalyzerPerformanceComparisonTest, UsesAverageDestructionPerAttack)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        99.0,
        0,
        2.0,
        30,
        30,
        15,
        0,
        0,
        0,
        75.0
    );
    const auto historicalAverages = makeHistoricalAverages(
        2.0,
        80.0,
        0.0,
        0.0,
        0.0
    );

    const auto comparison = clanwar_analytics::compareWithHistoricalAverage(
        currentWar,
        historicalAverages
    );

    EXPECT_EQ(ClanwarPerformanceTrend::Worse, comparison.trend);
    EXPECT_EQ(0, comparison.improvedMetrics);
    EXPECT_EQ(1, comparison.worsenedMetrics);
    EXPECT_EQ(3, comparison.unchangedMetrics);
}

TEST(ClanwarAnalyzerPerformanceComparisonTest, HandlesZeroTeamSize)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Draw,
        0.0,
        0,
        0.0,
        0,
        0,
        0,
        0,
        0,
        0,
        0.0
    );
    const auto historicalAverages = makeHistoricalAverages(
        0.0,
        0.0,
        0.0,
        0.0,
        0.0
    );

    const auto comparison = clanwar_analytics::compareWithHistoricalAverage(
        currentWar,
        historicalAverages
    );

    EXPECT_EQ(ClanwarPerformanceTrend::Similar, comparison.trend);
    EXPECT_EQ(0, comparison.improvedMetrics);
    EXPECT_EQ(0, comparison.worsenedMetrics);
    EXPECT_EQ(4, comparison.unchangedMetrics);
    EXPECT_EQ(4, comparison.totalMetrics);
    EXPECT_DOUBLE_EQ(0.0, comparison.improvedMetricsRate);
    EXPECT_DOUBLE_EQ(0.0, comparison.worsenedMetricsRate);
    EXPECT_DOUBLE_EQ(1.0, comparison.unchangedMetricsRate);
}

TEST(ClanwarAnalyzerPerformanceComparisonTest, HandlesZeroParticipantsForFirstAttackRate)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Draw,
        80.0,
        60,
        2.0,
        30,
        15,
        15,
        15,
        0,
        0,
        80.0
    );
    const auto historicalAverages = makeHistoricalAverages(
        2.0,
        80.0,
        1.0,
        0.0,
        0.0
    );

    const auto comparison = clanwar_analytics::compareWithHistoricalAverage(
        currentWar,
        historicalAverages
    );

    EXPECT_EQ(ClanwarPerformanceTrend::Similar, comparison.trend);
    EXPECT_EQ(0, comparison.improvedMetrics);
    EXPECT_EQ(0, comparison.worsenedMetrics);
    EXPECT_EQ(4, comparison.unchangedMetrics);
    EXPECT_EQ(4, comparison.totalMetrics);
}

TEST(ClanwarAnalyzerPerformanceComparisonTest, HandlesCurrentWarWithoutAttacks)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Defeat,
        0.0,
        0,
        0.0,
        30,
        0,
        15,
        15,
        0,
        0,
        0.0
    );
    const auto historicalAverages = makeHistoricalAverages(
        2.0,
        80.0,
        0.1,
        0.0,
        0.0
    );

    const auto comparison = clanwar_analytics::compareWithHistoricalAverage(
        currentWar,
        historicalAverages
    );

    EXPECT_EQ(ClanwarPerformanceTrend::Worse, comparison.trend);
    EXPECT_EQ(0, comparison.improvedMetrics);
    EXPECT_EQ(3, comparison.worsenedMetrics);
    EXPECT_EQ(1, comparison.unchangedMetrics);
    EXPECT_EQ(4, comparison.totalMetrics);
    EXPECT_DOUBLE_EQ(0.0, comparison.improvedMetricsRate);
    EXPECT_DOUBLE_EQ(0.75, comparison.worsenedMetricsRate);
    EXPECT_DOUBLE_EQ(0.25, comparison.unchangedMetricsRate);
}
