#include <gtest/gtest.h>

#include <string_view>

#include "reports/PlayerRoleChangedFormatter.h"

namespace
{
    struct PlayerRoleChangedData
    {
        std::string_view clanName;
        std::string_view clanTag;
        std::string_view playerName;
        std::string_view playerTag;
        std::string_view oldRole;
        std::string_view newRole;
    };

    constexpr PlayerRoleChangedData promotionData{
        .clanName = "aurus",
        .clanTag = "#2J8PJ9VLG",
        .playerName = "Flacicz",
        .playerTag = "#9CJRC2LLC",
        .oldRole = "member",
        .newRole = "admin"
    };

    constexpr PlayerRoleChangedData demotionData{
        .clanName = "aurus",
        .clanTag = "#2J8PJ9VLG",
        .playerName = "Alex Mercer",
        .playerTag = "#8P0L2R7Q",
        .oldRole = "coLeader",
        .newRole = "admin"
    };

    constexpr PlayerRoleChangedData coLeaderPromotionData{
        .clanName = "aurus",
        .clanTag = "#2J8PJ9VLG",
        .playerName = "Flacicz",
        .playerTag = "#9CJRC2LLC",
        .oldRole = "admin",
        .newRole = "coLeader"
    };

    constexpr PlayerRoleChangedData leaderDemotionData{
        .clanName = "aurus",
        .clanTag = "#2J8PJ9VLG",
        .playerName = "Alex Mercer",
        .playerTag = "#8P0L2R7Q",
        .oldRole = "leader",
        .newRole = "coLeader"
    };

    constexpr PlayerRoleChangedData twoTimesPromotedData{
        .clanName = "aurus",
        .clanTag = "#2J8PJ9VLG",
        .playerName = "Flacicz",
        .playerTag = "#9CJRC2LLC",
        .oldRole = "member",
        .newRole = "coLeader"
    };

    constexpr PlayerRoleChangedData threeTimesDemotedData{
        .clanName = "aurus",
        .clanTag = "#2J8PJ9VLG",
        .playerName = "Flacicz",
        .playerTag = "#9CJRC2LLC",
        .oldRole = "leader",
        .newRole = "member"
    };
}

TEST(PlayerRoleChangedFormatterTest, BuildReportFormatsPromotion)
{
    EXPECT_EQ(
        PlayerRoleChangedFormatter::buildReport(
            promotionData.clanName,
            promotionData.clanTag,
            promotionData.playerName,
            promotionData.playerTag,
            promotionData.oldRole,
            promotionData.newRole),
        "⬆️ <b>Изменение роли игрока</b>\n\n"
        "Клан: aurus (<code>#2J8PJ9VLG</code>)\n"
        "👤 <b>Flacicz</b> (<code>#9CJRC2LLC</code>)\n"
        "Роль: <b>Участник</b> → <b>Старейшина</b>\n"
        "Игрок получил повышение."
    );
}

TEST(PlayerRoleChangedFormatterTest, BuildReportFormatsDemotion)
{
    EXPECT_EQ(
        PlayerRoleChangedFormatter::buildReport(
            demotionData.clanName,
            demotionData.clanTag,
            demotionData.playerName,
            demotionData.playerTag,
            demotionData.oldRole,
            demotionData.newRole),
        "⬇️ <b>Изменение роли игрока</b>\n\n"
        "Клан: aurus (<code>#2J8PJ9VLG</code>)\n"
        "👤 <b>Alex Mercer</b> (<code>#8P0L2R7Q</code>)\n"
        "Роль: <b>Соруководитель</b> → <b>Старейшина</b>\n"
        "Игрок был понижен."
    );
}

TEST(PlayerRoleChangedFormatterTest, BuildReportFormatsPromotionToCoLeader)
{
    EXPECT_EQ(
        PlayerRoleChangedFormatter::buildReport(
            coLeaderPromotionData.clanName,
            coLeaderPromotionData.clanTag,
            coLeaderPromotionData.playerName,
            coLeaderPromotionData.playerTag,
            coLeaderPromotionData.oldRole,
            coLeaderPromotionData.newRole),
        "⬆️ <b>Изменение роли игрока</b>\n\n"
        "Клан: aurus (<code>#2J8PJ9VLG</code>)\n"
        "👤 <b>Flacicz</b> (<code>#9CJRC2LLC</code>)\n"
        "Роль: <b>Старейшина</b> → <b>Соруководитель</b>\n"
        "Игрок получил повышение."
    );
}

