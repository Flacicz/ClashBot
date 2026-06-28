#include "reports/RaidsEndedFormatter.h"

#include <sstream>

#include "common/SyncResult.h"
#include "database/database.h"
#include "events/DomainEvents.h"
#include "spdlog/spdlog.h"

RaidsEndedFormatter::RaidsEndedFormatter(RaidRepo& raidRepo) : raidRepo(raidRepo)
{
}

std::string RaidsEndedFormatter::format(const RaidsEndedEvent& result) const
{
    const auto report = raidRepo.getRaidsReportData(result.raidsId, result.clanTag);

    return buildReport(report);
}

std::string RaidsEndedFormatter::buildReport(const RaidReportData& reportData)
{
    std::ostringstream report;
    report << "🏰 <b>ОТЧЕТ ПО РЕЙДАМ</b>\n";
    report << "Клан: <code>" << reportData.clanTag << "</code>\n\n";

    bool hasAnyProblems = false;
    auto slackers = reportData.raidSlackers;

    std::ostringstream incompleteAttacks;
    std::ostringstream noAttacks;

    for (const auto& slacker : slackers)
    {
        if (constexpr int MAX_ATTACKS = 6; slacker.attacksCount > 0 && slacker.attacksCount < MAX_ATTACKS)
        {
            incompleteAttacks << "• " << slacker.playerName << " [" << slacker.attacksCount << "/6]\n";
            hasAnyProblems = true;
        }
        else if (slacker.attacksCount == 0)
        {
            noAttacks << "• " << slacker.playerName << "\n";
            hasAnyProblems = true;
        }
    }

    if (!hasAnyProblems)
    {
        report << "✅ <b>Все участники сделали 6/6 атак!</b>\n";
        report << "<i>Отличная работа!</i>";
        return report.str();
    }

    if (!incompleteAttacks.str().empty())
    {
        report << "⚠️ <b>Не доделали атаки:</b>\n" << incompleteAttacks.str() << "\n";
    }

    if (!noAttacks.str().empty())
    {
        report << "🚫 <b>Вообще не сделали атаки:</b>\n" << noAttacks.str();
    }

    return report.str();
}

