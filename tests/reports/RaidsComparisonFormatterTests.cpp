#include <gtest/gtest.h>

#include <array>
#include <optional>
#include <string>
#include <string_view>

#include "reports/RaidsComparisonFormatter.h"

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
        const int enemyDistrictsDestroyed,
        const int offensiveReward,
        const int defensiveReward)
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

    RaidComparisonStats makeCurrentRaid()
    {
        return makeRaidStats(
            86'400,
            1'312'000,
            9,
            96,
            120,
            20,
            24,
            13,
            4,
            12,
            1'850,
            640
        );
    }

    RaidComparisonStats makePreviousRaid()
    {
        return makeRaidStats(
            1,
            1'180'000,
            7,
            84,
            120,
            18,
            24,
            10,
            6,
            10,
            1'720,
            590
        );
    }

    RaidHistoricalAverages makeHistoricalAverages(const int raidsCount = 3)
    {
        return RaidHistoricalAverages{
            .raidsCount = raidsCount,
            .averageLootPerUsedAttack = 13'850.0,
            .averageParticipantsWithAllAttacksUsedRate = 10.5 / 18.7,
            .averageParticipantsWithoutAttacksRate = 5.3 / 23.7,
            .averageAttackUsageRate = 88.9 / 120.0,
            .averageActiveParticipants = 18.7,
            .averageEligibleParticipants = 23.7,
            .averageParticipantsWithAllAttacksUsed = 10.5,
            .averageParticipantsWithoutAttacks = 5.3,
            .averageUsedAttacks = 88.9,
            .averageAvailableAttacks = 120.0,
            .averageTotalLoot = 1'130'000.0,
            .averageRaidsCompleted = 7.3,
            .averageEnemyDistrictsDestroyed = 9.3,
            .averageOffensiveReward = 1'650.0,
            .averageDefensiveReward = 560.0
        };
    }

    RaidPerformanceComparison makePerformance(
        const RaidPerformanceTrend trend,
        const int improvedMetrics = 2,
        const int worsenedMetrics = 1,
        const int unchangedMetrics = 0,
        const int totalMetrics = 3)
    {
        return RaidPerformanceComparison{
            .trend = trend,
            .improvedMetrics = improvedMetrics,
            .worsenedMetrics = worsenedMetrics,
            .unchangedMetrics = unchangedMetrics,
            .totalMetrics = totalMetrics,
            .improvedMetricsRate = static_cast<double>(improvedMetrics)
                / totalMetrics,
            .worsenedMetricsRate = static_cast<double>(worsenedMetrics)
                / totalMetrics,
            .unchangedMetricsRate = static_cast<double>(unchangedMetrics)
                / totalMetrics
        };
    }

    RaidComparisonData makeComparisonData(
        const RaidComparisonStats& currentRaid,
        const RaidComparisonStats& previousRaid)
    {
        return RaidComparisonData{
            .clanTag = "#2J8PJ9VLG",
            .clanName = "aurus",
            .currentRaid = currentRaid,
            .previousRaid = previousRaid,
            .previousRaidsAverage = std::nullopt,
            .performanceComparison = std::nullopt
        };
    }

    RaidComparisonData makeFullComparisonData()
    {
        return RaidComparisonData{
            .clanTag = "#2J8PJ9VLG",
            .clanName = "aurus",
            .currentRaid = makeCurrentRaid(),
            .previousRaid = makePreviousRaid(),
            .previousRaidsAverage = makeHistoricalAverages(),
            .performanceComparison = makePerformance(
                RaidPerformanceTrend::Better
            )
        };
    }
}

TEST(RaidsComparisonFormatterTest, FormatsHeaderAndComparisonSections)
{
    const auto report = RaidsComparisonFormatter::buildReport(
        makeFullComparisonData()
    );

    EXPECT_TRUE(report.starts_with(
        "📈 <b>ДИНАМИКА РЕЙДОВ</b>\n\n"
        "🏠 Наш клан: aurus (<code>#2J8PJ9VLG</code>)\n\n"
        "Последний рейд: 02.01.1970\n"
        "Предыдущий рейд: 01.01.1970\n\n"
    ));
    EXPECT_NE(
        report.find("📊 <b>СРАВНЕНИЕ С ПРЕДЫДУЩИМ РЕЙДОМ</b>"),
        std::string::npos
    );
    EXPECT_NE(
        report.find("📌 Основные метрики:\n"),
        std::string::npos
    );
    EXPECT_NE(
        report.find("📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 3 ПРЕДЫДУЩИХ РЕЙДА</b>"),
        std::string::npos
    );
}

TEST(RaidsComparisonFormatterTest, FormatsDisciplineUsingCommonMetricLayout)
{
    const auto report = RaidsComparisonFormatter::buildReport(
        makeFullComparisonData()
    );

    EXPECT_NE(
        report.find(
            "🎯 Дисциплина:\n"
            "Полностью использовали доступные атаки\n"
            "(среди активных участников):\n"
            "55.6% → 65.0% (+9.4 п.п.; 10/18 → 13/20; ✅ лучше)\n"
            "Использовали не все атаки\n"
            "(среди активных участников):\n"
            "44.4% → 35.0% (−9.4 п.п.; 8/18 → 7/20; ✅ лучше)\n"
            "Без атак\n"
            "(среди всех участников):\n"
            "25.0% → 16.7% (−8.3 п.п.; 6/24 → 4/24; ✅ лучше)"
        ),
        std::string::npos
    );
}

