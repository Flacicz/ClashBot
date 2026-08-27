#include "reports/ClanwarsLeagueRoundViolationsFormatter.h"

#include <sstream>
#include <unordered_map>

#include "common/StringUtils.h"
#include "reports/WarReportParts.h"

ClanwarsLeagueRoundViolationsFormatter::ClanwarsLeagueRoundViolationsFormatter(
    ClanwarsLeagueRepo& clanwarsLeagueRepo,
    ClanwarRepo& clanwarRepo) :
    clanwarsLeagueRepo(clanwarsLeagueRepo),
    clanwarRepo(clanwarRepo)
{
}

std::string ClanwarsLeagueRoundViolationsFormatter::format(
    const ClanwarsLeagueRoundEndedEvent& event) const
{
    const auto roundInfo = clanwarsLeagueRepo.getRoundInfo(event.warReference);
    const auto missedAttacks = clanwarRepo.getSlackersWithNoAttacks(event.warReference);
    const auto notMirrorAttacks = clanwarRepo.getPlayersWithFirstAttackNotOnMirror(event.warReference);

    return buildReport(
        event.clanTag,
        roundInfo.roundNumber,
        missedAttacks,
        notMirrorAttacks
    );
}

std::string ClanwarsLeagueRoundViolationsFormatter::buildReport(
    const std::string_view clanTag,
    const int roundNumber,
    const std::vector<ClanwarSlacker>& missedAttacks,
    const std::vector<NotMirrorAttack>& notMirrorAttacks)
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

    std::ostringstream report;
    report << "⚠️ <b>НАРУШЕНИЯ ПО " << rounds.at(roundNumber) << " РАУНДУ ЛВК</b>\n";
    report << "Клан: <code>" << utils::escapeHTML(clanTag) << "</code>\n";

    if (missedAttacks.empty() && notMirrorAttacks.empty())
    {
        report << "\n";
        report << "✅ <b>Нарушений в раунде ЛВК не обнаружено!</b>\n";
        report << "<i>Отличная работа в лиге!</i>";
        return report.str();
    }

    war_report::appendNoAttackPlayers(
        report,
        missedAttacks,
        "Пропустили атаку в ЛВК",
        true
    );
    war_report::appendNotMirrorAttacks(report, notMirrorAttacks);

    return utils::removeTrailingNewlines(report.str());
}