TEST(PlayerRoleChangedFormatterTest, BuildReportFormatsDemotionFromLeader)
{
    EXPECT_EQ(
        PlayerRoleChangedFormatter::buildReport(
            leaderDemotionData.clanName,
            leaderDemotionData.clanTag,
            leaderDemotionData.playerName,
            leaderDemotionData.playerTag,
            leaderDemotionData.oldRole,
            leaderDemotionData.newRole),
        "⬇️ <b>Изменение роли игрока</b>\n\n"
        "Клан: aurus (<code>#2J8PJ9VLG</code>)\n"
        "👤 <b>Alex Mercer</b> (<code>#8P0L2R7Q</code>)\n"
        "Роль: <b>Глава</b> → <b>Соруководитель</b>\n"
        "Игрок был понижен."
    );
}

TEST(PlayerRoleChangedFormatterTest, BuildReportEscapesHtmlFields)
{
    constexpr PlayerRoleChangedData data{
        .clanName = "aurus & <clan>",
        .clanTag = "#<2J8PJ9VLG&>",
        .playerName = "\xE3\x80\x8A" "ТУРАН" "\xE3\x80\x8B <&>",
        .playerTag = "#<9CJRC2LLC&>",
        .oldRole = "member",
        .newRole = "admin"
    };

    EXPECT_EQ(
        PlayerRoleChangedFormatter::buildReport(
            data.clanName,
            data.clanTag,
            data.playerName,
            data.playerTag,
            data.oldRole,
            data.newRole),
        "⬆️ <b>Изменение роли игрока</b>\n\n"
        "Клан: aurus &amp; &lt;clan&gt; "
        "(<code>#&lt;2J8PJ9VLG&amp;&gt;</code>)\n"
        "👤 <b>&lt;ТУРАН&gt; &lt;&amp;&gt;</b> "
        "(<code>#&lt;9CJRC2LLC&amp;&gt;</code>)\n"
        "Роль: <b>Участник</b> → <b>Старейшина</b>\n"
        "Игрок получил повышение."
    );
}

TEST(PlayerRoleChangedFormatterTest, BuildReportFormatsPromotedTwoTimes)
{
    EXPECT_EQ(
        PlayerRoleChangedFormatter::buildReport(
            twoTimesPromotedData.clanName,
            twoTimesPromotedData.clanTag,
            twoTimesPromotedData.playerName,
            twoTimesPromotedData.playerTag,
            twoTimesPromotedData.oldRole,
            twoTimesPromotedData.newRole),
        "⬆️ <b>Изменение роли игрока</b>\n\n"
        "Клан: aurus (<code>#2J8PJ9VLG</code>)\n"
        "👤 <b>Flacicz</b> (<code>#9CJRC2LLC</code>)\n"
        "Роль: <b>Участник</b> → <b>Соруководитель</b>\n"
        "Игрок получил повышение."
    );
}

TEST(PlayerRoleChangedFormatterTest, BuildReportFormatsDemotedThreeTimes)
{
    EXPECT_EQ(
        PlayerRoleChangedFormatter::buildReport(
            threeTimesDemotedData.clanName,
            threeTimesDemotedData.clanTag,
            threeTimesDemotedData.playerName,
            threeTimesDemotedData.playerTag,
            threeTimesDemotedData.oldRole,
            threeTimesDemotedData.newRole),
        "⬇️ <b>Изменение роли игрока</b>\n\n"
        "Клан: aurus (<code>#2J8PJ9VLG</code>)\n"
        "👤 <b>Flacicz</b> (<code>#9CJRC2LLC</code>)\n"
        "Роль: <b>Глава</b> → <b>Участник</b>\n"
        "Игрок был понижен."
    );
}
