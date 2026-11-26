import {
    buildRaidComparisonData,
    RaidPerformanceTrend,
    type RaidComparisonData,
} from '../analytics/raidComparisonAnalyzer.js';
import { escapeHtml, formatUnixToDate, removeTrailingNewlines } from '../common/formatUtils.js';
import type { RaidsEndedEvent } from '../events/applicationEvents.js';
import type { RaidComparisonStats, RaidReference } from '../models/raid.js';
import { DEFAULT_TIMEZONE_OFFSET_HOURS } from '../models/subscription.js';
import { formatFixedHalfToEven } from './numberFormat.js';
import type { ClanNameReader } from './playerJoinedFormatter.js';

export interface RaidComparisonReader {
    getRaidComparisonStats(reference: RaidReference): RaidComparisonStats;
    getPreviousRaids(currentRaid: RaidReference, limit: number): RaidReference[];
}

const PREVIOUS_RAIDS_FOR_REPORT = 3;

function calculateRate(value: number, total: number): number {
    if (total <= 0.0) {
        return 0.0;
    }
    return value / total;
}

function roundHalfAwayFromZero(value: number): number {
    if (value === 0) {
        return 0;
    }
    return value < 0 ? -Math.round(-value) : Math.round(value);
}

function formatRate(rate: number): string {
    return `${formatFixedHalfToEven(rate * 100.0, 1)}%`;
}

function groupDigitsWithSpaces(absoluteInteger: number): string {
    const digits = String(Math.trunc(absoluteInteger));
    let formatted = '';

    for (let i = 0; i < digits.length; i += 1) {
        if (i > 0 && (digits.length - i) % 3 === 0) {
            formatted += ' ';
        }
        formatted += digits[i] ?? '';
    }

    return formatted;
}

function formatSignedInteger(value: number): string {
    const truncated = Math.trunc(value);
    if (truncated === 0) {
        return '0';
    }

    const formatted = groupDigitsWithSpaces(Math.abs(truncated));
    return truncated > 0 ? `+${formatted}` : `−${formatted}`;
}

function formatInteger(value: number): string {
    const truncated = Math.trunc(value);
    if (truncated === 0) {
        return '0';
    }

    const formatted = groupDigitsWithSpaces(Math.abs(truncated));
    return truncated < 0 ? `−${formatted}` : formatted;
}

function formatSignedDouble(value: number): string {
    if (value === 0.0) {
        return '0.0';
    }

    const formatted = formatFixedHalfToEven(Math.abs(value), 1);
    return value > 0.0 ? `+${formatted}` : `−${formatted}`;
}

function formatRateDelta(previousRate: number, currentRate: number): string {
    return `${formatSignedDouble((currentRate - previousRate) * 100.0)} п.п.`;
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

function formatAverageNumber(value: number): string {
    const roundedValue = roundHalfAwayFromZero(value);

    if (Math.abs(value - roundedValue) < 0.0001) {
        return formatInteger(roundedValue);
    }

    return formatFixedHalfToEven(value, 1);
}

function formatAverageFraction(numerator: number, denominator: number): string {
    return `${formatAverageNumber(numerator)}/${formatAverageNumber(denominator)}`;
}

function formatRaidDate(timestamp: number, timezoneOffsetHours: number): string {
    return formatUnixToDate(timestamp, timezoneOffsetHours);
}

function lootPerUsedAttack(stats: RaidComparisonStats): number {
    return calculateRate(stats.totalLoot, stats.usedAttacks + stats.externalUsedAttacks);
}

function attackUsageRate(stats: RaidComparisonStats): number {
    return calculateRate(stats.usedAttacks, stats.availableAttacks);
}

function participantsWithUnusedAttacks(stats: RaidComparisonStats): number {
    return Math.max(0, stats.activeParticipants - stats.participantsWithAllAttacksUsed);
}

function participantsWithUnusedAttacksRate(stats: RaidComparisonStats): number {
    return calculateRate(participantsWithUnusedAttacks(stats), stats.activeParticipants);
}

function formatHistoricalAveragesLabel(raidsCount: number): string {
    const absoluteValue = Math.abs(raidsCount);
    const lastTwoDigits = absoluteValue % 100;
    const lastDigit = absoluteValue % 10;

    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
        return `📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА ${String(raidsCount)} ПРЕДЫДУЩИХ РЕЙДОВ</b>`;
    }

    if (lastDigit === 1) {
        return `📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА ${String(raidsCount)} ПРЕДЫДУЩИЙ РЕЙД</b>`;
    }

    if (lastDigit >= 2 && lastDigit <= 4) {
        return `📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА ${String(raidsCount)} ПРЕДЫДУЩИХ РЕЙДА</b>`;
    }

    return `📉 <b>СРАВНЕНИЕ СО СРЕДНИМ ЗА ${String(raidsCount)} ПРЕДЫДУЩИХ РЕЙДОВ</b>`;
}

