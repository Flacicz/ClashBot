#include <gtest/gtest.h>

#include <string_view>

#include "reports/PlayerJoinedFormatter.h"

namespace
{
    struct PlayerJoinedData
    {
        std::string_view clanName;
        std::string_view clanTag;
        std::string_view playerName;
        std::string_view playerTag;
    };

    constexpr PlayerJoinedData normalData{
        .clanName = "aurus",
        .clanTag = "#2J8PJ9VLG",
        .playerName = "Flacicz",
        .playerTag = "#9CJRC2LLC"
    };
}

TEST(PlayerJoinedFormatterTest, BuildReportFormatsPlayerData)
{
    EXPECT_EQ(
        PlayerJoinedFormatter::buildReport(
            normalData.clanName,
            normalData.clanTag,
            normalData.playerName,
            normalData.playerTag),
        "🟢 <b>Игрок присоединился к клану</b>\n\n"
        "Клан: aurus (<code>#2J8PJ9VLG</code>)\n"
        "Игрок: Flacicz (<code>#9CJRC2LLC</code>)"
    );
}

TEST(PlayerJoinedFormatterTest, BuildReportEscapesHtmlFields)
{
    constexpr PlayerJoinedData data{
        .clanName = "aurus & <clan>",
        .clanTag = "#<2J8PJ9VLG&>",
        .playerName = "\xE3\x80\x8A" "ТУРАН" "\xE3\x80\x8B <&>",
        .playerTag = "#<9CJRC2LLC&>"
    };

    EXPECT_EQ(
        PlayerJoinedFormatter::buildReport(
            data.clanName,
            data.clanTag,
            data.playerName,
            data.playerTag),
        "🟢 <b>Игрок присоединился к клану</b>\n\n"
        "Клан: aurus &amp; &lt;clan&gt; "
        "(<code>#&lt;2J8PJ9VLG&amp;&gt;</code>)\n"
        "Игрок: &lt;ТУРАН&gt; &lt;&amp;&gt; "
        "(<code>#&lt;9CJRC2LLC&amp;&gt;</code>)"
    );
}
