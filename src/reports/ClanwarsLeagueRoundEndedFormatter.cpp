#include "reports/ClanwarsLeagueRoundEndedFormatter.h"

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
    auto warRoundDetails = clanwarRepo.getWarRoundDetails(ids.warId, ids.homeClanId);

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
    auto notMirror = reportData.warDetails.notMirror;

    std::ostringstream report;
    report << "🏆 <b>ОТЧЕТ ПО " << rounds[reportData.cwlRoundInfo.roundNumber] << " РАУНДУ ЛВК</b>\n";
    report << "Клан: " << home.clanName << " (<code>" << home.clanTag << "</code>)\n";
    report << "Соперник: " << opponent.clanName << " (<code>" << opponent.clanTag << "</code>)\n\n";

    report << "Счет: ⭐️ " << home.stars << " - " << opponent.stars << " ⭐️\n";
    report << "Разрушение: 💥 " << fmt::format("{:.2f}%", home.destructionPercentage)
        << " - " << fmt::format("{:.2f}%", opponent.destructionPercentage) << "\n\n";

    report << "Итог: " << checkForWinner(home.stars, opponent.stars,
                                         home.destructionPercentage,
                                         opponent.destructionPercentage) << "\n\n";

    if (noAttack.empty() && notMirror.empty())
    {
        report << "✅ <b>Все участники раунда провели атаку без нарушений!</b>\n";
        report << "<i>Отличная работа в лиге!</i>";
        return report.str();
    }

    std::ostringstream missedAttack;
    std::ostringstream wrongTarget;

    for (const auto& [playerTag, playerName] : noAttack)
    {
        missedAttack << "• " << playerName << " [0/1]\n";
    }

    for (const auto& [playerTag, playerName] : notMirror)
    {
        wrongTarget << "• " << playerName << "\n";
    }

    report << "<b>НАРУШИТЕЛИ РАУНДА:</b>\n";

    if (!missedAttack.str().empty())
    {
        report << "\n🔴 <b>Пропустили атаку в ЛВК:</b>\n" << missedAttack.str();
    }

    // if (!wrongTarget.str().empty())
    // {
    //     report << "\n🎯 <b>Атаковали не по зеркалу:</b>\n" << wrongTarget.str();
    // }

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