TEST(RaidsComparisonFormatterTest, FormatsActivityAndRaidResult)
{
    const auto report = RaidsComparisonFormatter::buildReport(
        makeFullComparisonData()
    );

    EXPECT_NE(
        report.find(
            "⚔️ Активность (не входит в итоговую оценку):\n"
            "Использование атак:\n"
            "70.0% → 80.0% (+10.0 п.п.; 84/120 → 96/120; ✅ лучше)\n"
            "Активные участники\n"
            "(сделали хотя бы одну атаку):\n"
            "75.0% → 83.3% (+8.3 п.п.; 18/24 → 20/24; ✅ лучше)"
        ),
        std::string::npos
    );
    EXPECT_NE(
        report.find(
            "📊 Итог рейда:\n"
            "Заработано золота:\n"
            "1 180 000 → 1 312 000 (+132 000)\n"
            "Завершено рейдов:\n"
            "7 → 9 (+2)\n"
            "Уничтожено районов:\n"
            "10 → 12 (+2)\n"
            "Награда за нападение:\n"
            "1 720 → 1 850 (+130)\n"
            "Награда за оборону:\n"
            "590 → 640 (+50)"
        ),
        std::string::npos
    );
}

TEST(RaidsComparisonFormatterTest, FormatsHistoricalComparisonUsingSameLayout)
{
    const auto report = RaidsComparisonFormatter::buildReport(
        makeFullComparisonData()
    );

    EXPECT_NE(
        report.find(
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 3 ПРЕДЫДУЩИХ РЕЙДА</b>\n"
            "Для долевых метрик изменение указано в процентных пунктах (п.п.).\n"
            "\n📌 Основные метрики:\n"
            "💰 Средняя добыча золота за использованную атаку:\n"
            "13 850 → 13 667 (−183; ⚠️ хуже)\n"
            "\n🎯 Дисциплина:\n"
            "Полностью использовали доступные атаки\n"
            "(среди активных участников):\n"
            "56.1% → 65.0% (+8.9 п.п.; 10.5/18.7 → 13/20; ✅ лучше)\n"
            "Использовали не все атаки\n"
            "(среди активных участников):\n"
            "43.9% → 35.0% (−8.9 п.п.; 8.2/18.7 → 7/20; ✅ лучше)\n"
            "Без атак\n"
            "(среди всех участников):\n"
            "22.4% → 16.7% (−5.7 п.п.; 5.3/23.7 → 4/24; ✅ лучше)\n"
            "\n⚔️ Активность (не входит в итоговую оценку):\n"
            "Использование атак:\n"
            "74.1% → 80.0% (+5.9 п.п.; 88.9/120 → 96/120; ✅ лучше)\n"
            "Активные участники\n"
            "(сделали хотя бы одну атаку):\n"
            "78.9% → 83.3% (+4.4 п.п.; 18.7/23.7 → 20/24; ✅ лучше)\n"
            "\n📊 Итог рейда:\n"
            "Заработано золота:\n"
            "1 130 000 → 1 312 000 (+182 000)\n"
            "Завершено рейдов:\n"
            "7.3 → 9 (+1.7)\n"
            "Уничтожено районов:\n"
            "9.3 → 12 (+2.7)\n"
            "Награда за нападение:\n"
            "1 650 → 1 850 (+200)\n"
            "Награда за оборону:\n"
            "560 → 640 (+80)"
        ),
        std::string::npos
    );
}

TEST(RaidsComparisonFormatterTest, FormatsAllPerformanceTrends)
{
    struct PerformanceCase
    {
        RaidPerformanceTrend trend;
        std::string_view expectedTrend;
    };

    constexpr std::array cases{
        PerformanceCase{
            RaidPerformanceTrend::Better,
            "✅ Динамика лучше среднего за последние 3 рейда\n"
        },
        PerformanceCase{
            RaidPerformanceTrend::Worse,
            "⚠️ Динамика хуже среднего за последние 3 рейда\n"
        },
        PerformanceCase{
            RaidPerformanceTrend::Similar,
            "⚖️ Динамика примерно на уровне среднего за последние 3 рейда\n"
        }
    };

    for (const auto& testCase : cases)
    {
        auto comparisonData = makeFullComparisonData();
        comparisonData.performanceComparison = makePerformance(
            testCase.trend,
            2,
            1,
            1,
            4
        );

        const auto report = RaidsComparisonFormatter::buildReport(
            comparisonData
        );

        EXPECT_NE(
            report.find(
                std::string(testCase.expectedTrend)
                + "\nИтог по 4 основным метрикам:\n"
                "Улучшились: 2 (50.0%)\n"
                "Ухудшились: 1 (25.0%)\n"
                "Без изменений: 1 (25.0%)."
            ),
            std::string::npos
        );
    }
}

