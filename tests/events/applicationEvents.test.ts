import { describe, expect, it } from 'vitest';

import {
    APPLICATION_EVENT_TYPES,
    RAID_REMINDER_KINDS,
    WAR_REMINDER_KINDS,
    WAR_REMINDER_WAR_KINDS,
    getApplicationEventKey,
    type ApplicationEvent,
    type RaidReminderKind,
    type WarReminderKind,
} from '../../src/events/index.js';

describe('ApplicationEvents', () => {
    it('exposes exact historical event_type strings matching C++ and ADR-0004', () => {
        expect(APPLICATION_EVENT_TYPES.playerJoinedClan).toBe('PlayerJoinedClanEvent');
        expect(APPLICATION_EVENT_TYPES.playerLeftClan).toBe('PlayerLeftClanEvent');
        expect(APPLICATION_EVENT_TYPES.playerRoleChanged).toBe('PlayerRoleChangedEvent');
        expect(APPLICATION_EVENT_TYPES.warEnded).toBe('war_ended');
        expect(APPLICATION_EVENT_TYPES.raidsEnded).toBe('raids_ended');
        expect(APPLICATION_EVENT_TYPES.cwlRoundEnded).toBe('cwl_round_ended');
        expect(APPLICATION_EVENT_TYPES.syncFailure).toBe('SyncFailureEvent');
        expect(APPLICATION_EVENT_TYPES.syncRecovery).toBe('SyncRecoveryEvent');
        expect(APPLICATION_EVENT_TYPES.warReminder).toBe('war_reminder');
        expect(APPLICATION_EVENT_TYPES.raidReminder).toBe('raid_reminder');
        expect(Object.keys(APPLICATION_EVENT_TYPES)).toHaveLength(10);
    });

    it('returns stable event_id keys for persistent non-reminder events', () => {
        const events: readonly (readonly [ApplicationEvent, string])[] = [
            [
                {
                    type: 'PlayerJoinedClanEvent',
                    clanTag: '#CLAN',
                    playerTag: '#P1',
                    playerName: 'Alice',
                    membershipId: 11,
                },
                '11',
            ],
            [
                {
                    type: 'PlayerLeftClanEvent',
                    clanTag: '#CLAN',
                    playerTag: '#P2',
                    playerName: 'Bob',
                    membershipId: 12,
                },
                '12',
            ],
            [
                {
                    type: 'PlayerRoleChangedEvent',
                    clanTag: '#CLAN',
                    playerTag: '#P3',
                    playerName: 'Carl',
                    oldRole: 'member',
                    newRole: 'elder',
                    snapshotId: 13,
                },
                '13',
            ],
            [
                {
                    type: 'war_ended',
                    clanTag: '#CLAN',
                    warReference: {
                        clanTag: '#CLAN',
                        warId: 101,
                        homeClanId: 1,
                        opponentClanId: 2,
                    },
                },
                '101',
            ],
            [
                {
                    type: 'raids_ended',
                    clanTag: '#CLAN',
                    raidReference: { raidId: 202 },
                },
                '202',
            ],
            [
                {
                    type: 'cwl_round_ended',
                    clanTag: '#CLAN',
                    cwlSeasonId: 202409,
                    warReference: {
                        clanTag: '#CLAN',
                        warId: 303,
                        homeClanId: 1,
                        opponentClanId: 2,
                    },
                },
                '303',
            ],
            [
                {
                    type: 'SyncFailureEvent',
                    clanTag: '#CLAN',
                    serviceName: 'RaidService',
                    errorMsg: 'timeout',
                    attempts: 3,
                    outageId: 51,
                },
                '51',
            ],
            [
                {
                    type: 'SyncRecoveryEvent',
                    clanTag: '#CLAN',
                    serviceName: 'RaidService',
                    outageId: 51,
                },
                '51',
            ],
        ];

        for (const [event, expectedKey] of events) {
            expect(getApplicationEventKey(event)).toBe(expectedKey);
        }
    });

    it('returns stable keys for every war reminder kind', () => {
        const cases: readonly (readonly [WarReminderKind, string])[] = [
            [WAR_REMINDER_KINDS.started, '404:started'],
            [WAR_REMINDER_KINDS.sixHoursLeft, '404:six_hours_left'],
            [WAR_REMINDER_KINDS.oneHourLeft, '404:one_hour_left'],
        ];

        for (const [kind, expectedKey] of cases) {
            const event: ApplicationEvent = {
                type: 'war_reminder',
                clanTag: '#CLAN',
                warId: 404,
                endTime: 1700,
                warKind: WAR_REMINDER_WAR_KINDS.regular,
                kind,
            };
            expect(getApplicationEventKey(event)).toBe(expectedKey);
        }
    });

    it('returns stable keys for every raid reminder kind', () => {
        const cases: readonly (readonly [RaidReminderKind, string])[] = [
            [RAID_REMINDER_KINDS.started, '505:started'],
            [RAID_REMINDER_KINDS.fortyEightHoursLeft, '505:forty_eight_hours_left'],
            [RAID_REMINDER_KINDS.twentyFourHoursLeft, '505:twenty_four_hours_left'],
            [RAID_REMINDER_KINDS.sixHoursLeft, '505:six_hours_left'],
            [RAID_REMINDER_KINDS.oneHourLeft, '505:one_hour_left'],
        ];

        for (const [kind, expectedKey] of cases) {
            const event: ApplicationEvent = {
                type: 'raid_reminder',
                clanTag: '#CLAN',
                raidReference: { raidId: 505 },
                endTime: 1800,
                kind,
            };
            expect(getApplicationEventKey(event)).toBe(expectedKey);
        }
    });
});
