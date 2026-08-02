//
// Created by zuevm on 29.06.2026.
//

#include "reports/PlayerRoleChangedFormatter.h"
#include <unordered_map>
#include <fmt/format.h>

std::string PlayerRoleChangedFormatter::format(const PlayerRoleChangedEvent& event)
{
    const std::unordered_map<std::string, int> playerRoles = {
        {"member", 1},
        {"admin", 2},
        {"coLeader", 3},
        {"leader", 4}
    };

    const std::unordered_map<std::string, std::string> roleNames = {
        {"member", "Участник"},
        {"admin", "Старейшина"},
        {"coLeader", "Соруководитель"},
        {"leader", "Глава"}
    };

    std::string message;

    if (playerRoles.at(event.newRole) > playerRoles.at(event.oldRole))
    {
        message = fmt::format(
            "⬆️ Игрок <b>{}</b> получил повышение.\n\n"
            "👤 <b>{}</b> → <b>{}</b>",
            event.playerName,
            roleNames.at(event.oldRole),
            roleNames.at(event.newRole)
        );
    }
    else
    {
        message = fmt::format(
            "⬇️ Игрок <b>{}</b> был понижен.\n\n"
            "👤 <b>{}</b> → <b>{}</b>",
            event.playerName,
            roleNames.at(event.oldRole),
            roleNames.at(event.newRole)
        );
    }

    return message;
}
