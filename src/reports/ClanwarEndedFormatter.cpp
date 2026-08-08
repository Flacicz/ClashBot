#include "reports/ClanwarEndedFormatter.h"

#include <fmt/format.h>
#include <sstream>
#include <unordered_map>
#include <utility>

#include "common/StringUtils.h"

ClanwarEndedFormatter::ClanwarEndedFormatter(ClanwarRepo& repo) : clanwarRepo(repo)
{
}

std::string ClanwarEndedFormatter::format(const WarEndedEvent& event) const
{
    const auto ids = event.insertedWarResult;
    const auto reportData = clanwarRepo.getReportData(ids);

    return buildReport(reportData);
}

std::string ClanwarEndedFormatter::buildReport(const ClanwarReportData& reportData)
{
    const auto& home = reportData.home;
    const auto& opponent = reportData.opponent;
    const auto& attackStats = reportData.attack_stats;
    const auto& bestAttacks = reportData.best_attacks;
    const auto& slackersWithNoAttacks = reportData.missedAllAttacks;
    const auto& slackersWithOneAttack = reportData.missedOneAttack;
    const auto notMirrorAttacks = buildPartForNotMirrorAttacks(reportData.dataForMirrorAnalysis);

    std::ostringstream report;
    report << "⚔️ <b>ОТЧЕТ ПО КВ</b>\n";
    report << "Клан: " << utils::escapeHTML(home.clanName) << " (<code>"
        << utils::escapeHTML(home.clanTag) << "</code>)\n";
    report << "Соперник: " << utils::escapeHTML(opponent.clanName) << " (<code>"
        << utils::escapeHTML(opponent.clanTag) << "</code>)\n\n";

    report << "Счет: ⭐️ " << home.stars << " - " << opponent.stars << " ⭐️\n";
    report << "Разрушение: 💥 " << fmt::format("{:.2f}%", home.destructionPercentage)
        << " - " << fmt::format("{:.2f}%", opponent.destructionPercentage) << "\n\n";

    report << "Итог: " << checkForWinner(home.stars, opponent.stars,
                                         home.destructionPercentage,
                                         opponent.destructionPercentage) << "\n\n";

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

    if (!bestAttacks.empty())
    {
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

    if (slackersWithNoAttacks.empty() && slackersWithOneAttack.empty() && notMirrorAttacks.empty())
    {
        report << "✅ <b>Все участники провели атаки без нарушений!</b>\n";
        report << "<i>Молодцы!</i>";
        return report.str();
    }

    std::ostringstream missedAll;
    std::ostringstream missedOne;

    for (const auto& [playerTag, playerName] : slackersWithNoAttacks)
    {
        missedAll << "• " << utils::escapeHTML(playerName) << " [0/2]\n";
    }

    for (const auto& [playerTag, playerName] : slackersWithOneAttack)
    {
        missedOne << "• " << utils::escapeHTML(playerName) << " [1/2]\n";
    }

    report << "<b>Нарушители по итогам войны:</b>\n";

    if (!missedAll.str().empty())
    {
        report << "\n🔴 <b>Пропустили все атаки:</b>\n" << missedAll.str();
    }

    if (!missedOne.str().empty())
    {
        report << "\n🟡 <b>Не использовали вторую атаку:</b>\n" << missedOne.str();
    }

    if (!notMirrorAttacks.empty()) report << notMirrorAttacks;

    return report.str();
}

std::string ClanwarEndedFormatter::checkForWinner(int homeStars, int opponentStars,
                                                  double homeDestruction, double opponentDestruction)
{
    if (homeStars > opponentStars) return "Победа";
    if (homeStars < opponentStars) return "Поражение";

    if (homeDestruction > opponentDestruction) return "Победа";
    if (homeDestruction < opponentDestruction) return "Поражение";

    return "Ничья";
}

std::string ClanwarEndedFormatter::buildPartForNotMirrorAttacks(const ClanwarRoundData& data)
{
    auto [indexedHomeMembers, indexedOpponentMembers] = normalizePositions(
        data.homeMembers, data.opponentMembers);

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

    if (!hasViolations)
    {
        return "";
    }

    std::ostringstream result;
    result << "\n🎯 <b>Атаковали не по зеркалу:</b>\n" << violationsStream.str();
    return result.str();
}

NormalizePositions ClanwarEndedFormatter::normalizePositions(
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
