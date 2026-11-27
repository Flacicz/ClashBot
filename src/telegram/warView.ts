import {
    formatCompactPlayerSection,
    formatFreshnessFooter,
    formatPercentRu1,
    formatShortDate,
    formatShortDurationRu,
    formatTimeWithUtcOffset,
    type CompactPlayerListItem,
} from '../common/compactPlayerList.js';
import { escapeHtml } from '../common/formatUtils.js';
import {
    ClanwarOutcome,
    WAR_TYPES,
    type ActiveWarSnapshot,
    type ClanwarOutcomeValue,
    type CompletedRegularWarSummary,
} from '../database/repos/clanwarRepo.js';
import type { ClansRepo } from '../database/repos/clansRepo.js';
import type { ClanwarRepo } from '../database/repos/clanwarRepo.js';
import type { ClanSubscriptionSummary } from '../database/repos/subscriptionRepo.js';
import { PRIVATE_WAR_LOG_WARNING_TEXT } from './linkOnboarding.js';
import { resolveSynchronizedClanName } from './subscriptionSettings.js';

export interface WarViewDataSource {
    readonly clanwarRepo: Pick<ClanwarRepo, 'getActiveWar' | 'getLatestCompletedRegularWar'>;
    readonly clansRepo: Pick<ClansRepo, 'getLatestSnapshotCreatedAt'>;
}

export type WarViewData =
    | {
          readonly kind: 'private_war_log';
          readonly clanTag: string;
          readonly clanName: string | null;
          readonly updatedAt: number | null;
      }
    | {
          readonly kind: 'in_war';
          readonly war: ActiveWarSnapshot;
          readonly timezoneOffsetHours: number;
      }
    | {
          readonly kind: 'preparation';
          readonly war: ActiveWarSnapshot;
          readonly timezoneOffsetHours: number;
      }
    | {
          readonly kind: 'cwl';
          readonly clanTag: string;
          readonly clanName: string | null;
          readonly updatedAt: number;
      }
    | {
          readonly kind: 'no_war';
          readonly clanTag: string;
          readonly clanName: string | null;
          readonly lastCompletedWar: CompletedRegularWarSummary | null;
          readonly timezoneOffsetHours: number;
          readonly updatedAt: number | null;
      };

const WAR_OUTCOME_LABELS: Readonly<Record<ClanwarOutcomeValue, string>> = {
    [ClanwarOutcome.Victory]: 'Победа',
    [ClanwarOutcome.Defeat]: 'Поражение',
    [ClanwarOutcome.Draw]: 'Ничья',
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

/**
 * Loads the current regular war state for a subscribed clan strictly from SQLite.
 */
export function loadWarViewData(
    source: WarViewDataSource,
    subscription: Pick<
        ClanSubscriptionSummary,
        'clanTag' | 'clanName' | 'isWarLogPublic' | 'timezoneOffsetHours'
    >,
    nowEpochSeconds: number,
): WarViewData {
    const { clanTag, clanName, isWarLogPublic, timezoneOffsetHours } = subscription;

    if (isWarLogPublic === false) {
        return {
            kind: 'private_war_log',
            clanTag,
            clanName,
            updatedAt: source.clansRepo.getLatestSnapshotCreatedAt(clanTag),
        };
    }

    const activeRegularWar = source.clanwarRepo.getActiveWar(
        clanTag,
        WAR_TYPES.regular,
        nowEpochSeconds,
    );
    if (activeRegularWar !== null) {
        return {
            kind: activeRegularWar.state === 'inWar' ? 'in_war' : 'preparation',
            war: activeRegularWar,
            timezoneOffsetHours,
        };
    }

    const activeCwlWar = source.clanwarRepo.getActiveWar(clanTag, WAR_TYPES.cwl, nowEpochSeconds);
    if (activeCwlWar !== null) {
        return {
            kind: 'cwl',
            clanTag,
            clanName,
            updatedAt: activeCwlWar.lastObservedAt,
        };
    }

    const lastCompletedWar = source.clanwarRepo.getLatestCompletedRegularWar(clanTag);
    const latestSnapshotCreatedAt = source.clansRepo.getLatestSnapshotCreatedAt(clanTag);
    const updatedAt = resolveLatestTimestamp(
        latestSnapshotCreatedAt,
        lastCompletedWar?.lastObservedAt ?? null,
    );

    return {
        kind: 'no_war',
        clanTag,
        clanName,
        lastCompletedWar,
        timezoneOffsetHours,
        updatedAt,
    };
}

function formatInWarView(
    war: ActiveWarSnapshot,
    timezoneOffsetHours: number,
    nowEpochSeconds: number,
): string {
    const homeName = resolveWarSideLabel(war.home.clanTag, war.home.clanName);
    const opponentName = resolveWarSideLabel(war.opponent.clanTag, war.opponent.clanName);

    const remainingSeconds = war.endTime - nowEpochSeconds;
    const durationText = formatShortDurationRu(remainingSeconds);
    const endTimeText = formatTimeWithUtcOffset(war.endTime, timezoneOffsetHours);

    const attacksPerMember = Math.max(1, war.attacksPerMember);
    const maxAttacks = war.teamSize * attacksPerMember;

    let attacksUsed = 0;
    let finishedCount = 0;
    const noAttacks: CompactPlayerListItem[] = [];
    const partialAttacks: CompactPlayerListItem[] = [];

    for (const member of war.homeMembers) {
        attacksUsed += member.attacksUsed;

        if (member.attacksUsed >= attacksPerMember) {
            finishedCount += 1;
        } else if (member.attacksUsed === 0) {
            noAttacks.push({
                playerTag: member.playerTag,
                playerName: member.playerName,
            });
        } else {
            partialAttacks.push({
                playerTag: member.playerTag,
                playerName: member.playerName,
                ...(attacksPerMember !== 2
                    ? { suffix: `${String(member.attacksUsed)}/${String(attacksPerMember)}` }
                    : {}),
            });
        }
    }

    const pendingPlayers: readonly CompactPlayerListItem[] = [...noAttacks, ...partialAttacks];

    const lines: string[] = [
        `⚔️ <b>КВ: ${homeName} vs ${opponentName}</b>`,
        `⭐ ${String(war.home.stars)} : ${String(war.opponent.stars)} · 💥 ${formatPercentRu1(war.home.destructionPercentage)}% : ${formatPercentRu1(war.opponent.destructionPercentage)}%`,
        `⏳ осталось ${durationText} (до ${endTimeText})`,
        `Атаки: ${String(attacksUsed)}/${String(maxAttacks)}`,
    ];

    const noAttacksLine = formatCompactPlayerSection('Без атак', noAttacks, {
        disambiguateAcross: pendingPlayers,
    });
    if (noAttacksLine !== null) {
        lines.push(noAttacksLine);
    }

    const partialLabel = attacksPerMember === 2 ? '1 из 2' : 'Не все атаки';
    const partialLine = formatCompactPlayerSection(partialLabel, partialAttacks, {
        disambiguateAcross: pendingPlayers,
    });
    if (partialLine !== null) {
        lines.push(partialLine);
    }

    if (noAttacks.length === 0 && partialAttacks.length === 0 && war.homeMembers.length > 0) {
        lines.push(`✅ Отбились: ${String(finishedCount)} — все атаки использованы`);
    } else {
        lines.push(`✅ Отбились: ${String(finishedCount)}`);
    }

    lines.push(formatFreshnessFooter(war.lastObservedAt, nowEpochSeconds));
    return lines.join('\n');
}

function formatPreparationWarView(
    war: ActiveWarSnapshot,
    timezoneOffsetHours: number,
    nowEpochSeconds: number,
): string {
    const homeName = resolveWarSideLabel(war.home.clanTag, war.home.clanName);
    const opponentName = resolveWarSideLabel(war.opponent.clanTag, war.opponent.clanName);
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
        `⚔️ <b>КВ (подготовка): ${homeName} vs ${opponentName}</b>`,
        timingLine,
        `👥 Состав: ${String(war.teamSize)} vs ${String(war.teamSize)}`,
        formatFreshnessFooter(war.lastObservedAt, nowEpochSeconds),
    ].join('\n');
}

