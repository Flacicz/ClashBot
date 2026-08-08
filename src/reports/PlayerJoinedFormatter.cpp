//
// Created by zuevm on 27.06.2026.
//

#include "reports/PlayerJoinedFormatter.h"
#include "common/StringUtils.h"
#include <fmt/format.h>

PlayerJoinedFormatter::PlayerJoinedFormatter(ClansRepo& clansRepo) : clansRepo(clansRepo)
{
}

std::string PlayerJoinedFormatter::format(const PlayerJoinedClanEvent& event) const
{
    std::string message = fmt::format(
        "🔔 <b>Обновление состава клана {}(<code>{}</code>)</b>\n\n",
        utils::escapeHTML(clansRepo.getClanNameByTag(event.clanTag)),
        utils::escapeHTML(event.clanTag));

    message += fmt::format(
        "• Игрок {}(<code>{}</code>) присоединился к клану.\n",
        utils::escapeHTML(event.playerName),
        utils::escapeHTML(event.playerTag));

    return message;
}
