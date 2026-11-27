import type { ActiveWarMemberAttackCount } from '../database/repos/clanwarRepo.js';
import {
    RAID_REMINDER_KINDS,
    WAR_REMINDER_KINDS,
    type RaidReminderKind,
    type ReminderAttackSnapshot,
    type ReminderPendingPlayer,
    type WarReminderKind,
} from '../events/applicationEvents.js';
import type { RaidMemberAttackState } from '../models/raid.js';

export const SECONDS_PER_HOUR = 60 * 60;
export const RAID_BASE_ATTACKS_PER_MEMBER = 5;

export const WAR_REMINDER_SIX_HOURS_SECONDS = 6 * SECONDS_PER_HOUR;
export const WAR_REMINDER_ONE_HOUR_SECONDS = 1 * SECONDS_PER_HOUR;

export const RAID_REMINDER_FORTY_EIGHT_HOURS_SECONDS = 48 * SECONDS_PER_HOUR;
export const RAID_REMINDER_TWENTY_FOUR_HOURS_SECONDS = 24 * SECONDS_PER_HOUR;
export const RAID_REMINDER_SIX_HOURS_SECONDS = 6 * SECONDS_PER_HOUR;
export const RAID_REMINDER_ONE_HOUR_SECONDS = 1 * SECONDS_PER_HOUR;

/**
 * Grace period for `started` reminders after `startTime`.
 * If sync starts or recovers after this window, the missed `started` checkpoint
 * is marked as skipped without sending.
 */
export const DEFAULT_STARTED_REMINDER_GRACE_PERIOD_SECONDS = 1 * SECONDS_PER_HOUR;

export interface ReminderSelection<TKind> {
    readonly activeKind: TKind | null;
    readonly skippedKinds: readonly TKind[];
    readonly remainingSeconds: number;
}

interface ReminderCheckpoint<TKind> {
    readonly kind: TKind;
    readonly threshold: number;
    readonly gracePeriodSeconds?: number;
}

function selectReminderCheckpoints<TKind>(
    startTime: number,
    endTime: number,
    nowEpochSeconds: number,
    checkpoints: readonly ReminderCheckpoint<TKind>[],
): ReminderSelection<TKind> {
    if (nowEpochSeconds < startTime || nowEpochSeconds >= endTime) {
        return {
            activeKind: null,
            skippedKinds: [],
            remainingSeconds: 0,
        };
    }

    const remainingSeconds = Math.max(0, Math.trunc(endTime - nowEpochSeconds));
    const openCheckpoints = checkpoints.filter(
        (checkpoint) => nowEpochSeconds >= checkpoint.threshold,
    );

    const latest = openCheckpoints[openCheckpoints.length - 1];
    if (latest === undefined) {
        return {
            activeKind: null,
            skippedKinds: [],
            remainingSeconds,
        };
    }

    const skippedKinds = openCheckpoints.slice(0, -1).map((checkpoint) => checkpoint.kind);

    if (
        latest.gracePeriodSeconds !== undefined &&
        nowEpochSeconds >= latest.threshold + latest.gracePeriodSeconds
    ) {
        skippedKinds.push(latest.kind);
        return {
            activeKind: null,
            skippedKinds,
            remainingSeconds,
        };
    }

    return {
        activeKind: latest.kind,
        skippedKinds,
        remainingSeconds,
    };
}

export function selectWarReminders(
    startTime: number,
    endTime: number,
    nowEpochSeconds: number,
    startedGracePeriodSeconds: number = DEFAULT_STARTED_REMINDER_GRACE_PERIOD_SECONDS,
): ReminderSelection<WarReminderKind> {
    return selectReminderCheckpoints(startTime, endTime, nowEpochSeconds, [
        {
            kind: WAR_REMINDER_KINDS.started,
            threshold: startTime,
            gracePeriodSeconds: startedGracePeriodSeconds,
        },
        {
            kind: WAR_REMINDER_KINDS.sixHoursLeft,
            threshold: endTime - WAR_REMINDER_SIX_HOURS_SECONDS,
        },
        {
            kind: WAR_REMINDER_KINDS.oneHourLeft,
            threshold: endTime - WAR_REMINDER_ONE_HOUR_SECONDS,
        },
    ]);
}

export function selectRaidReminders(
    startTime: number,
    endTime: number,
    nowEpochSeconds: number,
    startedGracePeriodSeconds: number = DEFAULT_STARTED_REMINDER_GRACE_PERIOD_SECONDS,
): ReminderSelection<RaidReminderKind> {
    return selectReminderCheckpoints(startTime, endTime, nowEpochSeconds, [
        {
            kind: RAID_REMINDER_KINDS.started,
            threshold: startTime,
            gracePeriodSeconds: startedGracePeriodSeconds,
        },
        {
            kind: RAID_REMINDER_KINDS.fortyEightHoursLeft,
            threshold: endTime - RAID_REMINDER_FORTY_EIGHT_HOURS_SECONDS,
        },
        {
            kind: RAID_REMINDER_KINDS.twentyFourHoursLeft,
            threshold: endTime - RAID_REMINDER_TWENTY_FOUR_HOURS_SECONDS,
        },
        {
            kind: RAID_REMINDER_KINDS.sixHoursLeft,
            threshold: endTime - RAID_REMINDER_SIX_HOURS_SECONDS,
        },
        {
            kind: RAID_REMINDER_KINDS.oneHourLeft,
            threshold: endTime - RAID_REMINDER_ONE_HOUR_SECONDS,
        },
    ]);
}

