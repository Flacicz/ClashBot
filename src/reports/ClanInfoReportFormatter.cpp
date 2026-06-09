#include <reports/ClanInfoReportFormatter.h>
#include "database/database.h"

#include "spdlog/fmt/bundled/compile.h"

bool ClanInfoReportFormatter::shouldNotify(const SyncResult& result, const Database& db) const
{
    if (!result.hasReportData()) return false;

    if (const auto& [clanTag, leaveJoinPlayers] =
        std::get<ClanReportData>(result.reportData); leaveJoinPlayers.first.empty() && leaveJoinPlayers.second.empty())
    {
        return false;
    }

    return true;
}

std::string ClanInfoReportFormatter::format(const SyncResult& result)
{
    auto [fst, snd] = std::get<ClanReportData>(result.reportData).leaveJoinPlayers;

    std::string message = fmt::format("🔔 <b>Обновление состава клана {}</b>\n\n", result.clanTag);

    if (!snd.empty())
    {
        message += "➕ <b>Пришли в клан:</b>\n";
        for (const auto& player : snd)
        {
            message += fmt::format("• {} (<code>{}</code>)\n", player.name, player.tag);
        }
        message += "\n";
    }

    if (!fst.empty())
    {
        message += "➖ <b>Покинули клан:</b>\n";
        for (const auto& player : fst)
        {
            message += fmt::format("• {} (<code>{}</code>)\n", player.name, player.tag);
        }
    }

    return message;
}

void ClanInfoReportFormatter::onNotificationSent(const SyncResult& result, const Database& db) const
{
}
