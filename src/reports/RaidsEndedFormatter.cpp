#include "reports/RaidsEndedFormatter.h"

#include <sstream>
#include <string_view>

#include "common/StringUtils.h"

namespace
{
    std::string_view attackWord(const int count)
    {
        switch (count)
        {
        case 1:
            return "атака";
        case 2:
        case 3:
        case 4:
            return "атаки";
        default:
            return "атак";
        }
    }
}

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
        .bestMembers = raidRepo.getBestRaidMembers(event.raidsId)
    };

    return buildReport(reportData);
}

std::string RaidsEndedFormatter::buildReport(const RaidReportData& reportData)
{
    const auto& stats = reportData.stats;
    const auto& bestMembers = reportData.bestMembers;

    std::ostringstream report;
    report << "🏰 <b>ОТЧЕТ ПО РЕЙДАМ</b>\n";
    report << "Клан: " << utils::escapeHTML(reportData.clanName) << " (<code>"
        << utils::escapeHTML(reportData.clanTag) << "</code>)\n\n";

    report << "📊 <b>СТАТИСТИКА РЕЙДА</b>\n";
    report << "Заработано золота: " << stats.totalLoot << "\n";
    report << "Завершено рейдов: " << stats.raidsCompleted << "\n";
    report << "Использовано атак: " << stats.totalAttacks << "\n";
    report << "Уничтожено районов: " << stats.enemyDistrictsDestroyed << "\n";
    report << "Награда за нападение: " << stats.offensiveReward << "\n";
    report << "Награда за оборону: " << stats.defensiveReward << "\n\n";

    if (!bestMembers.empty())
    {
        report << "🏅 <b>ЛУЧШИЕ УЧАСТНИКИ</b>\n";

        int memberNumber = 1;
        for (const auto& member : bestMembers)
        {
            report << memberNumber++ << ". "
                << utils::escapeHTML(member.playerName)
                << " — " << member.totalLoot << " золота, "
                << member.attacksCount << ' ' << attackWord(member.attacksCount);

            if (member.bonusAttacks > 0)
            {
                report << ", " << member.bonusAttacks << " бонусная атака";
            }

            report << "\n";
        }

        report << "\n";
    }

    return utils::removeTrailingNewlines(report.str());
}
