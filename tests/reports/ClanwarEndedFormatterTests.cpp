#include <gtest/gtest.h>

#include "reports/ClanwarEndedFormatter.h"

TEST(ClanwarEndedFormatterTest, ReportsCompleteWarWithBestAttacks)
{
    const ClanwarResultReportData reportData{
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
        .attackStats = {
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
        .bestAttacks = {
            {"#PLAYER1", "Flacicz", 3, 100.0, 5, 3},
            {"#PLAYER2", "Alex", 2, 87.5, 2, 7},
            {"#PLAYER3", "ТУРАН", 1, 50.0, 4, 4}
        },
    };

    EXPECT_EQ(
        ClanwarEndedFormatter::buildReport(reportData),
        "⚔️ <b>ИТОГ ВОЙНЫ КЛАНОВ</b>\n"
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

TEST(ClanwarEndedFormatterTest, ReportsWarWithoutBestAttacks)
{
    const ClanwarResultReportData reportData{
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
        .attackStats = {
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
        .bestAttacks = {},
    };

    EXPECT_EQ(
        ClanwarEndedFormatter::buildReport(reportData),
        "⚔️ <b>ИТОГ ВОЙНЫ КЛАНОВ</b>\n"
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

TEST(ClanwarEndedFormatterTest, ReportsDefeat)
{
    const ClanwarResultReportData reportData{
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
        .attackStats = {
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
        .bestAttacks = {},
    };

    EXPECT_EQ(
        ClanwarEndedFormatter::buildReport(reportData),
        "⚔️ <b>ИТОГ ВОЙНЫ КЛАНОВ</b>\n"
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

TEST(ClanwarEndedFormatterTest, EscapesHtmlFields)
{
    const ClanwarResultReportData reportData{
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
        .attackStats = {
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
        .bestAttacks = {
            {"#PLAYER1", "<ТУРАН&>", 3, 100.0, 5, 3}
        },
    };

    EXPECT_EQ(
        ClanwarEndedFormatter::buildReport(reportData),
        "⚔️ <b>ИТОГ ВОЙНЫ КЛАНОВ</b>\n"
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
