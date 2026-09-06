//
// Created by zuevm on 31.08.2026.
//

#include "telegram/TelegramKeyboards.h"

#include <string>

namespace telegram::keyboards
{
    nlohmann::json makeStartMenuKeyboard()
    {
        return {
            {
                "inline_keyboard", {
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
                }
            }
        };
    }

    nlohmann::json makeMyClansNavigationKeyboard()
    {
        return {
            {
                "inline_keyboard", {
                    {
                        {
                            {"text", "🏠 В главное меню"},
                            {"callback_data", "menu:start"}
                        }
                    }
                }
            }
        };
    }

    nlohmann::json makeLinkInstructionsKeyboard()
    {
        return {
            {
                "inline_keyboard", {
                    {
                        {
                            {"text", "🏠 В главное меню"},
                            {"callback_data", "menu:start"}
                        }
                    }
                }
            }
        };
    }

    nlohmann::json makeHelpNavigationKeyboard()
    {
        return {
            {
                "inline_keyboard", {
                    {
                        {
                            {"text", "🏠 В главное меню"},
                            {"callback_data", "menu:start"}
                        }
                    }
                }
            }
        };
    }

    nlohmann::json makeClanUnlinkKeyboard(
        const std::vector<std::string>& clanTags)
    {
        nlohmann::json keyboard = {
            {"inline_keyboard", nlohmann::json::array()}
        };

        for (const auto& clanTag : clanTags)
        {
            keyboard["inline_keyboard"].push_back({
                {
                    {"text", "❌ " + clanTag},
                    {"callback_data", "clans:unlink:" + clanTag}
                }
            });
        }

        keyboard["inline_keyboard"].push_back({
            {
                {"text", "🏠 В главное меню"},
                {"callback_data", "menu:start"}
            }
        });

        return keyboard;
    }

    nlohmann::json makeGuideNavigationKeyboard(
        const int townHall,
        const std::string_view armyId,
        const std::string_view armyTitle)
    {
        const std::string townHallNumber = std::to_string(townHall);
        const std::string strategyCallback =
            "guides:strategy:" + townHallNumber + ":" +
            std::string(armyId);

        return {
            {
                "inline_keyboard", {
                    {
                        {
                            {"text", "⬅️ Другие гайды: " + std::string(armyTitle)},
                            {"callback_data", strategyCallback}
                        }
                    },
                    {
                        {
                            {"text", "⬅️ К выбору стратегий"},
                            {"callback_data", "guides:townhall:" + townHallNumber}
                        }
                    },
                    {
                        {
                            {"text", "🏠 В главное меню"},
                            {"callback_data", "menu:start"}
                        }
                    }
                }
            }
        };
    }

    nlohmann::json makeTownHallListKeyboard()
    {
        constexpr int firstTownHall = 7;
        constexpr int lastTownHall = 18;
        constexpr int buttonsPerRow = 3;

        nlohmann::json keyboard = {
            {"inline_keyboard", nlohmann::json::array()}
        };

        for (int townHall = firstTownHall; townHall <= lastTownHall; ++townHall)
        {
            if ((townHall - firstTownHall) % buttonsPerRow == 0)
            {
                keyboard["inline_keyboard"].push_back(nlohmann::json::array());
            }

            const std::string townHallNumber = std::to_string(townHall);

            keyboard["inline_keyboard"].back().push_back({
                {"text", "Ратуша " + townHallNumber},
                {"callback_data", "guides:townhall:" + townHallNumber}
            });
        }

        return keyboard;
    }

    nlohmann::json makeStrategyListKeyboard(
        const int townHall,
        const std::vector<AttackStrategy>& strategies)
    {
        const std::string townHallNumber = std::to_string(townHall);

        nlohmann::json keyboard = {
            {"inline_keyboard", nlohmann::json::array()}
        };

        for (const auto& strategy : strategies)
        {
            keyboard["inline_keyboard"].push_back({
                {
                    {"text", strategy.title},
                    {"callback_data", "guides:strategy:" +
                        townHallNumber + ":" + strategy.id}
                }
            });
        }

        keyboard["inline_keyboard"].push_back({
            {
                {"text", "⬅️ К выбору ратуши"},
                {"callback_data", "guides:townhalls"}
            }
        });

        return keyboard;
    }

    nlohmann::json makeGuideListKeyboard(
        const int townHall,
        const std::vector<AttackGuide>& guides)
    {
        nlohmann::json keyboard = {
            {"inline_keyboard", nlohmann::json::array()}
        };

        for (const auto& guide : guides)
        {
            keyboard["inline_keyboard"].push_back({
                {
                    {"text", guide.title},
                    {"callback_data", "guides:guide:" +
                        std::to_string(townHall) + ":" + guide.id}
                }
            });
        }

        keyboard["inline_keyboard"].push_back({
            {
                {"text", "⬅️ К выбору стратегий"},
                {"callback_data", "guides:townhall:" +
                    std::to_string(townHall)}
            }
        });

        return keyboard;
    }
}
