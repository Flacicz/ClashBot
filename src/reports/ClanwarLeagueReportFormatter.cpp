#include "reports/ClanwarLeagueReportFormatter.h"

#include <sstream>

std::string ClanwarLeagueReportFormatter::format(const SyncResult& result)
{
    auto& round = std::get<ClanwarsLeagueReportData>(result.reportData).round;
    auto& attacks = std::get<ClanwarsLeagueReportData>(result.reportData).attacks;

    std::ostringstream report;
    report << "🏆 <b>ОТЧЕТ ПО ЛВК (Раунд " << round.round << ")</b>\n";
    report << "Клан: <code>" << result.clanTag << "</code>\n";
    report << "Тег войны: <code>" << round.warTag << "</code>\n\n";

    bool hasAnySlackers = false;
    std::ostringstream missedAll;
    std::ostringstream wrongTarget;

    for (const auto& attack : attacks)
    {
        // Проверяем только атаки нашего клана в рамках этого раунда
        if (attack.warTag == round.warTag && attack.attackerClanTag == result.clanTag)
        {
            if (attack.rules == "Missed")
            {
                missedAll << "❌ " << attack.attackerTag << "\n";
                hasAnySlackers = true;
            }
            else if (attack.rules == "Not mirror")
            {
                wrongTarget << "⚠️ " << attack.attackerTag << " (Бил не зеркало)\n";
                hasAnySlackers = true;
            }
        }
    }

    if (!hasAnySlackers)
    {
        report << "✅ <b>Все участники провели атаки без нарушений!</b>\n";
        report << "<i>Молодцы!</i>";
        return report.str();
    }

    report << "<b>НАРУШИТЕЛИ:</b>\n";

    if (!missedAll.str().empty())
    {
        report << "\n🚫 <b>Не били вообще:</b>\n" << missedAll.str();
    }
    if (!wrongTarget.str().empty())
    {
        report << "\n🎯 <b>Атаковали не зеркало:</b>\n" << wrongTarget.str();
    }

    return report.str();
}
