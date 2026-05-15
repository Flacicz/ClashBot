//
// Created by zuevm on 13.05.2026.
//

#include "reports/ClanwarReportFormatter.h"
#include "common/SyncResult.h"

#include <ranges>
#include <sstream>
#include <unordered_map>

std::string ClanwarReportFormatter::format(const SyncResult& result)
{
    auto [clanTag, attacks, summary] = std::get<ClanwarReportData>(result.reportData);

    std::ostringstream report;
    report << "⚔️ <b>ОТЧЕТ ПО КВ</b>\n";
    report << "Клан: <code>" << clanTag << "</code>\n";
    report << "Соперник: " << summary.opponentName << " (<code>" << summary.opponentTag <<
        "</code>)\n";

    if (summary.result == "win") report << "🏆 <b>ПОБЕДА!</b>\n";
    else if (summary.result == "lose") report << "💀 <b>ПОРАЖЕНИЕ</b>\n";
    else if (summary.result == "tie") report << "🤝 <b>НИЧЬЯ</b>\n";

    report << "Счет: ⭐️ " << summary.clanStars << " - " << summary.opponentStars << " ⭐️\n\n";

    std::unordered_map<std::string, std::pair<std::string, std::string>> slackers;
    bool hasAnySlackers = false;

    for (const auto& attack : attacks)
    {
        if (attack.isOpponentAttack) continue;

        if (attack.rules == "Missed" || attack.rules == "Missed (1/2)" || attack.rules == "Not mirror")
        {
            slackers[attack.attackerTag] = {attack.attackerName, attack.rules};
            hasAnySlackers = true;
        }
    }

    if (!hasAnySlackers)
    {
        report << "✅ <b>Все участники провели атаки без нарушений!</b>\n";
        report << "<i>Молодцы!</i>";
        return report.str();
    }

    std::ostringstream missedAll;
    std::ostringstream missedOne;
    std::ostringstream wrongTarget;

    for (const auto& [fst, snd] : slackers | std::views::values)
    {
        const std::string& name = fst;

        if (const std::string& rule = snd; rule == "Missed")
        {
            missedAll << "❌ " << name << " [0/2]\n";
        }
        else if (rule == "Missed (1/2)")
        {
            missedOne << "➖ " << name << " [1/2]\n";
        }
        else
        {
            wrongTarget << "⚠️ " << name << " (Бил не зеркало)\n";
        }
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
