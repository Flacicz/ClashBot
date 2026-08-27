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
    const auto clanName = clansRepo.getClanNameByTag(event.clanTag);

    return buildReport(clanName, event.clanTag, event.playerName, event.playerTag);
}

std::string PlayerJoinedFormatter::buildReport(const std::string_view clanName, const std::string_view clanTag,
                                               const std::string_view playerName, const std::string_view playerTag)
{
    return fmt::format(
        "🟢 <b>Игрок присоединился к клану</b>\n\n"
        "Клан: {} (<code>{}</code>)\n"
        "Игрок: {} (<code>{}</code>)",
        utils::escapeHTML(clanName),
        utils::escapeHTML(clanTag),
        utils::escapeHTML(playerName),
        utils::escapeHTML(playerTag));
}
