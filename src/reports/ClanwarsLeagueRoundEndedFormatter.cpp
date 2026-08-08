#include "reports/ClanwarsLeagueRoundEndedFormatter.h"

#include <fmt/format.h>
#include <sstream>
#include <unordered_map>
#include <utility>

#include "common/StringUtils.h"

ClanwarsLeagueRoundEndedFormatter::ClanwarsLeagueRoundEndedFormatter(ClanwarsLeagueRepo& clanwarsLeagueRepo,
                                                                     ClanwarRepo& clanwarRepo) :
    clanwarsLeagueRepo(clanwarsLeagueRepo), clanwarRepo(clanwarRepo)
{
}

std::string ClanwarsLeagueRoundEndedFormatter::format(const ClanwarsLeagueRoundEndedEvent& event) const
{
    const auto ids = event.insertedWarResult;

    auto cwlInfo = clanwarsLeagueRepo.getRoundInfo(ids.warId);
    auto warRoundDetails = clanwarRepo.getWarRoundDetails(ids);

    const ClanwarsLeagueRoundReportData reportData{
        .cwlRoundInfo = std::move(cwlInfo),
        .warDetails = std::move(warRoundDetails)
    };

    return buildReport(reportData);
}

std::string ClanwarsLeagueRoundEndedFormatter::buildReport(const ClanwarsLeagueRoundReportData& reportData)
{
    std::unordered_map<int, std::string> rounds = {
        {1, "ПЕРВОМУ"},
        {2, "ВТОРОМУ"},
        {3, "ТРЕТЬЕМУ"},
        {4, "ЧЕТВЁРТОМУ"},
        {5, "ПЯТОМУ"},
        {6, "ШЕСТОМУ"},
        {7, "СЕДЬМОМУ"},
    };

    const auto& home = reportData.warDetails.home;
    const auto& opponent = reportData.warDetails.opponent;
    const auto& attackStats = reportData.warDetails.attack_stats;
    const auto& bestAttacks = reportData.warDetails.best_attacks;
    const auto& noAttack = reportData.warDetails.missedAttack;

    auto notMirrorAttacks = buildPartForNotMirrorAttacks(reportData.warDetails.dataForMirrorAnalysis);

    std::ostringstream report;
    report << "🏆 <b>ОТЧЕТ ПО " << rounds[reportData.cwlRoundInfo.roundNumber] << " РАУНДУ ЛВК</b>\n";
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
        auto [indexedHomeMembers, indexedOpponentMembers] = normalizePositions(
            reportData.warDetails.dataForMirrorAnalysis.homeMembers,
            reportData.warDetails.dataForMirrorAnalysis.opponentMembers);

        report << "🏅 <b>ЛУЧШИЕ АТАКИ</b>\n";

        int attackNumber = 1;
        for (const auto& attack : bestAttacks)
        {
            report << attackNumber++ << ". "
                << utils::escapeHTML(attack.attackerName)
                << " — " << attack.stars << "⭐, "
                << fmt::format("{:.2f}%", attack.destructionPercentage)
                << " (№" << indexedHomeMembers[attack.attackerTag]
                << " ➜ №" << indexedOpponentMembers[attack.defenderTag] << ")\n";
        }

        report << "\n";
    }

    if (noAttack.empty() && notMirrorAttacks.empty())
    {
        report << "✅ <b>Все участники раунда провели атаку без нарушений!</b>\n";
        report << "<i>Отличная работа в лиге!</i>";
        return report.str();
    }

    std::ostringstream missedAttack;

    for (const auto& [playerTag, playerName] : noAttack)
    {
        missedAttack << "• " << utils::escapeHTML(playerName) << " [0/1]\n";
    }

    report << "<b>НАРУШИТЕЛИ РАУНДА:</b>\n";

    if (!missedAttack.str().empty())
    {
        report << "\n🔴 <b>Пропустили атаку в ЛВК:</b>\n" << missedAttack.str();
    }

    if (notMirrorAttacks.empty()) report << "\n🎯 <b>Атак не по зеркалу не обнаружено! Все молодцы!</b>\n";
    else report << notMirrorAttacks;

    return report.str();
}

std::string ClanwarsLeagueRoundEndedFormatter::checkForWinner(int homeStars, int opponentStars,
                                                              double homeDestruction,
                                                              double opponentDestruction)
{
    if (homeStars > opponentStars) return "Победа";
    if (homeStars < opponentStars) return "Поражение";

    if (homeDestruction > opponentDestruction) return "Победа";
    if (homeDestruction < opponentDestruction) return "Поражение";

    return "Ничья";
}

std::string ClanwarsLeagueRoundEndedFormatter::buildPartForNotMirrorAttacks(const ClanwarRoundData& data)
{
    auto [indexedHomeMembers, indexedOpponentMembers] = ClanwarsLeagueRoundEndedFormatter::normalizePositions(
        data.homeMembers, data.opponentMembers);

    std::ostringstream violationsStream;
    bool hasViolations = false;

    for (const auto& [attackerTag, defenderTag] : data.homeAttacks)
    {
        const int homePos = indexedHomeMembers.at(attackerTag);
        const int oppPos = indexedOpponentMembers.at(defenderTag);

        if (homePos != oppPos)
        {
            hasViolations = true;

            // Достаем имя напрямую из отсортированного вектора за O(1)
            const auto& attackerName = data.homeMembers.at(homePos - 1).playerName;

            violationsStream << "• " << utils::escapeHTML(attackerName)
                << " (№" << homePos << " ➔ №" << oppPos << ")\n";
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

NormalizePositions ClanwarsLeagueRoundEndedFormatter::normalizePositions(
    const std::vector<WarRoundMember>& homeMembers, const std::vector<WarRoundMember>& opponentMembers)
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
