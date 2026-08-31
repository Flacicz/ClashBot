//
// Created by zuevm on 31.08.2026.
//

#ifndef CLASHBOT_TELEGRAMKEYBOARDS_H
#define CLASHBOT_TELEGRAMKEYBOARDS_H

#include <nlohmann/json.hpp>

#include "models/telegram/TelegramModels.h"

namespace telegram::keyboards
{
    nlohmann::json makeStartMenuKeyboard();
    nlohmann::json makeGuideNavigationKeyboard(int townHall);
    nlohmann::json makeTownHallListKeyboard();
    nlohmann::json makeTownHallLevelGuideListKeyboard();

    nlohmann::json makeGuideListKeyboard(
        int townHall,
        const std::vector<AttackGuide>& guides);
}

#endif //CLASHBOT_TELEGRAMKEYBOARDS_H
