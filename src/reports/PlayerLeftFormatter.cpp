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
    const auto clanName = clansRepo.getClanNameByTag(event.clanTag);

    return buildReport(clanName, event.clanTag, event.playerName, event.playerTag);
}

std::string PlayerLeftFormatter::buildReport(const std::string_view clanName, const std::string_view clanTag,
                                             const std::string_view playerName, const std::string_view playerTag)
{
    return fmt::format(
        "🔴 <b>Игрок покинул клан</b>\n\n"
        "Клан: {} (<code>{}</code>)\n"
        "Игрок: {} (<code>{}</code>)",
        utils::escapeHTML(clanName),
        utils::escapeHTML(clanTag),
        utils::escapeHTML(playerName),
        utils::escapeHTML(playerTag));
}
