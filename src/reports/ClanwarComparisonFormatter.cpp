#include "reports/ClanwarComparisonFormatter.h"

#include <cmath>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include <fmt/format.h>

#include "analytics/ClanwarComparisonAnalyzer.h"
#include "common/StringUtils.h"

namespace
{
    double calculateRate(const int value, const int total)
    {
        if (total <= 0) return 0.0;
        return static_cast<double>(value) / total;
    }

    std::string formatRate(const double rate)
    {
        return fmt::format("{:.1f}%", rate * 100.0);
    }

    std::string_view outcomeName(const ClanwarOutcome outcome)
    {
        switch (outcome)
        {
        case ClanwarOutcome::Victory:
            return "Победа";
        case ClanwarOutcome::Defeat:
            return "Поражение";
        case ClanwarOutcome::Draw:
            return "Ничья";
        }

        return "Неизвестно";
    }

    std::string_view outcomeIcon(const ClanwarOutcome outcome)
    {
        switch (outcome)
        {
        case ClanwarOutcome::Victory:
            return "✅";
        case ClanwarOutcome::Defeat:
            return "❌";
        case ClanwarOutcome::Draw:
            return "➖";
        }

        return "❔";
    }

    std::string formatSignedInteger(const int value)
    {
        if (value == 0) return "0";
        if (value >= 0) return fmt::format("+{}", value);
        return fmt::format("−{}", std::abs(value));
    }

    std::string formatSignedDouble(const double value)
    {
        if (value == 0.0) return "0.00";
        if (value >= 0.0) return fmt::format("+{:.2f}", value);
        return fmt::format("−{:.2f}", std::abs(value));
    }

    std::string formatSignedPercentagePoints(const double percentagePoints)
    {
        if (percentagePoints == 0.0)
        {
            return "0.0 п.п.";
        }

        if (percentagePoints > 0.0)
        {
            return fmt::format("+{:.1f} п.п.", percentagePoints);
        }

        return fmt::format("−{:.1f} п.п.", std::abs(percentagePoints));
    }

    std::string formatRateDelta(const double previousRate,
                                const double currentRate)
    {
        return formatSignedPercentagePoints(
            (currentRate - previousRate) * 100.0
        );
    }

    std::string_view formatMetricStatus(const double previousValue,
                                        const double currentValue,
                                        const bool higherIsBetter)
    {
        if (currentValue == previousValue) return "➖ без изменений";

        const auto improved = higherIsBetter
                                  ? currentValue > previousValue
                                  : currentValue < previousValue;

        return improved ? "✅ лучше" : "⚠️ хуже";
    }

    void appendRateComparison(std::ostream& report,
                              const std::string_view label,
                              const double previousRate,
                              const double currentRate,
                              const std::string& previousDetails,
                              const std::string& currentDetails,
                              const bool higherIsBetter,
                              const bool includeStatus = true)
    {
        report << label << ":\n"
            << formatRate(previousRate)
            << " → " << formatRate(currentRate)
            << " (" << formatRateDelta(previousRate, currentRate)
            << "; " << previousDetails
            << " → " << currentDetails;

        if (includeStatus)
        {
            report << "; " << formatMetricStatus(
                previousRate,
                currentRate,
                higherIsBetter
            );
        }

        report << ")\n";
    }

    std::string formatWarLabel(const std::string_view label,
                               const ClanwarWarStats& stats)
    {
        return fmt::format(
            "{}: {} {} {}–{}",
            label,
            outcomeIcon(stats.result),
            outcomeName(stats.result),
            stats.homeStars,
            stats.opponentStars
        );
    }

    void appendWarParticipants(std::ostream& report,
                               const ClanwarWarStats& stats)
    {
        report << "🏠 Наш клан: " << utils::escapeHTML(stats.homeClanName)
            << " (<code>" << utils::escapeHTML(stats.homeClanTag)
            << "</code>)\n";
        report << "⚔️ Соперник: " << utils::escapeHTML(stats.opponentClanName)
            << " (<code>" << utils::escapeHTML(stats.opponentClanTag)
            << "</code>)\n";
    }