TEST(RaidsComparisonFormatterTest, FormatsHistoricalAverageCountWithCorrectDeclension)
{
    struct HistoricalAverageCase
    {
        int count;
        std::string_view expectedLabel;
        std::string_view expectedPeriod;
    };

    constexpr std::array cases{
        HistoricalAverageCase{
            1,
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 1 ПРЕДЫДУЩИЙ РЕЙД</b>\n",
            "за последний рейд"
        },
        HistoricalAverageCase{
            2,
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 2 ПРЕДЫДУЩИХ РЕЙДА</b>\n",
            "за последние 2 рейда"
        },
        HistoricalAverageCase{
            3,
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 3 ПРЕДЫДУЩИХ РЕЙДА</b>\n",
            "за последние 3 рейда"
        },
        HistoricalAverageCase{
            5,
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 5 ПРЕДЫДУЩИХ РЕЙДОВ</b>\n",
            "за последние 5 рейдов"
        },
        HistoricalAverageCase{
            11,
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 11 ПРЕДЫДУЩИХ РЕЙДОВ</b>\n",
            "за последние 11 рейдов"
        }
    };

    for (const auto& testCase : cases)
    {
        auto comparisonData = makeFullComparisonData();
        comparisonData.previousRaidsAverage = makeHistoricalAverages(
            testCase.count
        );

        const auto report = RaidsComparisonFormatter::buildReport(
            comparisonData
        );

        EXPECT_NE(report.find(testCase.expectedLabel), std::string::npos);
        EXPECT_NE(
            report.find(
                "✅ Динамика лучше среднего "
                + std::string(testCase.expectedPeriod) + "\n"
            ),
            std::string::npos
        );
    }
}

TEST(RaidsComparisonFormatterTest, OmitsHistoricalComparisonWhenAverageIsMissing)
{
    const auto report = RaidsComparisonFormatter::buildReport(
        makeComparisonData(makeCurrentRaid(), makePreviousRaid())
    );

    EXPECT_EQ(
        report.find("📉 <b>СРАВНЕНИЕ СО СРЕДНИМ"),
        std::string::npos
    );
    EXPECT_EQ(report.find("Итог по "), std::string::npos);
}

TEST(RaidsComparisonFormatterTest, ReturnsEmptyReportWithoutPreviousRaid)
{
    auto comparisonData = makeFullComparisonData();
    comparisonData.previousRaid.reset();

    EXPECT_TRUE(RaidsComparisonFormatter::buildReport(comparisonData).empty());
}

TEST(RaidsComparisonFormatterTest, RemovesTrailingNewlinesFromReport)
{
    const auto report = RaidsComparisonFormatter::buildReport(
        makeFullComparisonData()
    );

    EXPECT_FALSE(report.ends_with("\n"));
}

TEST(RaidsComparisonFormatterTest, EscapesClanFields)
{
    auto comparisonData = makeFullComparisonData();
    comparisonData.clanName = "<Aurus&>";
    comparisonData.clanTag = "#<TAG&>";

    const auto report = RaidsComparisonFormatter::buildReport(comparisonData);

    EXPECT_TRUE(report.starts_with(
        "📈 <b>ДИНАМИКА РЕЙДОВ</b>\n\n"
        "🏠 Наш клан: &lt;Aurus&amp;&gt; "
        "(<code>#&lt;TAG&amp;&gt;</code>)\n\n"
    ));
}

