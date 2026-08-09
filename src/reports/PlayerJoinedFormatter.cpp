//
// Created by zuevm on 27.06.2026.
//

#include "reports/PlayerJoinedFormatter.h"

#include <fmt/format.h>

#include "common/StringUtils.h"

PlayerJoinedFormatter::PlayerJoinedFormatter(ClansRepo& clansRepo) : clansRepo(clansRepo)
{
}

std::string PlayerJoinedFormatter::format(const PlayerJoinedClanEvent& event) const
{
    return fmt::format(
        "🟢 <b>Игрок присоединился к клану</b>\n\n"
        "Клан: {} (<code>{}</code>)\n"
        "Игрок: {} (<code>{}</code>)",
        utils::escapeHTML(clansRepo.getClanNameByTag(event.clanTag)),
        utils::escapeHTML(event.clanTag),
        utils::escapeHTML(event.playerName),
        utils::escapeHTML(event.playerTag));
}