    std::string formatPreviousWarsPeriod(const int warsCount)
    {
        if (warsCount == 1) return "за последнюю войну";

        const auto absoluteValue = std::abs(warsCount);
        const auto lastTwoDigits = absoluteValue % 100;
        const auto lastDigit = absoluteValue % 10;

        if ((lastTwoDigits >= 11 && lastTwoDigits <= 14) ||
            lastDigit == 0 || lastDigit >= 5)
        {
            return fmt::format("за последние {} войн", warsCount);
        }

        if (lastDigit >= 2)
        {
            return fmt::format("за последние {} войны", warsCount);
        }

        return fmt::format("за последние {} войну", warsCount);
    }

    std::string formatRecentWarsLabel(const std::size_t warsCount)
    {
        if (warsCount == 1) return "Последняя война";

        const auto lastTwoDigits = warsCount % 100;
        const auto lastDigit = warsCount % 10;

        if (lastTwoDigits >= 11 && lastTwoDigits <= 14)
        {
            return fmt::format("Последние {} войн", warsCount);
        }

        if (lastDigit >= 2 && lastDigit <= 4)
        {
            return fmt::format("Последние {} войны", warsCount);
        }

        if (lastDigit == 1)
        {
            return fmt::format("Последние {} война", warsCount);
        }

        return fmt::format("Последние {} войн", warsCount);
    }

    std::string formatHistoricalAveragesLabel(const int warsCount)
    {
        const auto absoluteValue = std::abs(warsCount);
        const auto lastTwoDigits = absoluteValue % 100;
        const auto lastDigit = absoluteValue % 10;

        if (lastTwoDigits >= 11 && lastTwoDigits <= 14)
        {
            return fmt::format(
                "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА {} ПРЕДЫДУЩИХ ВОЙН</b>",
                warsCount
            );
        }

        if (lastDigit == 1)
        {
            return fmt::format(
                "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА {} ПРЕДЫДУЩУЮ ВОЙНУ</b>",
                warsCount
            );
        }

        if (lastDigit >= 2 && lastDigit <= 4)
        {
            return fmt::format(
                "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА {} ПРЕДЫДУЩИЕ ВОЙНЫ</b>",
                warsCount
            );
        }

        return fmt::format(
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА {} ПРЕДЫДУЩИХ ВОЙН</b>",
            warsCount
        );
    }

    void appendDisciplineChange(std::ostream& report,
                                const ClanwarWarStats& currentWar,
                                const ClanwarWarStats& previousWar)
    {
        const auto previousPlayersWithoutAttacksRate = calculateRate(
            previousWar.disciplineStats.playersWithoutAttacks,
            previousWar.teamSize
        );
        const auto currentPlayersWithoutAttacksRate = calculateRate(
            currentWar.disciplineStats.playersWithoutAttacks,
            currentWar.teamSize
        );

        const auto previousFirstAttacksNotOnMirrorRate = calculateRate(
            previousWar.disciplineStats.firstAttacksNotOnMirror,
            previousWar.teamSize - previousWar.disciplineStats.playersWithoutAttacks
        );
        const auto currentFirstAttacksNotOnMirrorRate = calculateRate(
            currentWar.disciplineStats.firstAttacksNotOnMirror,
            currentWar.teamSize - currentWar.disciplineStats.playersWithoutAttacks
        );

        appendRateComparison(
            report,
            "Без атак\n(среди всех участников)",
            previousPlayersWithoutAttacksRate,
            currentPlayersWithoutAttacksRate,
            std::to_string(previousWar.disciplineStats.playersWithoutAttacks),
            std::to_string(currentWar.disciplineStats.playersWithoutAttacks),
            false
        );

        appendRateComparison(
            report,
            "Атаки не по зеркалу\n(среди участников с атаками)",
            previousFirstAttacksNotOnMirrorRate,
            currentFirstAttacksNotOnMirrorRate,
            std::to_string(previousWar.disciplineStats.firstAttacksNotOnMirror),
            std::to_string(currentWar.disciplineStats.firstAttacksNotOnMirror),
            false
        );
    }

