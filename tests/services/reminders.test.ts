import { describe, expect, it } from 'vitest';

import { RAID_REMINDER_KINDS, WAR_REMINDER_KINDS } from '../../src/events/applicationEvents.js';
import {
    SECONDS_PER_HOUR,
    getActiveRaidReminderKinds,
    getActiveWarReminderKinds,
} from '../../src/services/reminders.js';

describe('reminder checkpoint helpers', () => {
    describe('getActiveWarReminderKinds', () => {
        const startTime = 1_700_000_000;
        const endTime = startTime + 24 * SECONDS_PER_HOUR;

        it('returns no reminders before war start', () => {
            expect(getActiveWarReminderKinds(startTime, endTime, startTime - 1)).toEqual([]);
        });

        it('returns started reminder at exact startTime and until 6h threshold', () => {
            expect(getActiveWarReminderKinds(startTime, endTime, startTime)).toEqual([
                WAR_REMINDER_KINDS.started,
            ]);
            expect(
                getActiveWarReminderKinds(startTime, endTime, endTime - 6 * SECONDS_PER_HOUR - 1),
            ).toEqual([WAR_REMINDER_KINDS.started]);
        });

        it('returns started and six_hours_left from 6h before end until 1h threshold', () => {
            expect(
                getActiveWarReminderKinds(startTime, endTime, endTime - 6 * SECONDS_PER_HOUR),
            ).toEqual([WAR_REMINDER_KINDS.started, WAR_REMINDER_KINDS.sixHoursLeft]);
            expect(
                getActiveWarReminderKinds(startTime, endTime, endTime - SECONDS_PER_HOUR - 1),
            ).toEqual([WAR_REMINDER_KINDS.started, WAR_REMINDER_KINDS.sixHoursLeft]);
        });

        it('returns all 3 reminders from 1h before end until endTime - 1', () => {
            expect(
                getActiveWarReminderKinds(startTime, endTime, endTime - SECONDS_PER_HOUR),
            ).toEqual([
                WAR_REMINDER_KINDS.started,
                WAR_REMINDER_KINDS.sixHoursLeft,
                WAR_REMINDER_KINDS.oneHourLeft,
            ]);
            expect(getActiveWarReminderKinds(startTime, endTime, endTime - 1)).toEqual([
                WAR_REMINDER_KINDS.started,
                WAR_REMINDER_KINDS.sixHoursLeft,
                WAR_REMINDER_KINDS.oneHourLeft,
            ]);
        });

        it('returns no reminders at or after endTime', () => {
            expect(getActiveWarReminderKinds(startTime, endTime, endTime)).toEqual([]);
            expect(getActiveWarReminderKinds(startTime, endTime, endTime + 1)).toEqual([]);
        });
    });

    describe('getActiveRaidReminderKinds', () => {
        const startTime = 1_700_000_000;
        const endTime = startTime + 72 * SECONDS_PER_HOUR;

        it('returns no reminders before raid start', () => {
            expect(getActiveRaidReminderKinds(startTime, endTime, startTime - 1)).toEqual([]);
        });

        it('returns started reminder at exact startTime until 48h threshold', () => {
            expect(getActiveRaidReminderKinds(startTime, endTime, startTime)).toEqual([
                RAID_REMINDER_KINDS.started,
            ]);
            expect(
                getActiveRaidReminderKinds(startTime, endTime, endTime - 48 * SECONDS_PER_HOUR - 1),
            ).toEqual([RAID_REMINDER_KINDS.started]);
        });

        it('adds forty_eight_hours_left at exact 48h boundary', () => {
            expect(
                getActiveRaidReminderKinds(startTime, endTime, endTime - 48 * SECONDS_PER_HOUR),
            ).toEqual([RAID_REMINDER_KINDS.started, RAID_REMINDER_KINDS.fortyEightHoursLeft]);
            expect(
                getActiveRaidReminderKinds(startTime, endTime, endTime - 24 * SECONDS_PER_HOUR - 1),
            ).toEqual([RAID_REMINDER_KINDS.started, RAID_REMINDER_KINDS.fortyEightHoursLeft]);
        });

        it('adds twenty_four_hours_left at exact 24h boundary', () => {
            expect(
                getActiveRaidReminderKinds(startTime, endTime, endTime - 24 * SECONDS_PER_HOUR),
            ).toEqual([
                RAID_REMINDER_KINDS.started,
                RAID_REMINDER_KINDS.fortyEightHoursLeft,
                RAID_REMINDER_KINDS.twentyFourHoursLeft,
            ]);
            expect(
                getActiveRaidReminderKinds(startTime, endTime, endTime - 6 * SECONDS_PER_HOUR - 1),
            ).toEqual([
                RAID_REMINDER_KINDS.started,
                RAID_REMINDER_KINDS.fortyEightHoursLeft,
                RAID_REMINDER_KINDS.twentyFourHoursLeft,
            ]);
        });

        it('adds six_hours_left at exact 6h boundary', () => {
            expect(
                getActiveRaidReminderKinds(startTime, endTime, endTime - 6 * SECONDS_PER_HOUR),
            ).toEqual([
                RAID_REMINDER_KINDS.started,
                RAID_REMINDER_KINDS.fortyEightHoursLeft,
                RAID_REMINDER_KINDS.twentyFourHoursLeft,
                RAID_REMINDER_KINDS.sixHoursLeft,
            ]);
            expect(
                getActiveRaidReminderKinds(startTime, endTime, endTime - SECONDS_PER_HOUR - 1),
            ).toEqual([
                RAID_REMINDER_KINDS.started,
                RAID_REMINDER_KINDS.fortyEightHoursLeft,
                RAID_REMINDER_KINDS.twentyFourHoursLeft,
                RAID_REMINDER_KINDS.sixHoursLeft,
            ]);
        });

        it('returns all 5 reminders from 1h before end until endTime - 1', () => {
            expect(
                getActiveRaidReminderKinds(startTime, endTime, endTime - SECONDS_PER_HOUR),
            ).toEqual([
                RAID_REMINDER_KINDS.started,
                RAID_REMINDER_KINDS.fortyEightHoursLeft,
                RAID_REMINDER_KINDS.twentyFourHoursLeft,
                RAID_REMINDER_KINDS.sixHoursLeft,
                RAID_REMINDER_KINDS.oneHourLeft,
            ]);
            expect(getActiveRaidReminderKinds(startTime, endTime, endTime - 1)).toEqual([
                RAID_REMINDER_KINDS.started,
                RAID_REMINDER_KINDS.fortyEightHoursLeft,
                RAID_REMINDER_KINDS.twentyFourHoursLeft,
                RAID_REMINDER_KINDS.sixHoursLeft,
                RAID_REMINDER_KINDS.oneHourLeft,
            ]);
        });

        it('returns no reminders at or after endTime', () => {
            expect(getActiveRaidReminderKinds(startTime, endTime, endTime)).toEqual([]);
            expect(getActiveRaidReminderKinds(startTime, endTime, endTime + 1)).toEqual([]);
        });
    });
});
