import {
    buildComparisonData,
    ClanwarPerformanceTrend,
    type ClanwarComparisonData,
    type ClanwarComparisonOptions,
} from '../analytics/clanwarComparisonAnalyzer.js';
import { escapeHtml, removeTrailingNewlines } from '../common/formatUtils.js';
import {
    ClanwarOutcome,
    type ClanwarOutcomeValue,
    type ClanwarReference,
    type ClanwarWarStats,
} from '../database/repos/clanwarRepo.js';
import type { WarEndedEvent } from '../events/applicationEvents.js';
import { formatFixedHalfToEven } from './numberFormat.js';

export interface ClanwarComparisonReader {
    getClanwarStats(reference: ClanwarReference): ClanwarWarStats;
    getPreviousClanwars(currentWar: ClanwarReference, limit: number): ClanwarReference[];
}

const PREVIOUS_WARS_FOR_REPORT = 4;

function calculateRate(value: number, total: number): number {
    if (total <= 0) {
        return 0.0;
    }
    return value / total;
}

function formatRate(rate: number): string {
    return `${formatFixedHalfToEven(rate * 100.0, 1)}%`;
}

function outcomeName(outcome: ClanwarOutcomeValue): string {
    switch (outcome) {
        case ClanwarOutcome.Victory:
            return 'Победа';
        case ClanwarOutcome.Defeat:
            return 'Поражение';
        case ClanwarOutcome.Draw:
            return 'Ничья';
    }
}

function outcomeIcon(outcome: ClanwarOutcomeValue): string {
    switch (outcome) {
        case ClanwarOutcome.Victory:
            return '✅';
        case ClanwarOutcome.Defeat:
            return '❌';
        case ClanwarOutcome.Draw:
            return '➖';
    }
}

function formatSignedInteger(value: number): string {
    if (value === 0) {
        return '0';
    }
    if (value >= 0) {
        return `+${String(value)}`;
    }
    return `−${String(Math.abs(value))}`;
}

function formatSignedDouble(value: number): string {
    if (value === 0.0) {
        return '0.00';
    }
    if (value >= 0.0) {
        return `+${formatFixedHalfToEven(value, 2)}`;
    }
    return `−${formatFixedHalfToEven(Math.abs(value), 2)}`;
}

function formatSignedPercentagePoints(percentagePoints: number): string {
    if (percentagePoints === 0.0) {
        return '0.0 п.п.';
    }
    if (percentagePoints > 0.0) {
        return `+${formatFixedHalfToEven(percentagePoints, 1)} п.п.`;
    }
    return `−${formatFixedHalfToEven(Math.abs(percentagePoints), 1)} п.п.`;
}

function formatRateDelta(previousRate: number, currentRate: number): string {
    return formatSignedPercentagePoints((currentRate - previousRate) * 100.0);
}

function formatMetricStatus(
    previousValue: number,
    currentValue: number,
    higherIsBetter: boolean,
): string {
    if (currentValue === previousValue) {
        return '➖ без изменений';
    }

    const improved = higherIsBetter ? currentValue > previousValue : currentValue < previousValue;
    return improved ? '✅ лучше' : '⚠️ хуже';
}

function formatRateComparison(
    label: string,
    previousRate: number,
    currentRate: number,
    previousDetails: string,
    currentDetails: string,
    higherIsBetter: boolean,
    includeStatus = true,
): string {
    let line =
        `${label}:\n` +
        `${formatRate(previousRate)} → ${formatRate(currentRate)}` +
        ` (${formatRateDelta(previousRate, currentRate)}; ${previousDetails} → ${currentDetails}`;

    if (includeStatus) {
        line += `; ${formatMetricStatus(previousRate, currentRate, higherIsBetter)}`;
    }

    line += ')\n';
    return line;
}

function formatWarLabel(label: string, stats: ClanwarWarStats): string {
    return `${label}: ${outcomeIcon(stats.result)} ${outcomeName(stats.result)} ${String(stats.homeStars)}–${String(stats.opponentStars)}`;
}

