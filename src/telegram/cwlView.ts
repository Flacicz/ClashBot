import {
    formatCompactPlayerSection,
    formatFreshnessFooter,
    formatPercentRu1,
    formatShortDurationRu,
    formatTimeWithUtcOffset,
    type CompactPlayerListItem,
} from '../common/compactPlayerList.js';
import { escapeHtml } from '../common/formatUtils.js';
import {
    WAR_TYPES,
    type ActiveWarSnapshot,
    type ClanwarRepo,
} from '../database/repos/clanwarRepo.js';
import type { ClansRepo } from '../database/repos/clansRepo.js';
import type {
    ClanwarsLeagueRepo,
    CwlSeasonProgressSummary,
} from '../database/repos/clanwarsLeagueRepo.js';
import type { ClanSubscriptionSummary } from '../database/repos/subscriptionRepo.js';
import { resolveSynchronizedClanName } from './subscriptionSettings.js';

export const CWL_TOTAL_ROUNDS = 7;

export interface CwlViewDataSource {
    readonly clanwarRepo: Pick<ClanwarRepo, 'getActiveWar'>;
    readonly clanwarsLeagueRepo: Pick<
        ClanwarsLeagueRepo,
        'getSeasonProgressSummary' | 'getLatestCwlObservedAt'
    >;
    readonly clansRepo: Pick<ClansRepo, 'getLatestSnapshotCreatedAt'>;
}

export type CwlViewData =
    | {
          readonly kind: 'in_war';
          readonly war: ActiveWarSnapshot;
          readonly seasonSummary: CwlSeasonProgressSummary;
          readonly timezoneOffsetHours: number;
      }
    | {
          readonly kind: 'preparation';
          readonly war: ActiveWarSnapshot;
          readonly seasonSummary: CwlSeasonProgressSummary;
          readonly timezoneOffsetHours: number;
      }
    | {
          readonly kind: 'no_cwl';
          readonly clanTag: string;
          readonly clanName: string | null;
          readonly updatedAt: number | null;
      };

const EMPTY_SEASON_PROGRESS_SUMMARY: CwlSeasonProgressSummary = {
    seasonLabel: null,
    completedRounds: 0,
    victories: 0,
    defeats: 0,
    draws: 0,
    totalStars: 0,
};

function resolveClanHeaderLabel(clanTag: string, clanName: string | null | undefined): string {
    const synchronizedName = resolveSynchronizedClanName(clanName);
    return escapeHtml(synchronizedName ?? clanTag);
}

function resolveWarSideLabel(clanTag: string, clanName: string): string {
    const trimmed = clanName.trim();
    return escapeHtml(trimmed.length > 0 ? trimmed : clanTag);
}

function resolveLatestTimestamp(first: number | null, second: number | null): number | null {
    if (first !== null && second !== null) {
        return Math.max(first, second);
    }
    return first ?? second;
}

function formatCwlHeader(
    war: ActiveWarSnapshot,
    seasonLabel: string | null,
    stateSuffix: string,
): string {
    const homeName = resolveWarSideLabel(war.home.clanTag, war.home.clanName);
    const opponentName = resolveWarSideLabel(war.opponent.clanTag, war.opponent.clanName);
    const trimmedSeason = seasonLabel?.trim() ?? '';
    const seasonPart = trimmedSeason.length > 0 ? ` ${escapeHtml(trimmedSeason)}` : '';
    const roundPart =
        war.roundNumber !== null && war.roundNumber > 0
            ? ` · раунд ${String(war.roundNumber)}/${String(CWL_TOTAL_ROUNDS)}`
            : '';
    const suffixPart = stateSuffix.length > 0 ? ` ${stateSuffix}` : '';

    return `🏆 <b>ЛВК${seasonPart}${roundPart}${suffixPart}: ${homeName} vs ${opponentName}</b>`;
}

function formatCwlSeasonSummaryLine(summary: CwlSeasonProgressSummary): string {
    if (summary.completedRounds <= 0) {
        return '📊 Сезон: сыгранных раундов пока нет';
    }

    return (
        `📊 Сезон (сыграно ${String(summary.completedRounds)}): ` +
        `победы ${String(summary.victories)} / ` +
        `поражения ${String(summary.defeats)} / ` +
        `ничьи ${String(summary.draws)} · ` +
        `⭐ ${String(summary.totalStars)}`
    );
}

/**
 * Loads the current Clan War League state for a subscribed clan strictly from SQLite.
 * Unlike regular wars, CWL works even when `is_war_log_public = 0`.
 */
