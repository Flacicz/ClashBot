#include <gtest/gtest.h>

#include <array>
#include <string>

#include "reports/ClanwarsLeagueRoundEndedFormatter.h"

TEST(ClanwarsLeagueRoundEndedFormatterTest, ReportsRoundWithBestAttacks)
{
    const ClanwarsLeagueRoundReportData reportData{
        .cwlRoundInfo = {
            "2026",
            3
        },
        .warDetails = {
            .home = {
                "#2J8PJ9VLG",
                "aurus",
                45,
                92.5
            },
            .opponent = {
                "#OPPONENT",
                "Rival",
                42,
                88.75
            },
            .attack_stats = {
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
            },
            .best_attacks = {
                {"#PLAYER1", "Flacicz", 3, 100.0, 5, 3},
                {"#PLAYER2", "Alex", 2, 87.5, 2, 7},
                {"#PLAYER3", "ТУРАН", 1, 50.0, 4, 4}
            },
        }
    };

    EXPECT_EQ(
        ClanwarsLeagueRoundEndedFormatter::buildReport(reportData),
        "🏆 <b>ОТЧЕТ ПО ТРЕТЬЕМУ РАУНДУ ЛВК</b>\n"
        "Клан: aurus (<code>#2J8PJ9VLG</code>)\n"
        "Соперник: Rival (<code>#OPPONENT</code>)\n\n"
        "Счет: ⭐️ 45 - 42 ⭐️\n"
        "Разрушение: 💥 92.50% - 88.75%\n\n"
        "Итог: Победа\n\n"
        "📊 <b>СТАТИСТИКА АТАК</b>\n"
        "Проведено атак: 8/10\n"
        "Средний результат: 2.25 ⭐ за атаку\n"
        "Среднее разрушение: 87.50%\n"
        "Распределение атак:\n"
        "3⭐ — 3\n"
        "2⭐ — 2\n"
        "1⭐ — 1\n"
        "0⭐ — 0\n\n"
        "🏅 <b>ЛУЧШИЕ АТАКИ</b>\n"
        "1. Flacicz — 3⭐, 100.00% (№5 ➜ №3)\n"
        "2. Alex — 2⭐, 87.50% (№2 ➜ №7)\n"
        "3. ТУРАН — 1⭐, 50.00% (№4 ➜ №4)"
    );
}

TEST(ClanwarsLeagueRoundEndedFormatterTest, ReportsRoundWithoutBestAttacks)
{
    const ClanwarsLeagueRoundReportData reportData{
        .cwlRoundInfo = {
            "2026",
            1
        },
        .warDetails = {
            .home = {
                "#HOME",
                "Aurus",
                42,
                90.0
            },
            .opponent = {
                "#OPPONENT",
                "Rival",
                42,
                90.0
            },
            .attack_stats = {
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
            },
            .best_attacks = {},
        }
    };

    EXPECT_EQ(
        ClanwarsLeagueRoundEndedFormatter::buildReport(reportData),
        "🏆 <b>ОТЧЕТ ПО ПЕРВОМУ РАУНДУ ЛВК</b>\n"
        "Клан: Aurus (<code>#HOME</code>)\n"
        "Соперник: Rival (<code>#OPPONENT</code>)\n\n"
        "Счет: ⭐️ 42 - 42 ⭐️\n"
        "Разрушение: 💥 90.00% - 90.00%\n\n"
        "Итог: Ничья\n\n"
        "📊 <b>СТАТИСТИКА АТАК</b>\n"
        "Проведено атак: 0/0\n"
        "Средний результат: 0.00 ⭐ за атаку\n"
        "Среднее разрушение: 0.00%\n"
        "Распределение атак:\n"
        "3⭐ — 0\n"
        "2⭐ — 0\n"
        "1⭐ — 0\n"
        "0⭐ — 0"
    );
}

