//
// Created by zuevm on 28.06.2026.
//

#include "reports/PlayerLeftFormatter.h"

#include <fmt/format.h>

#include "common/StringUtils.h"

PlayerLeftFormatter::PlayerLeftFormatter(ClansRepo& clansRepo) : clansRepo(clansRepo)
{
}

std::string PlayerLeftFormatter::format(const PlayerLeftClanEvent& event) const
{
    return fmt::format(
        "🔴 <b>Игрок покинул клан</b>\n\n"
        "Клан: {} (<code>{}</code>)\n"
        "Игрок: {} (<code>{}</code>)",
        utils::escapeHTML(clansRepo.getClanNameByTag(event.clanTag)),
        utils::escapeHTML(event.clanTag),
        utils::escapeHTML(event.playerName),
        utils::escapeHTML(event.playerTag));
}
