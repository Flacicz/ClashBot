#include "telegram/TelegramCommands.h"

#include <gtest/gtest.h>

TEST(TelegramCommandsTest, ParsesStartCommand)
{
    const auto command = telegram::parseCommand("/start");

    ASSERT_TRUE(command.has_value());
    EXPECT_EQ("start", command->name);
    EXPECT_TRUE(command->arguments.empty());
}

TEST(TelegramCommandsTest, ParsesLinkCommandAndTagArgument)
{
    const auto command = telegram::parseCommand("/link #2pplq");

    ASSERT_TRUE(command.has_value());
    EXPECT_EQ("link", command->name);
    ASSERT_EQ(1u, command->arguments.size());
    EXPECT_EQ("#2pplq", command->arguments.front());
}

TEST(TelegramCommandsTest, ParsesUnlinkCommandAndTagArgument)
{
    const auto command = telegram::parseCommand("/unlink #2PPLQ");

    ASSERT_TRUE(command.has_value());
    EXPECT_EQ("unlink", command->name);
    ASSERT_EQ(1u, command->arguments.size());
    EXPECT_EQ("#2PPLQ", command->arguments.front());
}

TEST(TelegramCommandsTest, PreservesExtraArgumentsForCommandValidation)
{
    const auto command = telegram::parseCommand("/unlink #2PPLQ extra");

    ASSERT_TRUE(command.has_value());
    EXPECT_EQ("unlink", command->name);
    ASSERT_EQ(2u, command->arguments.size());
    EXPECT_EQ("#2PPLQ", command->arguments[0]);
    EXPECT_EQ("extra", command->arguments[1]);
}

TEST(TelegramCommandsTest, ParsesLinkCommandWithoutArguments)
{
    const auto command = telegram::parseCommand("/link");

    ASSERT_TRUE(command.has_value());
    EXPECT_EQ("link", command->name);
    EXPECT_TRUE(command->arguments.empty());
}

TEST(TelegramCommandsTest, AcceptsBotCommandSuffix)
{
    const auto command = telegram::parseCommand("/link@clash_bot 2PPLQ");

    ASSERT_TRUE(command.has_value());
    EXPECT_EQ("link", command->name);
    ASSERT_EQ(1u, command->arguments.size());
    EXPECT_EQ("2PPLQ", command->arguments.front());
}

TEST(TelegramCommandsTest, RejectsTextWithoutCommand)
{
    EXPECT_FALSE(telegram::parseCommand("hello").has_value());
}

TEST(TelegramCommandsTest, ParsesClanTagWithOrWithoutHash)
{
    EXPECT_EQ("#2PPLQ", telegram::parseClanTag("2pplq"));
    EXPECT_EQ("#2PPLQ", telegram::parseClanTag("#2PPLQ"));
}

TEST(TelegramCommandsTest, RejectsInvalidClanTagFormat)
{
    EXPECT_FALSE(telegram::parseClanTag("#2PPA").has_value());
    EXPECT_FALSE(telegram::parseClanTag("#2PPLQ-").has_value());
    EXPECT_FALSE(telegram::parseClanTag("#2P").has_value());
    EXPECT_FALSE(telegram::parseClanTag("#2PPLQ0123456789").has_value());
}