function formatWarParticipants(stats: ClanwarWarStats): string {
    return (
        `🏠 Наш клан: ${escapeHtml(stats.homeClanName)} (<code>${escapeHtml(stats.homeClanTag)}</code>)\n` +
        `⚔️ Соперник: ${escapeHtml(stats.opponentClanName)} (<code>${escapeHtml(stats.opponentClanTag)}</code>)\n`
    );
}

function formatPreviousWarsPeriod(warsCount: number): string {
    if (warsCount === 1) {
        return 'за последнюю войну';
    }

    const absoluteValue = Math.abs(warsCount);
    const lastTwoDigits = absoluteValue % 100;
    const lastDigit = absoluteValue % 10;

    if ((lastTwoDigits >= 11 && lastTwoDigits <= 14) || lastDigit === 0 || lastDigit >= 5) {
        return `за последние ${String(warsCount)} войн`;
    }

    if (lastDigit >= 2) {
        return `за последние ${String(warsCount)} войны`;
    }

    return `за последние ${String(warsCount)} войну`;
}

function formatRecentWarsLabel(warsCount: number): string {
    if (warsCount === 1) {
        return 'Последняя война';
    }

    const lastTwoDigits = warsCount % 100;
    const lastDigit = warsCount % 10;

    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
        return `Последние ${String(warsCount)} войн`;
    }

    if (lastDigit >= 2 && lastDigit <= 4) {
        return `Последние ${String(warsCount)} войны`;
    }

    if (lastDigit === 1) {
        return `Последние ${String(warsCount)} война`;
    }

    return `Последние ${String(warsCount)} войн`;
}

function formatHistoricalAveragesLabel(warsCount: number): string {
    const absoluteValue = Math.abs(warsCount);
    const lastTwoDigits = absoluteValue % 100;
    const lastDigit = absoluteValue % 10;

    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
        return `📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА ${String(warsCount)} ПРЕДЫДУЩИХ ВОЙН</b>`;
    }

    if (lastDigit === 1) {
        return `📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА ${String(warsCount)} ПРЕДЫДУЩУЮ ВОЙНУ</b>`;
    }

    if (lastDigit >= 2 && lastDigit <= 4) {
        return `📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА ${String(warsCount)} ПРЕДЫДУЩИЕ ВОЙНЫ</b>`;
    }

    return `📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА ${String(warsCount)} ПРЕДЫДУЩИХ ВОЙН</b>`;
}

export type ClanwarComparisonFormatOptions = ClanwarComparisonOptions;

function formatDisciplineChange(
    currentWar: ClanwarWarStats,
    previousWar: ClanwarWarStats,
    mirrorRuleEnabled: boolean,
): string {
    const previousPlayersWithoutAttacksRate = calculateRate(
        previousWar.disciplineStats.playersWithoutAttacks,
        previousWar.teamSize,
    );
    const currentPlayersWithoutAttacksRate = calculateRate(
        currentWar.disciplineStats.playersWithoutAttacks,
        currentWar.teamSize,
    );

    let section = formatRateComparison(
        'Без атак\n(среди всех участников)',
        previousPlayersWithoutAttacksRate,
        currentPlayersWithoutAttacksRate,
        String(previousWar.disciplineStats.playersWithoutAttacks),
        String(currentWar.disciplineStats.playersWithoutAttacks),
        false,
    );

    if (mirrorRuleEnabled) {
        const previousFirstAttacksNotOnMirrorRate = calculateRate(
            previousWar.disciplineStats.firstAttacksNotOnMirror,
            previousWar.teamSize - previousWar.disciplineStats.playersWithoutAttacks,
        );
        const currentFirstAttacksNotOnMirrorRate = calculateRate(
            currentWar.disciplineStats.firstAttacksNotOnMirror,
            currentWar.teamSize - currentWar.disciplineStats.playersWithoutAttacks,
        );
        section += formatRateComparison(
            'Атаки не по зеркалу\n(среди участников с атаками)',
            previousFirstAttacksNotOnMirrorRate,
            currentFirstAttacksNotOnMirrorRate,
            String(previousWar.disciplineStats.firstAttacksNotOnMirror),
            String(currentWar.disciplineStats.firstAttacksNotOnMirror),
            false,
        );
    }

    return section;
}