function formatPreviousRaidsPeriod(raidsCount: number): string {
    if (raidsCount === 1) {
        return 'за последний рейд';
    }

    const absoluteValue = Math.abs(raidsCount);
    const lastTwoDigits = absoluteValue % 100;
    const lastDigit = absoluteValue % 10;

    if ((lastTwoDigits >= 11 && lastTwoDigits <= 14) || lastDigit === 0 || lastDigit >= 5) {
        return `за последние ${String(raidsCount)} рейдов`;
    }

    return `за последние ${String(raidsCount)} рейда`;
}

function formatRateComparison(
    label: string,
    previousRate: number,
    currentRate: number,
    previousDetails: string,
    currentDetails: string,
    higherIsBetter: boolean,
): string {
    return (
        `${label}:\n` +
        `${formatRate(previousRate)} → ${formatRate(currentRate)}` +
        ` (${formatRateDelta(previousRate, currentRate)}; ${previousDetails} → ${currentDetails}; ${formatMetricStatus(previousRate, currentRate, higherIsBetter)})\n`
    );
}

function formatLootPerAttackComparison(
    previousLootPerAttack: number,
    currentLootPerAttack: number,
): string {
    return (
        '💰 Средняя добыча золота за использованную атаку:\n' +
        `${formatInteger(roundHalfAwayFromZero(previousLootPerAttack))} → ${formatInteger(roundHalfAwayFromZero(currentLootPerAttack))}` +
        ` (${formatSignedInteger(roundHalfAwayFromZero(currentLootPerAttack - previousLootPerAttack))}; ${formatMetricStatus(previousLootPerAttack, currentLootPerAttack, true)})\n`
    );
}

function formatDisciplineComparison(
    previousFullRate: number,
    currentFullRate: number,
    previousFullDetails: string,
    currentFullDetails: string,
    previousIncompleteRate: number,
    currentIncompleteRate: number,
    previousIncompleteDetails: string,
    currentIncompleteDetails: string,
    previousNoAttackRate: number,
    currentNoAttackRate: number,
    previousNoAttackDetails: string,
    currentNoAttackDetails: string,
): string {
    let section = '🎯 Дисциплина:\n';

    section += formatRateComparison(
        'Полностью использовали доступные атаки\n(среди активных участников)',
        previousFullRate,
        currentFullRate,
        previousFullDetails,
        currentFullDetails,
        true,
    );

    section += formatRateComparison(
        'Использовали не все атаки\n(среди активных участников)',
        previousIncompleteRate,
        currentIncompleteRate,
        previousIncompleteDetails,
        currentIncompleteDetails,
        false,
    );

    section += formatRateComparison(
        'Без атак\n(среди всех участников)',
        previousNoAttackRate,
        currentNoAttackRate,
        previousNoAttackDetails,
        currentNoAttackDetails,
        false,
    );

    return section;
}

function formatActivityComparison(
    previousUsageRate: number,
    currentUsageRate: number,
    previousUsageDetails: string,
    currentUsageDetails: string,
    previousParticipantsRate: number,
    currentParticipantsRate: number,
    previousParticipantsDetails: string,
    currentParticipantsDetails: string,
): string {
    let section = '⚔️ Активность (не входит в итоговую оценку):\n';

    section += formatRateComparison(
        'Использование атак',
        previousUsageRate,
        currentUsageRate,
        previousUsageDetails,
        currentUsageDetails,
        true,
    );

    section += formatRateComparison(
        'Активные участники\n(сделали хотя бы одну атаку)',
        previousParticipantsRate,
        currentParticipantsRate,
        previousParticipantsDetails,
        currentParticipantsDetails,
        true,
    );

    return section;
}

