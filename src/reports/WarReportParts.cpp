#include "reports/WarReportParts.h"

#include <fmt/format.h>

#include "common/StringUtils.h"

namespace
{
    void appendWinner(std::ostream& report,
                      const int homeStars, const int opponentStars,
                      const double homeDestruction, const double opponentDestruction)
    {
        if (homeStars > opponentStars ||
            (homeStars == opponentStars && homeDestruction > opponentDestruction))
        {
            report << "Итог: Победа\n\n";
            return;
        }

        if (homeStars < opponentStars ||
            (homeStars == opponentStars && homeDestruction < opponentDestruction))
        {
            report << "Итог: Поражение\n\n";
            return;
        }

        report << "Итог: Ничья\n\n";
    }
}

namespace war_report
{
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

        appendWinner(report, home.stars, opponent.stars,
                     home.destructionPercentage, opponent.destructionPercentage);
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

    void appendDisciplineSummary(std::ostream& report,
                                 const ClanwarDisciplineStats& disciplineStats)
    {
        const bool hasNoViolations =
            disciplineStats.playersWithoutAttacks == 0 &&
            disciplineStats.playersWithoutSecondAttack == 0 &&
            disciplineStats.notMirrorAttacks == 0;

        report << "🎯 <b>ДИСЦИПЛИНА</b>\n";

        if (hasNoViolations)
        {
            report << "✅ Все участники использовали атаки по правилам!";
            return;
        }

        report << "⚠️ Есть замечания:\n";
        report << "Без атак: " << disciplineStats.playersWithoutAttacks << "\n";
        report << "Без второй атаки: " << disciplineStats.playersWithoutSecondAttack << "\n";
        report << "Атаки не по зеркалу: " << disciplineStats.notMirrorAttacks << "\n";
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

    void appendNotMirrorAttacks(std::ostream& report,
                                const std::vector<NotMirrorAttack>& attacks)
    {
        if (attacks.empty()) return;

        report << "\n🎯 <b>Атаки не по зеркалу (" << attacks.size() << "):</b>\n";

        for (const auto& attack : attacks)
        {
            report << "• " << utils::escapeHTML(attack.attackerName)
                << " (№" << attack.attackerPosition
                << " ➜ №" << attack.defenderPosition << ")\n";
        }
    }
}
