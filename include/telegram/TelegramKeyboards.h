//
// Created by zuevm on 31.08.2026.
//

#ifndef CLASHBOT_TELEGRAMKEYBOARDS_H
#define CLASHBOT_TELEGRAMKEYBOARDS_H

#include <nlohmann/json.hpp>
#include <string_view>

#include "models/telegram/TelegramModels.h"

namespace telegram::keyboards
{
    nlohmann::json makeStartMenuKeyboard();
    nlohmann::json makeMyClansNavigationKeyboard();
    nlohmann::json makeLinkInstructionsKeyboard();
    nlohmann::json makeClanUnlinkKeyboard(
        const std::vector<std::string>& clanTags);
    nlohmann::json makeGuideNavigationKeyboard(
        int townHall,
        std::string_view armyId,
        std::string_view armyTitle);
    nlohmann::json makeTownHallListKeyboard();

    nlohmann::json makeStrategyListKeyboard(
        int townHall,
        const std::vector<AttackStrategy>& strategies);

    nlohmann::json makeGuideListKeyboard(
        int townHall,
        const std::vector<AttackGuide>& guides);
}

#endif //CLASHBOT_TELEGRAMKEYBOARDS_H
