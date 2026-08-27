#include <gtest/gtest.h>

#include <array>
#include <string>
#include <vector>

#include "reports/ClanwarsLeagueRoundViolationsFormatter.h"

TEST(ClanwarsLeagueRoundViolationsFormatterTest, ReportsNoViolations)
{
    EXPECT_EQ(
        ClanwarsLeagueRoundViolationsFormatter::buildReport("#2J8PJ9VLG", 3, {}, {}),
        "⚠️ <b>НАРУШЕНИЯ ПО ТРЕТЬЕМУ РАУНДУ ЛВК</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "✅ <b>Нарушений в раунде ЛВК не обнаружено!</b>\n"
        "<i>Отличная работа в лиге!</i>"
    );
}

TEST(ClanwarsLeagueRoundViolationsFormatterTest, ReportsAllRoundNames)
{
    constexpr std::array rounds{
        std::pair{1, "ПЕРВОМУ"},
        std::pair{2, "ВТОРОМУ"},
        std::pair{3, "ТРЕТЬЕМУ"},
        std::pair{4, "ЧЕТВЁРТОМУ"},
        std::pair{5, "ПЯТОМУ"},
        std::pair{6, "ШЕСТОМУ"},
        std::pair{7, "СЕДЬМОМУ"}
    };

    for (const auto& [roundNumber, roundName] : rounds)
    {
        const std::string expectedReport =
            "⚠️ <b>НАРУШЕНИЯ ПО " + std::string(roundName) + " РАУНДУ ЛВК</b>\n"
            "Клан: <code>#2J8PJ9VLG</code>\n\n"
            "✅ <b>Нарушений в раунде ЛВК не обнаружено!</b>\n"
            "<i>Отличная работа в лиге!</i>";

        EXPECT_EQ(
            ClanwarsLeagueRoundViolationsFormatter::buildReport(
                "#2J8PJ9VLG",
                roundNumber,
                {},
                {}
            ),
            expectedReport
        ) << "round number: " << roundNumber;
    }
}

TEST(ClanwarsLeagueRoundViolationsFormatterTest, ReportsPlayersWithMissedAttack)
{
    const std::vector<ClanwarSlacker> missedAttacks{
        {"#9CJRC2LLC", "Flacicz"}
    };

    EXPECT_EQ(
        ClanwarsLeagueRoundViolationsFormatter::buildReport(
            "#2J8PJ9VLG",
            3,
            missedAttacks,
            {}
        ),
        "⚠️ <b>НАРУШЕНИЯ ПО ТРЕТЬЕМУ РАУНДУ ЛВК</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "🔴 <b>Пропустили атаку в ЛВК:</b>\n"
        "• Flacicz [0/1]"
    );
}

TEST(ClanwarsLeagueRoundViolationsFormatterTest, ReportsNotMirrorAttacks)
{
    const std::vector<NotMirrorAttack> notMirrorAttacks{
        {"#PLAYER1", "Flacicz", 5, 3},
        {"#PLAYER2", "Alex", 2, 7}
    };

    EXPECT_EQ(
        ClanwarsLeagueRoundViolationsFormatter::buildReport(
            "#2J8PJ9VLG",
            3,
            {},
            notMirrorAttacks
        ),
        "⚠️ <b>НАРУШЕНИЯ ПО ТРЕТЬЕМУ РАУНДУ ЛВК</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "🎯 <b>Атаки не по зеркалу:</b>\n"
        "• Flacicz (№5 ➜ №3)\n"
        "• Alex (№2 ➜ №7)"
    );
}

TEST(ClanwarsLeagueRoundViolationsFormatterTest, ReportsMissedAndNotMirrorAttacks)
{
    const std::vector<ClanwarSlacker> missedAttacks{
        {"#PLAYER1", "Flacicz"}
    };
    const std::vector<NotMirrorAttack> notMirrorAttacks{
        {"#PLAYER2", "ТУРАН", 3, 5}
    };

    EXPECT_EQ(
        ClanwarsLeagueRoundViolationsFormatter::buildReport(
            "#2J8PJ9VLG",
            3,
            missedAttacks,
            notMirrorAttacks
        ),
        "⚠️ <b>НАРУШЕНИЯ ПО ТРЕТЬЕМУ РАУНДУ ЛВК</b>\n"
        "Клан: <code>#2J8PJ9VLG</code>\n\n"
        "🔴 <b>Пропустили атаку в ЛВК:</b>\n"
        "• Flacicz [0/1]\n\n"
        "🎯 <b>Атаки не по зеркалу:</b>\n"
        "• ТУРАН (№3 ➜ №5)"
    );
}

TEST(ClanwarsLeagueRoundViolationsFormatterTest, EscapesHtmlFields)
{
    const std::vector<ClanwarSlacker> missedAttacks{
        {"#PLAYER1", "<ТУРАН&>"}
    };
    const std::vector<NotMirrorAttack> notMirrorAttacks{
        {"#PLAYER2", "Flacicz > &", 3, 5}
    };

    EXPECT_EQ(
        ClanwarsLeagueRoundViolationsFormatter::buildReport(
            "#<2J8PJ9VLG&>",
            3,
            missedAttacks,
            notMirrorAttacks
        ),
        "⚠️ <b>НАРУШЕНИЯ ПО ТРЕТЬЕМУ РАУНДУ ЛВК</b>\n"
        "Клан: <code>#&lt;2J8PJ9VLG&amp;&gt;</code>\n\n"
        "🔴 <b>Пропустили атаку в ЛВК:</b>\n"
        "• &lt;ТУРАН&amp;&gt; [0/1]\n\n"
        "🎯 <b>Атаки не по зеркалу:</b>\n"
        "• Flacicz &gt; &amp; (№3 ➜ №5)"
    );
}
