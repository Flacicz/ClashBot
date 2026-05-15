#include "../../include/reports/RaidReportFormatter.h"

#include <sstream>
#include <unordered_set>

std::string RaidReportFormatter::format(const SyncResult& result)
{
    auto participants = std::get<RaidReportData>(result.reportData).playerRaidStats;
    auto players = std::get<RaidReportData>(result.reportData).players;

    std::unordered_set<std::string> participant_tags;
    for (const auto& p : participants) {
        participant_tags.insert(p.playerTag);
    }

    std::ostringstream report;
    report << "🏰 <b>ОТЧЕТ ПО РЕЙДАМ</b>\n";
    report << "Клан: <code>" << result.clanTag << "</code>\n\n";

    bool hasAnyProblems = false;

    std::ostringstream incompleteAttacks;
    std::ostringstream noAttacks;

    // Группа 1: Не закончили атаки
    for (const auto& p : participants) {
        if (constexpr int MAX_ATTACKS = 6; p.attacksCount > 0 && p.attacksCount < MAX_ATTACKS) {
            incompleteAttacks << "➖ " << p.name << " [" << p.attacksCount << "/6]\n";
            hasAnyProblems = true;
        }
    }

    // Группа 2: Прогульщики
    for (const auto& player : players) {
        if (!participant_tags.contains(player.tag)) {
            noAttacks << "❌ " << player.name << "\n";
            hasAnyProblems = true;
        }
    }

    if (!hasAnyProblems) {
        report << "✅ <b>Все участники отбили 6/6 атак!</b>\n";
        report << "<i>Отличная работа!</i>";
        return report.str(); // Если все ок, возвращаем короткое сообщение
    }

    if (!incompleteAttacks.str().empty()) {
        report << "⚠️ <b>Не добили атаки:</b>\n" << incompleteAttacks.str() << "\n";
    }

    if (!noAttacks.str().empty()) {
        report << "🚫 <b>Вообще не били:</b>\n" << noAttacks.str();
    }

    return report.str();
}


