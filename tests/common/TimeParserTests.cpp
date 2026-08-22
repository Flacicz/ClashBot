//
// Created by zuevm on 19.08.2026.
//

#include "common/TimeParser.h"

#include <nlohmann/json.hpp>
#include <gtest/gtest.h>

TEST(ExtractTimeTest, ExtractsApiTime)
{
    const nlohmann::json json = {
        {"startTime", "20260820T084359.000Z"}
    };

    EXPECT_EQ(
        "20260820T084359",
        utils::extractTime(json, "startTime")
    );
}

TEST(ExtractTimeTest, RemovesMilliseconds)
{
    const nlohmann::json json = {
        {"startTime", "20260820T084359.123Z"}
    };

    EXPECT_EQ(
        "20260820T084359",
        utils::extractTime(json, "startTime")
    );
}

TEST(ExtractTimeTest, ReturnsEmptyWhenKeyIsMissing)
{
    const nlohmann::json json = nlohmann::json::object();

    EXPECT_EQ("", utils::extractTime(json, "startTime"));
}

TEST(ExtractTimeTest, ReturnsEmptyForUnknownApiTime)
{
    const nlohmann::json json = {
        {"startTime", "00000000T00000"}
    };

    EXPECT_EQ("", utils::extractTime(json, "startTime"));
}

TEST(ExtractTimeTest, ReturnsEmptyForEmptyValue)
{
    const nlohmann::json json = {
        {"startTime", ""}
    };

    EXPECT_EQ("", utils::extractTime(json, "startTime"));
}

TEST(ParseIsoToUnixTest, ParsesApiTime)
{
    EXPECT_EQ(
        1704067200,
        utils::parseISOToUnix("20240101T000000.000Z")
    );
}

TEST(ParseIsoToUnixTest, ParsesTimeWithMilliseconds)
{
    EXPECT_EQ(
        1704067200,
        utils::parseISOToUnix("20240101T000000.123Z")
    );
}

TEST(ParseIsoToUnixTest, ParsesTimeWithoutMilliseconds)
{
    EXPECT_EQ(
        1704067200,
        utils::parseISOToUnix("20240101T000000Z")
    );
}

TEST(ParseIsoToUnixTest, ReturnsZeroForEmptyString)
{
    EXPECT_EQ(0, utils::parseISOToUnix(""));
}

TEST(ParseIsoToUnixTest, ReturnsZeroForInvalidFormat)
{
    EXPECT_EQ(0, utils::parseISOToUnix("invalid"));
}

TEST(ParseIsoToUnixTest, RejectsInvalidFraction)
{
    EXPECT_EQ(
        0,
        utils::parseISOToUnix("20240101T000000.ABCZ")
    );
}

TEST(ParseIsoToUnixTest, RejectsTrailingCharacters)
{
    EXPECT_EQ(
        0,
        utils::parseISOToUnix("20240101T000000ABC")
    );
}

TEST(ParseIsoToUnixTest, RejectsInvalidCalendarDate)
{
    EXPECT_EQ(
        0,
        utils::parseISOToUnix("20240230T120000Z")
    );
}

TEST(FormatUnixToLocalDateTimeTest, FormatsMoscowTime)
{
    EXPECT_EQ(
        "01.01.2024 03:00",
        utils::formatUnixToLocalDateTime(1704067200)
    );
}

TEST(FormatUnixToLocalDateTimeTest, HandlesMidnightRollover)
{
    EXPECT_EQ(
        "02.01.2024 01:00",
        utils::formatUnixToLocalDateTime(1704146400)
    );
}

TEST(FormatUnixToLocalDateTimeTest, ReturnsUnknownForZero)
{
    EXPECT_EQ(
        "неизвестно",
        utils::formatUnixToLocalDateTime(0)
    );
}

TEST(FormatUnixToLocalDateTimeTest, ReturnsUnknownForNegativeTimestamp)
{
    EXPECT_EQ(
        "неизвестно",
        utils::formatUnixToLocalDateTime(-1)
    );
}

TEST(ParseIsoToUnixTest, ParsesNormalizedTimeWithoutZone)
{
    EXPECT_EQ(
        1704067200,
        utils::parseISOToUnix("20240101T000000")
    );
}

TEST(ParseIsoToUnixTest, AcceptsLeapDay)
{
    EXPECT_EQ(
        1709208000,
        utils::parseISOToUnix("20240229T120000Z")
    );
}

TEST(ParseIsoToUnixTest, RejectsInvalidTime)
{
    EXPECT_EQ(
        0,
        utils::parseISOToUnix("20240101T240000Z")
    );
}
