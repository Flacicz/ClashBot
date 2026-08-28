#include "reports/RaidsComparisonFormatter.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <sstream>
#include <string_view>
#include <vector>

#include <fmt/format.h>

#include "analytics/RaidComparisonAnalyzer.h"
#include "common/StringUtils.h"
#include "common/TimeParser.h"

namespace
{
    double calculateRate(const double value, const double total)
    {
        if (total <= 0.0) return 0.0;
        return value / total;
    }

    std::string formatRate(const double rate)
    {
        return fmt::format("{:.1f}%", rate * 100.0);
    }

    std::string formatSignedInteger(const long long value)
    {
        if (value == 0) return "0";

        const auto absoluteValue = std::llabs(value);
        const auto digits = std::to_string(absoluteValue);

        std::string formatted;
        formatted.reserve(digits.size() + digits.size() / 3);

        for (std::size_t i = 0; i < digits.size(); ++i)
        {
            if (i > 0 && (digits.size() - i) % 3 == 0)
            {
                formatted += ' ';
            }

            formatted += digits[i];
        }

        if (value > 0)
        {
            return "+" + formatted;
        }

        return "−" + formatted;
    }

    std::string formatInteger(const long long value)
    {
        if (value == 0) return "0";

        const auto absoluteValue = std::llabs(value);
        const auto digits = std::to_string(absoluteValue);

        std::string formatted;
        formatted.reserve(digits.size() + digits.size() / 3);

        for (std::size_t i = 0; i < digits.size(); ++i)
        {
            if (i > 0 && (digits.size() - i) % 3 == 0)
            {
                formatted += ' ';
            }

            formatted += digits[i];
        }

        return value < 0 ? "−" + formatted : formatted;
    }

    std::string formatSignedDouble(const double value)
    {
        if (value == 0.0) return "0.0";

        const auto absoluteValue = std::abs(value);
        const auto formatted = fmt::format("{:.1f}", absoluteValue);

        return value > 0.0 ? "+" + formatted : "−" + formatted;
    }