function formatSingleAttackActivity(
    currentWar: ClanwarWarStats,
    previousWar: ClanwarWarStats,
): string {
    const previousRate = calculateRate(
        previousWar.disciplineStats.playersWithOneAttack,
        previousWar.teamSize,
    );
    const currentRate = calculateRate(
        currentWar.disciplineStats.playersWithOneAttack,
        currentWar.teamSize,
    );

    return formatRateComparison(
        'Ровно одна атака\n(среди всех участников)',
        previousRate,
        currentRate,
        String(previousWar.disciplineStats.playersWithOneAttack),
        String(currentWar.disciplineStats.playersWithOneAttack),
        false,
    );
}

function formatHistoricalAveragesSection(
    reportData: ClanwarComparisonData,
    mirrorRuleEnabled: boolean,
): string {
    if (reportData.previousWarsAverage === null) {
        return '';
    }

    const average = reportData.previousWarsAverage;
    const currentWar = reportData.currentWar;

    const averageAttackUsageRate = 1.0 - average.averageMissedAttacksRate;
    const currentAttackUsageRate = calculateRate(currentWar.attacksUsed, currentWar.maxAttacks);
    const currentMissedAttacksRate = calculateRate(
        currentWar.maxAttacks - currentWar.attacksUsed,
        currentWar.maxAttacks,
    );
    const currentPlayersWithoutAttacksRate = calculateRate(
        currentWar.disciplineStats.playersWithoutAttacks,
        currentWar.teamSize,
    );
    const currentPlayersWithOneAttackRate = calculateRate(
        currentWar.disciplineStats.playersWithOneAttack,
        currentWar.teamSize,
    );

    let section = '';
    section += `${formatHistoricalAveragesLabel(average.warsCount)}\n`;
    section += 'Для долевых метрик изменение указано в процентных пунктах (п.п.).\n';
    section += '\n📌 Основные метрики:\n';
    section += '⭐ Средние звёзды за атаку:\n';
    section += `${formatFixedHalfToEven(average.averageStarsPerAttack, 2)} → ${formatFixedHalfToEven(currentWar.averageStarsPerAttack, 2)} (${formatSignedDouble(currentWar.averageStarsPerAttack - average.averageStarsPerAttack)}; ${formatMetricStatus(average.averageStarsPerAttack, currentWar.averageStarsPerAttack, true)})\n`;

    section += '💥 Среднее разрушение за атаку:\n';
    section += `${formatFixedHalfToEven(average.averageDestructionPerAttack, 2)}% → ${formatFixedHalfToEven(currentWar.averageDestructionPerAttack, 2)}% (${formatSignedPercentagePoints(currentWar.averageDestructionPerAttack - average.averageDestructionPerAttack)}; ${formatMetricStatus(average.averageDestructionPerAttack, currentWar.averageDestructionPerAttack, true)})\n`;

    section += '\n🎯 Дисциплина:\n';
    section += formatRateComparison(
        'Без атак\n(среди всех участников)',
        average.averagePlayersWithoutAttacksRate,
        currentPlayersWithoutAttacksRate,
        formatFixedHalfToEven(average.averagePlayersWithoutAttacks, 1),
        String(currentWar.disciplineStats.playersWithoutAttacks),
        false,
    );

    if (mirrorRuleEnabled) {
        const currentFirstAttacksNotOnMirrorRate = calculateRate(
            currentWar.disciplineStats.firstAttacksNotOnMirror,
            currentWar.teamSize - currentWar.disciplineStats.playersWithoutAttacks,
        );
        section += formatRateComparison(
            'Атаки не по зеркалу\n(среди участников с атаками)',
            average.averageFirstAttacksNotOnMirrorRate,
            currentFirstAttacksNotOnMirrorRate,
            formatFixedHalfToEven(average.averageFirstAttacksNotOnMirror, 1),
            String(currentWar.disciplineStats.firstAttacksNotOnMirror),
            false,
        );
    }

    section += '\n⚔️ Активность (не входит в итоговую оценку):\n';

    section += formatRateComparison(
        'Использование атак',
        averageAttackUsageRate,
        currentAttackUsageRate,
        `${formatFixedHalfToEven(average.averageAttacksUsed, 1)}/${formatFixedHalfToEven(average.averageMaxAttacks, 1)}`,
        `${String(currentWar.attacksUsed)}/${String(currentWar.maxAttacks)}`,
        true,
    );

    section += formatRateComparison(
        'Пропущенные атаки',
        average.averageMissedAttacksRate,
        currentMissedAttacksRate,
        formatFixedHalfToEven(average.averageMissedAttacks, 1),
        String(currentWar.maxAttacks - currentWar.attacksUsed),
        false,
    );

    section += formatRateComparison(
        'Ровно одна атака\n(среди всех участников)',
        average.averagePlayersWithOneAttackRate,
        currentPlayersWithOneAttackRate,
        formatFixedHalfToEven(average.averagePlayersWithOneAttack, 1),
        String(currentWar.disciplineStats.playersWithOneAttack),
        false,
    );

    return section;
}

