#include "reports/ClanwarEndedFormatter.h"
#include "common/StringUtils.h"
#include <sstream>
#include <fmt/format.h>

ClanwarEndedFormatter::ClanwarEndedFormatter(ClanwarRepo& repo) : clanwarRepo(repo)
{
}

std::string ClanwarEndedFormatter::format(const WarEndedEvent& event) const
{
    const auto ids = event.insertedWarResult;
    const auto reportData = clanwarRepo.getReportData(ids.warId, ids.homeClanId);

    return buildReport(reportData);
}

std::string ClanwarEndedFormatter::buildReport(const ClanwarReportData& reportData)
{
    auto home = reportData.home;
    auto opponent = reportData.opponent;

    auto slackersWithNoAttacks = reportData.missedAllAttacks;
    auto slackersWithOneAttack = reportData.missedOneAttack;
    auto notMirror = reportData.notMirror;

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

    if (slackersWithNoAttacks.empty() && slackersWithOneAttack.empty() && notMirror.empty())
    {
        report << "✅ <b>Все участники провели атаки без нарушений!</b>\n";
        report << "<i>Молодцы!</i>";
        return report.str();
    }

    std::ostringstream missedAll;
    std::ostringstream missedOne;
    std::ostringstream wrongTarget;

    for (const auto& [playerTag, playerName] : slackersWithNoAttacks)
    {
        missedAll << "• " << utils::escapeHTML(playerName) << " [0/2]\n";
    }

    for (const auto& [playerTag, playerName] : slackersWithOneAttack)
    {
        missedOne << "• " << utils::escapeHTML(playerName) << " [1/2]\n";
    }

    for (const auto& [playerTag, playerName] : notMirror)
    {
        wrongTarget << "• " << utils::escapeHTML(playerName) << "\n";
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

    if (!wrongTarget.str().empty())
    {
        report << "\n🎯 <b>Атаковали не по зеркалу:</b>\n" << wrongTarget.str();
    }

    return report.str();
}

std::string ClanwarEndedFormatter::checkForWinner(const int homeStars, const int opponentStars,
                                                  const double homeDestruction, const double opponentDestruction)
{
    if (homeStars > opponentStars) return "Победа";
    if (homeStars < opponentStars) return "Поражение";

    if (homeDestruction > opponentDestruction) return "Победа";
    if (homeDestruction < opponentDestruction) return "Поражение";

    return "Ничья";
}
