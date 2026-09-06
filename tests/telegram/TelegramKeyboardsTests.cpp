#include "telegram/TelegramKeyboards.h"

#include <gtest/gtest.h>

#include <string>
#include <vector>

namespace
{
    nlohmann::json makeButton(
        const std::string_view text,
        const std::string_view callbackData)
    {
        return {
            {"text", text},
            {"callback_data", callbackData}
        };
    }

    telegram::AttackGuide makeGuide(
        const std::string_view id,
        const std::string_view title)
    {
        telegram::AttackGuide guide;
        guide.id = id;
        guide.title = title;
        return guide;
    }
}

TEST(TelegramKeyboardsTest, BuildsExpectedStartMenuJson)
{
    const auto result = telegram::keyboards::makeStartMenuKeyboard();

    const nlohmann::json expected = {
        {"inline_keyboard", {
            {
                {
                    {"text", "🎥 Гайды по атакам"},
                    {"callback_data", "guides:townhalls"}
                }
            },
            {
                {
                    {"text", "🔗 Подключить клан"},
                    {"callback_data", "clans:link"}
                }
            },
            {
                {
                    {"text", "📋 Мои кланы"},
                    {"callback_data", "clans:list"}
                }
            },
            {
                {
                    {"text", "❌ Отключить клан"},
                    {"callback_data", "clans:unlink"}
                }
            },
            {
                {
                    {"text", "❓ Помощь"},
                    {"callback_data", "help:main"}
                }
            }
        }}
    };

    EXPECT_EQ(expected, result);
}

TEST(TelegramKeyboardsTest, BuildsClanNavigationKeyboardsWithMainMenuButton)
{
    const auto myClansKeyboard =
        telegram::keyboards::makeMyClansNavigationKeyboard();
    const auto linkKeyboard =
        telegram::keyboards::makeLinkInstructionsKeyboard();
    const auto helpKeyboard =
        telegram::keyboards::makeHelpNavigationKeyboard();
    const auto expectedButton = makeButton("🏠 В главное меню", "menu:start");

    ASSERT_EQ(1, myClansKeyboard.at("inline_keyboard").size());
    ASSERT_EQ(1, linkKeyboard.at("inline_keyboard").size());
    ASSERT_EQ(1, helpKeyboard.at("inline_keyboard").size());
    EXPECT_EQ(
        expectedButton,
        myClansKeyboard.at("inline_keyboard").at(0).at(0));
    EXPECT_EQ(
        expectedButton,
        linkKeyboard.at("inline_keyboard").at(0).at(0));
    EXPECT_EQ(
        expectedButton,
        helpKeyboard.at("inline_keyboard").at(0).at(0));
}

TEST(TelegramKeyboardsTest, BuildsClanUnlinkKeyboardForEachClan)
{
    const auto result = telegram::keyboards::makeClanUnlinkKeyboard(
        {"#2PPLQ", "#ABC123"});

    const auto& rows = result.at("inline_keyboard");

    ASSERT_EQ(3, rows.size());
    EXPECT_EQ(
        makeButton("❌ #2PPLQ", "clans:unlink:#2PPLQ"),
        rows.at(0).at(0));
    EXPECT_EQ(
        makeButton("❌ #ABC123", "clans:unlink:#ABC123"),
        rows.at(1).at(0));
    EXPECT_EQ(
        makeButton("🏠 В главное меню", "menu:start"),
        rows.at(2).at(0));
}

TEST(TelegramKeyboardsTest, KeepsOnlyMainMenuButtonWhenClanListIsEmpty)
{
    const auto result = telegram::keyboards::makeClanUnlinkKeyboard({});

    const auto& rows = result.at("inline_keyboard");

    ASSERT_EQ(1, rows.size());
    ASSERT_EQ(1, rows.at(0).size());
    EXPECT_EQ(
        makeButton("🏠 В главное меню", "menu:start"),
        rows.at(0).at(0));
}

TEST(TelegramKeyboardsTest, UsesArgumentsInGuideNavigationKeyboard)
{
    const auto first = telegram::keyboards::makeGuideNavigationKeyboard(
        12,
        "zap_dragons",
        "Землетрясение + драконы");

    const auto second = telegram::keyboards::makeGuideNavigationKeyboard(
        16,
        "root_riders",
        "Всадники на кабанах");

    ASSERT_EQ(3, first.at("inline_keyboard").size());
    ASSERT_EQ(3, second.at("inline_keyboard").size());

    EXPECT_EQ(
        "⬅️ Другие гайды: Землетрясение + драконы",
        first.at("inline_keyboard").at(0).at(0).at("text")
            .get<std::string>());
    EXPECT_EQ(
        "guides:strategy:12:zap_dragons",
        first.at("inline_keyboard").at(0).at(0).at("callback_data")
            .get<std::string>());
    EXPECT_EQ(
        "⬅️ К выбору стратегий",
        first.at("inline_keyboard").at(1).at(0).at("text")
            .get<std::string>());
    EXPECT_EQ(
        "guides:townhall:12",
        first.at("inline_keyboard").at(1).at(0).at("callback_data")
            .get<std::string>());
    EXPECT_EQ(
        "🏠 В главное меню",
        first.at("inline_keyboard").at(2).at(0).at("text")
            .get<std::string>());
    EXPECT_EQ(
        "menu:start",
        first.at("inline_keyboard").at(2).at(0).at("callback_data")
            .get<std::string>());

    EXPECT_EQ(
        "⬅️ Другие гайды: Всадники на кабанах",
        second.at("inline_keyboard").at(0).at(0).at("text")
            .get<std::string>());
    EXPECT_EQ(
        "guides:strategy:16:root_riders",
        second.at("inline_keyboard").at(0).at(0).at("callback_data")
            .get<std::string>());
    EXPECT_EQ(
        "guides:townhall:16",
        second.at("inline_keyboard").at(1).at(0).at("callback_data")
            .get<std::string>());
}

