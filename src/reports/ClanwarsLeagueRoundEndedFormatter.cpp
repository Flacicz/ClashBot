#include "reports/ClanwarsLeagueRoundEndedFormatter.h"
#include "common/StringUtils.h"

#include <sstream>
#include <algorithm>

#include "database/database.h"
#include "spdlog/spdlog.h"

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

    ClanwarsLeagueRoundReportData reportData = {
        .cwlRoundInfo = cwlInfo,
        .warDetails = warRoundDetails
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

    auto home = reportData.warDetails.home;
    auto opponent = reportData.warDetails.opponent;

    auto noAttack = reportData.warDetails.missedAttack;

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

    if (noAttack.empty() && notMirrorAttacks.empty())
    {
        report << "✅ <b>Все участники раунда провели атаку без нарушений!</b>\n";
        report << "<i>Отличная работа в лиге!</i>";
        return report.str();
    }

    std::ostringstream missedAttack;
    std::ostringstream wrongTarget;

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

std::string ClanwarsLeagueRoundEndedFormatter::checkForWinner(const int homeStars, const int opponentStars,
                                                              const double homeDestruction,
                                                              const double opponentDestruction)
{
    if (homeStars > opponentStars) return "Победа";
    if (homeStars < opponentStars) return "Поражение";

    if (homeDestruction > opponentDestruction) return "Победа";
    if (homeDestruction < opponentDestruction) return "Поражение";

    return "Ничья";
}

std::string ClanwarsLeagueRoundEndedFormatter::buildPartForNotMirrorAttacks(const ClanwarRoundData& data)
{
    std::unordered_map<std::string, int> indexedHomeMembers;
    std::unordered_map<std::string, int> indexedOpponentMembers;

    for (int index = 1; const auto& homePlayer : data.homeMembers)
    {
        indexedHomeMembers[homePlayer.playerTag] = index++;
    }

    for (int index = 1; const auto& opponentPlayer : data.opponentMembers)
    {
        indexedOpponentMembers[opponentPlayer.playerTag] = index++;
    }

    std::ostringstream violationsStream;
    bool hasViolations = false;

    for (const auto& attack : data.homeAttacks)
    {
        int homePos = indexedHomeMembers[attack.attackerTag];
        int oppPos = indexedOpponentMembers[attack.defenderTag];

        if (homePos != oppPos)
        {
            hasViolations = true;

            // Достаем имя напрямую из отсортированного вектора за O(1)
            std::string attackerName = data.homeMembers[homePos - 1].playerName;

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