TEST(RaidsComparisonFormatterTest, ReportsAllTrendsForMainMetrics)
{
    struct TrendCase
    {
        int previousLoot;
        int currentLoot;
        int previousFullParticipants;
        int currentFullParticipants;
        int previousParticipantsWithoutAttacks;
        int currentParticipantsWithoutAttacks;
        std::string_view expectedLoot;
        std::string_view expectedFullParticipants;
        std::string_view expectedParticipantsWithoutAttacks;
    };

    constexpr std::array cases{
        TrendCase{
            1'000,
            2'000,
            10,
            15,
            6,
            3,
            "1 000 → 2 000 (+1 000; ✅ лучше)",
            "50.0% → 75.0% (+25.0 п.п.; 10/20 → 15/20; ✅ лучше)",
            "25.0% → 12.5% (−12.5 п.п.; 6/24 → 3/24; ✅ лучше)"
        },
        TrendCase{
            2'000,
            1'000,
            15,
            10,
            3,
            6,
            "2 000 → 1 000 (−1 000; ⚠️ хуже)",
            "75.0% → 50.0% (−25.0 п.п.; 15/20 → 10/20; ⚠️ хуже)",
            "12.5% → 25.0% (+12.5 п.п.; 3/24 → 6/24; ⚠️ хуже)"
        },
        TrendCase{
            1'000,
            1'000,
            10,
            10,
            6,
            6,
            "1 000 → 1 000 (0; ➖ без изменений)",
            "50.0% → 50.0% (0.0 п.п.; 10/20 → 10/20; ➖ без изменений)",
            "25.0% → 25.0% (0.0 п.п.; 6/24 → 6/24; ➖ без изменений)"
        }
    };

    for (const auto& testCase : cases)
    {
        auto currentRaid = makeCurrentRaid();
        auto previousRaid = makePreviousRaid();

        currentRaid.activeParticipants = 20;
        previousRaid.activeParticipants = 20;
        currentRaid.totalLoot = testCase.currentLoot;
        previousRaid.totalLoot = testCase.previousLoot;
        currentRaid.usedAttacks = 1;
        previousRaid.usedAttacks = 1;
        currentRaid.participantsWithAllAttacksUsed =
            testCase.currentFullParticipants;
        previousRaid.participantsWithAllAttacksUsed =
            testCase.previousFullParticipants;
        currentRaid.participantsWithoutAttacks =
            testCase.currentParticipantsWithoutAttacks;
        previousRaid.participantsWithoutAttacks =
            testCase.previousParticipantsWithoutAttacks;

        const auto report = RaidsComparisonFormatter::buildReport(
            makeComparisonData(currentRaid, previousRaid)
        );

        EXPECT_NE(
            report.find(
                "💰 Средняя добыча золота за использованную атаку:\n"
                + std::string(testCase.expectedLoot)
            ),
            std::string::npos
        );
        EXPECT_NE(
            report.find(
                "Полностью использовали доступные атаки\n"
                "(среди активных участников):\n"
                + std::string(testCase.expectedFullParticipants)
            ),
            std::string::npos
        );
        EXPECT_NE(
            report.find(
                "Без атак\n"
                "(среди всех участников):\n"
                + std::string(testCase.expectedParticipantsWithoutAttacks)
            ),
            std::string::npos
        );
    }
}

TEST(RaidsComparisonFormatterTest, HandlesZeroDenominatorsWithoutInvalidNumbers)
{
    const auto emptyRaid = makeRaidStats(
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
    );
    const auto report = RaidsComparisonFormatter::buildReport(
        makeComparisonData(emptyRaid, emptyRaid)
    );

    EXPECT_NE(
        report.find(
            "Последний рейд: неизвестно\n"
            "Предыдущий рейд: неизвестно\n"
        ),
        std::string::npos
    );
    EXPECT_NE(
        report.find("0 → 0 (0; ➖ без изменений)"),
        std::string::npos
    );
    EXPECT_NE(
        report.find(
            "0.0% → 0.0% (0.0 п.п.; 0/0 → 0/0; ➖ без изменений)"
        ),
        std::string::npos
    );
    EXPECT_NE(
        report.find("0/0 → 0/0"),
        std::string::npos
    );
    EXPECT_EQ(report.find("nan"), std::string::npos);
    EXPECT_EQ(report.find("inf"), std::string::npos);
}

TEST(RaidsComparisonFormatterTest, ReportsAllActivityTrendsUsingDifferentDenominators)
{
    struct ActivityTrendCase
    {
        int previousUsedAttacks;
        int previousAvailableAttacks;
        int currentUsedAttacks;
        int currentAvailableAttacks;
        int previousActiveParticipants;
        int previousEligibleParticipants;
        int currentActiveParticipants;
        int currentEligibleParticipants;
        std::string_view expectedUsage;
        std::string_view expectedParticipants;
    };

    constexpr std::array cases{
        ActivityTrendCase{
            6,
            10,
            14,
            20,
            12,
            20,
            21,
            30,
            "60.0% → 70.0% (+10.0 п.п.; 6/10 → 14/20; ✅ лучше)",
            "60.0% → 70.0% (+10.0 п.п.; 12/20 → 21/30; ✅ лучше)"
        },
        ActivityTrendCase{
            14,
            20,
            6,
            10,
            21,
            30,
            12,
            20,
            "70.0% → 60.0% (−10.0 п.п.; 14/20 → 6/10; ⚠️ хуже)",
            "70.0% → 60.0% (−10.0 п.п.; 21/30 → 12/20; ⚠️ хуже)"
        },
        ActivityTrendCase{
            6,
            10,
            12,
            20,
            12,
            20,
            18,
            30,
            "60.0% → 60.0% (0.0 п.п.; 6/10 → 12/20; ➖ без изменений)",
            "60.0% → 60.0% (0.0 п.п.; 12/20 → 18/30; ➖ без изменений)"
        }
    };

    for (const auto& testCase : cases)
    {
        auto currentRaid = makeCurrentRaid();
        auto previousRaid = makePreviousRaid();

        previousRaid.usedAttacks = testCase.previousUsedAttacks;
        previousRaid.availableAttacks = testCase.previousAvailableAttacks;
        currentRaid.usedAttacks = testCase.currentUsedAttacks;
        currentRaid.availableAttacks = testCase.currentAvailableAttacks;
        previousRaid.activeParticipants = testCase.previousActiveParticipants;
        previousRaid.eligibleParticipants = testCase.previousEligibleParticipants;
        currentRaid.activeParticipants = testCase.currentActiveParticipants;
        currentRaid.eligibleParticipants = testCase.currentEligibleParticipants;

        const auto report = RaidsComparisonFormatter::buildReport(
            makeComparisonData(currentRaid, previousRaid)
        );

        EXPECT_NE(
            report.find(
                "Использование атак:\n"
                + std::string(testCase.expectedUsage)
            ),
            std::string::npos
        );
        EXPECT_NE(
            report.find(
                "Активные участники\n"
                "(сделали хотя бы одну атаку):\n"
                + std::string(testCase.expectedParticipants)
            ),
            std::string::npos
        );
    }
}