function formatExternalAttacksContext(
    previousAttacks: number,
    currentAttacks: number,
    previousParticipants: number,
    currentParticipants: number,
    formatPreviousValue: (value: number) => string,
): string {
    if (
        previousAttacks <= 0 &&
        currentAttacks <= 0 &&
        previousParticipants <= 0 &&
        currentParticipants <= 0
    ) {
        return '';
    }

    return (
        'ℹ️ Атаки вне основного состава (не входят в доли): ' +
        `${formatPreviousValue(previousAttacks)} → ${formatInteger(currentAttacks)} ` +
        `(игроков: ${formatPreviousValue(previousParticipants)} → ${formatInteger(currentParticipants)})\n`
    );
}

function formatIntegerMetricComparison(
    label: string,
    previousValue: number,
    currentValue: number,
): string {
    return (
        `${label}:\n` +
        `${formatInteger(previousValue)} → ${formatInteger(currentValue)}` +
        ` (${formatSignedInteger(currentValue - previousValue)})\n`
    );
}

function formatAverageMetricComparison(
    label: string,
    previousValue: number,
    currentValue: number,
): string {
    return (
        `${label}:\n` +
        `${formatAverageNumber(previousValue)} → ${formatAverageNumber(currentValue)}` +
        ` (${formatSignedDouble(currentValue - previousValue)})\n`
    );
}

function formatHistoricalIntegerMetricComparison(
    label: string,
    previousValue: number,
    currentValue: number,
): string {
    return (
        `${label}:\n` +
        `${formatInteger(roundHalfAwayFromZero(previousValue))} → ${formatInteger(currentValue)}` +
        ` (${formatSignedInteger(roundHalfAwayFromZero(currentValue - previousValue))})\n`
    );
}

function formatHeader(
    reportData: RaidComparisonData,
    previousRaid: RaidComparisonStats,
    timezoneOffsetHours: number,
): string {
    return (
        '📈 <b>ДИНАМИКА РЕЙДОВ</b>\n\n' +
        `🏠 Наш клан: ${escapeHtml(reportData.clanName)} (<code>${escapeHtml(reportData.clanTag)}</code>)\n\n` +
        `Последний рейд: ${formatRaidDate(reportData.currentRaid.startTime, timezoneOffsetHours)}\n` +
        `Предыдущий рейд: ${formatRaidDate(previousRaid.startTime, timezoneOffsetHours)}\n\n`
    );
}

function formatRaidResultComparison(
    previousRaid: RaidComparisonStats,
    currentRaid: RaidComparisonStats,
): string {
    let section = '📊 Итог рейда:\n';
    section += formatIntegerMetricComparison(
        'Заработано золота',
        previousRaid.totalLoot,
        currentRaid.totalLoot,
    );
    section += formatIntegerMetricComparison(
        'Завершено рейдов',
        previousRaid.raidsCompleted,
        currentRaid.raidsCompleted,
    );
    section += formatIntegerMetricComparison(
        'Уничтожено районов',
        previousRaid.enemyDistrictsDestroyed,
        currentRaid.enemyDistrictsDestroyed,
    );
    section += formatIntegerMetricComparison(
        'Награда за нападение',
        previousRaid.offensiveReward,
        currentRaid.offensiveReward,
    );
    section += formatIntegerMetricComparison(
        'Награда за оборону',
        previousRaid.defensiveReward,
        currentRaid.defensiveReward,
    );
    return section;
}