function formatPerformanceComparisonSection(reportData: ClanwarComparisonData): string {
    if (reportData.performanceComparison === null || reportData.previousWarsAverage === null) {
        return '';
    }

    const period = formatPreviousWarsPeriod(reportData.previousWarsAverage.warsCount);
    const comparison = reportData.performanceComparison;

    let trendLine: string;
    switch (comparison.trend) {
        case ClanwarPerformanceTrend.Better:
            trendLine = `✅ Динамика лучше среднего ${period}\n`;
            break;
        case ClanwarPerformanceTrend.Worse:
            trendLine = `⚠️ Динамика хуже среднего ${period}\n`;
            break;
        case ClanwarPerformanceTrend.Similar:
            trendLine = `⚖️ Динамика примерно на уровне среднего ${period}\n`;
            break;
    }

    return (
        `\n${trendLine}\n` +
        `Итог по ${String(comparison.totalMetrics)} основным метрикам:\n` +
        `Улучшились: ${String(comparison.improvedMetrics)} (${formatFixedHalfToEven(comparison.improvedMetricsRate * 100.0, 1)}%)\n` +
        `Ухудшились: ${String(comparison.worsenedMetrics)} (${formatFixedHalfToEven(comparison.worsenedMetricsRate * 100.0, 1)}%)\n` +
        `Без изменений: ${String(comparison.unchangedMetrics)} (${formatFixedHalfToEven(comparison.unchangedMetricsRate * 100.0, 1)}%).\n`
    );
}

export class ClanwarComparisonFormatter {
    static readonly EventType = 'war_comparison';

    readonly #clanwarRepo: ClanwarComparisonReader;

    constructor(clanwarRepo: ClanwarComparisonReader) {
        this.#clanwarRepo = clanwarRepo;
    }

    format(event: WarEndedEvent, options?: ClanwarComparisonFormatOptions): string {
        const currentWarStats = this.#clanwarRepo.getClanwarStats(event.warReference);
        const previousWarReferences = this.#clanwarRepo.getPreviousClanwars(
            event.warReference,
            PREVIOUS_WARS_FOR_REPORT,
        );

        const previousWarStats = previousWarReferences.map((reference) =>
            this.#clanwarRepo.getClanwarStats(reference),
        );

