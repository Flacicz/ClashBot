//
// Created by zuevm on 29.06.2026.
//

#ifndef ACTIVITYTRACKING_PLAYERROLECHANGEDFORMATTER_H
#define ACTIVITYTRACKING_PLAYERROLECHANGEDFORMATTER_H
#include <string>

#include "events/ApplicationEvents.h"

class PlayerRoleChangedFormatter
{
public:
    [[nodiscard]] static std::string format(const PlayerRoleChangedEvent& event);
};

#endif //ACTIVITYTRACKING_PLAYERROLECHANGEDFORMATTER_H