function formatPreviousRaidComparison(
    previousRaid: RaidComparisonStats,
    currentRaid: RaidComparisonStats,
): string {
    let section = '📊 <b>СРАВНЕНИЕ С ПРЕДЫДУЩИМ РЕЙДОМ</b>\n';
    section += 'Для долевых метрик изменение указано в процентных пунктах (п.п.).\n';
    section += '\n📌 Основные метрики:\n';

    section += formatLootPerAttackComparison(
        lootPerUsedAttack(previousRaid),
        lootPerUsedAttack(currentRaid),
    );

    section += '\n';

    section += formatDisciplineComparison(
        calculateRate(previousRaid.participantsWithAllAttacksUsed, previousRaid.activeParticipants),
        calculateRate(currentRaid.participantsWithAllAttacksUsed, currentRaid.activeParticipants),
        `${formatInteger(previousRaid.participantsWithAllAttacksUsed)}/${formatInteger(previousRaid.activeParticipants)}`,
        `${formatInteger(currentRaid.participantsWithAllAttacksUsed)}/${formatInteger(currentRaid.activeParticipants)}`,
        participantsWithUnusedAttacksRate(previousRaid),
        participantsWithUnusedAttacksRate(currentRaid),
        `${formatInteger(participantsWithUnusedAttacks(previousRaid))}/${formatInteger(previousRaid.activeParticipants)}`,
        `${formatInteger(participantsWithUnusedAttacks(currentRaid))}/${formatInteger(currentRaid.activeParticipants)}`,
        calculateRate(previousRaid.participantsWithoutAttacks, previousRaid.eligibleParticipants),
        calculateRate(currentRaid.participantsWithoutAttacks, currentRaid.eligibleParticipants),
        `${formatInteger(previousRaid.participantsWithoutAttacks)}/${formatInteger(previousRaid.eligibleParticipants)}`,
        `${formatInteger(currentRaid.participantsWithoutAttacks)}/${formatInteger(currentRaid.eligibleParticipants)}`,
    );

    section += '\n';

    section += formatActivityComparison(
        attackUsageRate(previousRaid),
        attackUsageRate(currentRaid),
        `${formatInteger(previousRaid.usedAttacks)}/${formatInteger(previousRaid.availableAttacks)}`,
        `${formatInteger(currentRaid.usedAttacks)}/${formatInteger(currentRaid.availableAttacks)}`,
        calculateRate(previousRaid.activeParticipants, previousRaid.eligibleParticipants),
        calculateRate(currentRaid.activeParticipants, currentRaid.eligibleParticipants),
        `${formatInteger(previousRaid.activeParticipants)}/${formatInteger(previousRaid.eligibleParticipants)}`,
        `${formatInteger(currentRaid.activeParticipants)}/${formatInteger(currentRaid.eligibleParticipants)}`,
    );
    section += formatExternalAttacksContext(
        previousRaid.externalUsedAttacks,
        currentRaid.externalUsedAttacks,
        previousRaid.externalParticipants,
        currentRaid.externalParticipants,
        formatInteger,
    );

    section += '\n';
    section += formatRaidResultComparison(previousRaid, currentRaid);
    return section;
}

function formatHistoricalComparison(reportData: RaidComparisonData): string {
    if (reportData.previousRaidsAverage === null) {
        return '';
    }

    const average = reportData.previousRaidsAverage;
    const currentRaid = reportData.currentRaid;

    const averageIncompleteParticipants = Math.max(
        0.0,
        average.averageActiveParticipants - average.averageParticipantsWithAllAttacksUsed,
    );

    let section = `\n${formatHistoricalAveragesLabel(average.raidsCount)}\n`;
    section += 'Для долевых метрик изменение указано в процентных пунктах (п.п.).\n';
    section += '\n📌 Основные метрики:\n';

    section += formatLootPerAttackComparison(
        average.averageLootPerUsedAttack,
        lootPerUsedAttack(currentRaid),
    );

    section += '\n';

    section += formatDisciplineComparison(
        average.averageParticipantsWithAllAttacksUsedRate,
        calculateRate(currentRaid.participantsWithAllAttacksUsed, currentRaid.activeParticipants),
        formatAverageFraction(
            average.averageParticipantsWithAllAttacksUsed,
            average.averageActiveParticipants,
        ),
        `${formatInteger(currentRaid.participantsWithAllAttacksUsed)}/${formatInteger(currentRaid.activeParticipants)}`,
        calculateRate(averageIncompleteParticipants, average.averageActiveParticipants),
        participantsWithUnusedAttacksRate(currentRaid),
        formatAverageFraction(averageIncompleteParticipants, average.averageActiveParticipants),
        `${formatInteger(participantsWithUnusedAttacks(currentRaid))}/${formatInteger(currentRaid.activeParticipants)}`,
        average.averageParticipantsWithoutAttacksRate,
        calculateRate(currentRaid.participantsWithoutAttacks, currentRaid.eligibleParticipants),
        formatAverageFraction(
            average.averageParticipantsWithoutAttacks,
            average.averageEligibleParticipants,
        ),
        `${formatInteger(currentRaid.participantsWithoutAttacks)}/${formatInteger(currentRaid.eligibleParticipants)}`,
    );

    section += '\n';

    section += formatActivityComparison(
        average.averageAttackUsageRate,
        attackUsageRate(currentRaid),
        formatAverageFraction(average.averageUsedAttacks, average.averageAvailableAttacks),
        `${formatInteger(currentRaid.usedAttacks)}/${formatInteger(currentRaid.availableAttacks)}`,
        calculateRate(average.averageActiveParticipants, average.averageEligibleParticipants),
        calculateRate(currentRaid.activeParticipants, currentRaid.eligibleParticipants),
        formatAverageFraction(
            average.averageActiveParticipants,
            average.averageEligibleParticipants,
        ),
        `${formatInteger(currentRaid.activeParticipants)}/${formatInteger(currentRaid.eligibleParticipants)}`,
    );
    section += formatExternalAttacksContext(
        average.averageExternalUsedAttacks,
        currentRaid.externalUsedAttacks,
        average.averageExternalParticipants,
        currentRaid.externalParticipants,
        formatAverageNumber,
    );

    section += '\n📊 Итог рейда:\n';
    section += formatHistoricalIntegerMetricComparison(
        'Заработано золота',
        average.averageTotalLoot,
        currentRaid.totalLoot,
    );
    section += formatAverageMetricComparison(
        'Завершено рейдов',
        average.averageRaidsCompleted,
        currentRaid.raidsCompleted,
    );
    section += formatAverageMetricComparison(
        'Уничтожено районов',
        average.averageEnemyDistrictsDestroyed,
        currentRaid.enemyDistrictsDestroyed,
    );
    section += formatHistoricalIntegerMetricComparison(
        'Награда за нападение',
        average.averageOffensiveReward,
        currentRaid.offensiveReward,
    );
    section += formatHistoricalIntegerMetricComparison(
        'Награда за оборону',
        average.averageDefensiveReward,
        currentRaid.defensiveReward,
    );

    return section;
}

