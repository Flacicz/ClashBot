#include "reports/ClanwarComparisonFormatter.h"

#include <cmath>
#include <sstream>
#include <string_view>
#include <vector>

#include <fmt/format.h>

#include "analytics/ClanwarComparisonAnalyzer.h"

namespace
{
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

    std::string formatAttacksDelta(const int value)
    {
        const auto absoluteValue = std::abs(value);
        const auto lastTwoDigits = absoluteValue % 100;
        const auto lastDigit = absoluteValue % 10;

        std::string_view word = "атак";
        if (lastTwoDigits < 11 || lastTwoDigits > 14)
        {
            if (lastDigit == 1) word = "атака";
            else if (lastDigit >= 2 && lastDigit <= 4) word = "атаки";
        }

        return formatSignedInteger(value) + " " + std::string(word);
    }

    std::string formatAttacksCount(const int count)
    {
        const auto absoluteValue = std::abs(count);
        const auto lastTwoDigits = absoluteValue % 100;
        const auto lastDigit = absoluteValue % 10;

        std::string_view word = "атак";
        if (lastTwoDigits < 11 || lastTwoDigits > 14)
        {
            if (lastDigit == 1) word = "атака";
            else if (lastDigit >= 2 && lastDigit <= 4) word = "атаки";
        }

        return fmt::format("{} {}", count, word);
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

    std::string formatAverageWarsLabel(const int warsCount)
    {
        if (warsCount == 1) return "Среднее за 1 предыдущую войну:";

        const auto absoluteValue = std::abs(warsCount);
        const auto lastTwoDigits = absoluteValue % 100;
        const auto lastDigit = absoluteValue % 10;

        if ((lastTwoDigits >= 11 && lastTwoDigits <= 14) ||
            lastDigit == 0 || lastDigit >= 5)
        {
            return fmt::format("Среднее за {} предыдущих войн:", warsCount);
        }

        if (lastDigit >= 2)
        {
            return fmt::format("Среднее за {} предыдущие войны:", warsCount);
        }

        return fmt::format("Среднее за {} предыдущую войну:", warsCount);
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

    std::string formatMissedAttacks(const int count)
    {
        if (count == 1) return "1 пропущенная атака";

        const auto absoluteValue = std::abs(count);
        const auto lastTwoDigits = absoluteValue % 100;
        const auto lastDigit = absoluteValue % 10;

        if ((lastTwoDigits >= 11 && lastTwoDigits <= 14) ||
            lastDigit == 0 || lastDigit >= 5)
        {
            return fmt::format("{} пропущенных атак", count);
        }

        if (lastDigit >= 2)
        {
            return fmt::format("{} пропущенные атаки", count);
        }

        return fmt::format("{} пропущенная атака", count);
    }

    void appendDisciplineChange(std::ostream& report,
                                const ClanwarWarStats& currentWar,
                                const ClanwarWarStats& previousWar)
    {
        report << "Без атак: "
            << previousWar.disciplineStats.playersWithoutAttacks
            << " → " << currentWar.disciplineStats.playersWithoutAttacks
            << " (" << formatSignedInteger(
                currentWar.disciplineStats.playersWithoutAttacks -
                previousWar.disciplineStats.playersWithoutAttacks)
            << ")\n";

        report << "Без второй атаки: "
            << previousWar.disciplineStats.playersWithOneAttack
            << " → " << currentWar.disciplineStats.playersWithOneAttack
            << " (" << formatSignedInteger(
                currentWar.disciplineStats.playersWithOneAttack -
                previousWar.disciplineStats.playersWithOneAttack)
            << ")\n";

        report << "Атаки не по зеркалу: "
            << previousWar.disciplineStats.firstAttacksNotOnMirror
            << " → " << currentWar.disciplineStats.firstAttacksNotOnMirror
            << " (" << formatSignedInteger(
                currentWar.disciplineStats.firstAttacksNotOnMirror -
                previousWar.disciplineStats.firstAttacksNotOnMirror)
            << ")\n";
    }

    void appendHistoricalAverages(std::ostream& report,
                                  const ClanwarComparisonData& reportData)
    {
        if (!reportData.previousWarsAverage.has_value()) return;

        const auto& average = reportData.previousWarsAverage.value();
        const auto& currentWar = reportData.currentWar;

        report << "📉 <b>ТРЕНД</b>\n";
        report << formatAverageWarsLabel(average.warsCount) << "\n";
        report << fmt::format(
            "{:.2f} ⭐/атаку\n{:.2f}% разрушение\n{:.1f} пропущенные атаки\n{:.1f} без второй атаки\n{:.1f} атаки не по зеркалу\n",
            average.averageStarsPerAttack,
            average.averageDestruction,
            average.averageMissedAttacks,
            average.averagePlayersWithOneAttack,
            average.averageFirstAttacksNotOnMirror
        );

        report << "\nТекущая война:\n";
        report << fmt::format("{:.2f} ⭐/атаку\n", currentWar.averageStarsPerAttack);
        report << fmt::format("{:.2f}% разрушение\n", currentWar.homeDestruction);
        report << formatMissedAttacks(currentWar.maxAttacks - currentWar.attacksUsed)
            << "\n";
        report << currentWar.disciplineStats.playersWithOneAttack
            << " без второй атаки\n"
            << formatAttacksCount(currentWar.disciplineStats.firstAttacksNotOnMirror)
            << " не по зеркалу\n";
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

        switch (reportData.performanceComparison->trend)
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
    report << formatWarLabel("Текущая война", currentWar) << "\n";
    report << formatWarLabel("Предыдущая", previousWar) << "\n\n";

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

    report << "📊 <b>ИЗМЕНЕНИЯ</b>\n";
    report << "⭐ Средние звёзды за атаку:\n";
    report << fmt::format("{:.2f} → {:.2f} ({})\n",
                          previousWar.averageStarsPerAttack,
                          currentWar.averageStarsPerAttack,
                          formatSignedDouble(
                              currentWar.averageStarsPerAttack -
                              previousWar.averageStarsPerAttack));

    report << "💥 Разрушение:\n";
    report << fmt::format("{:.2f}% → {:.2f}% (",
                          previousWar.homeDestruction,
                          currentWar.homeDestruction)
        << formatSignedDouble(currentWar.homeDestruction - previousWar.homeDestruction)
        << " п.п.)\n";

    report << "⚔️ Проведено атак:\n";
    report << previousWar.attacksUsed << "/" << previousWar.maxAttacks
        << " → " << currentWar.attacksUsed << "/" << currentWar.maxAttacks
        << " (" << formatAttacksDelta(
            currentWar.attacksUsed - previousWar.attacksUsed)
        << ")\n";

    report << "🎯 Дисциплина:\n";
    appendDisciplineChange(report, currentWar, previousWar);

    report << "\n";
    if (!reportData.recentWarResults.empty())
    {
        report << "Последние " << reportData.recentWarResults.size() << " войн:\n";
        for (const auto outcome : reportData.recentWarResults)
        {
            report << outcomeIcon(outcome) << ' ';
        }
        report << "\n\n";
    }

    appendHistoricalAverages(report, reportData);
    appendPerformanceComparison(report, reportData);

    return report.str();
}
