import {
    formatCompactPlayerSection,
    formatFreshnessFooter,
    formatShortDate,
    formatShortDurationRu,
    formatTimeWithUtcOffset,
    type CompactPlayerListItem,
} from '../common/compactPlayerList.js';
import { escapeHtml } from '../common/formatUtils.js';
import type { ClansRepo } from '../database/repos/clansRepo.js';
import type { RaidRepo } from '../database/repos/raidRepo.js';
import type { ClanSubscriptionSummary } from '../database/repos/subscriptionRepo.js';
import type { ActiveRaidSnapshot, CompletedRaidSummary } from '../models/raid.js';
import { resolveSynchronizedClanName } from './subscriptionSettings.js';

const BASE_RAID_ATTACKS = 5;

export interface RaidViewDataSource {
    readonly raidRepo: Pick<RaidRepo, 'getActiveRaid' | 'getLatestCompletedRaid'>;
    readonly clansRepo: Pick<ClansRepo, 'getLatestSnapshotCreatedAt'>;
}

export type RaidViewData =
    | {
          readonly kind: 'ongoing';
          readonly clanTag: string;
          readonly clanName: string | null;
          readonly raid: ActiveRaidSnapshot;
          readonly timezoneOffsetHours: number;
      }
    | {
          readonly kind: 'no_raid';
          readonly clanTag: string;
          readonly clanName: string | null;
          readonly lastCompletedRaid: CompletedRaidSummary | null;
          readonly timezoneOffsetHours: number;
          readonly updatedAt: number | null;
      };

function resolveClanHeaderLabel(clanTag: string, clanName: string | null | undefined): string {
    const synchronizedName = resolveSynchronizedClanName(clanName);
    return escapeHtml(synchronizedName ?? clanTag);
}

function resolveLatestTimestamp(first: number | null, second: number | null): number | null {
    if (first !== null && second !== null) {
        return Math.max(first, second);
    }
    return first ?? second;
}

function formatGroupedInteger(value: number): string {
    if (!Number.isFinite(value)) {
        return '0';
    }
    const truncated = Math.trunc(value);
    const digits = String(Math.abs(truncated));
    let formatted = '';
    for (let i = 0; i < digits.length; i += 1) {
        if (i > 0 && (digits.length - i) % 3 === 0) {
            formatted += ' ';
        }
        formatted += digits[i] ?? '';
    }
    return truncated < 0 ? `−${formatted}` : formatted;
}

function formatRaidEndDateTime(timestampSeconds: number, timezoneOffsetHours: number): string {
    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
        return 'неизвестно';
    }
    return `${formatShortDate(timestampSeconds, timezoneOffsetHours)} ${formatTimeWithUtcOffset(timestampSeconds, timezoneOffsetHours)}`;
}

/**
 * Loads the current capital raid weekend state for a subscribed clan strictly from SQLite.
 */
export function loadRaidViewData(
    source: RaidViewDataSource,
    subscription: Pick<ClanSubscriptionSummary, 'clanTag' | 'clanName' | 'timezoneOffsetHours'>,
    nowEpochSeconds: number,
): RaidViewData {
    const { clanTag, clanName, timezoneOffsetHours } = subscription;

    const activeRaid = source.raidRepo.getActiveRaid(clanTag, nowEpochSeconds);
    if (activeRaid !== null) {
        return {
            kind: 'ongoing',
            clanTag,
            clanName,
            raid: activeRaid,
            timezoneOffsetHours,
        };
    }

    const lastCompletedRaid = source.raidRepo.getLatestCompletedRaid(clanTag);
    const latestSnapshotCreatedAt = source.clansRepo.getLatestSnapshotCreatedAt(clanTag);
    const updatedAt = resolveLatestTimestamp(
        latestSnapshotCreatedAt,
        lastCompletedRaid?.lastObservedAt ?? null,
    );

    return {
        kind: 'no_raid',
        clanTag,
        clanName,
        lastCompletedRaid,
        timezoneOffsetHours,
        updatedAt,
    };
}

