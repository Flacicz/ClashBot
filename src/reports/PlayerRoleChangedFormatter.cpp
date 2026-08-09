//
// Created by zuevm on 29.06.2026.
//

#include "reports/PlayerRoleChangedFormatter.h"

#include <fmt/format.h>
#include <unordered_map>

#include "common/StringUtils.h"

PlayerRoleChangedFormatter::PlayerRoleChangedFormatter(ClansRepo& clansRepo) : clansRepo(clansRepo)
{
}

std::string PlayerRoleChangedFormatter::format(const PlayerRoleChangedEvent& event) const
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

    const auto clanName = clansRepo.getClanNameByTag(event.clanTag);
    const auto roleChange = fmt::format(
        "👤 <b>{}</b> (<code>{}</code>)\n"
        "Роль: <b>{}</b> → <b>{}</b>",
        utils::escapeHTML(event.playerName),
        utils::escapeHTML(event.playerTag),
        roleNames.at(event.oldRole),
        roleNames.at(event.newRole));

    if (playerRoles.at(event.newRole) > playerRoles.at(event.oldRole))
    {
        return fmt::format(
            "⬆️ <b>Изменение роли игрока</b>\n\n"
            "Клан: {} (<code>{}</code>)\n{}\n"
            "Игрок получил повышение.",
            utils::escapeHTML(clanName),
            utils::escapeHTML(event.clanTag),
            roleChange);
    }

    return fmt::format(
        "⬇️ <b>Изменение роли игрока</b>\n\n"
        "Клан: {} (<code>{}</code>)\n{}\n"
        "Игрок был понижен.",
        utils::escapeHTML(clanName),
        utils::escapeHTML(event.clanTag),
        roleChange);
}
