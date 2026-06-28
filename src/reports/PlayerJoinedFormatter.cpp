//
// Created by zuevm on 27.06.2026.
//

#include "reports/PlayerJoinedFormatter.h"

#include "spdlog/fmt/bundled/format.h"

std::string PlayerJoinedFormatter::format(const PlayerJoinedClanEvent& event)
{
    std::string message = fmt::format("🔔 <b>Обновление состава клана {}</b>\n\n", event.clanTag);

    message += fmt::format("• Игрок {}(<code>{}</code>) присоединился к клану.\n", event.playerName,
                           event.playerTag);

    return message;
}
