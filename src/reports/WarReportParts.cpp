#include "reports/WarReportParts.h"

#include <ostream>
#include <fmt/format.h>

#include "common/ClanwarUtils.h"
#include "common/StringUtils.h"

namespace war_report
{
    void appendOutcome(std::ostream& report, const ClanwarOutcome outcome)
    {
        switch (outcome)
        {
        case ClanwarOutcome::Victory:
            report << "Итог: Победа\n\n";
            break;

        case ClanwarOutcome::Defeat:
            report << "Итог: Поражение\n\n";
            break;

        case ClanwarOutcome::Draw:
            report << "Итог: Ничья\n\n";
            break;
        }
    }

    void appendWarOverview(std::ostream& report,
                           const ClanwarOverview& home,
                           const ClanwarOverview& opponent)
    {
        report << "Клан: " << utils::escapeHTML(home.clanName) << " (<code>"
            << utils::escapeHTML(home.clanTag) << "</code>)\n";
        report << "Соперник: " << utils::escapeHTML(opponent.clanName) << " (<code>"
            << utils::escapeHTML(opponent.clanTag) << "</code>)\n\n";

        report << "Счет: ⭐️ " << home.stars << " - " << opponent.stars << " ⭐️\n";
        report << "Разрушение: 💥 " << fmt::format("{:.2f}%", home.destructionPercentage)
            << " - " << fmt::format("{:.2f}%", opponent.destructionPercentage) << "\n\n";

        const auto outcome = clanwar_utils::calculateClanwarOutcome(
            home.stars,
            opponent.stars,
            home.destructionPercentage,
            opponent.destructionPercentage);

        appendOutcome(report, outcome);
    }

    void appendAttackStatistics(std::ostream& report,
                                const ClanwarAttackStats& attackStats)
    {
        report << "📊 <b>СТАТИСТИКА АТАК</b>\n";
        report << "Проведено атак: " << attackStats.attacksUsed
            << "/" << attackStats.maxAttacks << "\n";
        report << "Средний результат: "
            << fmt::format("{:.2f}", attackStats.averageStars)
            << " ⭐ за атаку\n";
        report << "Среднее разрушение: "
            << fmt::format("{:.2f}%", attackStats.averageDestruction) << "\n";
        report << "Распределение атак:\n"
            << "3⭐ — " << attackStats.threeStarAttacks << "\n"
            << "2⭐ — " << attackStats.twoStarAttacks << "\n"
            << "1⭐ — " << attackStats.oneStarAttacks << "\n"
            << "0⭐ — " << attackStats.zeroStarAttacks << "\n\n";
    }

    void appendBestAttacks(std::ostream& report,
                           const std::vector<BestAttack>& bestAttacks)
    {
        if (bestAttacks.empty()) return;

        report << "🏅 <b>ЛУЧШИЕ АТАКИ</b>\n";

        int attackNumber = 1;
        for (const auto& attack : bestAttacks)
        {
            report << attackNumber++ << ". "
                << utils::escapeHTML(attack.attackerName)
                << " — " << attack.stars << "⭐, "
                << fmt::format("{:.2f}%", attack.destructionPercentage)
                << " (№" << attack.attackerPosition
                << " ➜ №" << attack.defenderPosition << ")\n";
        }

        report << "\n";
    }

    void appendNoAttackPlayers(std::ostream& report,
                               const std::vector<ClanwarSlacker>& players,
                               const std::string_view sectionTitle,
                               const bool includeAttackLimit)
    {
        if (players.empty()) return;

        report << "\n🔴 <b>" << sectionTitle << ":</b>\n";

        for (const auto& player : players)
        {
            report << "• " << utils::escapeHTML(player.playerName);

            if (includeAttackLimit)
            {
                report << " [0/1]";
            }

            report << "\n";
        }
    }

    void appendOneAttackPlayers(std::ostream& report,
                                const std::vector<ClanwarSlacker>& players)
    {
        if (players.empty()) return;

        report << "\n🟡 <b>Сделали только одну атаку:</b>\n";

        for (const auto& player : players)
        {
            report << "• " << utils::escapeHTML(player.playerName) << "\n";
        }
    }

    void appendNotMirrorAttacks(std::ostream& report,
                                const std::vector<NotMirrorAttack>& attacks)
    {
        if (attacks.empty()) return;

        report << "\n🎯 <b>Атаки не по зеркалу:</b>\n";

        for (const auto& attack : attacks)
        {
            report << "• " << utils::escapeHTML(attack.attackerName)
                << " (№" << attack.attackerPosition
                << " ➜ №" << attack.defenderPosition << ")\n";
        }
    }
}
