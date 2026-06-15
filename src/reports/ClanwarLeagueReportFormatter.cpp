#include "reports/ClanwarLeagueReportFormatter.h"

#include <sstream>
#include <variant>
#include <algorithm>

#include "database/database.h"
#include "spdlog/spdlog.h"

bool ClanwarLeagueReportFormatter::shouldNotify(const SyncResult& result, const Database& db) const
{
    if (!result.hasReportData()) return false;

    if (result.reportEntityId <= 0)
    {
        return false;
    }

    return !db.isNotified(result.serviceName, result.reportEntityId);
}

std::string ClanwarLeagueReportFormatter::format(const SyncResult& result)
{
    const auto& leagueData = std::get<ClanwarsLeagueReportData>(result.reportData);

    // 2. Ищем в векторе раундов именно ту войну, которая завершилась прямо сейчас (по ее id)
    auto it = std::ranges::find_if(leagueData.reports,
                                   [targetId = result.reportEntityId](const ClanwarReportData& warReport)
                                   {
                                       return warReport.clanwarId == targetId;
                                   });

    // Предохранитель на случай, если отчет не найден (не должно происходить)
    if (it == leagueData.reports.end())
    {
        return "⚠️ <b>Ошибка:</b> Данные по завершенному раунду ЛВК не найдены.";
    }

    const auto& currentWar = *it;
    const auto& homeClan = currentWar.clanwars.first;
    const auto& oppClan = currentWar.clanwars.second;

    std::ostringstream report;
    report << "🏆 <b>ОТЧЕТ ПО РАУНДУ ЛВК</b>\n";
    report << "Клан: <code>" << homeClan.clanTag << "</code>\n";
    report << "Соперник: " << oppClan.clanName << " (<code>" << oppClan.clanTag << "</code>)\n";
    report << "Счет: ⭐️ " << homeClan.stars << " - " << oppClan.stars << " ⭐️\n";
    report << "Разрушение: 💥 " << fmt::format("{:.2f}%", homeClan.destructionPercentage)
        << " - " << fmt::format("{:.2f}%", oppClan.destructionPercentage) << "\n\n";

    // В ЛВК те, кто пропустил все атаки (missedAllAttacks), по сути пропустили единственную атаку [0/1]
    const auto& slackers = currentWar.missedAllAttacks;
    const auto& notMirror = currentWar.notMirror;

    if (slackers.empty() && notMirror.empty())
    {
        report << "✅ <b>Все участники раунда провели атаку без нарушений!</b>\n";
        report << "<i>Отличная работа в лиге!</i>";
        return report.str();
    }

    std::ostringstream missedAttack;
    std::ostringstream wrongTarget;

    for (const auto& [playerTag, playerName] : slackers)
    {
        missedAttack << "• " << playerName << " [0/1]\n";
    }

    for (const auto& [playerTag, playerName] : notMirror)
    {
        wrongTarget << "• " << playerName << "\n";
    }

    report << "<b>НАРУШИТЕЛИ РАУНДА:</b>\n";

    if (!missedAttack.str().empty())
    {
        report << "\n🔴 <b>Пропустили атаку в ЛВК:</b>\n" << missedAttack.str();
    }

    if (!wrongTarget.str().empty())
    {
        report << "\n🎯 <b>Атаковали не по зеркалу:</b>\n" << wrongTarget.str();
    }

    return report.str();
}

void ClanwarLeagueReportFormatter::onNotificationSent(const SyncResult& result, const Database& db) const
{
    if (!db.markAsNotified(result.serviceName, result.reportEntityId))
    {
        spdlog::error("[CWLFormatter] Failed to mark war {} as notified", result.reportEntityId);
    }
}
