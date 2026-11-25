import { describe, expect, it } from 'vitest';

import { RAID_REMINDER_KINDS, WAR_REMINDER_KINDS } from '../../src/events/applicationEvents.js';
import {
    DEFAULT_STARTED_REMINDER_GRACE_PERIOD_SECONDS,
    SECONDS_PER_HOUR,
    getActiveRaidReminderKinds,
    getActiveWarReminderKinds,
    selectRaidReminders,
    selectWarReminders,
} from '../../src/services/reminders.js';

describe('reminder checkpoint helpers', () => {
    describe('getActiveWarReminderKinds & selectWarReminders', () => {
        const startTime = 1_700_000_000;
        const endTime = startTime + 24 * SECONDS_PER_HOUR;

        it('returns no reminders before war start', () => {
            expect(getActiveWarReminderKinds(startTime, endTime, startTime - 1)).toEqual([]);
            expect(selectWarReminders(startTime, endTime, startTime - 1)).toEqual({
                activeKind: null,
                skippedKinds: [],
                remainingSeconds: 0,
            });
        });

        it('returns only started within the started grace period and skips it once grace expires', () => {
            expect(getActiveWarReminderKinds(startTime, endTime, startTime)).toEqual([
                WAR_REMINDER_KINDS.started,
            ]);
            expect(
                selectWarReminders(
                    startTime,
                    endTime,
                    startTime + DEFAULT_STARTED_REMINDER_GRACE_PERIOD_SECONDS - 1,
                ),
            ).toEqual({
                activeKind: WAR_REMINDER_KINDS.started,
                skippedKinds: [],
                remainingSeconds:
                    24 * SECONDS_PER_HOUR - DEFAULT_STARTED_REMINDER_GRACE_PERIOD_SECONDS + 1,
            });

            // At exact grace boundary and later before 6h window: started is skipped without sending
            expect(
                getActiveWarReminderKinds(
                    startTime,
                    endTime,
                    startTime + DEFAULT_STARTED_REMINDER_GRACE_PERIOD_SECONDS,
                ),
            ).toEqual([]);
            expect(
                selectWarReminders(startTime, endTime, endTime - 6 * SECONDS_PER_HOUR - 1),
            ).toEqual({
                activeKind: null,
                skippedKinds: [WAR_REMINDER_KINDS.started],
                remainingSeconds: 6 * SECONDS_PER_HOUR + 1,
            });
        });

        it('returns only six_hours_left and marks started as skipped from 6h left until 1h threshold', () => {
            expect(
                getActiveWarReminderKinds(startTime, endTime, endTime - 6 * SECONDS_PER_HOUR),
            ).toEqual([WAR_REMINDER_KINDS.sixHoursLeft]);
            expect(
                selectWarReminders(startTime, endTime, endTime - 3 * SECONDS_PER_HOUR - 15 * 60),
            ).toEqual({
                activeKind: WAR_REMINDER_KINDS.sixHoursLeft,
                skippedKinds: [WAR_REMINDER_KINDS.started],
                remainingSeconds: 3 * SECONDS_PER_HOUR + 15 * 60,
            });
            expect(
                getActiveWarReminderKinds(startTime, endTime, endTime - SECONDS_PER_HOUR - 1),
            ).toEqual([WAR_REMINDER_KINDS.sixHoursLeft]);
        });

        it('returns only one_hour_left and marks started & six_hours_left as skipped on late start / recovery', () => {
            expect(
                getActiveWarReminderKinds(startTime, endTime, endTime - SECONDS_PER_HOUR),
            ).toEqual([WAR_REMINDER_KINDS.oneHourLeft]);
            expect(selectWarReminders(startTime, endTime, endTime - 30 * 60)).toEqual({
                activeKind: WAR_REMINDER_KINDS.oneHourLeft,
                skippedKinds: [WAR_REMINDER_KINDS.started, WAR_REMINDER_KINDS.sixHoursLeft],
                remainingSeconds: 30 * 60,
            });
            expect(selectWarReminders(startTime, endTime, endTime - 1)).toEqual({
                activeKind: WAR_REMINDER_KINDS.oneHourLeft,
                skippedKinds: [WAR_REMINDER_KINDS.started, WAR_REMINDER_KINDS.sixHoursLeft],
                remainingSeconds: 1,
            });
        });

        it('returns no reminders at or after endTime', () => {
            expect(getActiveWarReminderKinds(startTime, endTime, endTime)).toEqual([]);
            expect(getActiveWarReminderKinds(startTime, endTime, endTime + 1)).toEqual([]);
            expect(selectWarReminders(startTime, endTime, endTime)).toEqual({
                activeKind: null,
                skippedKinds: [],
                remainingSeconds: 0,
            });
        });
    });

    describe('getActiveRaidReminderKinds & selectRaidReminders', () => {
        const startTime = 1_700_000_000;
        const endTime = startTime + 72 * SECONDS_PER_HOUR;

        it('returns no reminders before raid start', () => {
            expect(getActiveRaidReminderKinds(startTime, endTime, startTime - 1)).toEqual([]);
            expect(selectRaidReminders(startTime, endTime, startTime - 1)).toEqual({
                activeKind: null,
                skippedKinds: [],
                remainingSeconds: 0,
            });
        });

        it('returns only started within grace period and marks started skipped afterwards until 48h threshold', () => {
            expect(getActiveRaidReminderKinds(startTime, endTime, startTime)).toEqual([
                RAID_REMINDER_KINDS.started,
            ]);
            expect(
                getActiveRaidReminderKinds(
                    startTime,
                    endTime,
                    startTime + DEFAULT_STARTED_REMINDER_GRACE_PERIOD_SECONDS - 1,
                ),
            ).toEqual([RAID_REMINDER_KINDS.started]);

            // Late start 12h after raid start -> started is expired & skipped
            expect(
                selectRaidReminders(startTime, endTime, startTime + 12 * SECONDS_PER_HOUR),
            ).toEqual({
                activeKind: null,
                skippedKinds: [RAID_REMINDER_KINDS.started],
                remainingSeconds: 60 * SECONDS_PER_HOUR,
            });
            expect(
                getActiveRaidReminderKinds(startTime, endTime, endTime - 48 * SECONDS_PER_HOUR - 1),
            ).toEqual([]);
        });

        it('selects only the newest open checkpoint and marks earlier ones as skipped across all raid windows', () => {
            expect(
                selectRaidReminders(startTime, endTime, endTime - 48 * SECONDS_PER_HOUR),
            ).toEqual({
                activeKind: RAID_REMINDER_KINDS.fortyEightHoursLeft,
                skippedKinds: [RAID_REMINDER_KINDS.started],
                remainingSeconds: 48 * SECONDS_PER_HOUR,
            });
            expect(
                getActiveRaidReminderKinds(startTime, endTime, endTime - 24 * SECONDS_PER_HOUR - 1),
            ).toEqual([RAID_REMINDER_KINDS.fortyEightHoursLeft]);

            // Recovery in 24h window (10h left)
            expect(
                selectRaidReminders(startTime, endTime, endTime - 10 * SECONDS_PER_HOUR),
            ).toEqual({
                activeKind: RAID_REMINDER_KINDS.twentyFourHoursLeft,
                skippedKinds: [
                    RAID_REMINDER_KINDS.started,
                    RAID_REMINDER_KINDS.fortyEightHoursLeft,
                ],
                remainingSeconds: 10 * SECONDS_PER_HOUR,
            });

            // Recovery in 6h window (3h 45m left)
            expect(
                selectRaidReminders(startTime, endTime, endTime - 3 * SECONDS_PER_HOUR - 45 * 60),
            ).toEqual({
                activeKind: RAID_REMINDER_KINDS.sixHoursLeft,
                skippedKinds: [
                    RAID_REMINDER_KINDS.started,
                    RAID_REMINDER_KINDS.fortyEightHoursLeft,
                    RAID_REMINDER_KINDS.twentyFourHoursLeft,
                ],
                remainingSeconds: 3 * SECONDS_PER_HOUR + 45 * 60,
            });

            // Late start in final hour (25m left) -> only one_hour_left active, 4 earlier checkpoints skipped
            expect(getActiveRaidReminderKinds(startTime, endTime, endTime - 25 * 60)).toEqual([
                RAID_REMINDER_KINDS.oneHourLeft,
            ]);
            expect(selectRaidReminders(startTime, endTime, endTime - 25 * 60)).toEqual({
                activeKind: RAID_REMINDER_KINDS.oneHourLeft,
                skippedKinds: [
                    RAID_REMINDER_KINDS.started,
                    RAID_REMINDER_KINDS.fortyEightHoursLeft,
                    RAID_REMINDER_KINDS.twentyFourHoursLeft,
                    RAID_REMINDER_KINDS.sixHoursLeft,
                ],
                remainingSeconds: 25 * 60,
            });
        });

        it('returns no reminders at or after endTime', () => {
            expect(getActiveRaidReminderKinds(startTime, endTime, endTime)).toEqual([]);
            expect(getActiveRaidReminderKinds(startTime, endTime, endTime + 1)).toEqual([]);
        });
    });
});
