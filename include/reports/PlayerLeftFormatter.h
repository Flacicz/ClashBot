//
// Created by zuevm on 28.06.2026.
//

#ifndef ACTIVITYTRACKING_PLAYERLEFTFORMATTER_H
#define ACTIVITYTRACKING_PLAYERLEFTFORMATTER_H
#include "database/repos/clansRepo.h"
#include "events/ApplicationEvents.h"

class PlayerLeftFormatter
{
    ClansRepo& clansRepo;

public:
    explicit PlayerLeftFormatter(ClansRepo& clansRepo);

    [[nodiscard]] std::string format(const PlayerLeftClanEvent& event) const;
};

#endif //ACTIVITYTRACKING_PLAYERLEFTFORMATTER_H
