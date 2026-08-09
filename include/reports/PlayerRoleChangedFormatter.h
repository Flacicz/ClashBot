//
// Created by zuevm on 29.06.2026.
//

#ifndef CLASHBOT_PLAYERROLECHANGEDFORMATTER_H
#define CLASHBOT_PLAYERROLECHANGEDFORMATTER_H

#include <string>

#include "database/repos/ClansRepo.h"
#include "events/ApplicationEvents.h"

class PlayerRoleChangedFormatter
{
    ClansRepo& clansRepo;

public:
    explicit PlayerRoleChangedFormatter(ClansRepo& clansRepo);

    [[nodiscard]] std::string format(const PlayerRoleChangedEvent& event) const;
};

#endif //CLASHBOT_PLAYERROLECHANGEDFORMATTER_H
