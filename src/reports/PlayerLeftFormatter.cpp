//
// Created by zuevm on 28.06.2026.
//

#include "reports/PlayerLeftFormatter.h"
#include "spdlog/fmt/bundled/format.h"

PlayerLeftFormatter::PlayerLeftFormatter(ClansRepo& clansRepo) : clansRepo(clansRepo)
{
}

std::string PlayerLeftFormatter::format(const PlayerLeftClanEvent& event) const
{
    std::string message = fmt::format("🔔 <b>Обновление состава клана {}(<code>{}</code>)</b>\n\n",
                                      clansRepo.getClanNameByTag(event.clanTag), event.clanTag);

    message += fmt::format("• Игрок {}(<code>{}</code>) покинул клан.\n", event.playerName,
                           event.playerTag);

    return message;
}
