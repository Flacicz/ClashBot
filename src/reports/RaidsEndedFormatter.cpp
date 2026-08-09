#include "reports/RaidsEndedFormatter.h"

#include <sstream>

#include "common/StringUtils.h"

RaidsEndedFormatter::RaidsEndedFormatter(ClansRepo& clansRepo, RaidRepo& raidRepo) : clansRepo(clansRepo),
    raidRepo(raidRepo)
{
}

std::string RaidsEndedFormatter::format(const RaidsEndedEvent& event) const
{
    const RaidReportData reportData{
        .clanTag = event.clanTag,
        .clanName = clansRepo.getClanNameByTag(event.clanTag),
        .stats = raidRepo.getRaidStats(event.raidsId),
        .bestMembers = raidRepo.getBestRaidMembers(event.raidsId),
        .slackers = raidRepo.getRaidSlackers(event.raidsId)
    };

    return buildReport(reportData);
}

std::string RaidsEndedFormatter::buildReport(const RaidReportData& reportData)
{
    const auto& stats = reportData.stats;
    const auto& bestMembers = reportData.bestMembers;
    const auto& slackers = reportData.slackers;

    std::ostringstream report;
    report << "🏰 <b>ОТЧЕТ ПО РЕЙДАМ</b>\n";
    report << "Клан: " << utils::escapeHTML(reportData.clanName) << " (<code>"
        << utils::escapeHTML(reportData.clanTag) << "</code>)\n\n";

    report << "📊 <b>СТАТИСТИКА РЕЙДА</b>\n";
    report << "Заработано золота: " << stats.totalLoot << "\n";
    report << "Завершено рейдов: " << stats.raidsCompleted << "\n";
    report << "Использовано атак: " << stats.totalAttacks << "\n";
    report << "Уничтожено районов: " << stats.enemyDistrictsDestroyed << "\n";
    report << "Наступательная награда: " << stats.offensiveReward << "\n";
    report << "Оборонительная награда: " << stats.defensiveReward << "\n\n";

    if (!bestMembers.empty())
    {
        report << "🏅 <b>ЛУЧШИЕ УЧАСТНИКИ</b>\n";

        int memberNumber = 1;
        for (const auto& member : bestMembers)
        {
            report << memberNumber++ << ". "
                << utils::escapeHTML(member.playerName)
                << " — " << member.totalLoot << " золота, "
                << member.attacksCount << " атак";

            if (member.bonusAttacks > 0)
            {
                report << ", " << member.bonusAttacks << " бонусных";
            }

            report << "\n";
        }

        report << "\n";
    }

    bool hasAnyProblems = false;

    std::ostringstream incompleteAttacks;
    std::ostringstream noAttacks;

    for (const auto& slacker : slackers)
    {
        constexpr int BASE_ATTACKS = 5;
        const int maxAttacks = BASE_ATTACKS + slacker.bonusAttacks;

        if (slacker.attacksCount == 0)
        {
            noAttacks << "• " << utils::escapeHTML(slacker.playerName)
                << " [0/" << maxAttacks << "]\n";
            hasAnyProblems = true;
        }
        else if (slacker.attacksCount < maxAttacks)
        {
            incompleteAttacks << "• " << utils::escapeHTML(slacker.playerName)
                << " [" << slacker.attacksCount << "/" << maxAttacks << "]\n";
            hasAnyProblems = true;
        }
    }

    if (!hasAnyProblems)
    {
        report << "✅ <b>Все участники использовали все доступные атаки!</b>\n";
        report << "<i>Отличная работа!</i>";
        return report.str();
    }

    if (!incompleteAttacks.str().empty())
    {
        report << "🟡 <b>Не использовали все атаки:</b>\n" << incompleteAttacks.str() << "\n";
    }

    if (!noAttacks.str().empty())
    {
        report << "🔴 <b>Не сделали ни одной атаки:</b>\n" << noAttacks.str();
    }

    return report.str();
}
