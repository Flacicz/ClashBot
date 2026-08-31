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
                    }
                }
            }
        };
    }

    nlohmann::json makeGuideNavigationKeyboard(const int townHall)
    {
        const std::string townHallNumber = std::to_string(townHall);

        return {
            {
                "inline_keyboard", {
                    {
                        {
                            {"text", "⬅️ Другие гайды ТХ " + townHallNumber},
                            {"callback_data", "guides:townhall:" + townHallNumber}
                        }
                    },
                    {
                        {
                            {"text", "⬅️ К выбору ратуши"},
                            {"callback_data", "guides:townhalls"}
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

    nlohmann::json makeTownHallLevelGuideListKeyboard()
    {
        return {
            {
                "inline_keyboard", {
                    {
                        {
                            {"text", "🎥 Zap Dragons"},
                            {"callback_data", "guides:mix:8:zap_dragons"}
                        }
                    }
                }
            }
        };
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
            if (guide.townHall != townHall)
            {
                continue;
            }

            keyboard["inline_keyboard"].push_back({
                {
                    {"text", guide.title},
                    {"callback_data", "guides:mix:" +
                        std::to_string(townHall) + ":" + guide.id}
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
}
