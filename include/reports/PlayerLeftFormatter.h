//
// Created by zuevm on 28.06.2026.
//

#ifndef CLASHBOT_PLAYERLEFTFORMATTER_H
#define CLASHBOT_PLAYERLEFTFORMATTER_H

#include <string>
#include <string_view>

#include "database/repos/ClansRepo.h"
#include "events/ApplicationEvents.h"

class PlayerLeftFormatter
{
    ClansRepo& clansRepo;

public:
    explicit PlayerLeftFormatter(ClansRepo& clansRepo);

    [[nodiscard]] std::string format(const PlayerLeftClanEvent& event) const;
    [[nodiscard]] static std::string buildReport(std::string_view clanName, std::string_view clanTag,
                                                 std::string_view playerName, std::string_view playerTag);
};

#endif //CLASHBOT_PLAYERLEFTFORMATTER_H
