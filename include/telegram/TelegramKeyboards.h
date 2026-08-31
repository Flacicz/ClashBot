//
// Created by zuevm on 31.08.2026.
//

#ifndef CLASHBOT_TELEGRAMKEYBOARDS_H
#define CLASHBOT_TELEGRAMKEYBOARDS_H

#include <nlohmann/json.hpp>

namespace telegram::keyboards
{
    nlohmann::json makeStartMenuKeyboard();
    nlohmann::json makeBackNavigationKeyboard();
    nlohmann::json makeTownHallKeyboard();
    nlohmann::json makeTownHallLevelGuideListKeyboard();
}

#endif //CLASHBOT_TELEGRAMKEYBOARDS_H
