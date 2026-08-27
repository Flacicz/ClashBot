//
// Created by zuevm on 29.06.2026.
//

#ifndef CLASHBOT_PLAYERROLECHANGEDFORMATTER_H
#define CLASHBOT_PLAYERROLECHANGEDFORMATTER_H

#include <string>
#include <string_view>

#include "database/repos/ClansRepo.h"
#include "events/ApplicationEvents.h"

class PlayerRoleChangedFormatter
{
    ClansRepo& clansRepo;

public:
    explicit PlayerRoleChangedFormatter(ClansRepo& clansRepo);

    [[nodiscard]] std::string format(const PlayerRoleChangedEvent& event) const;
    [[nodiscard]] static std::string buildReport(std::string_view clanName, std::string_view clanTag,
                                                 std::string_view playerName, std::string_view playerTag,
                                                 std::string_view oldRole, std::string_view newRole);
};

#endif //CLASHBOT_PLAYERROLECHANGEDFORMATTER_H
