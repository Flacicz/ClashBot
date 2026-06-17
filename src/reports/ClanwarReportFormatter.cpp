#include "reports/ClanwarReportFormatter.h"

#include <sstream>

#include "database/database.h"
#include "spdlog/spdlog.h"

bool ClanwarReportFormatter::shouldNotify(const SyncResult& result, const Database& db, long long chatId) const
{
    if (!result.hasReportData()) return false;

    if (const auto& report = std::get<ClanwarReportData>(result.reportData); report.state != "warEnded")
    {
        return false;
    }

    return !db.isNotified(result.serviceName, result.reportEntityId, chatId);
}

std::string ClanwarReportFormatter::format(const SyncResult& result)
{
    auto reportData = std::get<ClanwarReportData>(result.reportData);
    auto slackersWithNoAttacks = reportData.missedAllAttacks;
    auto slackersWithOneAttack = reportData.missedOneAttack;
    auto notMirror = reportData.notMirror;

    std::ostringstream report;
    report << "⚔️ <b>ОТЧЕТ ПО КВ</b>\n";
    report << "Клан: <code>" << reportData.clanwars.first.clanTag << "</code>\n";
    report << "Соперник: " << reportData.clanwars.second.clanName << " (<code>" << reportData.clanwars.second.clanTag <<
        "</code>)\n";

    report << "Счет: ⭐️ " << reportData.clanwars.first.stars << " - " << reportData.clanwars.second.stars << " ⭐️\n\n";
    report << "Разрушение: 💥 " << fmt::format("{:.2f}%", reportData.clanwars.first.destructionPercentage)
        << " - " << fmt::format("{:.2f}%", reportData.clanwars.second.destructionPercentage) << "\n\n";

    if (slackersWithNoAttacks.empty() && slackersWithOneAttack.empty() && notMirror.empty())
    {
        report << "✅ <b>Все участники провели атаки без нарушений!</b>\n";
        report << "<i>Молодцы!</i>";
        return report.str();
    }

    std::ostringstream missedAll;
    std::ostringstream missedOne;
    std::ostringstream wrongTarget;

    for (const auto& [playerTag, playerName] : slackersWithNoAttacks)
    {
        missedAll << "• " << playerName << " [0/2]\n";
    }

    for (const auto& [playerTag, playerName] : slackersWithOneAttack)
    {
        missedOne << "• " << playerName << " [1/2]\n";
    }

    for (const auto& [playerTag, playerName] : notMirror)
    {
        wrongTarget << "• " << playerName << "\n";
    }

    // Формирование итогового отчета
    report << "<b>НАРУШИТЕЛИ ПО ИТОГАМ ВОЙНЫ:</b>\n";

    if (!missedAll.str().empty())
    {
        report << "\n🔴 <b>Пропустили все атаки:</b>\n" << missedAll.str();
    }

    if (!missedOne.str().empty())
    {
        report << "\n🟡 <b>Не использовали вторую атаку:</b>\n" << missedOne.str();
    }

    if (!wrongTarget.str().empty())
    {
        report << "\n🎯 <b>Атаковали не по зеркалу:</b>\n" << wrongTarget.str();
    }

    return report.str();
}

void ClanwarReportFormatter::onNotificationSent(const SyncResult& result, const Database& db, long long chatId) const
{
    if (!db.markAsNotified(result.serviceName, result.reportEntityId, chatId))
    {
        spdlog::error("[RaidFormatter] Failed to mark raid {} as notified", result.reportEntityId);
    }
}
