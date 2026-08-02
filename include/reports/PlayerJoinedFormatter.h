//
// Created by zuevm on 27.06.2026.
//

#ifndef CLASHBOT_PLAYERJOINEDFORMATTER_H
#define CLASHBOT_PLAYERJOINEDFORMATTER_H
#include <string>

#include "database/repos/clansRepo.h"
#include "events/ApplicationEvents.h"

class PlayerJoinedFormatter
{
    ClansRepo& clansRepo;

public:
    explicit PlayerJoinedFormatter(ClansRepo& clansRepo);

    [[nodiscard]] std::string format(const PlayerJoinedClanEvent& event) const;
};

#endif //CLASHBOT_PLAYERJOINEDFORMATTER_H