TEST(RaidsComparisonFormatterTest, CalculatesNoAttackRateForDifferentEligibleParticipants)
{
    auto currentRaid = makeCurrentRaid();
    auto previousRaid = makePreviousRaid();

    currentRaid.eligibleParticipants = 30;
    currentRaid.participantsWithoutAttacks = 6;
    previousRaid.eligibleParticipants = 20;
    previousRaid.participantsWithoutAttacks = 5;

    const auto report = RaidsComparisonFormatter::buildReport(
        makeComparisonData(currentRaid, previousRaid)
    );

    EXPECT_NE(
        report.find(
            "Без атак\n"
            "(среди всех участников):\n"
            "25.0% → 20.0% (−5.0 п.п.; 5/20 → 6/30; ✅ лучше)"
        ),
        std::string::npos
    );
}

TEST(RaidsComparisonFormatterTest, ReportsAllHistoricalMainMetricTrends)
{
    struct HistoricalTrendCase
    {
        double averageLootPerAttack;
        double averageFullParticipantsRate;
        double averageWithoutAttacksRate;
        double averageFullParticipants;
        double averageWithoutAttacks;
        std::string_view expectedLoot;
        std::string_view expectedFullParticipants;
        std::string_view expectedWithoutAttacks;
    };

    constexpr std::array cases{
        HistoricalTrendCase{
            13'000.0,
            0.5,
            0.25,
            10.0,
            6.0,
            "13 000 → 13 667 (+667; ✅ лучше)",
            "50.0% → 65.0% (+15.0 п.п.; 10/20 → 13/20; ✅ лучше)",
            "25.0% → 16.7% (−8.3 п.п.; 6/24 → 4/24; ✅ лучше)"
        },
        HistoricalTrendCase{
            15'000.0,
            0.75,
            0.125,
            15.0,
            3.0,
            "15 000 → 13 667 (−1 333; ⚠️ хуже)",
            "75.0% → 65.0% (−10.0 п.п.; 15/20 → 13/20; ⚠️ хуже)",
            "12.5% → 16.7% (+4.2 п.п.; 3/24 → 4/24; ⚠️ хуже)"
        },
        HistoricalTrendCase{
            static_cast<double>(1'312'000) / 96.0,
            0.65,
            4.0 / 24.0,
            13.0,
            4.0,
            "13 667 → 13 667 (0; ➖ без изменений)",
            "65.0% → 65.0% (0.0 п.п.; 13/20 → 13/20; ➖ без изменений)",
            "16.7% → 16.7% (0.0 п.п.; 4/24 → 4/24; ➖ без изменений)"
        }
    };

    for (const auto& testCase : cases)
    {
        auto comparisonData = makeFullComparisonData();
        auto historicalAverages = makeHistoricalAverages();

        historicalAverages.averageLootPerUsedAttack =
            testCase.averageLootPerAttack;
        historicalAverages.averageParticipantsWithAllAttacksUsedRate =
            testCase.averageFullParticipantsRate;
        historicalAverages.averageParticipantsWithoutAttacksRate =
            testCase.averageWithoutAttacksRate;
        historicalAverages.averageActiveParticipants = 20.0;
        historicalAverages.averageEligibleParticipants = 24.0;
        historicalAverages.averageParticipantsWithAllAttacksUsed =
            testCase.averageFullParticipants;
        historicalAverages.averageParticipantsWithoutAttacks =
            testCase.averageWithoutAttacks;
        comparisonData.previousRaidsAverage = historicalAverages;

        const auto report = RaidsComparisonFormatter::buildReport(
            comparisonData
        );

        EXPECT_NE(
            report.find(
                "💰 Средняя добыча золота за использованную атаку:\n"
                + std::string(testCase.expectedLoot)
            ),
            std::string::npos
        );
        EXPECT_NE(
            report.find(
                "Полностью использовали доступные атаки\n"
                "(среди активных участников):\n"
                + std::string(testCase.expectedFullParticipants)
            ),
            std::string::npos
        );
        EXPECT_NE(
            report.find(
                "Без атак\n"
                "(среди всех участников):\n"
                + std::string(testCase.expectedWithoutAttacks)
            ),
            std::string::npos
        );
    }
}