function formatPerformanceComparison(reportData: RaidComparisonData): string {
    if (reportData.performanceComparison === null || reportData.previousRaidsAverage === null) {
        return '';
    }

    const comparison = reportData.performanceComparison;
    const period = formatPreviousRaidsPeriod(reportData.previousRaidsAverage.raidsCount);

    let trendLine: string;
    switch (comparison.trend) {
        case RaidPerformanceTrend.Better:
            trendLine = `✅ Динамика лучше среднего ${period}\n`;
            break;
        case RaidPerformanceTrend.Worse:
            trendLine = `⚠️ Динамика хуже среднего ${period}\n`;
            break;
        case RaidPerformanceTrend.Similar:
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

export class RaidsComparisonFormatter {
    static readonly EventType = 'raids_comparison' as const;
    static readonly eventType = 'raids_comparison' as const;

    readonly #clansRepo: ClanNameReader;
    readonly #raidRepo: RaidComparisonReader;

    constructor(clansRepo: ClanNameReader, raidRepo: RaidComparisonReader) {
        this.#clansRepo = clansRepo;
        this.#raidRepo = raidRepo;
    }

    format(
        event: RaidsEndedEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        const currentRaidStats = this.#raidRepo.getRaidComparisonStats(event.raidReference);
        const previousRaidReferences = this.#raidRepo.getPreviousRaids(
            event.raidReference,
            PREVIOUS_RAIDS_FOR_REPORT,
        );

        const previousRaidStats = previousRaidReferences.map((reference) =>
            this.#raidRepo.getRaidComparisonStats(reference),
        );

        const reportData: RaidComparisonData = {
            ...buildRaidComparisonData(currentRaidStats, previousRaidStats),
            clanTag: event.clanTag,
            clanName: this.#clansRepo.getClanNameByTag(event.clanTag),
        };

        return RaidsComparisonFormatter.buildReport(reportData, timezoneOffsetHours);
    }

    static buildReport(
        reportData: RaidComparisonData,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        if (reportData.previousRaid === null) {
            return '';
        }

        const currentRaid = reportData.currentRaid;
        const previousRaid = reportData.previousRaid;

        let report = '';
        report += formatHeader(reportData, previousRaid, timezoneOffsetHours);
        report += formatPreviousRaidComparison(previousRaid, currentRaid);
        report += formatHistoricalComparison(reportData);
        report += formatPerformanceComparison(reportData);

        return removeTrailingNewlines(report);
    }
}
