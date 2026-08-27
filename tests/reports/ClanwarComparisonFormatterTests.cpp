#include <gtest/gtest.h>

#include <array>
#include <optional>
#include <string>
#include <string_view>

#include "reports/ClanwarComparisonFormatter.h"

namespace
{
    ClanwarWarStats makeWarStats(
        const ClanwarOutcome result,
        const int homeStars,
        const int opponentStars,
        const double homeDestruction,
        const double opponentDestruction,
        const double averageStarsPerAttack,
        const double averageDestructionPerAttack = -1.0)
    {
        return ClanwarWarStats{
            .homeStars = homeStars,
            .opponentStars = opponentStars,
            .homeDestruction = homeDestruction,
            .opponentDestruction = opponentDestruction,
            .result = result,
            .maxAttacks = 30,
            .attacksUsed = 30,
            .teamSize = 15,
            .totalAttackStars = 0,
            .averageStarsPerAttack = averageStarsPerAttack,
            .averageDestructionPerAttack = averageDestructionPerAttack < 0.0
                                               ? homeDestruction
                                               : averageDestructionPerAttack,
            .disciplineStats = {
                .playersWithoutAttacks = 0,
                .playersWithOneAttack = 0,
                .firstAttacksNotOnMirror = 0
            },
            .homeClanTag = "#HOME",
            .homeClanName = "Aurus",
            .opponentClanTag = "#OPPONENT",
            .opponentClanName = "Rival"
        };
    }

    ClanwarComparisonData makeComparisonData(
        const ClanwarWarStats& currentWar,
        const ClanwarWarStats& previousWar)
    {
        return ClanwarComparisonData{
            .currentWar = currentWar,
            .previousWar = previousWar,
            .previousWarsAverage = std::nullopt,
            .performanceComparison = std::nullopt,
            .recentWarResults = {}
        };
    }
}

TEST(ClanwarComparisonFormatterTest, FormatsWarParticipantsAndSeparators)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_TRUE(
        report.starts_with(
            "📈 <b>ДИНАМИКА ВОЙНЫ</b>\n\n"
            "Последняя война: ✅ Победа 45–42\n"
            "🏠 Наш клан: Aurus (<code>#HOME</code>)\n"
            "⚔️ Соперник: Rival (<code>#OPPONENT</code>)\n\n"
            "Предыдущая война: ❌ Поражение 42–45\n"
            "🏠 Наш клан: Aurus (<code>#HOME</code>)\n"
            "⚔️ Соперник: Rival (<code>#OPPONENT</code>)\n\n"
            "Изменение результата:\n"
            "Поражение → Победа\n"
            "Разница по звёздам: −3 → +3\n\n"
        )
    );
}

TEST(ClanwarComparisonFormatterTest, FormatsAllWarOutcomeTransitions)
{
    struct OutcomeCase
    {
        ClanwarOutcome currentOutcome;
        ClanwarOutcome previousOutcome;
        int currentHomeStars;
        int currentOpponentStars;
        int previousHomeStars;
        int previousOpponentStars;
        std::string_view currentIcon;
        std::string_view currentName;
        std::string_view previousIcon;
        std::string_view previousName;
    };

    constexpr std::array cases{
        OutcomeCase{
            ClanwarOutcome::Victory,
            ClanwarOutcome::Defeat,
            45,
            42,
            42,
            45,
            "✅",
            "Победа",
            "❌",
            "Поражение"
        },
        OutcomeCase{
            ClanwarOutcome::Victory,
            ClanwarOutcome::Victory,
            45,
            42,
            45,
            42,
            "✅",
            "Победа",
            "✅",
            "Победа"
        },
        OutcomeCase{
            ClanwarOutcome::Victory,
            ClanwarOutcome::Draw,
            45,
            42,
            42,
            42,
            "✅",
            "Победа",
            "➖",
            "Ничья"
        },
        OutcomeCase{
            ClanwarOutcome::Defeat,
            ClanwarOutcome::Victory,
            42,
            45,
            45,
            42,
            "❌",
            "Поражение",
            "✅",
            "Победа"
        },
        OutcomeCase{
            ClanwarOutcome::Defeat,
            ClanwarOutcome::Defeat,
            42,
            45,
            42,
            45,
            "❌",
            "Поражение",
            "❌",
            "Поражение"
        },
        OutcomeCase{
            ClanwarOutcome::Defeat,
            ClanwarOutcome::Draw,
            42,
            45,
            42,
            42,
            "❌",
            "Поражение",
            "➖",
            "Ничья"
        },
        OutcomeCase{
            ClanwarOutcome::Draw,
            ClanwarOutcome::Victory,
            42,
            42,
            45,
            42,
            "➖",
            "Ничья",
            "✅",
            "Победа"
        },
        OutcomeCase{
            ClanwarOutcome::Draw,
            ClanwarOutcome::Defeat,
            42,
            42,
            42,
            45,
            "➖",
            "Ничья",
            "❌",
            "Поражение"
        },
        OutcomeCase{
            ClanwarOutcome::Draw,
            ClanwarOutcome::Draw,
            42,
            42,
            42,
            42,
            "➖",
            "Ничья",
            "➖",
            "Ничья"
        }
    };

    for (const auto& testCase : cases)
    {
        const auto currentWar = makeWarStats(
            testCase.currentOutcome,
            testCase.currentHomeStars,
            testCase.currentOpponentStars,
            testCase.currentOutcome == ClanwarOutcome::Victory ? 92.5 :
                testCase.currentOutcome == ClanwarOutcome::Defeat ? 88.75 : 90.0,
            testCase.currentOutcome == ClanwarOutcome::Victory ? 88.75 :
                testCase.currentOutcome == ClanwarOutcome::Defeat ? 92.5 : 90.0,
            2.5
        );
        const auto previousWar = makeWarStats(
            testCase.previousOutcome,
            testCase.previousHomeStars,
            testCase.previousOpponentStars,
            testCase.previousOutcome == ClanwarOutcome::Victory ? 92.5 :
                testCase.previousOutcome == ClanwarOutcome::Defeat ? 88.75 : 90.0,
            testCase.previousOutcome == ClanwarOutcome::Victory ? 88.75 :
                testCase.previousOutcome == ClanwarOutcome::Defeat ? 92.5 : 90.0,
            2.0
        );
        const auto report = ClanwarComparisonFormatter::buildReport(
            makeComparisonData(currentWar, previousWar)
        );

        EXPECT_NE(
            report.find(
                "Последняя война: " + std::string(testCase.currentIcon) + " "
                + std::string(testCase.currentName) + " "
                + std::to_string(testCase.currentHomeStars) + "–"
                + std::to_string(testCase.currentOpponentStars)
            ),
            std::string::npos
        );
        EXPECT_NE(
            report.find(
                "Предыдущая война: " + std::string(testCase.previousIcon) + " "
                + std::string(testCase.previousName) + " "
                + std::to_string(testCase.previousHomeStars) + "–"
                + std::to_string(testCase.previousOpponentStars)
            ),
            std::string::npos
        );
        EXPECT_NE(
            report.find(
                "Изменение результата:\n"
                + std::string(testCase.previousName)
                + " → " + std::string(testCase.currentName) + "\n"
            ),
            std::string::npos
        );
    }
}

