#include "reports/ClanwarEndedFormatter.h"

#include <sstream>

#include "reports/WarReportParts.h"

ClanwarEndedFormatter::ClanwarEndedFormatter(ClanwarRepo& repo) : clanwarRepo(repo)
{
}

std::string ClanwarEndedFormatter::format(const WarEndedEvent& event) const
{
    const auto ids = event.insertedWarResult;
    const auto reportData = clanwarRepo.getClanwarResultReportData(ids);

    return buildReport(reportData);
}

std::string ClanwarEndedFormatter::buildReport(const ClanwarResultReportData& reportData)
{
    const auto& bestAttacks = reportData.bestAttacks;
    const auto& disciplineStats = reportData.disciplineStats;

    std::ostringstream report;
    report << "⚔️ <b>ИТОГ ВОЙНЫ КЛАНОВ</b>\n";
    war_report::appendWarOverview(report, reportData.home, reportData.opponent);
    war_report::appendAttackStatistics(report, reportData.attackStats);
    war_report::appendBestAttacks(report, bestAttacks);
    war_report::appendDisciplineSummary(report, disciplineStats);

    return report.str();
}