    void appendSingleAttackActivity(std::ostream& report,
                                    const ClanwarWarStats& currentWar,
                                    const ClanwarWarStats& previousWar)
    {
        const auto previousRate = calculateRate(
            previousWar.disciplineStats.playersWithOneAttack,
            previousWar.teamSize
        );
        const auto currentRate = calculateRate(
            currentWar.disciplineStats.playersWithOneAttack,
            currentWar.teamSize
        );

        appendRateComparison(
            report,
            "Ровно одна атака\n(среди всех участников)",
            previousRate,
            currentRate,
            std::to_string(previousWar.disciplineStats.playersWithOneAttack),
            std::to_string(currentWar.disciplineStats.playersWithOneAttack),
            false
        );
    }

    void appendHistoricalAverages(std::ostream& report,
                                  const ClanwarComparisonData& reportData)
    {
        if (!reportData.previousWarsAverage.has_value()) return;

        const auto& average = reportData.previousWarsAverage.value();
        const auto& currentWar = reportData.currentWar;

        const auto averageAttackUsageRate = 1.0 - average.averageMissedAttacksRate;
        const auto currentAttackUsageRate = calculateRate(
            currentWar.attacksUsed,
            currentWar.maxAttacks
        );
        const auto currentMissedAttacksRate = calculateRate(
            currentWar.maxAttacks - currentWar.attacksUsed,
            currentWar.maxAttacks
        );
        const auto currentPlayersWithoutAttacksRate = calculateRate(
            currentWar.disciplineStats.playersWithoutAttacks,
            currentWar.teamSize
        );
        const auto currentPlayersWithOneAttackRate = calculateRate(
            currentWar.disciplineStats.playersWithOneAttack,
            currentWar.teamSize
        );
        const auto currentFirstAttacksNotOnMirrorRate = calculateRate(
            currentWar.disciplineStats.firstAttacksNotOnMirror,
            currentWar.teamSize - currentWar.disciplineStats.playersWithoutAttacks
        );

        report << formatHistoricalAveragesLabel(average.warsCount) << "\n";
        report << "Для долевых метрик изменение указано в процентных пунктах (п.п.).\n";
        report << "\n📌 Основные метрики:\n";
        report << "⭐ Средние звёзды за атаку:\n";
        report << fmt::format(
            "{:.2f} → {:.2f} ({}; {})\n",
            average.averageStarsPerAttack,
            currentWar.averageStarsPerAttack,
            formatSignedDouble(
                currentWar.averageStarsPerAttack - average.averageStarsPerAttack),
            formatMetricStatus(
                average.averageStarsPerAttack,
                currentWar.averageStarsPerAttack,
                true)
        );

        report << "💥 Среднее разрушение за атаку:\n";
        report << fmt::format(
            "{:.2f}% → {:.2f}% ({}; {})\n",
            average.averageDestructionPerAttack,
            currentWar.averageDestructionPerAttack,
            formatSignedPercentagePoints(
                currentWar.averageDestructionPerAttack -
                average.averageDestructionPerAttack),
            formatMetricStatus(
                average.averageDestructionPerAttack,
                currentWar.averageDestructionPerAttack,
                true)
        );

        report << "\n🎯 Дисциплина:\n";
        appendRateComparison(
            report,
            "Без атак\n(среди всех участников)",
            average.averagePlayersWithoutAttacksRate,
            currentPlayersWithoutAttacksRate,
            fmt::format("{:.1f}", average.averagePlayersWithoutAttacks),
            std::to_string(currentWar.disciplineStats.playersWithoutAttacks),
            false
        );

        appendRateComparison(
            report,
            "Атаки не по зеркалу\n(среди участников с атаками)",
            average.averageFirstAttacksNotOnMirrorRate,
            currentFirstAttacksNotOnMirrorRate,
            fmt::format("{:.1f}", average.averageFirstAttacksNotOnMirror),
            std::to_string(currentWar.disciplineStats.firstAttacksNotOnMirror),
            false
        );

        report << "\n⚔️ Активность (не входит в итоговую оценку):\n";

        appendRateComparison(
            report,
            "Использование атак",
            averageAttackUsageRate,
            currentAttackUsageRate,
            fmt::format(
                "{:.1f}/{:.1f}",
                average.averageAttacksUsed,
                average.averageMaxAttacks),
            fmt::format(
                "{}/{}",
                currentWar.attacksUsed,
                currentWar.maxAttacks),
            true
        );

        appendRateComparison(
            report,
            "Пропущенные атаки",
            average.averageMissedAttacksRate,
            currentMissedAttacksRate,
            fmt::format("{:.1f}", average.averageMissedAttacks),
            std::to_string(currentWar.maxAttacks - currentWar.attacksUsed),
            false
        );

        appendRateComparison(
            report,
            "Ровно одна атака\n(среди всех участников)",
            average.averagePlayersWithOneAttackRate,
            currentPlayersWithOneAttackRate,
            fmt::format("{:.1f}", average.averagePlayersWithOneAttack),
            std::to_string(currentWar.disciplineStats.playersWithOneAttack),
            false
        );
    }

