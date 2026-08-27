#include <gtest/gtest.h>

#include <vector>

#include "reports/RaidsViolationsFormatter.h"

TEST(RaidsViolationsFormatterTest, ReportsNoViolations)
{
    const std::vector<RaidSlacker> slackers{
        {"#9CJRC2LLC", "Flacicz", 5, 0}
    };

    EXPECT_EQ(
        RaidsViolationsFormatter::buildReport("#2J8PJ9VLG", slackers),
        "⚠️ <b>НАРУШЕНИЯ В РЕЙДЕ</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "✅ <b>Нарушений в рейде не обнаружено!</b>\n"
        "<i>Отличная работа!</i>"
    );
}

TEST(RaidsViolationsFormatterTest, ReportsIncompleteAndMissingAttacks)
{
    const std::vector<RaidSlacker> slackers{
        {"#PLAYER1", "Alex", 4, 0},
        {"#PLAYER2", "ТУРАН", 0, 1},
        {"#PLAYER3", "Full Player", 6, 1}
    };

    EXPECT_EQ(
        RaidsViolationsFormatter::buildReport("#2J8PJ9VLG", slackers),
        "⚠️ <b>НАРУШЕНИЯ В РЕЙДЕ</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "🟡 <b>Не использовали все атаки:</b>\n"
        "• Alex [4/5]\n\n"
        "🔴 <b>Не сделали ни одной атаки:</b>\n"
        "• ТУРАН [0/6]"
    );
}

TEST(RaidsViolationsFormatterTest, UsesBonusAttacksInAttackLimit)
{
    const std::vector<RaidSlacker> slackers{
        {"#9CJRC2LLC", "Flacicz", 5, 1}
    };

    EXPECT_EQ(
        RaidsViolationsFormatter::buildReport("#2J8PJ9VLG", slackers),
        "⚠️ <b>НАРУШЕНИЯ В РЕЙДЕ</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "🟡 <b>Не использовали все атаки:</b>\n"
        "• Flacicz [5/6]"
    );
}

TEST(RaidsViolationsFormatterTest, ReportsOnlyPlayersWithoutAttacks)
{
    const std::vector<RaidSlacker> slackers{
        {"#9CJRC2LLC", "Flacicz", 0, 0}
    };

    EXPECT_EQ(
        RaidsViolationsFormatter::buildReport("#2J8PJ9VLG", slackers),
        "⚠️ <b>НАРУШЕНИЯ В РЕЙДЕ</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "🔴 <b>Не сделали ни одной атаки:</b>\n"
        "• Flacicz [0/5]"
    );
}

TEST(RaidsViolationsFormatterTest, EscapesHtmlFields)
{
    const std::vector<RaidSlacker> slackers{
        {"#<9CJRC2LLC&>", "\xE3\x80\x8A" "ТУРАН" "\xE3\x80\x8B <&>", 4, 0}
    };

    EXPECT_EQ(
        RaidsViolationsFormatter::buildReport("#<2J8PJ9VLG&>", slackers),
        "⚠️ <b>НАРУШЕНИЯ В РЕЙДЕ</b>\n"
        "Клан: <code>#&lt;2J8PJ9VLG&amp;&gt;</code>\n\n"
        "🟡 <b>Не использовали все атаки:</b>\n"
        "• &lt;ТУРАН&gt; &lt;&amp;&gt; [4/5]"
    );
}