TEST(RaidsComparisonFormatterTest, ReportsAllHistoricalActivityTrendsUsingDifferentDenominators)
{
    struct HistoricalActivityCase
    {
        double averageUsedAttacks;
        double averageAvailableAttacks;
        double averageActiveParticipants;
        double averageEligibleParticipants;
        std::string_view expectedUsage;
        std::string_view expectedParticipants;
    };

    constexpr std::array cases{
        HistoricalActivityCase{
            6.0,
            10.0,
            12.0,
            20.0,
            "60.0% → 80.0% (+20.0 п.п.; 6/10 → 96/120; ✅ лучше)",
            "60.0% → 83.3% (+23.3 п.п.; 12/20 → 20/24; ✅ лучше)"
        },
        HistoricalActivityCase{
            108.0,
            120.0,
            27.0,
            30.0,
            "90.0% → 80.0% (−10.0 п.п.; 108/120 → 96/120; ⚠️ хуже)",
            "90.0% → 83.3% (−6.7 п.п.; 27/30 → 20/24; ⚠️ хуже)"
        },
        HistoricalActivityCase{
            96.0,
            120.0,
            20.0,
            24.0,
            "80.0% → 80.0% (0.0 п.п.; 96/120 → 96/120; ➖ без изменений)",
            "83.3% → 83.3% (0.0 п.п.; 20/24 → 20/24; ➖ без изменений)"
        }
    };

    for (const auto& testCase : cases)
    {
        auto comparisonData = makeFullComparisonData();
        auto historicalAverages = makeHistoricalAverages();
        historicalAverages.averageAttackUsageRate =
            testCase.averageUsedAttacks / testCase.averageAvailableAttacks;
        historicalAverages.averageUsedAttacks = testCase.averageUsedAttacks;
        historicalAverages.averageAvailableAttacks =
            testCase.averageAvailableAttacks;
        historicalAverages.averageActiveParticipants =
            testCase.averageActiveParticipants;
        historicalAverages.averageEligibleParticipants =
            testCase.averageEligibleParticipants;
        comparisonData.previousRaidsAverage = historicalAverages;

        const auto report = RaidsComparisonFormatter::buildReport(
            comparisonData
        );

        EXPECT_NE(
            report.find(
                "Использование атак:\n"
                + std::string(testCase.expectedUsage)
            ),
            std::string::npos
        );
        EXPECT_NE(
            report.find(
                "Активные участники\n"
                "(сделали хотя бы одну атаку):\n"
                + std::string(testCase.expectedParticipants)
            ),
            std::string::npos
        );
    }
}

TEST(RaidsComparisonFormatterTest, ReportsEveryHistoricalRaidResultMetricForAllChangeDirections)
{
    struct HistoricalResultMetric
    {
        std::string_view label;
        double RaidHistoricalAverages::*averageMember;
        int RaidComparisonStats::*currentMember;
        std::string_view positiveChange;
        std::string_view negativeChange;
        std::string_view unchangedChange;
    };

    constexpr std::array metrics{
        HistoricalResultMetric{
            "Заработано золота",
            &RaidHistoricalAverages::averageTotalLoot,
            &RaidComparisonStats::totalLoot,
            "100 → 200 (+100)",
            "200 → 100 (−100)",
            "100 → 100 (0)"
        },
        HistoricalResultMetric{
            "Завершено рейдов",
            &RaidHistoricalAverages::averageRaidsCompleted,
            &RaidComparisonStats::raidsCompleted,
            "100 → 200 (+100.0)",
            "200 → 100 (−100.0)",
            "100 → 100 (0.0)"
        },
        HistoricalResultMetric{
            "Уничтожено районов",
            &RaidHistoricalAverages::averageEnemyDistrictsDestroyed,
            &RaidComparisonStats::enemyDistrictsDestroyed,
            "100 → 200 (+100.0)",
            "200 → 100 (−100.0)",
            "100 → 100 (0.0)"
        },
        HistoricalResultMetric{
            "Награда за нападение",
            &RaidHistoricalAverages::averageOffensiveReward,
            &RaidComparisonStats::offensiveReward,
            "100 → 200 (+100)",
            "200 → 100 (−100)",
            "100 → 100 (0)"
        },
        HistoricalResultMetric{
            "Награда за оборону",
            &RaidHistoricalAverages::averageDefensiveReward,
            &RaidComparisonStats::defensiveReward,
            "100 → 200 (+100)",
            "200 → 100 (−100)",
            "100 → 100 (0)"
        }
    };

    struct ChangeCase
    {
        double averageValue;
        int currentValue;
        std::string_view direction;
    };

    constexpr std::array changes{
        ChangeCase{100.0, 200, "positive"},
        ChangeCase{100.0, 100, "unchanged"},
        ChangeCase{200.0, 100, "negative"}
    };

    for (const auto& metric : metrics)
    {
        for (const auto& change : changes)
        {
            auto comparisonData = makeFullComparisonData();
            auto historicalAverages = makeHistoricalAverages();
            historicalAverages.*metric.averageMember =
                change.averageValue;
            comparisonData.currentRaid.*metric.currentMember = change.currentValue;

            const auto expectedChange = change.direction == "positive"
                                            ? metric.positiveChange
                                            : change.direction == "negative"
                                            ? metric.negativeChange
                                            : metric.unchangedChange;
            comparisonData.previousRaidsAverage = historicalAverages;

            const auto report = RaidsComparisonFormatter::buildReport(
                comparisonData
            );

            EXPECT_NE(
                report.find(
                    std::string(metric.label) + ":\n"
                    + std::string(expectedChange)
                ),
                std::string::npos
            );
        }
    }
}

