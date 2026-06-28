//
// Created by zuevm on 28.06.2026.
//

#include "reports/PlayerLeftFormatter.h"
#include "spdlog/fmt/bundled/format.h"

std::string PlayerLeftFormatter::format(const PlayerLeftClanEvent& event)
{
    std::string message = fmt::format("🔔 <b>Обновление состава клана {}</b>\n\n", event.clanTag);

    message += fmt::format("• Игрок {}(<code>{}</code>) присоединился к клану.\n", event.playerName,
                           event.playerTag);

    return message;
}