TEST(ClanwarsLeagueRoundEndedFormatterTest, ReportsDefeat)
{
    const ClanwarsLeagueRoundReportData reportData{
        .cwlRoundInfo = {
            "2026",
            2
        },
        .warDetails = {
            .home = {
                "#HOME",
                "Aurus",
                40,
                85.1
            },
            .opponent = {
                "#OPPONENT",
                "Rival",
                42,
                90.0
            },
            .attack_stats = {
                1,
                1,
                1,
                2,
                2.0,
                85.1,
                0,
                1,
                0,
                0
            },
            .best_attacks = {},
        }
    };

    EXPECT_EQ(
        ClanwarsLeagueRoundEndedFormatter::buildReport(reportData),
        "🏆 <b>ОТЧЕТ ПО ВТОРОМУ РАУНДУ ЛВК</b>\n"
        "Клан: Aurus (<code>#HOME</code>)\n"
        "Соперник: Rival (<code>#OPPONENT</code>)\n\n"
        "Счет: ⭐️ 40 - 42 ⭐️\n"
        "Разрушение: 💥 85.10% - 90.00%\n\n"
        "Итог: Поражение\n\n"
        "📊 <b>СТАТИСТИКА АТАК</b>\n"
        "Проведено атак: 1/1\n"
        "Средний результат: 2.00 ⭐ за атаку\n"
        "Среднее разрушение: 85.10%\n"
        "Распределение атак:\n"
        "3⭐ — 0\n"
        "2⭐ — 1\n"
        "1⭐ — 0\n"
        "0⭐ — 0"
    );
}

TEST(ClanwarsLeagueRoundEndedFormatterTest, EscapesHtmlFields)
{
    const ClanwarsLeagueRoundReportData reportData{
        .cwlRoundInfo = {
            "2026",
            3
        },
        .warDetails = {
            .home = {
                "#<HOME&>",
                "<Aurus&>",
                45,
                92.5
            },
            .opponent = {
                "#<OPPONENT&>",
                "<Rival&>",
                42,
                88.75
            },
            .attack_stats = {
                1,
                1,
                1,
                3,
                3.0,
                100.0,
                1,
                0,
                0,
                0
            },
            .best_attacks = {
                {"#PLAYER1", "<ТУРАН&>", 3, 100.0, 5, 3}
            },
        }
    };

    EXPECT_EQ(
        ClanwarsLeagueRoundEndedFormatter::buildReport(reportData),
        "🏆 <b>ОТЧЕТ ПО ТРЕТЬЕМУ РАУНДУ ЛВК</b>\n"
        "Клан: &lt;Aurus&amp;&gt; (<code>#&lt;HOME&amp;&gt;</code>)\n"
        "Соперник: &lt;Rival&amp;&gt; (<code>#&lt;OPPONENT&amp;&gt;</code>)\n\n"
        "Счет: ⭐️ 45 - 42 ⭐️\n"
        "Разрушение: 💥 92.50% - 88.75%\n\n"
        "Итог: Победа\n\n"
        "📊 <b>СТАТИСТИКА АТАК</b>\n"
        "Проведено атак: 1/1\n"
        "Средний результат: 3.00 ⭐ за атаку\n"
        "Среднее разрушение: 100.00%\n"
        "Распределение атак:\n"
        "3⭐ — 1\n"
        "2⭐ — 0\n"
        "1⭐ — 0\n"
        "0⭐ — 0\n\n"
        "🏅 <b>ЛУЧШИЕ АТАКИ</b>\n"
        "1. &lt;ТУРАН&amp;&gt; — 3⭐, 100.00% (№5 ➜ №3)"
    );
}

TEST(ClanwarsLeagueRoundEndedFormatterTest, ReportsEveryRoundNumber)
{
    constexpr std::array expectedRoundNames{
        "ПЕРВОМУ",
        "ВТОРОМУ",
        "ТРЕТЬЕМУ",
        "ЧЕТВЁРТОМУ",
        "ПЯТОМУ",
        "ШЕСТОМУ",
        "СЕДЬМОМУ"
    };

    ClanwarsLeagueRoundReportData reportData{
        .cwlRoundInfo = {
            "2026",
            1
        },
        .warDetails = {
            .home = {
                "#HOME",
                "Aurus",
                0,
                0.0
            },
            .opponent = {
                "#OPPONENT",
                "Rival",
                0,
                0.0
            },
            .attack_stats = {
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
            },
            .best_attacks = {}
        }
    };

    for (int roundNumber = 1; roundNumber <= 7; ++roundNumber)
    {
        reportData.cwlRoundInfo.roundNumber = roundNumber;

        const auto report = ClanwarsLeagueRoundEndedFormatter::buildReport(reportData);
        const auto expectedTitle =
            "🏆 <b>ОТЧЕТ ПО " + std::string(expectedRoundNames[roundNumber - 1]) + " РАУНДУ ЛВК</b>\n";

        EXPECT_EQ(report.substr(0, expectedTitle.size()), expectedTitle)
            << "round number: " << roundNumber;
    }
}