export function getActiveWarReminderKinds(
    startTime: number,
    endTime: number,
    nowEpochSeconds: number,
    startedGracePeriodSeconds: number = DEFAULT_STARTED_REMINDER_GRACE_PERIOD_SECONDS,
): WarReminderKind[] {
    const { activeKind } = selectWarReminders(
        startTime,
        endTime,
        nowEpochSeconds,
        startedGracePeriodSeconds,
    );
    return activeKind === null ? [] : [activeKind];
}

export function getActiveRaidReminderKinds(
    startTime: number,
    endTime: number,
    nowEpochSeconds: number,
    startedGracePeriodSeconds: number = DEFAULT_STARTED_REMINDER_GRACE_PERIOD_SECONDS,
): RaidReminderKind[] {
    const { activeKind } = selectRaidReminders(
        startTime,
        endTime,
        nowEpochSeconds,
        startedGracePeriodSeconds,
    );
    return activeKind === null ? [] : [activeKind];
}

function assertNeverReminderKind(kind: never): never {
    throw new Error(`Unhandled reminder kind: ${String(kind)}`);
}

/**
 * Returns the Unix epoch timestamp (seconds) at which a war reminder becomes stale:
 * either when the next checkpoint of the same war opens, or at `endTime` for the final checkpoint.
 */
export function getWarReminderExpiresAt(endTime: number, kind: WarReminderKind): number {
    switch (kind) {
        case WAR_REMINDER_KINDS.started:
            return endTime - WAR_REMINDER_SIX_HOURS_SECONDS;
        case WAR_REMINDER_KINDS.sixHoursLeft:
            return endTime - WAR_REMINDER_ONE_HOUR_SECONDS;
        case WAR_REMINDER_KINDS.oneHourLeft:
            return endTime;
        default:
            return assertNeverReminderKind(kind);
    }
}

/**
 * Returns the Unix epoch timestamp (seconds) at which a raid reminder becomes stale:
 * either when the next checkpoint of the same raid opens, or at `endTime` for the final checkpoint.
 */
export function getRaidReminderExpiresAt(endTime: number, kind: RaidReminderKind): number {
    switch (kind) {
        case RAID_REMINDER_KINDS.started:
            return endTime - RAID_REMINDER_FORTY_EIGHT_HOURS_SECONDS;
        case RAID_REMINDER_KINDS.fortyEightHoursLeft:
            return endTime - RAID_REMINDER_TWENTY_FOUR_HOURS_SECONDS;
        case RAID_REMINDER_KINDS.twentyFourHoursLeft:
            return endTime - RAID_REMINDER_SIX_HOURS_SECONDS;
        case RAID_REMINDER_KINDS.sixHoursLeft:
            return endTime - RAID_REMINDER_ONE_HOUR_SECONDS;
        case RAID_REMINDER_KINDS.oneHourLeft:
            return endTime;
        default:
            return assertNeverReminderKind(kind);
    }
}

/**
 * Builds an attack snapshot for countdown war/CWL reminders from the current war roster.
 * Returns `undefined` when the roster is empty so formatters avoid false "all used" output.
 */
export function buildWarReminderAttackSnapshot(
    members: readonly ActiveWarMemberAttackCount[],
    attacksPerMember: number,
    snapshotAt: number,
    includePlayers: boolean,
): ReminderAttackSnapshot | undefined {
    if (members.length === 0) {
        return undefined;
    }

    const maxAttacks = Math.max(1, Math.trunc(attacksPerMember));
    const pendingPlayers: ReminderPendingPlayer[] = [];

    for (const member of members) {
        const attacksUsed = Math.max(0, Math.trunc(member.attacksUsed));
        if (attacksUsed < maxAttacks) {
            pendingPlayers.push({
                playerTag: member.playerTag,
                playerName: member.playerName,
                attacksUsed,
                maxAttacks,
            });
        }
    }

    return {
        snapshotAt: Math.max(0, Math.trunc(snapshotAt)),
        totalParticipants: members.length,
        pendingParticipantsCount: pendingPlayers.length,
        ...(includePlayers ? { pendingPlayers } : {}),
    };
}

/**
 * Builds an attack snapshot for countdown raid reminders from the #47 eligible cohort.
 * Returns `undefined` when no eligible members exist at raid start.
 */
export function buildRaidReminderAttackSnapshot(
    members: readonly RaidMemberAttackState[],
    snapshotAt: number,
    includePlayers: boolean,
): ReminderAttackSnapshot | undefined {
    if (members.length === 0) {
        return undefined;
    }

    const pendingPlayers: ReminderPendingPlayer[] = [];

    for (const member of members) {
        const attacksUsed = Math.max(0, Math.trunc(member.attacksCount));
        const bonusAttacks = Math.max(0, Math.trunc(member.bonusAttacks));
        const maxAttacks = RAID_BASE_ATTACKS_PER_MEMBER + bonusAttacks;
        if (attacksUsed < maxAttacks) {
            pendingPlayers.push({
                playerTag: member.playerTag,
                playerName: member.playerName,
                attacksUsed,
                maxAttacks,
            });
        }
    }

    return {
        snapshotAt: Math.max(0, Math.trunc(snapshotAt)),
        totalParticipants: members.length,
        pendingParticipantsCount: pendingPlayers.length,
        ...(includePlayers ? { pendingPlayers } : {}),
    };
}
