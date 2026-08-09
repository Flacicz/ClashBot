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
    const auto ids = event.insertedWarResult;

    const auto reportData = ClanwarsLeagueRoundReportData{
        .cwlRoundInfo = clanwarsLeagueRepo.getRoundInfo(ids.warId),
        .warDetails = clanwarRepo.getWarRoundDetails(ids)
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

    const auto& missedAttacks = reportData.warDetails.missedAttack;
    const auto& bestAttacks = reportData.warDetails.best_attacks;
    const auto& notMirrorAttacks = reportData.warDetails.notMirrorAttacks;

    std::ostringstream report;
    report << "🏆 <b>ОТЧЕТ ПО " << rounds.at(reportData.cwlRoundInfo.roundNumber) << " РАУНДУ ЛВК</b>\n";
    war_report::appendWarOverview(report, reportData.warDetails.home, reportData.warDetails.opponent);
    war_report::appendAttackStatistics(report, reportData.warDetails.attack_stats);
    war_report::appendBestAttacks(report, bestAttacks);

    if (missedAttacks.empty() && notMirrorAttacks.empty())
    {
        report << "✅ <b>Все участники раунда провели атаку без нарушений!</b>\n";
        report << "<i>Отличная работа в лиге!</i>";
        return report.str();
    }

    std::ostringstream missedAttack;

    for (const auto& [playerTag, playerName] : missedAttacks)
    {
        missedAttack << "• " << utils::escapeHTML(playerName) << " [0/1]\n";
    }

    report << "<b>НАРУШИТЕЛИ РАУНДА:</b>\n";

    if (!missedAttack.str().empty())
    {
        report << "\n🔴 <b>Пропустили атаку в ЛВК:</b>\n" << missedAttack.str();
    }

    if (notMirrorAttacks.empty()) report << "\n🎯 <b>Атак не по зеркалу не обнаружено! Все молодцы!</b>\n";
    else war_report::appendNotMirrorAttacks(report, notMirrorAttacks);

    return report.str();
}
