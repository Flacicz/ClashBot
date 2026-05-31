#include "reports/ClanwarReportFormatter.h"

#include <sstream>

bool ClanwarReportFormatter::shouldNotify(const SyncResult& result) const
{
    if (!result.hasReportData()) return false;

    if (const auto& report = std::get<ClanwarReportData>(result.reportData); report.state != "ended") {
        return false;
    }

    return true;
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
        missedAll << "❌ " << playerName << " [0/2]\n";
    }

    for (const auto& [playerTag, playerName] : slackersWithOneAttack)
    {
        missedOne << "❌ " << playerName << " [0/2]\n";
    }

    for (const auto& [playerTag, playerName] : notMirror)
    {
        wrongTarget << "❌ " << playerName << " [0/2]\n";
    }

    report << "<b>НАРУШИТЕЛИ:</b>\n";

    if (!missedAll.str().empty())
    {
        report << "\n🚫 <b>Не били вообще:</b>\n" << missedAll.str();
    }
    if (!missedOne.str().empty())
    {
        report << "\n⚠️ <b>Сделали только 1 атаку:</b>\n" << missedOne.str();
    }
    if (!wrongTarget.str().empty())
    {
        report << "\n🎯 <b>Атаковали не зеркало:</b>\n" << wrongTarget.str();
    }

    return report.str();
}