    std::string formatRateDelta(const double previousRate,
                                const double currentRate)
    {
        return formatSignedDouble((currentRate - previousRate) * 100.0)
            + " п.п.";
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

    std::string formatAverageNumber(const double value)
    {
        const auto roundedValue = std::round(value);

        if (std::abs(value - roundedValue) < 0.0001)
        {
            return formatInteger(static_cast<long long>(roundedValue));
        }

        return fmt::format("{:.1f}", value);
    }

    std::string formatAverageFraction(const double numerator,
                                       const double denominator)
    {
        return formatAverageNumber(numerator) + "/" + formatAverageNumber(denominator);
    }

    std::string formatRaidDate(const long long timestamp)
    {
        const auto dateTime = utils::formatUnixToLocalDateTime(timestamp);

        if (dateTime == "неизвестно") return dateTime;

        return dateTime.substr(0, dateTime.find(' '));
    }

    double lootPerUsedAttack(const RaidComparisonStats& stats)
    {
        return calculateRate(stats.totalLoot, stats.usedAttacks);
    }

    double attackUsageRate(const RaidComparisonStats& stats)
    {
        return calculateRate(stats.usedAttacks, stats.availableAttacks);
    }

    int participantsWithUnusedAttacks(const RaidComparisonStats& stats)
    {
        return std::max(
            0,
            stats.activeParticipants - stats.participantsWithAllAttacksUsed
        );
    }

    double participantsWithUnusedAttacksRate(const RaidComparisonStats& stats)
    {
        return calculateRate(
            participantsWithUnusedAttacks(stats),
            stats.activeParticipants
        );
    }

    std::string formatHistoricalAveragesLabel(const int raidsCount)
    {
        const auto absoluteValue = std::abs(raidsCount);
        const auto lastTwoDigits = absoluteValue % 100;
        const auto lastDigit = absoluteValue % 10;

        if (lastTwoDigits >= 11 && lastTwoDigits <= 14)
        {
            return fmt::format(
                "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА {} ПРЕДЫДУЩИХ РЕЙДОВ</b>",
                raidsCount
            );
        }

        if (lastDigit == 1)
        {
            return fmt::format(
                "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА {} ПРЕДЫДУЩИЙ РЕЙД</b>",
                raidsCount
            );
        }

        if (lastDigit >= 2 && lastDigit <= 4)
        {
            return fmt::format(
                "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА {} ПРЕДЫДУЩИХ РЕЙДА</b>",
                raidsCount
            );
        }

        return fmt::format(
            "📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА {} ПРЕДЫДУЩИХ РЕЙДОВ</b>",
            raidsCount
        );
    }

    std::string formatPreviousRaidsPeriod(const int raidsCount)
    {
        if (raidsCount == 1) return "за последний рейд";

        const auto absoluteValue = std::abs(raidsCount);
        const auto lastTwoDigits = absoluteValue % 100;
        const auto lastDigit = absoluteValue % 10;

        if ((lastTwoDigits >= 11 && lastTwoDigits <= 14) ||
            lastDigit == 0 || lastDigit >= 5)
        {
            return fmt::format("за последние {} рейдов", raidsCount);
        }

        return fmt::format("за последние {} рейда", raidsCount);
    }

    void appendRateComparison(std::ostream& report,
                              const std::string_view label,
                              const double previousRate,
                              const double currentRate,
                              const std::string& previousDetails,
                              const std::string& currentDetails,
                              const bool higherIsBetter)
    {
        report << label << ":\n"
            << formatRate(previousRate)
            << " → " << formatRate(currentRate)
            << " (" << formatRateDelta(previousRate, currentRate)
            << "; " << previousDetails
            << " → " << currentDetails
            << "; " << formatMetricStatus(
                previousRate,
                currentRate,
                higherIsBetter)
            << ")\n";
    }

    void appendLootPerAttackComparison(std::ostream& report,
                                       const double previousLootPerAttack,
                                       const double currentLootPerAttack)
    {
        report << "💰 Средняя добыча золота за использованную атаку:\n"
            << formatInteger(static_cast<long long>(std::llround(previousLootPerAttack)))
            << " → "
            << formatInteger(static_cast<long long>(std::llround(currentLootPerAttack)))
            << " ("
            << formatSignedInteger(static_cast<long long>(std::llround(
                currentLootPerAttack - previousLootPerAttack)))
            << "; "
            << formatMetricStatus(
                previousLootPerAttack,
                currentLootPerAttack,
                true)
            << ")\n";
    }

    void appendDisciplineComparison(std::ostream& report,
                                    const double previousFullRate,
                                    const double currentFullRate,
                                    const std::string& previousFullDetails,
                                    const std::string& currentFullDetails,
                                    const double previousIncompleteRate,
                                    const double currentIncompleteRate,
                                    const std::string& previousIncompleteDetails,
                                    const std::string& currentIncompleteDetails,
                                    const double previousNoAttackRate,
                                    const double currentNoAttackRate,
                                    const std::string& previousNoAttackDetails,
                                    const std::string& currentNoAttackDetails)
    {
        report << "🎯 Дисциплина:\n";

        appendRateComparison(
            report,
            "Полностью использовали доступные атаки\n"
            "(среди активных участников)",
            previousFullRate,
            currentFullRate,
            previousFullDetails,
            currentFullDetails,
            true
        );

        appendRateComparison(
            report,
            "Использовали не все атаки\n"
            "(среди активных участников)",
            previousIncompleteRate,
            currentIncompleteRate,
            previousIncompleteDetails,
            currentIncompleteDetails,
            false
        );

        appendRateComparison(
            report,
            "Без атак\n"
            "(среди всех участников)",
            previousNoAttackRate,
            currentNoAttackRate,
            previousNoAttackDetails,
            currentNoAttackDetails,
            false
        );
    }

    void appendActivityComparison(std::ostream& report,
                                  const double previousUsageRate,
                                  const double currentUsageRate,
                                  const std::string& previousUsageDetails,
                                  const std::string& currentUsageDetails,
                                  const double previousParticipantsRate,
                                  const double currentParticipantsRate,
                                  const std::string& previousParticipantsDetails,
                                  const std::string& currentParticipantsDetails)
    {
        report << "⚔️ Активность (не входит в итоговую оценку):\n";

        appendRateComparison(
            report,
            "Использование атак",
            previousUsageRate,
            currentUsageRate,
            previousUsageDetails,
            currentUsageDetails,
            true
        );

        appendRateComparison(
            report,
            "Активные участники\n"
            "(сделали хотя бы одну атаку)",
            previousParticipantsRate,
            currentParticipantsRate,
            previousParticipantsDetails,
            currentParticipantsDetails,
            true
        );
    }

    void appendIntegerMetricComparison(std::ostream& report,
                                       const std::string_view label,
                                       const long long previousValue,
                                       const long long currentValue)
    {
        report << label << ":\n"
            << formatInteger(previousValue)
            << " → " << formatInteger(currentValue)
            << " (" << formatSignedInteger(currentValue - previousValue)
            << ")\n";
    }

    void appendAverageMetricComparison(std::ostream& report,
                                       const std::string_view label,
                                       const double previousValue,
                                       const double currentValue)
    {
        report << label << ":\n"
            << formatAverageNumber(previousValue)
            << " → " << formatAverageNumber(currentValue)
            << " (" << formatSignedDouble(currentValue - previousValue)
            << ")\n";
    }

    void appendHistoricalIntegerMetricComparison(std::ostream& report,
                                                 const std::string_view label,
                                                 const double previousValue,
                                                 const int currentValue)
    {
        report << label << ":\n"
            << formatInteger(std::llround(previousValue))
            << " → " << formatInteger(currentValue)
            << " ("
            << formatSignedInteger(std::llround(
                currentValue - previousValue))
            << ")\n";
    }

    void appendHeader(std::ostream& report,
                      const RaidComparisonData& reportData,
                      const RaidComparisonStats& previousRaid)
    {
        report << "📈 <b>ДИНАМИКА РЕЙДОВ</b>\n\n";
        report << "🏠 Наш клан: "
            << utils::escapeHTML(reportData.clanName)
            << " (<code>"
            << utils::escapeHTML(reportData.clanTag)
            << "</code>)\n\n";
        report << "Последний рейд: "
            << formatRaidDate(reportData.currentRaid.startTime) << "\n";
        report << "Предыдущий рейд: "
            << formatRaidDate(previousRaid.startTime) << "\n\n";
    }

    void appendRaidResultComparison(std::ostream& report,
                                    const RaidComparisonStats& previousRaid,
                                    const RaidComparisonStats& currentRaid)
    {
        report << "📊 Итог рейда:\n";
        appendIntegerMetricComparison(
            report,
            "Заработано золота",
            previousRaid.totalLoot,
            currentRaid.totalLoot
        );
        appendIntegerMetricComparison(
            report,
            "Завершено рейдов",
            previousRaid.raidsCompleted,
            currentRaid.raidsCompleted
        );
        appendIntegerMetricComparison(
            report,
            "Уничтожено районов",
            previousRaid.enemyDistrictsDestroyed,
            currentRaid.enemyDistrictsDestroyed
        );
        appendIntegerMetricComparison(
            report,
            "Награда за нападение",
            previousRaid.offensiveReward,
            currentRaid.offensiveReward
        );
        appendIntegerMetricComparison(
            report,
            "Награда за оборону",
            previousRaid.defensiveReward,
            currentRaid.defensiveReward
        );
    }

    void appendPreviousRaidComparison(std::ostream& report,
                                      const RaidComparisonStats& previousRaid,
                                      const RaidComparisonStats& currentRaid)
    {
        report << "📊 <b>СРАВНЕНИЕ С ПРЕДЫДУЩИМ РЕЙДОМ</b>\n";
        report << "Для долевых метрик изменение указано в процентных пунктах (п.п.).\n";
        report << "\n📌 Основные метрики:\n";

        appendLootPerAttackComparison(
            report,
            lootPerUsedAttack(previousRaid),
            lootPerUsedAttack(currentRaid)
        );

        report << "\n";

        appendDisciplineComparison(
            report,
            calculateRate(
                previousRaid.participantsWithAllAttacksUsed,
                previousRaid.activeParticipants),
            calculateRate(
                currentRaid.participantsWithAllAttacksUsed,
                currentRaid.activeParticipants),
            formatInteger(previousRaid.participantsWithAllAttacksUsed)
                + "/" + formatInteger(previousRaid.activeParticipants),
            formatInteger(currentRaid.participantsWithAllAttacksUsed)
                + "/" + formatInteger(currentRaid.activeParticipants),
            participantsWithUnusedAttacksRate(previousRaid),
            participantsWithUnusedAttacksRate(currentRaid),
            formatInteger(participantsWithUnusedAttacks(previousRaid))
                + "/" + formatInteger(previousRaid.activeParticipants),
            formatInteger(participantsWithUnusedAttacks(currentRaid))
                + "/" + formatInteger(currentRaid.activeParticipants),
            calculateRate(
                previousRaid.participantsWithoutAttacks,
                previousRaid.eligibleParticipants),
            calculateRate(
                currentRaid.participantsWithoutAttacks,
                currentRaid.eligibleParticipants),
            formatInteger(previousRaid.participantsWithoutAttacks)
                + "/" + formatInteger(previousRaid.eligibleParticipants),
            formatInteger(currentRaid.participantsWithoutAttacks)
                + "/" + formatInteger(currentRaid.eligibleParticipants)
        );

        report << "\n";

        appendActivityComparison(
            report,
            attackUsageRate(previousRaid),
            attackUsageRate(currentRaid),
            formatInteger(previousRaid.usedAttacks)
                + "/" + formatInteger(previousRaid.availableAttacks),
            formatInteger(currentRaid.usedAttacks)
                + "/" + formatInteger(currentRaid.availableAttacks),
            calculateRate(
                previousRaid.activeParticipants,
                previousRaid.eligibleParticipants),
            calculateRate(
                currentRaid.activeParticipants,
                currentRaid.eligibleParticipants),
            formatInteger(previousRaid.activeParticipants)
                + "/" + formatInteger(previousRaid.eligibleParticipants),
            formatInteger(currentRaid.activeParticipants)
                + "/" + formatInteger(currentRaid.eligibleParticipants)
        );

        report << "\n";
        appendRaidResultComparison(report, previousRaid, currentRaid);
    }

    void appendHistoricalComparison(std::ostream& report,
                                    const RaidComparisonData& reportData)
    {
        if (!reportData.previousRaidsAverage.has_value()) return;

        const auto& average = reportData.previousRaidsAverage.value();
        const auto& currentRaid = reportData.currentRaid;

        const auto averageIncompleteParticipants = std::max(
            0.0,
            average.averageActiveParticipants
                - average.averageParticipantsWithAllAttacksUsed
        );

        report << "\n"
            << formatHistoricalAveragesLabel(average.raidsCount) << "\n";
        report << "Для долевых метрик изменение указано в процентных пунктах (п.п.).\n";
        report << "\n📌 Основные метрики:\n";

        appendLootPerAttackComparison(
            report,
            average.averageLootPerUsedAttack,
            lootPerUsedAttack(currentRaid)
        );

        report << "\n";

        appendDisciplineComparison(
            report,
            average.averageParticipantsWithAllAttacksUsedRate,
            calculateRate(
                currentRaid.participantsWithAllAttacksUsed,
                currentRaid.activeParticipants),
            formatAverageFraction(
                average.averageParticipantsWithAllAttacksUsed,
                average.averageActiveParticipants),
            formatInteger(currentRaid.participantsWithAllAttacksUsed)
                + "/" + formatInteger(currentRaid.activeParticipants),
            calculateRate(
                averageIncompleteParticipants,
                average.averageActiveParticipants),
            participantsWithUnusedAttacksRate(currentRaid),
            formatAverageFraction(
                averageIncompleteParticipants,
                average.averageActiveParticipants),
            formatInteger(participantsWithUnusedAttacks(currentRaid))
                + "/" + formatInteger(currentRaid.activeParticipants),
            average.averageParticipantsWithoutAttacksRate,
            calculateRate(
                currentRaid.participantsWithoutAttacks,
                currentRaid.eligibleParticipants),
            formatAverageFraction(
                average.averageParticipantsWithoutAttacks,
                average.averageEligibleParticipants),
            formatInteger(currentRaid.participantsWithoutAttacks)
                + "/" + formatInteger(currentRaid.eligibleParticipants)
        );

        report << "\n";

        appendActivityComparison(
            report,
            average.averageAttackUsageRate,
            attackUsageRate(currentRaid),
            formatAverageFraction(
                average.averageUsedAttacks,
                average.averageAvailableAttacks),
            formatInteger(currentRaid.usedAttacks)
                + "/" + formatInteger(currentRaid.availableAttacks),
            calculateRate(
                average.averageActiveParticipants,
                average.averageEligibleParticipants),
            calculateRate(
                currentRaid.activeParticipants,
                currentRaid.eligibleParticipants),
            formatAverageFraction(
                average.averageActiveParticipants,
                average.averageEligibleParticipants),
            formatInteger(currentRaid.activeParticipants)
                + "/" + formatInteger(currentRaid.eligibleParticipants)
        );

        report << "\n📊 Итог рейда:\n";
        appendHistoricalIntegerMetricComparison(
            report,
            "Заработано золота",
            average.averageTotalLoot,
            currentRaid.totalLoot
        );
        appendAverageMetricComparison(
            report,
            "Завершено рейдов",
            average.averageRaidsCompleted,
            currentRaid.raidsCompleted
        );
        appendAverageMetricComparison(
            report,
            "Уничтожено районов",
            average.averageEnemyDistrictsDestroyed,
            currentRaid.enemyDistrictsDestroyed
        );
        appendHistoricalIntegerMetricComparison(
            report,
            "Награда за нападение",
            average.averageOffensiveReward,
            currentRaid.offensiveReward
        );
        appendHistoricalIntegerMetricComparison(
            report,
            "Награда за оборону",
            average.averageDefensiveReward,
            currentRaid.defensiveReward
        );
    }

    void appendPerformanceComparison(std::ostream& report,
                                     const RaidComparisonData& reportData)
    {
        if (!reportData.performanceComparison.has_value() ||
            !reportData.previousRaidsAverage.has_value())
        {
            return;
        }

        const auto& comparison = reportData.performanceComparison.value();
        const auto period = formatPreviousRaidsPeriod(
            reportData.previousRaidsAverage->raidsCount);

        report << "\n";

        switch (comparison.trend)
        {
        case RaidPerformanceTrend::Better:
            report << "✅ Динамика лучше среднего " << period << "\n";
            break;
        case RaidPerformanceTrend::Worse:
            report << "⚠️ Динамика хуже среднего " << period << "\n";
            break;
        case RaidPerformanceTrend::Similar:
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

RaidsComparisonFormatter::RaidsComparisonFormatter(
    ClansRepo& clansRepo,
    RaidRepo& raidRepo)
    : clansRepo(clansRepo),
      raidRepo(raidRepo)
{
}

std::string RaidsComparisonFormatter::format(const RaidsEndedEvent& event) const
{
    constexpr int PREVIOUS_RAIDS_FOR_REPORT = 3;

    const auto currentRaidStats = raidRepo.getRaidComparisonStats(
        event.raidReference
    );
    const auto previousRaidReferences = raidRepo.getPreviousRaids(
        event.raidReference,
        PREVIOUS_RAIDS_FOR_REPORT
    );

    std::vector<RaidComparisonStats> previousRaidStats;
    previousRaidStats.reserve(previousRaidReferences.size());

    for (const auto& reference : previousRaidReferences)
    {
        previousRaidStats.push_back(raidRepo.getRaidComparisonStats(reference));
    }

    auto reportData = raids_analytics::buildComparisonData(
        currentRaidStats,
        previousRaidStats
    );
    reportData.clanTag = event.clanTag;
    reportData.clanName = clansRepo.getClanNameByTag(event.clanTag);

    return buildReport(reportData);
}

std::string RaidsComparisonFormatter::buildReport(
    const RaidComparisonData& reportData)
{
    if (!reportData.previousRaid.has_value()) return {};

    const auto& currentRaid = reportData.currentRaid;
    const auto& previousRaid = reportData.previousRaid.value();

    std::ostringstream report;

    appendHeader(report, reportData, previousRaid);
    appendPreviousRaidComparison(report, previousRaid, currentRaid);
    appendHistoricalComparison(report, reportData);
    appendPerformanceComparison(report, reportData);

    return utils::removeTrailingNewlines(report.str());
}
