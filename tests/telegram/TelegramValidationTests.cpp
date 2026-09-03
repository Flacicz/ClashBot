#include "telegram/TelegramValidation.h"

#include <gtest/gtest.h>

#include <array>
#include <string_view>

TEST(TelegramValidationTest, AcceptsTownHallRangeBoundaries)
{
    EXPECT_EQ(7, telegram::parseTownHall("7"));
    EXPECT_EQ(18, telegram::parseTownHall("18"));
}

TEST(TelegramValidationTest, RejectsEmptyTownHall)
{
    EXPECT_FALSE(telegram::parseTownHall("").has_value());
}

TEST(TelegramValidationTest, RejectsNonNumericTownHall)
{
    constexpr std::array invalidValues{
        std::string_view{"abc"},
        std::string_view{"7x"},
        std::string_view{"x7"},
        std::string_view{" 7"},
        std::string_view{"7 "}
    };

    for (const auto value : invalidValues)
    {
        EXPECT_FALSE(telegram::parseTownHall(value).has_value())
            << "Input: " << value;
    }
}

TEST(TelegramValidationTest, RejectsTownHallOutsideSupportedRange)
{
    constexpr std::array invalidValues{
        std::string_view{"-1"},
        std::string_view{"6"},
        std::string_view{"19"},
        std::string_view{"100"}
    };

    for (const auto value : invalidValues)
    {
        EXPECT_FALSE(telegram::parseTownHall(value).has_value())
            << "Input: " << value;
    }
}
