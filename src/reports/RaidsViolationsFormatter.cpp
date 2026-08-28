#include "reports/RaidsViolationsFormatter.h"

#include <sstream>

#include "common/StringUtils.h"

RaidsViolationsFormatter::RaidsViolationsFormatter(RaidRepo& raidRepo) : raidRepo(raidRepo)
{
}

std::string RaidsViolationsFormatter::format(const RaidsEndedEvent& event) const
{
    return buildReport(event.clanTag, raidRepo.getRaidSlackers(event.raidReference));
}

std::string RaidsViolationsFormatter::buildReport(
    const std::string_view clanTag,
    const std::vector<RaidSlacker>& slackers)
{
    constexpr int BASE_ATTACKS = 5;

    std::ostringstream report;
    report << "⚠️ <b>НАРУШЕНИЯ В РЕЙДЕ</b>\n";
    report << "Клан: <code>" << utils::escapeHTML(clanTag) << "</code>\n\n";

    std::ostringstream incompleteAttacks;
    std::ostringstream noAttacks;

    for (const auto& slacker : slackers)
    {
        const int maxAttacks = BASE_ATTACKS + slacker.bonusAttacks;

        if (slacker.attacksCount == 0)
        {
            noAttacks << "• " << utils::escapeHTML(slacker.playerName)
                << " [0/" << maxAttacks << "]\n";
        }
        else if (slacker.attacksCount < maxAttacks)
        {
            incompleteAttacks << "• " << utils::escapeHTML(slacker.playerName)
                << " [" << slacker.attacksCount << "/" << maxAttacks << "]\n";
        }
    }

    const auto incompleteAttacksText = incompleteAttacks.str();
    const auto noAttacksText = noAttacks.str();

    if (incompleteAttacksText.empty() && noAttacksText.empty())
    {
        report << "✅ <b>Нарушений в рейде не обнаружено!</b>\n";
        report << "<i>Отличная работа!</i>";
        return report.str();
    }

    if (!incompleteAttacksText.empty())
    {
        report << "🟡 <b>Не использовали все атаки:</b>\n" << incompleteAttacksText;
    }

    if (!noAttacksText.empty())
    {
        if (!incompleteAttacksText.empty())
        {
            report << "\n";
        }

        report << "🔴 <b>Не сделали ни одной атаки:</b>\n" << noAttacksText;
    }

    return utils::removeTrailingNewlines(report.str());
}
