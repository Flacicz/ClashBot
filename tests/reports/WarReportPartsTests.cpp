#include <gtest/gtest.h>

#include <sstream>
#include <vector>

#include "reports/WarReportParts.h"

TEST(WarReportPartsTest, AppendsNoAttackPlayersWithAttackLimit)
{
    const std::vector<ClanwarSlacker> players{
        {"#PLAYER1", "Flacicz"},
        {"#PLAYER2", "ТУРАН"}
    };
    std::ostringstream report;

    war_report::appendNoAttackPlayers(
        report,
        players,
        "Пропустили атаку в ЛВК",
        true
    );

    EXPECT_EQ(
        report.str(),
        "\n🔴 <b>Пропустили атаку в ЛВК:</b>\n"
        "• Flacicz [0/1]\n"
        "• ТУРАН [0/1]\n"
    );
}

TEST(WarReportPartsTest, AppendsNoAttackPlayersWithoutAttackLimit)
{
    const std::vector<ClanwarSlacker> players{
        {"#PLAYER1", "Flacicz"}
    };
    std::ostringstream report;

    war_report::appendNoAttackPlayers(
        report,
        players,
        "Не сделали ни одной атаки",
        false
    );

    EXPECT_EQ(
        report.str(),
        "\n🔴 <b>Не сделали ни одной атаки:</b>\n"
        "• Flacicz\n"
    );
}

TEST(WarReportPartsTest, AppendsOneAttackPlayers)
{
    const std::vector<ClanwarSlacker> players{
        {"#PLAYER1", "Flacicz"},
        {"#PLAYER2", "Alex"}
    };
    std::ostringstream report;

    war_report::appendOneAttackPlayers(report, players);

    EXPECT_EQ(
        report.str(),
        "\n🟡 <b>Сделали только одну атаку:</b>\n"
        "• Flacicz\n"
        "• Alex\n"
    );
}

TEST(WarReportPartsTest, AppendsNotMirrorAttacks)
{
    const std::vector<NotMirrorAttack> attacks{
        {"#PLAYER1", "Flacicz", 5, 3},
        {"#PLAYER2", "Alex", 2, 7}
    };
    std::ostringstream report;

    war_report::appendNotMirrorAttacks(report, attacks);

    EXPECT_EQ(
        report.str(),
        "\n🎯 <b>Атаки не по зеркалу:</b>\n"
        "• Flacicz (№5 ➜ №3)\n"
        "• Alex (№2 ➜ №7)\n"
    );
}

TEST(WarReportPartsTest, EmptyCollectionsLeaveReportUnchanged)
{
    std::ostringstream report;
    report << "prefix";

    war_report::appendNoAttackPlayers(report, {}, "Не используется", true);
    war_report::appendOneAttackPlayers(report, {});
    war_report::appendNotMirrorAttacks(report, {});

    EXPECT_EQ(report.str(), "prefix");
}

TEST(WarReportPartsTest, EscapesPlayerNamesInAllViolationParts)
{
    const std::vector<ClanwarSlacker> missedAttacks{
        {"#PLAYER1", "<ТУРАН&>"}
    };
    const std::vector<ClanwarSlacker> oneAttackPlayers{
        {"#PLAYER2", "Alex <&>"}
    };
    const std::vector<NotMirrorAttack> notMirrorAttacks{
        {"#PLAYER3", "Flacicz > &", 3, 5}
    };
    std::ostringstream report;

    war_report::appendNoAttackPlayers(
        report,
        missedAttacks,
        "Пропустили атаку в ЛВК",
        true
    );
    war_report::appendOneAttackPlayers(report, oneAttackPlayers);
    war_report::appendNotMirrorAttacks(report, notMirrorAttacks);

    EXPECT_EQ(
        report.str(),
        "\n🔴 <b>Пропустили атаку в ЛВК:</b>\n"
        "• &lt;ТУРАН&amp;&gt; [0/1]\n"
        "\n🟡 <b>Сделали только одну атаку:</b>\n"
        "• Alex &lt;&amp;&gt;\n"
        "\n🎯 <b>Атаки не по зеркалу:</b>\n"
        "• Flacicz &gt; &amp; (№3 ➜ №5)\n"
    );
}