    void appendPerformanceComparison(std::ostream& report,
                                     const ClanwarComparisonData& reportData)
    {
        if (!reportData.performanceComparison.has_value() ||
            !reportData.previousWarsAverage.has_value())
        {
            return;
        }

        const auto period = formatPreviousWarsPeriod(
            reportData.previousWarsAverage->warsCount);

        report << "\n";

        const auto& comparison = reportData.performanceComparison.value();

        switch (comparison.trend)
        {
        case ClanwarPerformanceTrend::Better:
            report << "✅ Динамика лучше среднего " << period << "\n";
            break;
        case ClanwarPerformanceTrend::Worse:
            report << "⚠️ Динамика хуже среднего " << period << "\n";
            break;
        case ClanwarPerformanceTrend::Similar:
            report << "⚖️ Динамика примерно на уровне среднего " << period << "\n";
            break;
        }

        report << "\nИтог по " << comparison.totalMetrics
            << " основным метрикам:\n";
        report << fmt::format(
            "Улучшились: {} ({:.1f}%)\n",
            comparison.improvedMetrics,
            comparison.improvedMetricsRate * 100.0
        );
        report << fmt::format(
            "Ухудшились: {} ({:.1f}%)\n",
            comparison.worsenedMetrics,
            comparison.worsenedMetricsRate * 100.0
        );
        report << fmt::format(
            "Без изменений: {} ({:.1f}%).\n",
            comparison.unchangedMetrics,
            comparison.unchangedMetricsRate * 100.0
        );
    }
}

ClanwarComparisonFormatter::ClanwarComparisonFormatter(ClanwarRepo& repo) : clanwarRepo(repo)
{
}

std::string ClanwarComparisonFormatter::format(const WarEndedEvent& event) const
{
    constexpr int PREVIOUS_WARS_FOR_REPORT = 4;

    const auto currentWarStats = clanwarRepo.getClanwarStats(event.warReference);
    const auto previousWarReferences = clanwarRepo.getPreviousClanwars(
        event.warReference,
        PREVIOUS_WARS_FOR_REPORT
    );

    std::vector<ClanwarWarStats> previousWarStats;
    previousWarStats.reserve(previousWarReferences.size());

    for (const auto& reference : previousWarReferences)
    {
        previousWarStats.push_back(clanwarRepo.getClanwarStats(reference));
    }

    const auto reportData = clanwar_analytics::buildComparisonData(
        currentWarStats,
        previousWarStats
    );

    return buildReport(reportData);
}