export function loadCwlViewData(
    source: CwlViewDataSource,
    subscription: Pick<ClanSubscriptionSummary, 'clanTag' | 'clanName' | 'timezoneOffsetHours'>,
    nowEpochSeconds: number,
): CwlViewData {
    const { clanTag, clanName, timezoneOffsetHours } = subscription;

    const activeCwlWar = source.clanwarRepo.getActiveWar(clanTag, WAR_TYPES.cwl, nowEpochSeconds);
    if (activeCwlWar !== null) {
        const seasonSummary =
            activeCwlWar.seasonId !== null
                ? source.clanwarsLeagueRepo.getSeasonProgressSummary(clanTag, activeCwlWar.seasonId)
                : EMPTY_SEASON_PROGRESS_SUMMARY;

        return {
            kind: activeCwlWar.state === 'inWar' ? 'in_war' : 'preparation',
            war: activeCwlWar,
            seasonSummary,
            timezoneOffsetHours,
        };
    }

    const latestSnapshotCreatedAt = source.clansRepo.getLatestSnapshotCreatedAt(clanTag);
    const latestCwlObservedAt = source.clanwarsLeagueRepo.getLatestCwlObservedAt(clanTag);
    const updatedAt = resolveLatestTimestamp(latestSnapshotCreatedAt, latestCwlObservedAt);

    return {
        kind: 'no_cwl',
        clanTag,
        clanName,
        updatedAt,
    };
}

function formatInWarCwlView(
    war: ActiveWarSnapshot,
    seasonSummary: CwlSeasonProgressSummary,
    timezoneOffsetHours: number,
    nowEpochSeconds: number,
): string {
    const remainingSeconds = war.endTime - nowEpochSeconds;
    const durationText = formatShortDurationRu(remainingSeconds);
    const endTimeText = formatTimeWithUtcOffset(war.endTime, timezoneOffsetHours);

    const attacksPerMember = Math.max(1, war.attacksPerMember);
    const maxAttacks = war.teamSize * attacksPerMember;

    let attacksUsed = 0;
    let finishedCount = 0;
    const notAttacked: CompactPlayerListItem[] = [];

    for (const member of war.homeMembers) {
        attacksUsed += member.attacksUsed;

        if (member.attacksUsed >= attacksPerMember) {
            finishedCount += 1;
        } else {
            notAttacked.push({
                playerTag: member.playerTag,
                playerName: member.playerName,
                ...(attacksPerMember > 1 && member.attacksUsed > 0
                    ? { suffix: `${String(member.attacksUsed)}/${String(attacksPerMember)}` }
                    : {}),
            });
        }
    }

    const lines: string[] = [
        formatCwlHeader(war, seasonSummary.seasonLabel, ''),
        `⭐ ${String(war.home.stars)} : ${String(war.opponent.stars)} · 💥 ${formatPercentRu1(war.home.destructionPercentage)}% : ${formatPercentRu1(war.opponent.destructionPercentage)}%`,
        `⏳ осталось ${durationText} (до ${endTimeText})`,
        `Атаки: ${String(attacksUsed)}/${String(maxAttacks)}`,
    ];

    const notAttackedLine = formatCompactPlayerSection('Ещё не атаковали', notAttacked);
    if (notAttackedLine !== null) {
        lines.push(notAttackedLine);
    }

    if (notAttacked.length === 0 && war.homeMembers.length > 0) {
        lines.push(`✅ Отбились: ${String(finishedCount)} — все атаки использованы`);
    } else {
        lines.push(`✅ Отбились: ${String(finishedCount)}`);
    }

    lines.push(formatCwlSeasonSummaryLine(seasonSummary));
    lines.push(formatFreshnessFooter(war.lastObservedAt, nowEpochSeconds));

    return lines.join('\n');
}

function formatPreparationCwlView(
    war: ActiveWarSnapshot,
    seasonSummary: CwlSeasonProgressSummary,
    timezoneOffsetHours: number,
    nowEpochSeconds: number,
): string {
    const startTimeText = formatTimeWithUtcOffset(war.startTime, timezoneOffsetHours);
    const secondsUntilStart = war.startTime - nowEpochSeconds;

    let timingLine: string;
    if (secondsUntilStart <= 0) {
        timingLine = `⏳ Бой начнётся с минуты на минуту (старт: ${startTimeText})`;
    } else if (secondsUntilStart < 60) {
        timingLine = `⏳ Бой начнётся менее чем через минуту (в ${startTimeText})`;
    } else {
        timingLine = `⏳ Бой начнётся через ${formatShortDurationRu(secondsUntilStart)} (в ${startTimeText})`;
    }

    return [
        formatCwlHeader(war, seasonSummary.seasonLabel, '(подготовка)'),
        timingLine,
        `👥 Состав: ${String(war.teamSize)} vs ${String(war.teamSize)}`,
        formatCwlSeasonSummaryLine(seasonSummary),
        formatFreshnessFooter(war.lastObservedAt, nowEpochSeconds),
    ].join('\n');
}

/**
 * Formats the Telegram HTML response for `/cwl` in neutral tone with strict HTML escaping.
 */
export function formatCwlView(data: CwlViewData, nowEpochSeconds: number): string {
    switch (data.kind) {
        case 'in_war':
            return formatInWarCwlView(
                data.war,
                data.seasonSummary,
                data.timezoneOffsetHours,
                nowEpochSeconds,
            );
        case 'preparation':
            return formatPreparationCwlView(
                data.war,
                data.seasonSummary,
                data.timezoneOffsetHours,
                nowEpochSeconds,
            );
        case 'no_cwl':
            return [
                `🏆 <b>ЛВК: ${resolveClanHeaderLabel(data.clanTag, data.clanName)}</b>`,
                'ЛВК сейчас не идёт.',
                formatFreshnessFooter(data.updatedAt, nowEpochSeconds),
            ].join('\n');
    }
}
