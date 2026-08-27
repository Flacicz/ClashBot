#include <gtest/gtest.h>

#include <vector>

#include "reports/ClanwarViolationsFormatter.h"

TEST(ClanwarViolationsFormatterTest, ReportsNoViolations)
{
    EXPECT_EQ(
        ClanwarViolationsFormatter::buildReport(
            "#2J8PJ9VLG",
            {},
            {},
            {}
        ),
        "⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "✅ <b>Нарушений в войне кланов не обнаружено!</b>\n"
        "<i>Отличная работа!</i>"
    );
}

TEST(ClanwarViolationsFormatterTest, ReportsPlayersWithoutAttacks)
{
    const std::vector<ClanwarSlacker> missedAttacks{
        {"#9CJRC2LLC", "Flacicz"}
    };

    EXPECT_EQ(
        ClanwarViolationsFormatter::buildReport("#2J8PJ9VLG", missedAttacks, {}, {}),
        "⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "🔴 <b>Не сделали ни одной атаки:</b>\n"
        "• Flacicz"
    );
}

TEST(ClanwarViolationsFormatterTest, ReportsPlayersWithOneAttack)
{
    const std::vector<ClanwarSlacker> oneAttackPlayers{
        {"#9CJRC2LLC", "Flacicz"}
    };

    EXPECT_EQ(
        ClanwarViolationsFormatter::buildReport("#2J8PJ9VLG", {}, oneAttackPlayers, {}),
        "⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "🟡 <b>Сделали только одну атаку:</b>\n"
        "• Flacicz"
    );
}

TEST(ClanwarViolationsFormatterTest, ReportsNotMirrorAttacks)
{
    const std::vector<NotMirrorAttack> notMirrorAttacks{
        {"#PLAYER1", "Flacicz", 5, 3},
        {"#PLAYER2", "Alex", 2, 7}
    };

    EXPECT_EQ(
        ClanwarViolationsFormatter::buildReport("#2J8PJ9VLG", {}, {}, notMirrorAttacks),
        "⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "🎯 <b>Атаки не по зеркалу:</b>\n"
        "• Flacicz (№5 ➜ №3)\n"
        "• Alex (№2 ➜ №7)"
    );
}

TEST(ClanwarViolationsFormatterTest, ReportsAllViolationTypesInOrder)
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

    EXPECT_EQ(
        ClanwarViolationsFormatter::buildReport(
            "#2J8PJ9VLG",
            missedAttacks,
            oneAttackPlayers,
            notMirrorAttacks
        ),
        "⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "🔴 <b>Не сделали ни одной атаки:</b>\n"
        "• Flacicz\n\n"
        "🟡 <b>Сделали только одну атаку:</b>\n"
        "• Alex\n\n"
        "🎯 <b>Атаки не по зеркалу:</b>\n"
        "• ТУРАН (№3 ➜ №5)"
    );
}

TEST(ClanwarViolationsFormatterTest, ReportsMissedAndOneAttackPlayers)
{
    const std::vector<ClanwarSlacker> missedAttacks{
        {"#PLAYER1", "Flacicz"}
    };
    const std::vector<ClanwarSlacker> oneAttackPlayers{
        {"#PLAYER2", "Alex"}
    };

    EXPECT_EQ(
        ClanwarViolationsFormatter::buildReport(
            "#2J8PJ9VLG",
            missedAttacks,
            oneAttackPlayers,
            {}
        ),
        "⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "🔴 <b>Не сделали ни одной атаки:</b>\n"
        "• Flacicz\n\n"
        "🟡 <b>Сделали только одну атаку:</b>\n"
        "• Alex"
    );
}

TEST(ClanwarViolationsFormatterTest, ReportsMissedAndNotMirrorAttacks)
{
    const std::vector<ClanwarSlacker> missedAttacks{
        {"#PLAYER1", "Flacicz"}
    };
    const std::vector<NotMirrorAttack> notMirrorAttacks{
        {"#PLAYER2", "ТУРАН", 3, 5}
    };

    EXPECT_EQ(
        ClanwarViolationsFormatter::buildReport(
            "#2J8PJ9VLG",
            missedAttacks,
            {},
            notMirrorAttacks
        ),
        "⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "🔴 <b>Не сделали ни одной атаки:</b>\n"
        "• Flacicz\n\n"
        "🎯 <b>Атаки не по зеркалу:</b>\n"
        "• ТУРАН (№3 ➜ №5)"
    );
}

TEST(ClanwarViolationsFormatterTest, ReportsOneAttackAndNotMirrorAttacks)
{
    const std::vector<ClanwarSlacker> oneAttackPlayers{
        {"#PLAYER1", "Alex"}
    };
    const std::vector<NotMirrorAttack> notMirrorAttacks{
        {"#PLAYER2", "ТУРАН", 3, 5}
    };

    EXPECT_EQ(
        ClanwarViolationsFormatter::buildReport(
            "#2J8PJ9VLG",
            {},
            oneAttackPlayers,
            notMirrorAttacks
        ),
        "⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "🟡 <b>Сделали только одну атаку:</b>\n"
        "• Alex\n\n"
        "🎯 <b>Атаки не по зеркалу:</b>\n"
        "• ТУРАН (№3 ➜ №5)"
    );
}

TEST(ClanwarViolationsFormatterTest, EscapesHtmlFields)
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

    EXPECT_EQ(
        ClanwarViolationsFormatter::buildReport(
            "#<2J8PJ9VLG&>",
            missedAttacks,
            oneAttackPlayers,
            notMirrorAttacks
        ),
        "⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n"
        "Клан: <code>#&lt;2J8PJ9VLG&amp;&gt;</code>\n\n"
        "🔴 <b>Не сделали ни одной атаки:</b>\n"
        "• &lt;ТУРАН&amp;&gt;\n\n"
        "🟡 <b>Сделали только одну атаку:</b>\n"
        "• Alex &lt;&amp;&gt;\n\n"
        "🎯 <b>Атаки не по зеркалу:</b>\n"
        "• Flacicz &gt; &amp; (№3 ➜ №5)"
    );
}
