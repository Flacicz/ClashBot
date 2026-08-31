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
                            {"callback_data", "guides"}
                        }
                    }
                }
            }
        };
    }

    nlohmann::json makeBackNavigationKeyboard()
    {
        return {
            {
                "inline_keyboard", {
                    {
                        {"text", "⬅️ Другие гайды ТХ 8"},
                        {"callback_data", "guides:townhall:8"}
                    },
                    {
                        {"text", "⬅️ К выбору ратуши"},
                        {"callback_data", "guides"}
                    },
                    {
                        {"text", "🏠 В главное меню"},
                        {"callback_data", "menu:start"}
                    }
                }
            }
        };
    }

    nlohmann::json makeTownHallKeyboard()
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
                            {"callback_data", "guides:townhall:8:zap_dragons"}
                        }
                    }
                }
            }
        };
    }
}
