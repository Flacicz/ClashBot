//
// Created by zuevm on 29.06.2026.
//

#ifndef CLASHBOT_PLAYERROLECHANGEDFORMATTER_H
#define CLASHBOT_PLAYERROLECHANGEDFORMATTER_H
#include <string>

#include "events/ApplicationEvents.h"

class PlayerRoleChangedFormatter
{
public:
    [[nodiscard]] static std::string format(const PlayerRoleChangedEvent& event);
};

#endif //CLASHBOT_PLAYERROLECHANGEDFORMATTER_H