TEST(WarReportPartsTest, AppendsVictoryOutcome)
{
    std::ostringstream report;

    war_report::appendOutcome(report, ClanwarOutcome::Victory);

    EXPECT_EQ(report.str(), "Итог: Победа\n\n");
}

TEST(WarReportPartsTest, AppendsDefeatOutcome)
{
    std::ostringstream report;

    war_report::appendOutcome(report, ClanwarOutcome::Defeat);

    EXPECT_EQ(report.str(), "Итог: Поражение\n\n");
}

TEST(WarReportPartsTest, AppendsDrawOutcome)
{
    std::ostringstream report;

    war_report::appendOutcome(report, ClanwarOutcome::Draw);

    EXPECT_EQ(report.str(), "Итог: Ничья\n\n");
}

TEST(WarReportPartsTest, AppendsWarOverviewWithVictory)
{
    const ClanwarOverview home{
        "#HOME",
        "Aurus",
        45,
        92.5
    };
    const ClanwarOverview opponent{
        "#OPPONENT",
        "Rival",
        42,
        88.75
    };
    std::ostringstream report;

    war_report::appendWarOverview(report, home, opponent);

    EXPECT_EQ(
        report.str(),
        "Клан: Aurus (<code>#HOME</code>)\n"
        "Соперник: Rival (<code>#OPPONENT</code>)\n\n"
        "Счет: ⭐️ 45 - 42 ⭐️\n"
        "Разрушение: 💥 92.50% - 88.75%\n\n"
        "Итог: Победа\n\n"
    );
}

TEST(WarReportPartsTest, AppendsWarOverviewWithDefeat)
{
    const ClanwarOverview home{
        "#HOME",
        "Aurus",
        40,
        85.1
    };
    const ClanwarOverview opponent{
        "#OPPONENT",
        "Rival",
        42,
        90.0
    };
    std::ostringstream report;

    war_report::appendWarOverview(report, home, opponent);

    EXPECT_EQ(
        report.str(),
        "Клан: Aurus (<code>#HOME</code>)\n"
        "Соперник: Rival (<code>#OPPONENT</code>)\n\n"
        "Счет: ⭐️ 40 - 42 ⭐️\n"
        "Разрушение: 💥 85.10% - 90.00%\n\n"
        "Итог: Поражение\n\n"
    );
}

TEST(WarReportPartsTest, AppendsWarOverviewWithDrawAndEscapesFields)
{
    const ClanwarOverview home{
        "#<HOME&>",
        "<Aurus&>",
        42,
        90.0
    };
    const ClanwarOverview opponent{
        "#<OPPONENT&>",
        "<Rival&>",
        42,
        90.0
    };
    std::ostringstream report;

    war_report::appendWarOverview(report, home, opponent);

    EXPECT_EQ(
        report.str(),
        "Клан: &lt;Aurus&amp;&gt; (<code>#&lt;HOME&amp;&gt;</code>)\n"
        "Соперник: &lt;Rival&amp;&gt; (<code>#&lt;OPPONENT&amp;&gt;</code>)\n\n"
        "Счет: ⭐️ 42 - 42 ⭐️\n"
        "Разрушение: 💥 90.00% - 90.00%\n\n"
        "Итог: Ничья\n\n"
    );
}

TEST(WarReportPartsTest, AppendsAttackStatistics)
{
    const ClanwarAttackStats attackStats{
        8,
        10,
        5,
        18,
        2.25,
        87.5,
        3,
        2,
        1,
        0
    };
    std::ostringstream report;

    war_report::appendAttackStatistics(report, attackStats);

    EXPECT_EQ(
        report.str(),
        "📊 <b>СТАТИСТИКА АТАК</b>\n"
        "Проведено атак: 8/10\n"
        "Средний результат: 2.25 ⭐ за атаку\n"
        "Среднее разрушение: 87.50%\n"
        "Распределение атак:\n"
        "3⭐ — 3\n"
        "2⭐ — 2\n"
        "1⭐ — 1\n"
        "0⭐ — 0\n\n"
    );
}

