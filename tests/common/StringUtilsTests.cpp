//
// Created by zuevm on 01.08.2026.
//

#include <gtest/gtest.h>

#include "common/StringUtils.h"

TEST(TransformTagTest, TransformWithPrefix)
{
    EXPECT_EQ("%232J8PJ9VLG", utils::transformTag("#2J8PJ9VLG"));
}

TEST(TransformTagTest, TransformWithoutPrefix)
{
    EXPECT_EQ("%232J8PJ9VLG", utils::transformTag("2J8PJ9VLG"));
}

TEST(TransformTagTest, TransformWithPrefixWithLengthOne)
{
    EXPECT_EQ("%23A", utils::transformTag("#A"));
}

TEST(TransformTagTest, TransformWithoutPrefixWithLengthOne)
{
    EXPECT_EQ("%23A", utils::transformTag("A"));
}

TEST(TransformTagTest, TransformPrefixOnly)
{
    EXPECT_EQ("%23", utils::transformTag("#"));
}

TEST(TransformTagTest, TransformEmptyString)
{
    EXPECT_EQ("", utils::transformTag(""));
}

TEST(EscapeHtmlTest, EscapesHtmlSpecialCharacters)
{
    EXPECT_EQ(
        "A&amp;B &lt;player&gt;",
        utils::escapeHTML("A&B <player>")
    );
}

TEST(EscapeHtmlTest, EscapesDecorativeAngleBrackets)
{
    EXPECT_EQ(
        "&lt;ТУРАН&gt;",
        utils::escapeHTML(
            "\xE3\x80\x8A" "ТУРАН" "\xE3\x80\x8B"
        )
    );
}

TEST(EscapeHtmlTest, EscapesRepeatedSpecialCharacters)
{
    EXPECT_EQ(
        "&amp;&amp;&lt;&lt;&gt;&gt;",
        utils::escapeHTML("&&<<>>")
    );
}

TEST(EscapeHtmlTest, EscapesEmptyString)
{
    EXPECT_EQ(
        "",
        utils::escapeHTML(
            ""
        )
    );
}