TEST(RaidsComparisonFormatterTest, HandlesZeroHistoricalAveragesWithoutInvalidNumbers)
{
    auto comparisonData = makeFullComparisonData();
    auto historicalAverages = makeHistoricalAverages();

    historicalAverages.averageLootPerUsedAttack = 0.0;
    historicalAverages.averageParticipantsWithAllAttacksUsedRate = 0.0;
    historicalAverages.averageParticipantsWithoutAttacksRate = 0.0;
    historicalAverages.averageAttackUsageRate = 0.0;
    historicalAverages.averageActiveParticipants = 0.0;
    historicalAverages.averageEligibleParticipants = 0.0;
    historicalAverages.averageParticipantsWithAllAttacksUsed = 0.0;
    historicalAverages.averageParticipantsWithoutAttacks = 0.0;
    historicalAverages.averageUsedAttacks = 0.0;
    historicalAverages.averageAvailableAttacks = 0.0;
    historicalAverages.averageTotalLoot = 0.0;
    historicalAverages.averageRaidsCompleted = 0.0;
    historicalAverages.averageEnemyDistrictsDestroyed = 0.0;
    historicalAverages.averageOffensiveReward = 0.0;
    historicalAverages.averageDefensiveReward = 0.0;
    comparisonData.previousRaidsAverage = historicalAverages;

    const auto report = RaidsComparisonFormatter::buildReport(comparisonData);

    EXPECT_NE(
        report.find("📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 3 ПРЕДЫДУЩИХ РЕЙДА</b>"),
        std::string::npos
    );
    EXPECT_NE(report.find("0/0 → 96/120"), std::string::npos);
    EXPECT_NE(report.find("0/0 → 20/24"), std::string::npos);
    EXPECT_EQ(report.find("nan"), std::string::npos);
    EXPECT_EQ(report.find("inf"), std::string::npos);
}

TEST(RaidsComparisonFormatterTest, DoesNotProduceNegativeIncompleteParticipantCount)
{
    auto currentRaid = makeCurrentRaid();
    auto previousRaid = makePreviousRaid();

    currentRaid.activeParticipants = 3;
    currentRaid.participantsWithAllAttacksUsed = 5;
    previousRaid.activeParticipants = 3;
    previousRaid.participantsWithAllAttacksUsed = 2;

    const auto report = RaidsComparisonFormatter::buildReport(
        makeComparisonData(currentRaid, previousRaid)
    );

    EXPECT_NE(
        report.find(
            "Использовали не все атаки\n"
            "(среди активных участников):\n"
            "33.3% → 0.0% (−33.3 п.п.; 1/3 → 0/3; ✅ лучше)"
        ),
        std::string::npos
    );
}

TEST(RaidsComparisonFormatterTest, FormatsNegativeResultChangesAndLargeNumbers)
{
    auto currentRaid = makeCurrentRaid();
    auto previousRaid = makePreviousRaid();

    currentRaid.totalLoot = 1'000'000;
    previousRaid.totalLoot = 2'000'000;
    currentRaid.raidsCompleted = 0;
    previousRaid.raidsCompleted = 9;
    currentRaid.enemyDistrictsDestroyed = 0;
    previousRaid.enemyDistrictsDestroyed = 12;
    currentRaid.offensiveReward = 1'500;
    previousRaid.offensiveReward = 2'500;

    const auto report = RaidsComparisonFormatter::buildReport(
        makeComparisonData(currentRaid, previousRaid)
    );

    EXPECT_NE(
        report.find(
            "Заработано золота:\n"
            "2 000 000 → 1 000 000 (−1 000 000)"
        ),
        std::string::npos
    );
    EXPECT_NE(
        report.find(
            "Завершено рейдов:\n"
            "9 → 0 (−9)"
        ),
        std::string::npos
    );
    EXPECT_NE(
        report.find(
            "Награда за нападение:\n"
            "2 500 → 1 500 (−1 000)"
        ),
        std::string::npos
    );
}

TEST(RaidsComparisonFormatterTest, ReportsEveryRaidResultMetricForAllChangeDirections)
{
    struct ResultMetric
    {
        std::string_view label;
        int RaidComparisonStats::*member;
    };

    struct ChangeCase
    {
        int previousValue;
        int currentValue;
        std::string_view expectedChange;
    };

    constexpr std::array metrics{
        ResultMetric{"Заработано золота", &RaidComparisonStats::totalLoot},
        ResultMetric{"Завершено рейдов", &RaidComparisonStats::raidsCompleted},
        ResultMetric{
            "Уничтожено районов",
            &RaidComparisonStats::enemyDistrictsDestroyed
        },
        ResultMetric{
            "Награда за нападение",
            &RaidComparisonStats::offensiveReward
        },
        ResultMetric{
            "Награда за оборону",
            &RaidComparisonStats::defensiveReward
        }
    };

    constexpr std::array changes{
        ChangeCase{100, 200, "100 → 200 (+100)"},
        ChangeCase{200, 100, "200 → 100 (−100)"},
        ChangeCase{100, 100, "100 → 100 (0)"}
    };

    for (const auto& metric : metrics)
    {
        for (const auto& change : changes)
        {
            auto currentRaid = makeCurrentRaid();
            auto previousRaid = makePreviousRaid();
            previousRaid.*metric.member = change.previousValue;
            currentRaid.*metric.member = change.currentValue;

            const auto report = RaidsComparisonFormatter::buildReport(
                makeComparisonData(currentRaid, previousRaid)
            );

            EXPECT_NE(
                report.find(
                    std::string(metric.label) + ":\n"
                    + std::string(change.expectedChange)
                ),
                std::string::npos
            );
        }
    }
}

