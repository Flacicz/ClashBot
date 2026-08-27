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
    const auto clanName = clansRepo.getClanNameByTag(event.clanTag);

    return buildReport(
        clanName,
        event.clanTag,
        event.playerName,
        event.playerTag,
        event.oldRole,
        event.newRole
    );
}

std::string PlayerRoleChangedFormatter::buildReport(const std::string_view clanName,
                                                    const std::string_view clanTag,
                                                    const std::string_view playerName,
                                                    const std::string_view playerTag,
                                                    const std::string_view oldRole,
                                                    const std::string_view newRole)
{
    const std::unordered_map<std::string_view, int> playerRoles = {
        {"member", 1},
        {"admin", 2},
        {"coLeader", 3},
        {"leader", 4}
    };

    const std::unordered_map<std::string_view, std::string_view> roleNames = {
        {"member", "Участник"},
        {"admin", "Старейшина"},
        {"coLeader", "Соруководитель"},
        {"leader", "Глава"}
    };

    const auto roleChange = fmt::format(
        "👤 <b>{}</b> (<code>{}</code>)\n"
        "Роль: <b>{}</b> → <b>{}</b>",
        utils::escapeHTML(playerName),
        utils::escapeHTML(playerTag),
        roleNames.at(oldRole),
        roleNames.at(newRole));

    if (playerRoles.at(newRole) > playerRoles.at(oldRole))
    {
        return fmt::format(
            "⬆️ <b>Изменение роли игрока</b>\n\n"
            "Клан: {} (<code>{}</code>)\n{}\n"
            "Игрок получил повышение.",
            utils::escapeHTML(clanName),
            utils::escapeHTML(clanTag),
            roleChange);
    }

    return fmt::format(
        "⬇️ <b>Изменение роли игрока</b>\n\n"
        "Клан: {} (<code>{}</code>)\n{}\n"
        "Игрок был понижен.",
        utils::escapeHTML(clanName),
        utils::escapeHTML(clanTag),
        roleChange);
}
