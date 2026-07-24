#include "reports/RaidsEndedFormatter.h"

#include <sstream>

#include "database/database.h"
#include "events/ApplicationEvents.h"
#include "spdlog/spdlog.h"

RaidsEndedFormatter::RaidsEndedFormatter(ClansRepo& clansRepo, RaidRepo& raidRepo) : clansRepo(clansRepo),
    raidRepo(raidRepo)
{
}

std::string RaidsEndedFormatter::format(const RaidsEndedEvent& event) const
{
    const RaidReportData reportData = {
        .clanTag = event.clanTag,
        .clanName = clansRepo.getClanNameByTag(event.clanTag),
        .raidSlackers = raidRepo.getRaidSlackers(event.raidsId, event.clanTag)
    };

    return buildReport(reportData);
}

std::string RaidsEndedFormatter::buildReport(const RaidReportData& reportData)
{
    std::ostringstream report;
    report << "🏰 <b>ОТЧЕТ ПО РЕЙДАМ</b>\n";
    report << "Клан: " << reportData.clanName << " (<code>" << reportData.clanTag << "</code>)\n\n";

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
