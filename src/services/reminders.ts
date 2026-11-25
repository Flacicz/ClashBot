import {
    RAID_REMINDER_KINDS,
    WAR_REMINDER_KINDS,
    type RaidReminderKind,
    type WarReminderKind,
} from '../events/applicationEvents.js';

export const SECONDS_PER_HOUR = 60 * 60;

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
