#include <gtest/gtest.h>

#include <string_view>

#include "reports/PlayerLeftFormatter.h"

namespace
{
    struct PlayerLeftData
    {
        std::string_view clanName;
        std::string_view clanTag;
        std::string_view playerName;
        std::string_view playerTag;
    };

    constexpr PlayerLeftData normalData{
        .clanName = "aurus",
        .clanTag = "#2J8PJ9VLG",
        .playerName = "Flacicz",
        .playerTag = "#9CJRC2LLC"
    };
}

TEST(PlayerLeftFormatterTest, BuildReportFormatsPlayerData)
{
    EXPECT_EQ(
        PlayerLeftFormatter::buildReport(
            normalData.clanName,
            normalData.clanTag,
            normalData.playerName,
            normalData.playerTag),
        "🔴 <b>Игрок покинул клан</b>\n\n"
        "Клан: aurus (<code>#2J8PJ9VLG</code>)\n"
        "Игрок: Flacicz (<code>#9CJRC2LLC</code>)"
    );
}

TEST(PlayerLeftFormatterTest, BuildReportEscapesHtmlFields)
{
    constexpr PlayerLeftData data{
        .clanName = "aurus & <clan>",
        .clanTag = "#<2J8PJ9VLG&>",
        .playerName = "\xE3\x80\x8A" "ТУРАН" "\xE3\x80\x8B <&>",
        .playerTag = "#<9CJRC2LLC&>"
    };

    EXPECT_EQ(
        PlayerLeftFormatter::buildReport(
            data.clanName,
            data.clanTag,
            data.playerName,
            data.playerTag),
        "🔴 <b>Игрок покинул клан</b>\n\n"
        "Клан: aurus &amp; &lt;clan&gt; "
        "(<code>#&lt;2J8PJ9VLG&amp;&gt;</code>)\n"
        "Игрок: &lt;ТУРАН&gt; &lt;&amp;&gt; "
        "(<code>#&lt;9CJRC2LLC&amp;&gt;</code>)"
    );
}