function formatOngoingRaidView(
    clanTag: string,
    clanName: string | null,
    raid: ActiveRaidSnapshot,
    timezoneOffsetHours: number,
    nowEpochSeconds: number,
): string {
    const clanLabel = resolveClanHeaderLabel(clanTag, clanName);
    const remainingSeconds = raid.endTime - nowEpochSeconds;
    const durationText = formatShortDurationRu(remainingSeconds);
    const endTimeText = formatRaidEndDateTime(raid.endTime, timezoneOffsetHours);

    let usedAttacks = 0;
    let availableAttacks = 0;
    let finishedCount = 0;
    const noAttacks: CompactPlayerListItem[] = [];
    const partialAttacks: CompactPlayerListItem[] = [];

    for (const member of raid.eligibleMembers) {
        const attacksDone = Math.max(0, member.attacksCount);
        const bonusAttacks = Math.max(0, member.bonusAttacks);
        const maxAttacks = BASE_RAID_ATTACKS + bonusAttacks;

        usedAttacks += attacksDone;
        availableAttacks += maxAttacks;

        if (attacksDone >= maxAttacks) {
            finishedCount += 1;
        } else if (attacksDone === 0) {
            noAttacks.push({
                playerTag: member.playerTag,
                playerName: member.playerName,
            });
        } else {
            partialAttacks.push({
                playerTag: member.playerTag,
                playerName: member.playerName,
                suffix: `${String(attacksDone)}/${String(maxAttacks)}`,
            });
        }
    }

    const pendingPlayers: readonly CompactPlayerListItem[] = [...noAttacks, ...partialAttacks];
    const attacksLine =
        availableAttacks > 0
            ? `Атаки: ${String(usedAttacks)}/${String(availableAttacks)}`
            : raid.totalAttacks > 0
              ? `Атаки: ${String(raid.totalAttacks)}`
              : 'Атаки: 0/0';

    const lines: string[] = [
        `🏰 <b>Рейд: ${clanLabel}</b>`,
        `💰 ${formatGroupedInteger(raid.totalLoot)} золота · 🏘 Разрушено районов: ${formatGroupedInteger(raid.enemyDistrictsDestroyed)}`,
        `⏳ осталось ${durationText} (до ${endTimeText})`,
        attacksLine,
    ];

    const noAttacksLine = formatCompactPlayerSection('Без атак', noAttacks, {
        disambiguateAcross: pendingPlayers,
    });
    if (noAttacksLine !== null) {
        lines.push(noAttacksLine);
    }

    const partialLine = formatCompactPlayerSection('Не все атаки', partialAttacks, {
        disambiguateAcross: pendingPlayers,
    });
    if (partialLine !== null) {
        lines.push(partialLine);
    }

    if (noAttacks.length === 0 && partialAttacks.length === 0 && raid.eligibleMembers.length > 0) {
        lines.push(`✅ Отбились: ${String(finishedCount)} — все атаки использованы`);
    } else {
        lines.push(`✅ Отбились: ${String(finishedCount)}`);
    }

    lines.push(formatFreshnessFooter(raid.lastObservedAt, nowEpochSeconds));
    return lines.join('\n');
}

function formatLastCompletedRaidLine(
    lastRaid: CompletedRaidSummary,
    timezoneOffsetHours: number,
): string {
    const dateText = formatShortDate(lastRaid.endTime, timezoneOffsetHours);

    return (
        `Прошлый рейд: 💰 ${formatGroupedInteger(lastRaid.totalLoot)} золота · ` +
        `🏘 Разрушено районов: ${formatGroupedInteger(lastRaid.enemyDistrictsDestroyed)} · ` +
        dateText
    );
}

/**
 * Formats the Telegram HTML response for `/raid` in neutral tone with strict HTML escaping.
 */
export function formatRaidView(data: RaidViewData, nowEpochSeconds: number): string {
    switch (data.kind) {
        case 'ongoing':
            return formatOngoingRaidView(
                data.clanTag,
                data.clanName,
                data.raid,
                data.timezoneOffsetHours,
                nowEpochSeconds,
            );
        case 'no_raid': {
            const lines: string[] = [
                `🏰 <b>Рейд: ${resolveClanHeaderLabel(data.clanTag, data.clanName)}</b>`,
                'Рейдовый уикенд не идёт.',
            ];
            if (data.lastCompletedRaid !== null) {
                lines.push(
                    formatLastCompletedRaidLine(data.lastCompletedRaid, data.timezoneOffsetHours),
                );
            }
            lines.push(formatFreshnessFooter(data.updatedAt, nowEpochSeconds));
            return lines.join('\n');
        }
    }
}