TEST(ClanwarComparisonFormatterTest, FormatsZeroStarDifference)
{
    const auto war = makeWarStats(
        ClanwarOutcome::Draw,
        42,
        42,
        90.0,
        90.0,
        2.0
    );
    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(war, war)
    );

    EXPECT_NE(
        report.find("Разница по звёздам: 0 → 0\n\n"),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsImprovedAverageStarsPerAttack)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_NE(
        report.find(
            "📌 Основные метрики:\n"
            "⭐ Средние звёзды за атаку:\n"
            "2.00 → 2.50 (+0.50; ✅ лучше)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsWorsenedAverageStarsPerAttack)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Defeat,
        40,
        42,
        85.0,
        90.0,
        1.75
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.0
    );

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_NE(
        report.find(
            "📌 Основные метрики:\n"
            "⭐ Средние звёзды за атаку:\n"
            "2.00 → 1.75 (−0.25; ⚠️ хуже)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsUnchangedAverageStarsPerAttack)
{
    const auto war = makeWarStats(
        ClanwarOutcome::Draw,
        42,
        42,
        90.0,
        90.0,
        2.0
    );

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(war, war)
    );

    EXPECT_NE(
        report.find(
            "📌 Основные метрики:\n"
            "⭐ Средние звёзды за атаку:\n"
            "2.00 → 2.00 (0.00; ➖ без изменений)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsImprovedDestruction)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_NE(
        report.find(
            "💥 Среднее разрушение за атаку:\n"
            "88.75% → 92.50% (+3.75 п.п.; ✅ лучше)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsWorsenedDestruction)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Defeat,
        40,
        42,
        85.0,
        90.0,
        1.75
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.0
    );

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_NE(
        report.find(
            "💥 Среднее разрушение за атаку:\n"
            "92.50% → 85.00% (−7.50 п.п.; ⚠️ хуже)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsUnchangedDestruction)
{
    const auto war = makeWarStats(
        ClanwarOutcome::Draw,
        42,
        42,
        90.0,
        90.0,
        2.0
    );

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(war, war)
    );

    EXPECT_NE(
        report.find(
            "💥 Среднее разрушение за атаку:\n"
            "90.00% → 90.00% (0.00 п.п.; ➖ без изменений)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, UsesAverageDestructionPerAttack)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        99.0,
        88.75,
        2.5,
        85.0
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        1.0,
        92.5,
        2.0,
        80.0
    );

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_NE(
        report.find(
            "💥 Среднее разрушение за атаку:\n"
            "80.00% → 85.00% (+5.00 п.п.; ✅ лучше)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsImprovedDiscipline)
{
    auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    currentWar.disciplineStats = {
        .playersWithoutAttacks = 1,
        .playersWithOneAttack = 0,
        .firstAttacksNotOnMirror = 1
    };
    previousWar.disciplineStats = {
        .playersWithoutAttacks = 3,
        .playersWithOneAttack = 0,
        .firstAttacksNotOnMirror = 2
    };

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_NE(
        report.find(
            "🎯 Дисциплина:\n"
            "Без атак: 20.0% → 6.7% (−13.33 п.п.; 3 → 1; ✅ лучше)\n"
            "Атаки не по зеркалу: 16.7% → 7.1% (−9.52 п.п.; 2 → 1; ✅ лучше)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsWorsenedDiscipline)
{
    auto currentWar = makeWarStats(
        ClanwarOutcome::Defeat,
        40,
        42,
        85.0,
        90.0,
        1.75
    );
    auto previousWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.0
    );

    currentWar.disciplineStats = {
        .playersWithoutAttacks = 3,
        .playersWithOneAttack = 0,
        .firstAttacksNotOnMirror = 2
    };
    previousWar.disciplineStats = {
        .playersWithoutAttacks = 1,
        .playersWithOneAttack = 0,
        .firstAttacksNotOnMirror = 1
    };

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_NE(
        report.find(
            "🎯 Дисциплина:\n"
            "Без атак: 6.7% → 20.0% (+13.33 п.п.; 1 → 3; ⚠️ хуже)\n"
            "Атаки не по зеркалу: 7.1% → 16.7% (+9.52 п.п.; 1 → 2; ⚠️ хуже)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsUnchangedDiscipline)
{
    auto war = makeWarStats(
        ClanwarOutcome::Draw,
        42,
        42,
        90.0,
        90.0,
        2.0
    );
    war.disciplineStats = {
        .playersWithoutAttacks = 2,
        .playersWithOneAttack = 0,
        .firstAttacksNotOnMirror = 1
    };

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(war, war)
    );

    EXPECT_NE(
        report.find(
            "🎯 Дисциплина:\n"
            "Без атак: 13.3% → 13.3% (0.00 п.п.; 2 → 2; ➖ без изменений)\n"
            "Атаки не по зеркалу: 7.7% → 7.7% (0.00 п.п.; 1 → 1; ➖ без изменений)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsDisciplineAsRatesForDifferentTeamSizes)
{
    auto previousWar = makeWarStats(
        ClanwarOutcome::Draw,
        42,
        42,
        90.0,
        90.0,
        2.0
    );
    previousWar.teamSize = 10;
    previousWar.maxAttacks = 20;
    previousWar.attacksUsed = 20;
    previousWar.disciplineStats = {
        .playersWithoutAttacks = 2,
        .playersWithOneAttack = 0,
        .firstAttacksNotOnMirror = 2
    };

    auto currentWar = makeWarStats(
        ClanwarOutcome::Draw,
        42,
        42,
        90.0,
        90.0,
        2.0
    );
    currentWar.teamSize = 20;
    currentWar.maxAttacks = 40;
    currentWar.attacksUsed = 40;
    currentWar.disciplineStats = {
        .playersWithoutAttacks = 4,
        .playersWithOneAttack = 0,
        .firstAttacksNotOnMirror = 4
    };

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_NE(
        report.find(
            "🎯 Дисциплина:\n"
            "Без атак: 20.0% → 20.0% (0.00 п.п.; 2 → 4; ➖ без изменений)\n"
            "Атаки не по зеркалу: 25.0% → 25.0% (0.00 п.п.; 2 → 4; ➖ без изменений)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsImprovedAttackUsage)
{
    auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    previousWar.attacksUsed = 24;
    currentWar.attacksUsed = 27;

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_NE(
        report.find(
            "⚔️ Активность (не входит в итоговую оценку):\n"
            "Использование атак:\n"
            "80.0% → 90.0% (+10.00 п.п.; 24/30 → 27/30; ✅ лучше)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsWorsenedAttackUsage)
{
    auto currentWar = makeWarStats(
        ClanwarOutcome::Defeat,
        40,
        42,
        85.0,
        90.0,
        1.75
    );
    auto previousWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.0
    );

    previousWar.attacksUsed = 27;
    currentWar.attacksUsed = 24;

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_NE(
        report.find(
            "⚔️ Активность (не входит в итоговую оценку):\n"
            "Использование атак:\n"
            "90.0% → 80.0% (−10.00 п.п.; 27/30 → 24/30; ⚠️ хуже)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsUnchangedAttackUsage)
{
    auto war = makeWarStats(
        ClanwarOutcome::Draw,
        42,
        42,
        90.0,
        90.0,
        2.0
    );
    war.attacksUsed = 24;

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(war, war)
    );

    EXPECT_NE(
        report.find(
            "⚔️ Активность (не входит в итоговую оценку):\n"
            "Использование атак:\n"
            "80.0% → 80.0% (0.00 п.п.; 24/30 → 24/30; ➖ без изменений)\n"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsImprovedAttackActivity)
{
    auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    previousWar.attacksUsed = 24;
    currentWar.attacksUsed = 27;
    previousWar.disciplineStats.playersWithOneAttack = 3;
    currentWar.disciplineStats.playersWithOneAttack = 1;

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_NE(
        report.find(
            "Пропущенные атаки:\n"
            "20.0% → 10.0% (−10.00 п.п.; 6 → 3; ✅ лучше)\n"
            "Ровно одна атака: 20.0% → 6.7% (−13.33 п.п.; 3 → 1)"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsWorsenedAttackActivity)
{
    auto currentWar = makeWarStats(
        ClanwarOutcome::Defeat,
        40,
        42,
        85.0,
        90.0,
        1.75
    );
    auto previousWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.0
    );

    previousWar.attacksUsed = 27;
    currentWar.attacksUsed = 24;
    previousWar.disciplineStats.playersWithOneAttack = 1;
    currentWar.disciplineStats.playersWithOneAttack = 3;

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_NE(
        report.find(
            "Пропущенные атаки:\n"
            "10.0% → 20.0% (+10.00 п.п.; 3 → 6; ⚠️ хуже)\n"
            "Ровно одна атака: 6.7% → 20.0% (+13.33 п.п.; 1 → 3)"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsUnchangedAttackActivity)
{
    auto war = makeWarStats(
        ClanwarOutcome::Draw,
        42,
        42,
        90.0,
        90.0,
        2.0
    );
    war.attacksUsed = 24;
    war.disciplineStats.playersWithOneAttack = 2;

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(war, war)
    );

    EXPECT_NE(
        report.find(
            "Пропущенные атаки:\n"
            "20.0% → 20.0% (0.00 п.п.; 6 → 6; ➖ без изменений)\n"
            "Ровно одна атака: 13.3% → 13.3% (0.00 п.п.; 2 → 2)"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsActivityAsRatesForDifferentTeamSizes)
{
    auto previousWar = makeWarStats(
        ClanwarOutcome::Draw,
        42,
        42,
        90.0,
        90.0,
        2.0
    );
    previousWar.teamSize = 10;
    previousWar.maxAttacks = 20;
    previousWar.attacksUsed = 10;
    previousWar.disciplineStats.playersWithOneAttack = 2;

    auto currentWar = makeWarStats(
        ClanwarOutcome::Draw,
        42,
        42,
        90.0,
        90.0,
        2.0
    );
    currentWar.teamSize = 20;
    currentWar.maxAttacks = 40;
    currentWar.attacksUsed = 20;
    currentWar.disciplineStats.playersWithOneAttack = 4;

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_NE(
        report.find(
            "⚔️ Активность (не входит в итоговую оценку):\n"
            "Использование атак:\n"
            "50.0% → 50.0% (0.00 п.п.; 10/20 → 20/40; ➖ без изменений)\n"
            "Пропущенные атаки:\n"
            "50.0% → 50.0% (0.00 п.п.; 10 → 20; ➖ без изменений)\n"
            "Ровно одна атака: 20.0% → 20.0% (0.00 п.п.; 2 → 4)"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsRecentWarResultsInOrder)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );
    auto comparisonData = makeComparisonData(currentWar, previousWar);
    comparisonData.recentWarResults = {
        ClanwarOutcome::Defeat,
        ClanwarOutcome::Draw,
        ClanwarOutcome::Victory,
        ClanwarOutcome::Defeat,
        ClanwarOutcome::Victory
    };

    const auto report = ClanwarComparisonFormatter::buildReport(comparisonData);

    EXPECT_NE(
        report.find(
            "Последние 5 войн:\n"
            "❌ ➖ ✅ ❌ ✅ "
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, FormatsRecentWarCountWithCorrectDeclension)
{
    struct RecentWarsCase
    {
        int count;
        std::string_view expectedLabel;
    };

    constexpr std::array cases{
        RecentWarsCase{1, "Последняя война:\n"},
        RecentWarsCase{2, "Последние 2 войны:\n"},
        RecentWarsCase{4, "Последние 4 войны:\n"},
        RecentWarsCase{5, "Последние 5 войн:\n"},
        RecentWarsCase{11, "Последние 11 войн:\n"},
        RecentWarsCase{21, "Последние 21 война:\n"}
    };

    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    for (const auto& testCase : cases)
    {
        auto comparisonData = makeComparisonData(currentWar, previousWar);
        constexpr std::array outcomes{
            ClanwarOutcome::Defeat,
            ClanwarOutcome::Draw,
            ClanwarOutcome::Victory
        };
        comparisonData.recentWarResults.reserve(testCase.count);
        for (int index = 0; index < testCase.count; ++index)
        {
            comparisonData.recentWarResults.push_back(
                outcomes[index % outcomes.size()]
            );
        }

        const auto report = ClanwarComparisonFormatter::buildReport(
            comparisonData
        );

        EXPECT_NE(
            report.find(testCase.expectedLabel),
            std::string::npos
        ) << "Unexpected label for " << testCase.count << " recent wars";
    }
}

TEST(ClanwarComparisonFormatterTest, OmitsRecentWarResultsWhenEmpty)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_EQ(report.find("Последние "), std::string::npos);
}

TEST(ClanwarComparisonFormatterTest, OmitsHistoricalAveragesWhenMissing)
{
    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_EQ(
        report.find("📉 <b>СРАВНЕНИЕ СО СРЕДНИМ"),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsHistoricalAveragesAndCurrentActivity)
{
    auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    currentWar.attacksUsed = 27;
    currentWar.disciplineStats = {
        .playersWithoutAttacks = 1,
        .playersWithOneAttack = 3,
        .firstAttacksNotOnMirror = 1
    };

    auto comparisonData = makeComparisonData(currentWar, previousWar);
    comparisonData.previousWarsAverage = ClanwarHistoricalAverages{
        .warsCount = 3,
        .averageStarsPerAttack = 2.25,
        .averageDestructionPerAttack = 88.5,
        .averageAttacksUsed = 16.0,
        .averageMaxAttacks = 20.0,
        .averageMissedAttacks = 4.0,
        .averagePlayersWithoutAttacks = 2.0,
        .averagePlayersWithOneAttack = 1.0,
        .averageFirstAttacksNotOnMirror = 3.0,
        .averageMissedAttacksRate = 0.2,
        .averagePlayersWithoutAttacksRate = 0.2,
        .averagePlayersWithOneAttackRate = 0.1,
        .averageFirstAttacksNotOnMirrorRate = 0.15
    };

    const auto report = ClanwarComparisonFormatter::buildReport(comparisonData);

    EXPECT_NE(
        report.find(
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 3 ПРЕДЫДУЩИЕ ВОЙНЫ</b>\n"
            "Изменение указано в процентных пунктах (п.п.).\n"
            "\n📌 Основные метрики:\n"
            "⭐ Средние звёзды за атаку:\n"
            "2.25 → 2.50 (+0.25; ✅ лучше)\n"
            "💥 Среднее разрушение за атаку:\n"
            "88.50% → 92.50% (+4.00 п.п.; ✅ лучше)\n"
            "🎯 Дисциплина:\n"
            "Без атак: 20.0% → 6.7% (−13.33 п.п.; 2.0 → 1; ✅ лучше)\n"
            "Атаки не по зеркалу: 15.0% → 7.1% (−7.86 п.п.; 3.0 → 1; ✅ лучше)\n"
            "\n📈 Активность (не входит в итоговую оценку):\n"
            "Использование атак:\n"
            "80.0% → 90.0% (+10.00 п.п.; 16.0/20.0 → 27/30; ✅ лучше)\n"
            "Пропущенные атаки:\n"
            "20.0% → 10.0% (−10.00 п.п.; 4.0 → 3; ✅ лучше)\n"
            "Ровно одна атака: 10.0% → 20.0% (+10.00 п.п.; 1.0 → 3)"
        ),
        std::string::npos
    );
    EXPECT_EQ(report.find("Пропущенные атаки (доля)"), std::string::npos);
    EXPECT_EQ(report.find(" сейчас"), std::string::npos);
}

TEST(ClanwarComparisonFormatterTest, ReportsWorsenedHistoricalMetrics)
{
    auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.0,
        80.0
    );
    currentWar.attacksUsed = 24;
    currentWar.disciplineStats = {
        .playersWithoutAttacks = 3,
        .playersWithOneAttack = 0,
        .firstAttacksNotOnMirror = 2
    };

    const auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.5
    );

    auto comparisonData = makeComparisonData(currentWar, previousWar);
    comparisonData.previousWarsAverage = ClanwarHistoricalAverages{
        .warsCount = 3,
        .averageStarsPerAttack = 2.5,
        .averageDestructionPerAttack = 85.0,
        .averageAttacksUsed = 24.0,
        .averageMaxAttacks = 30.0,
        .averageMissedAttacks = 6.0,
        .averagePlayersWithoutAttacks = 1.0,
        .averagePlayersWithOneAttack = 0.0,
        .averageFirstAttacksNotOnMirror = 1.0,
        .averageMissedAttacksRate = 0.2,
        .averagePlayersWithoutAttacksRate = 0.1,
        .averagePlayersWithOneAttackRate = 0.0,
        .averageFirstAttacksNotOnMirrorRate = 0.1
    };

    const auto report = ClanwarComparisonFormatter::buildReport(comparisonData);

    EXPECT_NE(
        report.find(
            "2.50 → 2.00 (−0.50; ⚠️ хуже)\n"
            "💥 Среднее разрушение за атаку:\n"
            "85.00% → 80.00% (−5.00 п.п.; ⚠️ хуже)\n"
            "🎯 Дисциплина:\n"
            "Без атак: 10.0% → 20.0% (+10.00 п.п.; 1.0 → 3; ⚠️ хуже)\n"
            "Атаки не по зеркалу: 10.0% → 16.7% (+6.67 п.п.; 1.0 → 2; ⚠️ хуже)"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsUnchangedHistoricalMetrics)
{
    auto currentWar = makeWarStats(
        ClanwarOutcome::Draw,
        42,
        42,
        90.0,
        90.0,
        2.5,
        90.0
    );
    currentWar.disciplineStats = {
        .playersWithoutAttacks = 0,
        .playersWithOneAttack = 0,
        .firstAttacksNotOnMirror = 0
    };

    const auto previousWar = makeWarStats(
        ClanwarOutcome::Victory,
        42,
        40,
        90.0,
        88.0,
        2.0
    );

    auto comparisonData = makeComparisonData(currentWar, previousWar);
    comparisonData.previousWarsAverage = ClanwarHistoricalAverages{
        .warsCount = 3,
        .averageStarsPerAttack = 2.5,
        .averageDestructionPerAttack = 90.0,
        .averageAttacksUsed = 30.0,
        .averageMaxAttacks = 30.0,
        .averageMissedAttacks = 0.0,
        .averagePlayersWithoutAttacks = 0.0,
        .averagePlayersWithOneAttack = 0.0,
        .averageFirstAttacksNotOnMirror = 0.0,
        .averageMissedAttacksRate = 0.0,
        .averagePlayersWithoutAttacksRate = 0.0,
        .averagePlayersWithOneAttackRate = 0.0,
        .averageFirstAttacksNotOnMirrorRate = 0.0
    };

    const auto report = ClanwarComparisonFormatter::buildReport(comparisonData);

    EXPECT_NE(
        report.find(
            "2.50 → 2.50 (0.00; ➖ без изменений)\n"
            "💥 Среднее разрушение за атаку:\n"
            "90.00% → 90.00% (0.00 п.п.; ➖ без изменений)\n"
            "🎯 Дисциплина:\n"
            "Без атак: 0.0% → 0.0% (0.00 п.п.; 0.0 → 0; ➖ без изменений)\n"
            "Атаки не по зеркалу: 0.0% → 0.0% (0.00 п.п.; 0.0 → 0; ➖ без изменений)"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsWorsenedHistoricalActivity)
{
    auto currentWar = makeWarStats(
        ClanwarOutcome::Draw,
        42,
        42,
        90.0,
        90.0,
        2.5,
        90.0
    );
    currentWar.attacksUsed = 15;

    const auto previousWar = makeWarStats(
        ClanwarOutcome::Victory,
        42,
        40,
        90.0,
        88.0,
        2.0
    );

    auto comparisonData = makeComparisonData(currentWar, previousWar);
    comparisonData.previousWarsAverage = ClanwarHistoricalAverages{
        .warsCount = 3,
        .averageStarsPerAttack = 2.5,
        .averageDestructionPerAttack = 90.0,
        .averageAttacksUsed = 24.0,
        .averageMaxAttacks = 30.0,
        .averageMissedAttacks = 6.0,
        .averagePlayersWithoutAttacks = 0.0,
        .averagePlayersWithOneAttack = 0.0,
        .averageFirstAttacksNotOnMirror = 0.0,
        .averageMissedAttacksRate = 0.2,
        .averagePlayersWithoutAttacksRate = 0.0,
        .averagePlayersWithOneAttackRate = 0.0,
        .averageFirstAttacksNotOnMirrorRate = 0.0
    };

    const auto report = ClanwarComparisonFormatter::buildReport(comparisonData);

    EXPECT_NE(
        report.find(
            "Использование атак:\n"
            "80.0% → 50.0% (−30.00 п.п.; 24.0/30.0 → 15/30; ⚠️ хуже)\n"
            "Пропущенные атаки:\n"
            "20.0% → 50.0% (+30.00 п.п.; 6.0 → 15; ⚠️ хуже)"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsUnchangedHistoricalActivity)
{
    auto currentWar = makeWarStats(
        ClanwarOutcome::Draw,
        42,
        42,
        90.0,
        90.0,
        2.5,
        90.0
    );
    currentWar.attacksUsed = 24;

    const auto previousWar = makeWarStats(
        ClanwarOutcome::Victory,
        42,
        40,
        90.0,
        88.0,
        2.0
    );

    auto comparisonData = makeComparisonData(currentWar, previousWar);
    comparisonData.previousWarsAverage = ClanwarHistoricalAverages{
        .warsCount = 3,
        .averageStarsPerAttack = 2.5,
        .averageDestructionPerAttack = 90.0,
        .averageAttacksUsed = 24.0,
        .averageMaxAttacks = 30.0,
        .averageMissedAttacks = 6.0,
        .averagePlayersWithoutAttacks = 0.0,
        .averagePlayersWithOneAttack = 0.0,
        .averageFirstAttacksNotOnMirror = 0.0,
        .averageMissedAttacksRate = 0.2,
        .averagePlayersWithoutAttacksRate = 0.0,
        .averagePlayersWithOneAttackRate = 0.0,
        .averageFirstAttacksNotOnMirrorRate = 0.0
    };

    const auto report = ClanwarComparisonFormatter::buildReport(comparisonData);

    EXPECT_NE(
        report.find(
            "Использование атак:\n"
            "80.0% → 80.0% (0.00 п.п.; 24.0/30.0 → 24/30; ➖ без изменений)\n"
            "Пропущенные атаки:\n"
            "20.0% → 20.0% (0.00 п.п.; 6.0 → 6; ➖ без изменений)"
        ),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, FormatsHistoricalAverageCountWithCorrectDeclension)
{
    struct HistoricalAverageCase
    {
        int count;
        std::string_view expectedLabel;
    };

    constexpr std::array cases{
        HistoricalAverageCase{
            1,
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 1 ПРЕДЫДУЩУЮ ВОЙНУ</b>\n"
        },
        HistoricalAverageCase{
            2,
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 2 ПРЕДЫДУЩИЕ ВОЙНЫ</b>\n"
        },
        HistoricalAverageCase{
            4,
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 4 ПРЕДЫДУЩИЕ ВОЙНЫ</b>\n"
        },
        HistoricalAverageCase{
            5,
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 5 ПРЕДЫДУЩИХ ВОЙН</b>\n"
        },
        HistoricalAverageCase{
            11,
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 11 ПРЕДЫДУЩИХ ВОЙН</b>\n"
        },
        HistoricalAverageCase{
            21,
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА 21 ПРЕДЫДУЩУЮ ВОЙНУ</b>\n"
        }
    };

    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    for (const auto& testCase : cases)
    {
        auto comparisonData = makeComparisonData(currentWar, previousWar);
        comparisonData.previousWarsAverage = ClanwarHistoricalAverages{
            .warsCount = testCase.count,
            .averageStarsPerAttack = 0.0,
            .averageDestructionPerAttack = 0.0,
            .averageMissedAttacks = 0.0,
            .averagePlayersWithoutAttacks = 0.0,
            .averagePlayersWithOneAttack = 0.0,
            .averageFirstAttacksNotOnMirror = 0.0,
            .averageMissedAttacksRate = 0.0,
            .averagePlayersWithoutAttacksRate = 0.0,
            .averagePlayersWithOneAttackRate = 0.0,
            .averageFirstAttacksNotOnMirrorRate = 0.0
        };

        const auto report = ClanwarComparisonFormatter::buildReport(
            comparisonData
        );

        EXPECT_NE(
            report.find(testCase.expectedLabel),
            std::string::npos
        ) << "Unexpected label for " << testCase.count
          << " historical wars";
    }
}

TEST(ClanwarComparisonFormatterTest, OmitsPerformanceComparisonWhenHistoricalAverageIsMissing)
{
    auto comparisonData = makeComparisonData(
        makeWarStats(
            ClanwarOutcome::Victory,
            45,
            42,
            92.5,
            88.75,
            2.5
        ),
        makeWarStats(
            ClanwarOutcome::Defeat,
            42,
            45,
            88.75,
            92.5,
            2.0
        )
    );
    comparisonData.performanceComparison = ClanwarPerformanceComparison{
        .trend = ClanwarPerformanceTrend::Better,
        .improvedMetrics = 2,
        .worsenedMetrics = 1,
        .unchangedMetrics = 1,
        .totalMetrics = 4,
        .improvedMetricsRate = 0.5,
        .worsenedMetricsRate = 0.25,
        .unchangedMetricsRate = 0.25
    };

    const auto report = ClanwarComparisonFormatter::buildReport(comparisonData);

    EXPECT_EQ(
        report.find("Результат лучше среднего"),
        std::string::npos
    );
}

TEST(ClanwarComparisonFormatterTest, ReportsAllPerformanceTrends)
{
    struct PerformanceCase
    {
        ClanwarPerformanceTrend trend;
        std::string_view expectedTrend;
    };

    constexpr std::array cases{
        PerformanceCase{
            ClanwarPerformanceTrend::Better,
            "✅ Результат лучше среднего за последние 3 войны\n"
        },
        PerformanceCase{
            ClanwarPerformanceTrend::Worse,
            "⚠️ Результат хуже среднего за последние 3 войны\n"
        },
        PerformanceCase{
            ClanwarPerformanceTrend::Similar,
            "⚖️ Результат примерно на уровне среднего за последние 3 войны\n"
        }
    };

    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    for (const auto& testCase : cases)
    {
        auto comparisonData = makeComparisonData(currentWar, previousWar);
        comparisonData.previousWarsAverage = ClanwarHistoricalAverages{
            .warsCount = 3,
            .averageStarsPerAttack = 0.0,
            .averageDestructionPerAttack = 0.0,
            .averageMissedAttacks = 0.0,
            .averagePlayersWithoutAttacks = 0.0,
            .averagePlayersWithOneAttack = 0.0,
            .averageFirstAttacksNotOnMirror = 0.0,
            .averageMissedAttacksRate = 0.0,
            .averagePlayersWithoutAttacksRate = 0.0,
            .averagePlayersWithOneAttackRate = 0.0,
            .averageFirstAttacksNotOnMirrorRate = 0.0
        };
        comparisonData.performanceComparison = ClanwarPerformanceComparison{
            .trend = testCase.trend,
            .improvedMetrics = 2,
            .worsenedMetrics = 1,
            .unchangedMetrics = 1,
            .totalMetrics = 4,
            .improvedMetricsRate = 0.5,
            .worsenedMetricsRate = 0.25,
            .unchangedMetricsRate = 0.25
        };

        const auto report = ClanwarComparisonFormatter::buildReport(
            comparisonData
        );

        EXPECT_NE(
            report.find(
                std::string(testCase.expectedTrend)
                + "Итог по 4 метрикам: улучшились 2 (50.0%), "
                "ухудшились 1 (25.0%), без изменений 1 (25.0%)."
            ),
            std::string::npos
        );
    }
}

TEST(ClanwarComparisonFormatterTest, FormatsPerformanceComparisonPeriod)
{
    struct PeriodCase
    {
        int warsCount;
        std::string_view expectedPeriod;
    };

    constexpr std::array cases{
        PeriodCase{1, "за последнюю войну"},
        PeriodCase{2, "за последние 2 войны"},
        PeriodCase{3, "за последние 3 войны"},
        PeriodCase{5, "за последние 5 войн"},
        PeriodCase{11, "за последние 11 войн"}
    };

    const auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    const auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    for (const auto& testCase : cases)
    {
        auto comparisonData = makeComparisonData(currentWar, previousWar);
        comparisonData.previousWarsAverage = ClanwarHistoricalAverages{
            .warsCount = testCase.warsCount,
            .averageStarsPerAttack = 0.0,
            .averageDestructionPerAttack = 0.0,
            .averageMissedAttacks = 0.0,
            .averagePlayersWithoutAttacks = 0.0,
            .averagePlayersWithOneAttack = 0.0,
            .averageFirstAttacksNotOnMirror = 0.0,
            .averageMissedAttacksRate = 0.0,
            .averagePlayersWithoutAttacksRate = 0.0,
            .averagePlayersWithOneAttackRate = 0.0,
            .averageFirstAttacksNotOnMirrorRate = 0.0
        };
        comparisonData.performanceComparison = ClanwarPerformanceComparison{
            .trend = ClanwarPerformanceTrend::Better,
            .improvedMetrics = 1,
            .worsenedMetrics = 0,
            .unchangedMetrics = 3,
            .totalMetrics = 4,
            .improvedMetricsRate = 0.25,
            .worsenedMetricsRate = 0.0,
            .unchangedMetricsRate = 0.75
        };

        const auto report = ClanwarComparisonFormatter::buildReport(
            comparisonData
        );

        EXPECT_NE(
            report.find(
                "✅ Результат лучше среднего "
                + std::string(testCase.expectedPeriod) + "\n"
            ),
            std::string::npos
        );
    }
}

TEST(ClanwarComparisonFormatterTest, RemovesTrailingNewlinesFromReport)
{
    auto comparisonData = makeComparisonData(
        makeWarStats(
            ClanwarOutcome::Victory,
            45,
            42,
            92.5,
            88.75,
            2.5
        ),
        makeWarStats(
            ClanwarOutcome::Defeat,
            42,
            45,
            88.75,
            92.5,
            2.0
        )
    );
    comparisonData.previousWarsAverage = ClanwarHistoricalAverages{
        .warsCount = 3,
        .averageStarsPerAttack = 0.0,
        .averageDestructionPerAttack = 0.0,
        .averageMissedAttacks = 0.0,
        .averagePlayersWithoutAttacks = 0.0,
        .averagePlayersWithOneAttack = 0.0,
        .averageFirstAttacksNotOnMirror = 0.0,
        .averageMissedAttacksRate = 0.0,
        .averagePlayersWithoutAttacksRate = 0.0,
        .averagePlayersWithOneAttackRate = 0.0,
        .averageFirstAttacksNotOnMirrorRate = 0.0
    };
    comparisonData.performanceComparison = ClanwarPerformanceComparison{
        .trend = ClanwarPerformanceTrend::Similar,
        .improvedMetrics = 1,
        .worsenedMetrics = 1,
        .unchangedMetrics = 2,
        .totalMetrics = 4,
        .improvedMetricsRate = 0.25,
        .worsenedMetricsRate = 0.25,
        .unchangedMetricsRate = 0.5
    };

    const auto report = ClanwarComparisonFormatter::buildReport(comparisonData);

    EXPECT_FALSE(report.ends_with("\n"));
}

TEST(ClanwarComparisonFormatterTest, EscapesWarParticipantFields)
{
    auto currentWar = makeWarStats(
        ClanwarOutcome::Victory,
        45,
        42,
        92.5,
        88.75,
        2.5
    );
    auto previousWar = makeWarStats(
        ClanwarOutcome::Defeat,
        42,
        45,
        88.75,
        92.5,
        2.0
    );

    currentWar.homeClanTag = "#<HOME&>";
    currentWar.homeClanName = "<Aurus&>";
    currentWar.opponentClanTag = "#<OPPONENT&>";
    currentWar.opponentClanName = "<Rival&>";
    previousWar.homeClanTag = "#<PREVIOUS_HOME&>";
    previousWar.homeClanName = "<Previous Aurus&>";
    previousWar.opponentClanTag = "#<PREVIOUS_OPPONENT&>";
    previousWar.opponentClanName = "<Previous Rival&>";

    const auto report = ClanwarComparisonFormatter::buildReport(
        makeComparisonData(currentWar, previousWar)
    );

    EXPECT_TRUE(
        report.starts_with(
            "📈 <b>ДИНАМИКА ВОЙНЫ</b>\n\n"
            "Последняя война: ✅ Победа 45–42\n"
            "🏠 Наш клан: &lt;Aurus&amp;&gt; "
            "(<code>#&lt;HOME&amp;&gt;</code>)\n"
            "⚔️ Соперник: &lt;Rival&amp;&gt; "
            "(<code>#&lt;OPPONENT&amp;&gt;</code>)\n\n"
            "Предыдущая война: ❌ Поражение 42–45\n"
            "🏠 Наш клан: &lt;Previous Aurus&amp;&gt; "
            "(<code>#&lt;PREVIOUS_HOME&amp;&gt;</code>)\n"
            "⚔️ Соперник: &lt;Previous Rival&amp;&gt; "
            "(<code>#&lt;PREVIOUS_OPPONENT&amp;&gt;</code>)\n\n"
        )
    );

    EXPECT_NE(
        report.find(
            "Изменение результата:\n"
            "Поражение → Победа\n"
            "Разница по звёздам: −3 → +3\n"
        ),
        std::string::npos
    );
}