TEST(WarReportPartsTest, AppendsZeroAttackStatistics)
{
    const ClanwarAttackStats attackStats{
        0,
        0,
        0,
        0,
        0.0,
        0.0,
        0,
        0,
        0,
        0
    };
    std::ostringstream report;

    war_report::appendAttackStatistics(report, attackStats);

    EXPECT_EQ(
        report.str(),
        "📊 <b>СТАТИСТИКА АТАК</b>\n"
        "Проведено атак: 0/0\n"
        "Средний результат: 0.00 ⭐ за атаку\n"
        "Среднее разрушение: 0.00%\n"
        "Распределение атак:\n"
        "3⭐ — 0\n"
        "2⭐ — 0\n"
        "1⭐ — 0\n"
        "0⭐ — 0\n\n"
    );
}

TEST(WarReportPartsTest, RoundsAttackStatisticsToTwoDecimalPlaces)
{
    const ClanwarAttackStats attackStats{
        1,
        1,
        1,
        3,
        2.346,
        87.556,
        1,
        0,
        0,
        0
    };
    std::ostringstream report;

    war_report::appendAttackStatistics(report, attackStats);

    EXPECT_EQ(
        report.str(),
        "📊 <b>СТАТИСТИКА АТАК</b>\n"
        "Проведено атак: 1/1\n"
        "Средний результат: 2.35 ⭐ за атаку\n"
        "Среднее разрушение: 87.56%\n"
        "Распределение атак:\n"
        "3⭐ — 1\n"
        "2⭐ — 0\n"
        "1⭐ — 0\n"
        "0⭐ — 0\n\n"
    );
}

TEST(WarReportPartsTest, AppendsViolationPartsToExistingReport)
{
    const std::vector<ClanwarSlacker> missedAttacks{
        {"#PLAYER1", "Flacicz"}
    };
    const std::vector<ClanwarSlacker> oneAttackPlayers{
        {"#PLAYER2", "Alex"}
    };
    const std::vector<NotMirrorAttack> notMirrorAttacks{
        {"#PLAYER3", "ТУРАН", 3, 5}
    };
    std::ostringstream report;
    report << "Начало отчёта";

    war_report::appendNoAttackPlayers(
        report,
        missedAttacks,
        "Пропустили атаку в ЛВК",
        true
    );
    war_report::appendOneAttackPlayers(report, oneAttackPlayers);
    war_report::appendNotMirrorAttacks(report, notMirrorAttacks);

    EXPECT_EQ(
        report.str(),
        "Начало отчёта\n"
        "🔴 <b>Пропустили атаку в ЛВК:</b>\n"
        "• Flacicz [0/1]\n"
        "\n🟡 <b>Сделали только одну атаку:</b>\n"
        "• Alex\n"
        "\n🎯 <b>Атаки не по зеркалу:</b>\n"
        "• ТУРАН (№3 ➜ №5)\n"
    );
}

TEST(WarReportPartsTest, EmptyBestAttacksLeaveReportUnchanged)
{
    std::ostringstream report;
    report << "prefix";

    war_report::appendBestAttacks(report, {});

    EXPECT_EQ(report.str(), "prefix");
}

TEST(WarReportPartsTest, AppendsSingleBestAttack)
{
    const std::vector<BestAttack> bestAttacks{
        {"#PLAYER1", "Flacicz", 3, 100.0, 5, 3}
    };
    std::ostringstream report;

    war_report::appendBestAttacks(report, bestAttacks);

    EXPECT_EQ(
        report.str(),
        "🏅 <b>ЛУЧШИЕ АТАКИ</b>\n"
        "1. Flacicz — 3⭐, 100.00% (№5 ➜ №3)\n\n"
    );
}

TEST(WarReportPartsTest, AppendsMultipleBestAttacksWithEscapingAndNumbering)
{
    const std::vector<BestAttack> bestAttacks{
        {"#PLAYER1", "<ТУРАН&>", 3, 100.0, 5, 3},
        {"#PLAYER2", "Alex", 2, 87.5, 2, 7}
    };
    std::ostringstream report;

    war_report::appendBestAttacks(report, bestAttacks);

    EXPECT_EQ(
        report.str(),
        "🏅 <b>ЛУЧШИЕ АТАКИ</b>\n"
        "1. &lt;ТУРАН&amp;&gt; — 3⭐, 100.00% (№5 ➜ №3)\n"
        "2. Alex — 2⭐, 87.50% (№2 ➜ №7)\n\n"
    );
}
