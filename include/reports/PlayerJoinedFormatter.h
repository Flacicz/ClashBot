//
// Created by zuevm on 27.06.2026.
//

#ifndef CLASHBOT_PLAYERJOINEDFORMATTER_H
#define CLASHBOT_PLAYERJOINEDFORMATTER_H

#include <string>

#include "database/repos/ClansRepo.h"
#include "events/ApplicationEvents.h"

class PlayerJoinedFormatter
{
    ClansRepo& clansRepo;

public:
    explicit PlayerJoinedFormatter(ClansRepo& clansRepo);

    [[nodiscard]] std::string format(const PlayerJoinedClanEvent& event) const;
    [[nodiscard]] static std::string buildReport(std::string_view clanName, std::string_view clanTag,
                                                 std::string_view playerName, std::string_view playerTag);
};

#endif //CLASHBOT_PLAYERJOINEDFORMATTER_H
