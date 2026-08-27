#include "reports/ClanwarsLeagueRoundEndedFormatter.h"

#include <sstream>
#include <unordered_map>

#include "common/StringUtils.h"
#include "reports/WarReportParts.h"

ClanwarsLeagueRoundEndedFormatter::ClanwarsLeagueRoundEndedFormatter(ClanwarsLeagueRepo& clanwarsLeagueRepo,
                                                                     ClanwarRepo& clanwarRepo) :
    clanwarsLeagueRepo(clanwarsLeagueRepo), clanwarRepo(clanwarRepo)
{
}

std::string ClanwarsLeagueRoundEndedFormatter::format(const ClanwarsLeagueRoundEndedEvent& event) const
{
    const auto reportData = ClanwarsLeagueRoundReportData{
        .cwlRoundInfo = clanwarsLeagueRepo.getRoundInfo(event.warReference),
        .warDetails = clanwarRepo.getWarRoundDetails(event.warReference)
    };

    return buildReport(reportData);
}

std::string ClanwarsLeagueRoundEndedFormatter::buildReport(const ClanwarsLeagueRoundReportData& reportData)
{
    const std::unordered_map<int, std::string> rounds = {
        {1, "ПЕРВОМУ"},
        {2, "ВТОРОМУ"},
        {3, "ТРЕТЬЕМУ"},
        {4, "ЧЕТВЁРТОМУ"},
        {5, "ПЯТОМУ"},
        {6, "ШЕСТОМУ"},
        {7, "СЕДЬМОМУ"},
    };

    const auto& bestAttacks = reportData.warDetails.best_attacks;

    std::ostringstream report;
    report << "🏆 <b>ОТЧЕТ ПО " << rounds.at(reportData.cwlRoundInfo.roundNumber) << " РАУНДУ ЛВК</b>\n";
    war_report::appendWarOverview(report, reportData.warDetails.home, reportData.warDetails.opponent);
    war_report::appendAttackStatistics(report, reportData.warDetails.attack_stats);
    war_report::appendBestAttacks(report, bestAttacks);

    return utils::removeTrailingNewlines(report.str());
}
