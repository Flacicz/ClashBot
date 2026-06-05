#include "reports/RaidReportFormatter.h"

#include <sstream>

#include "database/database.h"
#include "spdlog/spdlog.h"

bool RaidReportFormatter::shouldNotify(const SyncResult& result, const Database& db) const
{
    if (!result.hasReportData()) return false;

    if (const auto& report = std::get<RaidReportData>(result.reportData); report.state != "ended")
    {
        return false;
    }

    return !db.isNotified(result.serviceName, result.reportEntityId);
}

std::string RaidReportFormatter::format(const SyncResult& result)
{
    auto slackers = std::get<RaidReportData>(result.reportData).raidSlackers;

    std::ostringstream report;
    report << "🏰 <b>ОТЧЕТ ПО РЕЙДАМ</b>\n";
    report << "Клан: <code>" << result.clanTag << "</code>\n\n";

    bool hasAnyProblems = false;

    std::ostringstream incompleteAttacks;
    std::ostringstream noAttacks;

    // Группа 1: Не закончили атаки
    for (const auto& slacker : slackers)
    {
        if (constexpr int MAX_ATTACKS = 6; slacker.attacksCount > 0 && slacker.attacksCount < MAX_ATTACKS)
        {
            incompleteAttacks << "➖ " << slacker.playerName << " [" << slacker.attacksCount << "/6]\n";
            hasAnyProblems = true;
        }
    }

    // Группа 2: Прогульщики
    for (const auto& slacker : slackers)
    {
        if (slacker.attacksCount == 0)
        {
            noAttacks << "❌ " << slacker.playerName << "\n";
            hasAnyProblems = true;
        }
    }

    if (!hasAnyProblems)
    {
        report << "✅ <b>Все участники отбили 6/6 атак!</b>\n";
        report << "<i>Отличная работа!</i>";
        return report.str();
    }

    if (!incompleteAttacks.str().empty())
    {
        report << "⚠️ <b>Не добили атаки:</b>\n" << incompleteAttacks.str() << "\n";
    }

    if (!noAttacks.str().empty())
    {
        report << "🚫 <b>Вообще не били:</b>\n" << noAttacks.str();
    }

    return report.str();
}

void RaidReportFormatter::onNotificationSent(const SyncResult& result, const Database& db) const
{
    if (!db.markAsNotified(result.serviceName, result.reportEntityId))
    {
        spdlog::error("[RaidFormatter] Failed to mark raid {} as notified", result.reportEntityId);
    }
}
