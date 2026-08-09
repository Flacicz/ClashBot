#include "reports/ClanwarEndedFormatter.h"

#include <sstream>

#include "common/StringUtils.h"
#include "reports/WarReportParts.h"

ClanwarEndedFormatter::ClanwarEndedFormatter(ClanwarRepo& repo) : clanwarRepo(repo)
{
}

std::string ClanwarEndedFormatter::format(const WarEndedEvent& event) const
{
    const auto ids = event.insertedWarResult;
    const auto reportData = clanwarRepo.getReportData(ids);

    return buildReport(reportData);
}

std::string ClanwarEndedFormatter::buildReport(const ClanwarReportData& reportData)
{
    const auto& slackersWithNoAttacks = reportData.missedAllAttacks;
    const auto& slackersWithOneAttack = reportData.missedOneAttack;
    const auto& bestAttacks = reportData.best_attacks;
    const auto& notMirrorAttacks = reportData.notMirrorAttacks;

    std::ostringstream report;
    report << "⚔️ <b>ОТЧЕТ ПО КВ</b>\n";
    war_report::appendWarOverview(report, reportData.home, reportData.opponent);
    war_report::appendAttackStatistics(report, reportData.attack_stats);
    war_report::appendBestAttacks(report, bestAttacks);

    if (slackersWithNoAttacks.empty() && slackersWithOneAttack.empty() && notMirrorAttacks.empty())
    {
        report << "✅ <b>Все участники провели атаки без нарушений!</b>\n";
        report << "<i>Молодцы!</i>";
        return report.str();
    }

    std::ostringstream missedAll;
    std::ostringstream missedOne;

    for (const auto& [playerTag, playerName] : slackersWithNoAttacks)
    {
        missedAll << "• " << utils::escapeHTML(playerName) << " [0/2]\n";
    }

    for (const auto& [playerTag, playerName] : slackersWithOneAttack)
    {
        missedOne << "• " << utils::escapeHTML(playerName) << " [1/2]\n";
    }

    report << "<b>Нарушители по итогам войны:</b>\n";

    if (!missedAll.str().empty())
    {
        report << "\n🔴 <b>Пропустили все атаки:</b>\n" << missedAll.str();
    }

    if (!missedOne.str().empty())
    {
        report << "\n🟡 <b>Не использовали вторую атаку:</b>\n" << missedOne.str();
    }

    war_report::appendNotMirrorAttacks(report, notMirrorAttacks);

    return report.str();
}
