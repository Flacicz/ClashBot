//
// Created by zuevm on 28.06.2026.
//

#include "reports/PlayerLeftFormatter.h"
#include "common/StringUtils.h"
#include <fmt/format.h>

PlayerLeftFormatter::PlayerLeftFormatter(ClansRepo& clansRepo) : clansRepo(clansRepo)
{
}

std::string PlayerLeftFormatter::format(const PlayerLeftClanEvent& event) const
{
    std::string message = fmt::format(
        "🔔 <b>Обновление состава клана {}(<code>{}</code>)</b>\n\n",
        utils::escapeHTML(clansRepo.getClanNameByTag(event.clanTag)),
        utils::escapeHTML(event.clanTag));

    message += fmt::format(
        "• Игрок {}(<code>{}</code>) покинул клан.\n",
        utils::escapeHTML(event.playerName),
        utils::escapeHTML(event.playerTag));

    return message;
}
