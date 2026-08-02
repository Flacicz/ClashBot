//
// Created by zuevm on 28.06.2026.
//

#ifndef CLASHBOT_PLAYERLEFTFORMATTER_H
#define CLASHBOT_PLAYERLEFTFORMATTER_H
#include "database/repos/clansRepo.h"
#include "events/ApplicationEvents.h"

class PlayerLeftFormatter
{
    ClansRepo& clansRepo;

public:
    explicit PlayerLeftFormatter(ClansRepo& clansRepo);

    [[nodiscard]] std::string format(const PlayerLeftClanEvent& event) const;
};

#endif //CLASHBOT_PLAYERLEFTFORMATTER_H