TEST(RaidsComparisonFormatterTest, FormatsIntegralAndFractionalHistoricalAverages)
{
    auto comparisonData = makeFullComparisonData();
    comparisonData.currentRaid.totalLoot = 1'234'568;
    comparisonData.currentRaid.raidsCompleted = 8;
    comparisonData.currentRaid.enemyDistrictsDestroyed = 10;
    comparisonData.currentRaid.offensiveReward = 2'345;
    comparisonData.currentRaid.defensiveReward = 0;

    auto historicalAverages = makeHistoricalAverages();
    historicalAverages.averageTotalLoot = 1'234'567.0;
    historicalAverages.averageRaidsCompleted = 7.0;
    historicalAverages.averageEnemyDistrictsDestroyed = 9.5;
    historicalAverages.averageOffensiveReward = 1'234.0;
    historicalAverages.averageDefensiveReward = 0.0;
    historicalAverages.averageParticipantsWithAllAttacksUsed = 10.0;
    historicalAverages.averageActiveParticipants = 20.0;
    historicalAverages.averageParticipantsWithoutAttacks = 4.0;
    historicalAverages.averageEligibleParticipants = 24.0;
    historicalAverages.averageParticipantsWithAllAttacksUsedRate = 0.5;
    comparisonData.previousRaidsAverage = historicalAverages;

    const auto report = RaidsComparisonFormatter::buildReport(comparisonData);

    EXPECT_NE(
        report.find(
            "Полностью использовали доступные атаки\n"
            "(среди активных участников):\n"
            "50.0% → 65.0% (+15.0 п.п.; 10/20 → 13/20; ✅ лучше)"
        ),
        std::string::npos
    );
    EXPECT_NE(
        report.find(
            "Заработано золота:\n"
            "1 234 567 → 1 234 568 (+1)"
        ),
        std::string::npos
    );
    EXPECT_NE(
        report.find(
            "Завершено рейдов:\n"
            "7 → 8 (+1)"
        ),
        std::string::npos
    );
    EXPECT_NE(
        report.find(
            "Уничтожено районов:\n"
            "9.5 → 10 (+0.5)"
        ),
        std::string::npos
    );
    EXPECT_NE(
        report.find(
            "Награда за нападение:\n"
            "1 234 → 2 345 (+1 111)"
        ),
        std::string::npos
    );
    EXPECT_NE(
        report.find(
            "Награда за оборону:\n"
            "0 → 0 (0)"
        ),
        std::string::npos
    );
}

TEST(RaidsComparisonFormatterTest, OmitsPerformanceWhenHistoricalAverageIsMissing)
{
    auto comparisonData = makeComparisonData(
        makeCurrentRaid(),
        makePreviousRaid()
    );
    comparisonData.performanceComparison = makePerformance(
        RaidPerformanceTrend::Better
    );

    const auto report = RaidsComparisonFormatter::buildReport(comparisonData);

    EXPECT_EQ(report.find("Динамика "), std::string::npos);
    EXPECT_EQ(report.find("Итог по "), std::string::npos);
}

TEST(RaidsComparisonFormatterTest, OmitsPerformanceWhenPerformanceComparisonIsMissing)
{
    auto comparisonData = makeFullComparisonData();
    comparisonData.performanceComparison.reset();

    const auto report = RaidsComparisonFormatter::buildReport(comparisonData);

    EXPECT_NE(
        report.find("📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 3 ПРЕДЫДУЩИХ РЕЙДА</b>"),
        std::string::npos
    );
    EXPECT_EQ(report.find("Динамика "), std::string::npos);
    EXPECT_EQ(report.find("Итог по "), std::string::npos);
}

TEST(RaidsComparisonFormatterTest, FormatsPerformanceWithZeroCounters)
{
    auto comparisonData = makeFullComparisonData();
    comparisonData.performanceComparison = makePerformance(
        RaidPerformanceTrend::Similar,
        0,
        0,
        3,
        3
    );

    const auto report = RaidsComparisonFormatter::buildReport(comparisonData);

    EXPECT_NE(
        report.find(
            "⚖️ Динамика примерно на уровне среднего за последние 3 рейда\n"
            "\nИтог по 3 основным метрикам:\n"
            "Улучшились: 0 (0.0%)\n"
            "Ухудшились: 0 (0.0%)\n"
            "Без изменений: 3 (100.0%)."
        ),
        std::string::npos
    );
}