TEST(TelegramKeyboardsTest, BuildsTownHallButtonsInRowsOfThree)
{
    const auto result = telegram::keyboards::makeTownHallListKeyboard();

    const auto& rows = result.at("inline_keyboard");

    ASSERT_EQ(4, rows.size());

    int townHall = 7;
    for (const auto& row : rows)
    {
        ASSERT_EQ(3, row.size());

        for (const auto& button : row)
        {
            const std::string townHallNumber = std::to_string(townHall);
            EXPECT_EQ(
                "Ратуша " + townHallNumber,
                button.at("text").get<std::string>());
            EXPECT_EQ(
                "guides:townhall:" + townHallNumber,
                button.at("callback_data").get<std::string>());
            ++townHall;
        }
    }

    EXPECT_EQ(19, townHall);
}

TEST(TelegramKeyboardsTest, UsesStrategiesAndTownHallInStrategyListKeyboard)
{
    const std::vector<telegram::AttackStrategy> strategies = {
        {"zap_dragons", "Землетрясение + драконы"},
        {"root_riders", "Всадники на кабанах"}
    };

    const auto result = telegram::keyboards::makeStrategyListKeyboard(
        14,
        strategies);

    const auto& rows = result.at("inline_keyboard");

    ASSERT_EQ(3, rows.size());
    ASSERT_EQ(1, rows.at(0).size());
    ASSERT_EQ(1, rows.at(1).size());
    ASSERT_EQ(1, rows.at(2).size());

    EXPECT_EQ(
        makeButton(
            "Землетрясение + драконы",
            "guides:strategy:14:zap_dragons"),
        rows.at(0).at(0));
    EXPECT_EQ(
        makeButton(
            "Всадники на кабанах",
            "guides:strategy:14:root_riders"),
        rows.at(1).at(0));
    EXPECT_EQ(
        makeButton("⬅️ К выбору ратуши", "guides:townhalls"),
        rows.at(2).at(0));
}

TEST(TelegramKeyboardsTest, KeepsOnlyBackButtonWhenStrategyListIsEmpty)
{
    const auto result = telegram::keyboards::makeStrategyListKeyboard(
        10,
        {});

    const auto& rows = result.at("inline_keyboard");

    ASSERT_EQ(1, rows.size());
    ASSERT_EQ(1, rows.at(0).size());
    EXPECT_EQ(
        makeButton("⬅️ К выбору ратуши", "guides:townhalls"),
        rows.at(0).at(0));
}

TEST(TelegramKeyboardsTest, UsesGuidesAndTownHallInGuideListKeyboard)
{
    const std::vector<telegram::AttackGuide> guides = {
        makeGuide("zap_dragons", "Гайд по драконам"),
        makeGuide("root_riders", "Гайд по всадникам")
    };

    const auto result = telegram::keyboards::makeGuideListKeyboard(
        15,
        guides);

    const auto& rows = result.at("inline_keyboard");

    ASSERT_EQ(3, rows.size());
    ASSERT_EQ(1, rows.at(0).size());
    ASSERT_EQ(1, rows.at(1).size());
    ASSERT_EQ(1, rows.at(2).size());

    EXPECT_EQ(
        makeButton("Гайд по драконам", "guides:guide:15:zap_dragons"),
        rows.at(0).at(0));
    EXPECT_EQ(
        makeButton("Гайд по всадникам", "guides:guide:15:root_riders"),
        rows.at(1).at(0));
    EXPECT_EQ(
        makeButton("⬅️ К выбору стратегий", "guides:townhall:15"),
        rows.at(2).at(0));
}

TEST(TelegramKeyboardsTest, KeepsOnlyBackButtonWhenGuideListIsEmpty)
{
    const auto result = telegram::keyboards::makeGuideListKeyboard(
        11,
        {});

    const auto& rows = result.at("inline_keyboard");

    ASSERT_EQ(1, rows.size());
    ASSERT_EQ(1, rows.at(0).size());
    EXPECT_EQ(
        makeButton("⬅️ К выбору стратегий", "guides:townhall:11"),
        rows.at(0).at(0));
}
