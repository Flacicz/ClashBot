#include "reports/WarReportParts.h"

#include <fmt/format.h>
#include <sstream>
#include <unordered_map>
#include <utility>

#include "common/StringUtils.h"

namespace
{
    void appendWinner(std::ostream& report,
                      int homeStars, int opponentStars,
                      double homeDestruction, double opponentDestruction)
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

    NormalizePositions normalizePositions(
        const std::vector<WarRoundMember>& homeMembers,
        const std::vector<WarRoundMember>& opponentMembers)
    {
        std::unordered_map<std::string, int> indexedHomeMembers;
        std::unordered_map<std::string, int> indexedOpponentMembers;

        for (int index = 1; const auto& homePlayer : homeMembers)
        {
            indexedHomeMembers[homePlayer.playerTag] = index++;
        }

        for (int index = 1; const auto& opponentPlayer : opponentMembers)
        {
            indexedOpponentMembers[opponentPlayer.playerTag] = index++;
        }

        return NormalizePositions{
            .indexedHomeMembers = std::move(indexedHomeMembers),
            .indexedOpponentMembers = std::move(indexedOpponentMembers)
        };
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
        report << "Использовано атак: " << attackStats.attacksUsed
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
                           const std::vector<BestAttack>& bestAttacks,
                           const ClanwarRoundData& data)
    {
        if (bestAttacks.empty()) return;

        const auto [indexedHomeMembers, indexedOpponentMembers] = normalizePositions(data.homeMembers, data.opponentMembers);

        report << "🏅 <b>ЛУЧШИЕ АТАКИ</b>\n";

        int attackNumber = 1;
        for (const auto& attack : bestAttacks)
        {
            report << attackNumber++ << ". "
                << utils::escapeHTML(attack.attackerName)
                << " — " << attack.stars << "⭐, "
                << fmt::format("{:.2f}%", attack.destructionPercentage)
                << " (№" << indexedHomeMembers.at(attack.attackerTag)
                << " ➜ №" << indexedOpponentMembers.at(attack.defenderTag) << ")\n";
        }

        report << "\n";
    }

    std::string buildPartForNotMirrorAttacks(const ClanwarRoundData& data)
    {
        const auto [indexedHomeMembers, indexedOpponentMembers] = normalizePositions(data.homeMembers, data.opponentMembers);

        std::ostringstream violationsStream;
        bool hasViolations = false;

        for (const auto& [attackerTag, defenderTag] : data.homeAttacks)
        {
            const int homePosition = indexedHomeMembers.at(attackerTag);
            const int opponentPosition = indexedOpponentMembers.at(defenderTag);

            if (homePosition != opponentPosition)
            {
                hasViolations = true;

                const auto& attackerName = data.homeMembers.at(homePosition - 1).playerName;

                violationsStream << "• " << utils::escapeHTML(attackerName)
                    << " (№" << homePosition
                    << " ➔ №" << opponentPosition << ")\n";
            }
        }

        if (!hasViolations) return "";

        std::ostringstream result;
        result << "\n🎯 <b>Атаковали не по зеркалу:</b>\n" << violationsStream.str();
        return result.str();
    }
}