std::string ClanwarComparisonFormatter::buildReport(
    const ClanwarComparisonData& reportData)
{
    if (!reportData.previousWar.has_value()) return {};

    const auto& currentWar = reportData.currentWar;
    const auto& previousWar = reportData.previousWar.value();

    std::ostringstream report;
    report << "📈 <b>ДИНАМИКА ВОЙНЫ</b>\n\n";
    report << formatWarLabel("Последняя война", currentWar) << "\n";
    appendWarParticipants(report, currentWar);
    report << "\n";
    report << formatWarLabel("Предыдущая война", previousWar) << "\n";
    appendWarParticipants(report, previousWar);
    report << "\n";

    report << "Изменение результата:\n";
    report << outcomeName(previousWar.result)
        << " → " << outcomeName(currentWar.result) << "\n";

    const auto previousStarDifference =
        previousWar.homeStars - previousWar.opponentStars;
    const auto currentStarDifference =
        currentWar.homeStars - currentWar.opponentStars;

    report << "Разница по звёздам: "
        << formatSignedInteger(previousStarDifference)
        << " → " << formatSignedInteger(currentStarDifference) << "\n\n";

    report << "📊 <b>СРАВНЕНИЕ С ПРЕДЫДУЩЕЙ ВОЙНОЙ</b>\n";
    report << "Для долевых метрик изменение указано в процентных пунктах (п.п.).\n";
    report << "\n📌 Основные метрики:\n";
    report << "⭐ Средние звёзды за атаку:\n";
    report << fmt::format("{:.2f} → {:.2f} ({}; ",
                          previousWar.averageStarsPerAttack,
                          currentWar.averageStarsPerAttack,
                          formatSignedDouble(
                              currentWar.averageStarsPerAttack -
                              previousWar.averageStarsPerAttack))
        << formatMetricStatus(
            previousWar.averageStarsPerAttack,
            currentWar.averageStarsPerAttack,
            true)
        << ")\n";

    report << "💥 Среднее разрушение за атаку:\n";
    report << fmt::format("{:.2f}% → {:.2f}% (",
                          previousWar.averageDestructionPerAttack,
                          currentWar.averageDestructionPerAttack)
        << formatSignedPercentagePoints(
            currentWar.averageDestructionPerAttack -
            previousWar.averageDestructionPerAttack)
        << "; "
        << formatMetricStatus(
            previousWar.averageDestructionPerAttack,
            currentWar.averageDestructionPerAttack,
            true)
        << ")\n";

    const auto previousAttackUsageRate = calculateRate(
        previousWar.attacksUsed,
        previousWar.maxAttacks
    );
    const auto currentAttackUsageRate = calculateRate(
        currentWar.attacksUsed,
        currentWar.maxAttacks
    );
    const auto previousMissedAttacksRate = calculateRate(
        previousWar.maxAttacks - previousWar.attacksUsed,
        previousWar.maxAttacks
    );
    const auto currentMissedAttacksRate = calculateRate(
        currentWar.maxAttacks - currentWar.attacksUsed,
        currentWar.maxAttacks
    );

    report << "\n🎯 Дисциплина:\n";
    appendDisciplineChange(report, currentWar, previousWar);

    report << "\n⚔️ Активность (не входит в итоговую оценку):\n";
    appendRateComparison(
        report,
        "Использование атак",
        previousAttackUsageRate,
        currentAttackUsageRate,
        std::to_string(previousWar.attacksUsed)
            + "/" + std::to_string(previousWar.maxAttacks),
        std::to_string(currentWar.attacksUsed)
            + "/" + std::to_string(currentWar.maxAttacks),
        true
    );

    appendRateComparison(
        report,
        "Пропущенные атаки",
        previousMissedAttacksRate,
        currentMissedAttacksRate,
        std::to_string(previousWar.maxAttacks - previousWar.attacksUsed),
        std::to_string(currentWar.maxAttacks - currentWar.attacksUsed),
        false
    );
    appendSingleAttackActivity(report, currentWar, previousWar);

    report << "\n";
    if (!reportData.recentWarResults.empty())
    {
        report << formatRecentWarsLabel(reportData.recentWarResults.size()) << ":\n";
        for (const auto outcome : reportData.recentWarResults)
        {
            report << outcomeIcon(outcome) << ' ';
        }
        report << "\n\n";
    }

    appendHistoricalAverages(report, reportData);
    appendPerformanceComparison(report, reportData);

    return utils::removeTrailingNewlines(report.str());
}
