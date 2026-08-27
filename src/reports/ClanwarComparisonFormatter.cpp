#include "reports/ClanwarComparisonFormatter.h"

#include <sstream>
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

    std::string formatRateDelta(const double previousRate,
                                const double currentRate)
    {
        return formatSignedDouble((currentRate - previousRate) * 100.0) + " п.п.";
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

        report << "Без атак: "
            << formatRate(previousPlayersWithoutAttacksRate)
            << " → " << formatRate(currentPlayersWithoutAttacksRate)
            << " (" << formatRateDelta(
                previousPlayersWithoutAttacksRate,
                currentPlayersWithoutAttacksRate)
            << "; " << previousWar.disciplineStats.playersWithoutAttacks
            << " → " << currentWar.disciplineStats.playersWithoutAttacks
            << "; " << formatMetricStatus(
                previousPlayersWithoutAttacksRate,
                currentPlayersWithoutAttacksRate,
                false)
            << ")\n";

        report << "Атаки не по зеркалу: "
            << formatRate(previousFirstAttacksNotOnMirrorRate)
            << " → " << formatRate(currentFirstAttacksNotOnMirrorRate)
            << " (" << formatRateDelta(
                previousFirstAttacksNotOnMirrorRate,
                currentFirstAttacksNotOnMirrorRate)
            << "; " << previousWar.disciplineStats.firstAttacksNotOnMirror
            << " → " << currentWar.disciplineStats.firstAttacksNotOnMirror
            << "; " << formatMetricStatus(
                previousFirstAttacksNotOnMirrorRate,
                currentFirstAttacksNotOnMirrorRate,
                false)
            << ")\n";
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

        report << "Ровно одна атака: "
            << formatRate(previousRate)
            << " → " << formatRate(currentRate)
            << " (" << formatRateDelta(previousRate, currentRate)
            << "; " << previousWar.disciplineStats.playersWithOneAttack
            << " → " << currentWar.disciplineStats.playersWithOneAttack
            << ")\n";
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
        report << "Изменение указано в процентных пунктах (п.п.).\n";
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
            "{:.2f}% → {:.2f}% ({} п.п.; {})\n",
            average.averageDestructionPerAttack,
            currentWar.averageDestructionPerAttack,
            formatSignedDouble(
                currentWar.averageDestructionPerAttack -
                average.averageDestructionPerAttack),
            formatMetricStatus(
                average.averageDestructionPerAttack,
                currentWar.averageDestructionPerAttack,
                true)
        );

        report << "🎯 Дисциплина:\n";
        report << "Без атак: "
            << formatRate(average.averagePlayersWithoutAttacksRate)
            << " → " << formatRate(currentPlayersWithoutAttacksRate)
            << " (" << formatRateDelta(
                average.averagePlayersWithoutAttacksRate,
                currentPlayersWithoutAttacksRate)
            << "; " << fmt::format(
                "{:.1f} → {}",
                average.averagePlayersWithoutAttacks,
                currentWar.disciplineStats.playersWithoutAttacks)
            << "; " << formatMetricStatus(
                average.averagePlayersWithoutAttacksRate,
                currentPlayersWithoutAttacksRate,
                false)
            << ")\n";

        report << "Атаки не по зеркалу: "
            << formatRate(average.averageFirstAttacksNotOnMirrorRate)
            << " → " << formatRate(currentFirstAttacksNotOnMirrorRate)
            << " (" << formatRateDelta(
                average.averageFirstAttacksNotOnMirrorRate,
                currentFirstAttacksNotOnMirrorRate)
            << "; " << fmt::format(
                "{:.1f} → {}",
                average.averageFirstAttacksNotOnMirror,
                currentWar.disciplineStats.firstAttacksNotOnMirror)
            << "; " << formatMetricStatus(
                average.averageFirstAttacksNotOnMirrorRate,
                currentFirstAttacksNotOnMirrorRate,
                false)
            << ")\n";

        report << "\n📈 Активность (не входит в итоговую оценку):\n";
        report << "Использование атак:\n";
        report << formatRate(averageAttackUsageRate)
            << " → " << formatRate(currentAttackUsageRate)
            << " (" << formatRateDelta(
                averageAttackUsageRate,
                currentAttackUsageRate)
            << "; " << fmt::format(
                "{:.1f}/{:.1f} → {}/{}",
                average.averageAttacksUsed,
                average.averageMaxAttacks,
                currentWar.attacksUsed,
                currentWar.maxAttacks)
            << "; " << formatMetricStatus(
                averageAttackUsageRate,
                currentAttackUsageRate,
                true)
            << ")\n";

        report << "Пропущенные атаки:\n";
        report << formatRate(average.averageMissedAttacksRate)
            << " → " << formatRate(currentMissedAttacksRate)
            << " (" << formatRateDelta(
                average.averageMissedAttacksRate,
                currentMissedAttacksRate)
            << "; " << fmt::format(
                "{:.1f} → {}",
                average.averageMissedAttacks,
                currentWar.maxAttacks - currentWar.attacksUsed)
            << "; " << formatMetricStatus(
                average.averageMissedAttacksRate,
                currentMissedAttacksRate,
                false)
            << ")\n";

        report << "Ровно одна атака: "
            << formatRate(average.averagePlayersWithOneAttackRate)
            << " → " << formatRate(currentPlayersWithOneAttackRate)
            << " (" << formatRateDelta(
                average.averagePlayersWithOneAttackRate,
                currentPlayersWithOneAttackRate)
            << "; " << fmt::format(
                "{:.1f} → {}",
                average.averagePlayersWithOneAttack,
                currentWar.disciplineStats.playersWithOneAttack)
            << ")\n";
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
            report << "✅ Результат лучше среднего " << period << "\n";
            break;
        case ClanwarPerformanceTrend::Worse:
            report << "⚠️ Результат хуже среднего " << period << "\n";
            break;
        case ClanwarPerformanceTrend::Similar:
            report << "⚖️ Результат примерно на уровне среднего " << period << "\n";
            break;
        }

        report << fmt::format(
            "Итог по {} метрикам: улучшились {} ({:.1f}%), "
            "ухудшились {} ({:.1f}%), без изменений {} ({:.1f}%).\n",
            comparison.totalMetrics,
            comparison.improvedMetrics,
            comparison.improvedMetricsRate * 100.0,
            comparison.worsenedMetrics,
            comparison.worsenedMetricsRate * 100.0,
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
    report << "Изменение указано в процентных пунктах (п.п.).\n";
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
        << formatSignedDouble(
            currentWar.averageDestructionPerAttack -
            previousWar.averageDestructionPerAttack)
        << " п.п.; "
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

    report << "🎯 Дисциплина:\n";
    appendDisciplineChange(report, currentWar, previousWar);

    report << "\n⚔️ Активность (не входит в итоговую оценку):\n";
    report << "Использование атак:\n";
    report << formatRate(previousAttackUsageRate)
        << " → " << formatRate(currentAttackUsageRate)
        << " (" << formatRateDelta(
            previousAttackUsageRate,
            currentAttackUsageRate)
        << "; " << previousWar.attacksUsed << "/" << previousWar.maxAttacks
        << " → " << currentWar.attacksUsed << "/" << currentWar.maxAttacks
        << "; " << formatMetricStatus(
            previousAttackUsageRate,
            currentAttackUsageRate,
            true)
        << ")\n";

    report << "Пропущенные атаки:\n";
    report << formatRate(previousMissedAttacksRate)
        << " → " << formatRate(currentMissedAttacksRate)
        << " (" << formatRateDelta(
            previousMissedAttacksRate,
            currentMissedAttacksRate)
        << "; " << previousWar.maxAttacks - previousWar.attacksUsed
        << " → " << currentWar.maxAttacks - currentWar.attacksUsed
        << "; " << formatMetricStatus(
            previousMissedAttacksRate,
            currentMissedAttacksRate,
            false)
        << ")\n";
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
