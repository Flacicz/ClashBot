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

export function getActiveWarReminderKinds(
    startTime: number,
    endTime: number,
    nowEpochSeconds: number,
): WarReminderKind[] {
    const kinds: WarReminderKind[] = [];

    if (nowEpochSeconds >= startTime && nowEpochSeconds < endTime) {
        kinds.push(WAR_REMINDER_KINDS.started);
    }

    if (nowEpochSeconds >= endTime - WAR_REMINDER_SIX_HOURS_SECONDS && nowEpochSeconds < endTime) {
        kinds.push(WAR_REMINDER_KINDS.sixHoursLeft);
    }

    if (nowEpochSeconds >= endTime - WAR_REMINDER_ONE_HOUR_SECONDS && nowEpochSeconds < endTime) {
        kinds.push(WAR_REMINDER_KINDS.oneHourLeft);
    }

    return kinds;
}

export function getActiveRaidReminderKinds(
    startTime: number,
    endTime: number,
    nowEpochSeconds: number,
): RaidReminderKind[] {
    const kinds: RaidReminderKind[] = [];

    if (nowEpochSeconds >= startTime && nowEpochSeconds < endTime) {
        kinds.push(RAID_REMINDER_KINDS.started);
    }

    if (
        nowEpochSeconds >= endTime - RAID_REMINDER_FORTY_EIGHT_HOURS_SECONDS &&
        nowEpochSeconds < endTime
    ) {
        kinds.push(RAID_REMINDER_KINDS.fortyEightHoursLeft);
    }

    if (
        nowEpochSeconds >= endTime - RAID_REMINDER_TWENTY_FOUR_HOURS_SECONDS &&
        nowEpochSeconds < endTime
    ) {
        kinds.push(RAID_REMINDER_KINDS.twentyFourHoursLeft);
    }

    if (nowEpochSeconds >= endTime - RAID_REMINDER_SIX_HOURS_SECONDS && nowEpochSeconds < endTime) {
        kinds.push(RAID_REMINDER_KINDS.sixHoursLeft);
    }

    if (nowEpochSeconds >= endTime - RAID_REMINDER_ONE_HOUR_SECONDS && nowEpochSeconds < endTime) {
        kinds.push(RAID_REMINDER_KINDS.oneHourLeft);
    }

    return kinds;
}
