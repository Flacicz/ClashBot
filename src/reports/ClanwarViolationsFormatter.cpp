#include "reports/ClanwarViolationsFormatter.h"

#include <sstream>

#include "common/StringUtils.h"
#include "reports/WarReportParts.h"

ClanwarViolationsFormatter::ClanwarViolationsFormatter(ClanwarRepo& clanwarRepo) : clanwarRepo(clanwarRepo)
{
}

std::string ClanwarViolationsFormatter::format(const WarEndedEvent& event) const
{
    const auto missedAttacks = clanwarRepo.getSlackersWithNoAttacks(event.warReference);
    const auto oneAttackPlayers = clanwarRepo.getSlackersWithOneAttack(event.warReference);
    const auto notMirrorAttacks = clanwarRepo.getPlayersWithFirstAttackNotOnMirror(event.warReference);

    return buildReport(event.clanTag, missedAttacks, oneAttackPlayers, notMirrorAttacks);
}

std::string ClanwarViolationsFormatter::buildReport(
    const std::string_view clanTag,
    const std::vector<ClanwarSlacker>& missedAttacks,
    const std::vector<ClanwarSlacker>& oneAttackPlayers,
    const std::vector<NotMirrorAttack>& notMirrorAttacks)
{
    std::ostringstream report;
    report << "⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n";
    report << "Клан: <code>" << utils::escapeHTML(clanTag) << "</code>\n";

    if (missedAttacks.empty() && oneAttackPlayers.empty() && notMirrorAttacks.empty())
    {
        report << "\n";
        report << "✅ <b>Нарушений в войне кланов не обнаружено!</b>\n";
        report << "<i>Отличная работа!</i>";
        return report.str();
    }

    war_report::appendNoAttackPlayers(report, missedAttacks, "Не сделали ни одной атаки", false);
    war_report::appendOneAttackPlayers(report, oneAttackPlayers);
    war_report::appendNotMirrorAttacks(report, notMirrorAttacks);

    return utils::removeTrailingNewlines(report.str());
}