        const reportData = buildComparisonData(currentWarStats, previousWarStats, options);
        return ClanwarComparisonFormatter.buildReport(reportData);
    }

    static buildReport(reportData: ClanwarComparisonData): string {
        if (reportData.previousWar === null) {
            return '';
        }

        const mirrorRuleEnabled = reportData.mirrorRuleEnabled ?? true;
        const currentWar = reportData.currentWar;
        const previousWar = reportData.previousWar;

        let report = '📈 <b>ДИНАМИКА ВОЙНЫ</b>\n\n';
        report += `${formatWarLabel('Последняя война', currentWar)}\n`;
        report += formatWarParticipants(currentWar);
        report += '\n';
        report += `${formatWarLabel('Предыдущая война', previousWar)}\n`;
        report += formatWarParticipants(previousWar);
        report += '\n';

        report += 'Изменение результата:\n';
        report += `${outcomeName(previousWar.result)} → ${outcomeName(currentWar.result)}\n`;

        const previousStarDifference = previousWar.homeStars - previousWar.opponentStars;
        const currentStarDifference = currentWar.homeStars - currentWar.opponentStars;

        report += `Разница по звёздам: ${formatSignedInteger(previousStarDifference)} → ${formatSignedInteger(currentStarDifference)}\n\n`;

        report += '📊 <b>СРАВНЕНИЕ С ПРЕДЫДУЩЕЙ ВОЙНОЙ</b>\n';
        report += 'Для долевых метрик изменение указано в процентных пунктах (п.п.).\n';
        report += '\n📌 Основные метрики:\n';
        report += '⭐ Средние звёзды за атаку:\n';
        report += `${formatFixedHalfToEven(previousWar.averageStarsPerAttack, 2)} → ${formatFixedHalfToEven(currentWar.averageStarsPerAttack, 2)} (${formatSignedDouble(currentWar.averageStarsPerAttack - previousWar.averageStarsPerAttack)}; ${formatMetricStatus(previousWar.averageStarsPerAttack, currentWar.averageStarsPerAttack, true)})\n`;

        report += '💥 Среднее разрушение за атаку:\n';
        report += `${formatFixedHalfToEven(previousWar.averageDestructionPerAttack, 2)}% → ${formatFixedHalfToEven(currentWar.averageDestructionPerAttack, 2)}% (${formatSignedPercentagePoints(currentWar.averageDestructionPerAttack - previousWar.averageDestructionPerAttack)}; ${formatMetricStatus(previousWar.averageDestructionPerAttack, currentWar.averageDestructionPerAttack, true)})\n`;

        const previousAttackUsageRate = calculateRate(
            previousWar.attacksUsed,
            previousWar.maxAttacks,
        );
        const currentAttackUsageRate = calculateRate(currentWar.attacksUsed, currentWar.maxAttacks);
        const previousMissedAttacksRate = calculateRate(
            previousWar.maxAttacks - previousWar.attacksUsed,
            previousWar.maxAttacks,
        );
        const currentMissedAttacksRate = calculateRate(
            currentWar.maxAttacks - currentWar.attacksUsed,
            currentWar.maxAttacks,
        );

        report += '\n🎯 Дисциплина:\n';
        report += formatDisciplineChange(currentWar, previousWar, mirrorRuleEnabled);

        report += '\n⚔️ Активность (не входит в итоговую оценку):\n';
        report += formatRateComparison(
            'Использование атак',
            previousAttackUsageRate,
            currentAttackUsageRate,
            `${String(previousWar.attacksUsed)}/${String(previousWar.maxAttacks)}`,
            `${String(currentWar.attacksUsed)}/${String(currentWar.maxAttacks)}`,
            true,
        );

        report += formatRateComparison(
            'Пропущенные атаки',
            previousMissedAttacksRate,
            currentMissedAttacksRate,
            String(previousWar.maxAttacks - previousWar.attacksUsed),
            String(currentWar.maxAttacks - currentWar.attacksUsed),
            false,
        );
        report += formatSingleAttackActivity(currentWar, previousWar);

        report += '\n';
        if (reportData.recentWarResults.length > 0) {
            report += `${formatRecentWarsLabel(reportData.recentWarResults.length)}:\n`;
            for (const outcome of reportData.recentWarResults) {
                report += `${outcomeIcon(outcome)} `;
            }
            report += '\n\n';
        }

        report += formatHistoricalAveragesSection(reportData, mirrorRuleEnabled);
        report += formatPerformanceComparisonSection(reportData);

        return removeTrailingNewlines(report);
    }
}
