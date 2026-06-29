//
// Created by zuevm on 27.06.2026.
//

#include "reports/PlayerJoinedFormatter.h"

#include "spdlog/fmt/bundled/format.h"

PlayerJoinedFormatter::PlayerJoinedFormatter(ClansRepo& clansRepo) : clansRepo(clansRepo)
{
}

std::string PlayerJoinedFormatter::format(const PlayerJoinedClanEvent& event) const
{
    std::string message = fmt::format("🔔 <b>Обновление состава клана {}(<code>{}</code>)</b>\n\n",
                                      clansRepo.getClanNameByTag(event.clanTag), event.clanTag);

    message += fmt::format("• Игрок {}(<code>{}</code>) присоединился к клану.\n", event.playerName,
                           event.playerTag);

    return message;
}
