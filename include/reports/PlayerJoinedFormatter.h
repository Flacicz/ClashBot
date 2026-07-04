//
// Created by zuevm on 27.06.2026.
//

#ifndef ACTIVITYTRACKING_PLAYERJOINEDFORMATTER_H
#define ACTIVITYTRACKING_PLAYERJOINEDFORMATTER_H
#include <string>

#include "database/repos/clansRepo.h"
#include "events/DomainEvents.h"

class PlayerJoinedFormatter
{
    ClansRepo& clansRepo;

public:
    explicit PlayerJoinedFormatter(ClansRepo& clansRepo);

    [[nodiscard]] std::string format(const PlayerJoinedClanEvent& event) const;
};

#endif //ACTIVITYTRACKING_PLAYERJOINEDFORMATTER_H
