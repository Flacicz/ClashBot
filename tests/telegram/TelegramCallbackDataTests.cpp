#include "telegram/TelegramCallbackData.h"

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include <array>
#include <string_view>

namespace
{
    nlohmann::json makeValidCallbackQuery()
    {
        return {
            {"id", "callback-query-id"},
            {"data", "guides:townhall:10"},
            {"from", {
                {"id", 123456789LL}
            }},
            {"message", {
                {"message_id", 42},
                {"chat", {
                    {"id", -1001234567890LL}
                }}
            }}
        };
    }
}

TEST(TelegramCallbackDataTest, ParsesCommandWithoutArguments)
{
    const auto result = telegram::parseCallbackData("menu:start");

    ASSERT_TRUE(result.has_value());
    EXPECT_EQ("menu:start", result->command);
    EXPECT_TRUE(result->arguments.empty());
}

TEST(TelegramCallbackDataTest, ParsesCommandWithOneArgument)
{
    const auto result = telegram::parseCallbackData("guides:townhall:10");

    ASSERT_TRUE(result.has_value());
    EXPECT_EQ("guides:townhall", result->command);
    ASSERT_EQ(1, result->arguments.size());
    EXPECT_EQ("10", result->arguments[0]);
}

TEST(TelegramCallbackDataTest, PreservesMultipleArgumentsInOrder)
{
    const auto result = telegram::parseCallbackData(
        "guides:strategy:10:zap_dragons:classic");

    ASSERT_TRUE(result.has_value());
    EXPECT_EQ("guides:strategy", result->command);
    ASSERT_EQ(3, result->arguments.size());
    EXPECT_EQ("10", result->arguments[0]);
    EXPECT_EQ("zap_dragons", result->arguments[1]);
    EXPECT_EQ("classic", result->arguments[2]);
}

TEST(TelegramCallbackDataTest, ReturnsNulloptWhenThereAreFewerThanTwoParts)
{
    EXPECT_FALSE(telegram::parseCallbackData("").has_value());
    EXPECT_FALSE(telegram::parseCallbackData("menu").has_value());
}

TEST(TelegramCallbackDataTest, ReturnsNulloptWhenAnyPartIsEmpty)
{
    constexpr std::array invalidData{
        std::string_view{"guides::10"},
        std::string_view{":townhall"},
        std::string_view{"guides:townhall:"}
    };

    for (const auto data : invalidData)
    {
        EXPECT_FALSE(telegram::parseCallbackData(data).has_value())
            << "Input: " << data;
    }
}

TEST(TelegramCallbackDataTest, DoesNotValidateCommandName)
{
    const auto result = telegram::parseCallbackData("unknown:command:value");

    ASSERT_TRUE(result.has_value());
    EXPECT_EQ("unknown:command", result->command);
    ASSERT_EQ(1, result->arguments.size());
    EXPECT_EQ("value", result->arguments[0]);
}

TEST(TelegramCallbackContextTest, ParsesAllFieldsFromValidCallbackQuery)
{
    const auto result = telegram::parseCallbackContext(
        makeValidCallbackQuery());

    ASSERT_TRUE(result.has_value());
    EXPECT_EQ("callback-query-id", result->queryId);
    EXPECT_EQ("guides:townhall:10", result->data);
    EXPECT_EQ(-1001234567890LL, result->chatId);
    EXPECT_EQ(42, result->messageId);
    EXPECT_EQ(123456789LL, result->userId);
}

TEST(TelegramCallbackContextTest, UsesEmptyDataWhenDataFieldIsMissing)
{
    auto callbackQuery = makeValidCallbackQuery();
    callbackQuery.erase("data");

    const auto result = telegram::parseCallbackContext(callbackQuery);

    ASSERT_TRUE(result.has_value());
    EXPECT_EQ("callback-query-id", result->queryId);
    EXPECT_TRUE(result->data.empty());
    EXPECT_EQ(-1001234567890LL, result->chatId);
    EXPECT_EQ(42, result->messageId);
}

TEST(TelegramCallbackContextTest, ReturnsNulloptWhenQueryIdIsMissing)
{
    auto callbackQuery = makeValidCallbackQuery();
    callbackQuery.erase("id");

    EXPECT_FALSE(telegram::parseCallbackContext(callbackQuery).has_value());
}

TEST(TelegramCallbackContextTest, ReturnsNulloptWhenMessageIsMissing)
{
    auto callbackQuery = makeValidCallbackQuery();
    callbackQuery.erase("message");

    EXPECT_FALSE(telegram::parseCallbackContext(callbackQuery).has_value());
}

TEST(TelegramCallbackContextTest, ReturnsNulloptWhenChatIsMissing)
{
    auto callbackQuery = makeValidCallbackQuery();
    callbackQuery["message"].erase("chat");

    EXPECT_FALSE(telegram::parseCallbackContext(callbackQuery).has_value());
}

TEST(TelegramCallbackContextTest, ReturnsNulloptWhenChatIdIsMissing)
{
    auto callbackQuery = makeValidCallbackQuery();
    callbackQuery["message"]["chat"].erase("id");

    EXPECT_FALSE(telegram::parseCallbackContext(callbackQuery).has_value());
}

TEST(TelegramCallbackContextTest, ReturnsNulloptWhenMessageIdIsMissing)
{
    auto callbackQuery = makeValidCallbackQuery();
    callbackQuery["message"].erase("message_id");

    EXPECT_FALSE(telegram::parseCallbackContext(callbackQuery).has_value());
}

TEST(TelegramCallbackContextTest, ReturnsNulloptWhenQueryIdHasWrongType)
{
    auto callbackQuery = makeValidCallbackQuery();
    callbackQuery["id"] = 123;

    EXPECT_FALSE(telegram::parseCallbackContext(callbackQuery).has_value());
}

TEST(TelegramCallbackContextTest, ReturnsNulloptWhenDataHasWrongType)
{
    auto callbackQuery = makeValidCallbackQuery();
    callbackQuery["data"] = 123;

    EXPECT_FALSE(telegram::parseCallbackContext(callbackQuery).has_value());
}

TEST(TelegramCallbackContextTest, ReturnsNulloptWhenMessageHasWrongType)
{
    auto callbackQuery = makeValidCallbackQuery();
    callbackQuery["message"] = "invalid";

    EXPECT_FALSE(telegram::parseCallbackContext(callbackQuery).has_value());
}

TEST(TelegramCallbackContextTest, ReturnsNulloptWhenChatIdHasWrongType)
{
    auto callbackQuery = makeValidCallbackQuery();
    callbackQuery["message"]["chat"]["id"] = "invalid";

    EXPECT_FALSE(telegram::parseCallbackContext(callbackQuery).has_value());
}

TEST(TelegramCallbackContextTest, ReturnsNulloptWhenMessageIdHasWrongType)
{
    auto callbackQuery = makeValidCallbackQuery();
    callbackQuery["message"]["message_id"] = "invalid";

    EXPECT_FALSE(telegram::parseCallbackContext(callbackQuery).has_value());
}

TEST(TelegramCallbackContextTest, ReturnsNulloptForEmptyJsonObject)
{
    EXPECT_FALSE(
        telegram::parseCallbackContext(nlohmann::json::object()).has_value());
}

TEST(TelegramCallbackContextTest, ReturnsNulloptForNullJson)
{
    EXPECT_FALSE(
        telegram::parseCallbackContext(nlohmann::json(nullptr)).has_value());
}

TEST(TelegramCallbackContextTest, ReturnsNulloptForJsonArray)
{
    EXPECT_FALSE(
        telegram::parseCallbackContext(nlohmann::json::array()).has_value());
}
