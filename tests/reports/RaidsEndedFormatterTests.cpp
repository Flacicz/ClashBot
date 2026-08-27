#include <gtest/gtest.h>

#include "reports/RaidsEndedFormatter.h"

TEST(RaidsEndedFormatterTest, ReportsRegularBestMember)
{
    const RaidReportData reportData{
        .clanTag = "#2J8PJ9VLG",
        .clanName = "aurus",
        .stats = {
            .totalLoot = 100000,
            .raidsCompleted = 1,
            .totalAttacks = 10,
            .enemyDistrictsDestroyed = 2,
            .offensiveReward = 500,
            .defensiveReward = 200
        },
        .bestMembers = {
            {"#9CJRC2LLC", "Flacicz", 3, 0, 50000}
        }
    };

    EXPECT_EQ(
        RaidsEndedFormatter::buildReport(reportData),
        "🏰 <b>ОТЧЕТ ПО РЕЙДАМ</b>\n"
        "Клан: aurus (<code>#2J8PJ9VLG</code>)\n\n"
        "📊 <b>СТАТИСТИКА РЕЙДА</b>\n"
        "Заработано золота: 100000\n"
        "Завершено рейдов: 1\n"
        "Использовано атак: 10\n"
        "Уничтожено районов: 2\n"
        "Награда за нападение: 500\n"
        "Награда за оборону: 200\n\n"
        "🏅 <b>ЛУЧШИЕ УЧАСТНИКИ</b>\n"
        "1. Flacicz — 50000 золота, 3 атаки"
    );
}

TEST(RaidsEndedFormatterTest, ReportsMembersWithAndWithoutBonusAttacks)
{
    const RaidReportData reportData{
        .clanTag = "#2J8PJ9VLG",
        .clanName = "aurus",
        .stats = {
            .totalLoot = 160000,
            .raidsCompleted = 2,
            .totalAttacks = 14,
            .enemyDistrictsDestroyed = 3,
            .offensiveReward = 700,
            .defensiveReward = 250
        },
        .bestMembers = {
            {"#PLAYER1", "Flacicz", 0, 0, 50000},
            {"#PLAYER2", "Alex", 1, 1, 60000},
            {"#PLAYER3", "ТУРАН", 6, 1, 70000}
        }
    };

    EXPECT_EQ(
        RaidsEndedFormatter::buildReport(reportData),
        "🏰 <b>ОТЧЕТ ПО РЕЙДАМ</b>\n"
        "Клан: aurus (<code>#2J8PJ9VLG</code>)\n\n"
        "📊 <b>СТАТИСТИКА РЕЙДА</b>\n"
        "Заработано золота: 160000\n"
        "Завершено рейдов: 2\n"
        "Использовано атак: 14\n"
        "Уничтожено районов: 3\n"
        "Награда за нападение: 700\n"
        "Награда за оборону: 250\n\n"
        "🏅 <b>ЛУЧШИЕ УЧАСТНИКИ</b>\n"
        "1. Flacicz — 50000 золота, 0 атак\n"
        "2. Alex — 60000 золота, 1 атака, 1 бонусная атака\n"
        "3. ТУРАН — 70000 золота, 6 атак, 1 бонусная атака"
    );
}

TEST(RaidsEndedFormatterTest, ReportsZeroStatisticsWithoutBestMembers)
{
    const RaidReportData reportData{
        .clanTag = "#2J8PJ9VLG",
        .clanName = "aurus",
        .stats = {
            .totalLoot = 0,
            .raidsCompleted = 0,
            .totalAttacks = 0,
            .enemyDistrictsDestroyed = 0,
            .offensiveReward = 0,
            .defensiveReward = 0
        },
        .bestMembers = {}
    };

    EXPECT_EQ(
        RaidsEndedFormatter::buildReport(reportData),
        "🏰 <b>ОТЧЕТ ПО РЕЙДАМ</b>\n"
        "Клан: aurus (<code>#2J8PJ9VLG</code>)\n\n"
        "📊 <b>СТАТИСТИКА РЕЙДА</b>\n"
        "Заработано золота: 0\n"
        "Завершено рейдов: 0\n"
        "Использовано атак: 0\n"
        "Уничтожено районов: 0\n"
        "Награда за нападение: 0\n"
        "Награда за оборону: 0"
    );
}

TEST(RaidsEndedFormatterTest, EscapesHtmlFields)
{
    const RaidReportData reportData{
        .clanTag = "#<2J8PJ9VLG&>",
        .clanName = "aurus & <clan>",
        .stats = {
            .totalLoot = 50000,
            .raidsCompleted = 1,
            .totalAttacks = 3,
            .enemyDistrictsDestroyed = 1,
            .offensiveReward = 100,
            .defensiveReward = 50
        },
        .bestMembers = {
            {"#PLAYER1", "<ТУРАН&>", 3, 0, 50000},
            {"#PLAYER2", "Alex > &", 4, 1, 60000}
        }
    };

    EXPECT_EQ(
        RaidsEndedFormatter::buildReport(reportData),
        "🏰 <b>ОТЧЕТ ПО РЕЙДАМ</b>\n"
        "Клан: aurus &amp; &lt;clan&gt; "
        "(<code>#&lt;2J8PJ9VLG&amp;&gt;</code>)\n\n"
        "📊 <b>СТАТИСТИКА РЕЙДА</b>\n"
        "Заработано золота: 50000\n"
        "Завершено рейдов: 1\n"
        "Использовано атак: 3\n"
        "Уничтожено районов: 1\n"
        "Награда за нападение: 100\n"
        "Награда за оборону: 50\n\n"
        "🏅 <b>ЛУЧШИЕ УЧАСТНИКИ</b>\n"
        "1. &lt;ТУРАН&amp;&gt; — 50000 золота, 3 атаки\n"
        "2. Alex &gt; &amp; — 60000 золота, 4 атаки, 1 бонусная атака"
    );
}