function formatLastCompletedWarLine(
    lastWar: CompletedRegularWarSummary,
    timezoneOffsetHours: number,
): string {
    const outcomeLabel = WAR_OUTCOME_LABELS[lastWar.outcome];
    const opponentName = resolveWarSideLabel(lastWar.opponent.clanTag, lastWar.opponent.clanName);
    const dateText = formatShortDate(lastWar.endTime, timezoneOffsetHours);

    return (
        `Прошлая КВ: ${outcomeLabel} vs ${opponentName} · ` +
        `⭐ ${String(lastWar.home.stars)} : ${String(lastWar.opponent.stars)} ` +
        `(${formatPercentRu1(lastWar.home.destructionPercentage)}% : ${formatPercentRu1(lastWar.opponent.destructionPercentage)}%) · ` +
        dateText
    );
}

/**
 * Formats the Telegram HTML response for `/war` in neutral tone with strict HTML escaping.
 */
export function formatWarView(data: WarViewData, nowEpochSeconds: number): string {
    switch (data.kind) {
        case 'in_war':
            return formatInWarView(data.war, data.timezoneOffsetHours, nowEpochSeconds);
        case 'preparation':
            return formatPreparationWarView(data.war, data.timezoneOffsetHours, nowEpochSeconds);
        case 'private_war_log':
            return [
                `⚔️ <b>КВ: ${resolveClanHeaderLabel(data.clanTag, data.clanName)}</b>`,
                PRIVATE_WAR_LOG_WARNING_TEXT,
                formatFreshnessFooter(data.updatedAt, nowEpochSeconds),
            ].join('\n');
        case 'cwl':
            return [
                `⚔️ <b>КВ: ${resolveClanHeaderLabel(data.clanTag, data.clanName)}</b>`,
                'Сейчас идёт ЛВК — см. /cwl',
                formatFreshnessFooter(data.updatedAt, nowEpochSeconds),
            ].join('\n');
        case 'no_war': {
            const lines: string[] = [
                `⚔️ <b>КВ: ${resolveClanHeaderLabel(data.clanTag, data.clanName)}</b>`,
                'Сейчас клан не в КВ.',
            ];
            if (data.lastCompletedWar !== null) {
                lines.push(
                    formatLastCompletedWarLine(data.lastCompletedWar, data.timezoneOffsetHours),
                );
            }
            lines.push(formatFreshnessFooter(data.updatedAt, nowEpochSeconds));
            return lines.join('\n');
        }
    }
}
