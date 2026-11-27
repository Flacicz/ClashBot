import { describe, expect, it } from 'vitest';

import {
    CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
    DomainEventPayloadSerializer,
    categoriesForEvent,
} from '../../src/domainEvents/index.js';
import type { ApplicationEvent } from '../../src/events/index.js';
import type { NotificationCategory } from '../../src/models/subscription.js';

interface PayloadContractCase {
    readonly event: ApplicationEvent;
    readonly eventType: string;
    readonly eventId: string;
    readonly payload: Record<string, unknown>;
    readonly categories: readonly NotificationCategory[];
}

const CLAN_TAG = '#2PPLQ';

const ALL_EVENT_CASES: readonly PayloadContractCase[] = [
    {
        event: {
            type: 'PlayerJoinedClanEvent',
            clanTag: CLAN_TAG,
            playerTag: '#P1',
            playerName: 'Alice & Bob',
            membershipId: 11,
        },
        eventType: 'PlayerJoinedClanEvent',
        eventId: '11',
        payload: {
            player_tag: '#P1',
            player_name: 'Alice & Bob',
            membership_id: 11,
        },
        categories: ['roster'],
    },
    {
        event: {
            type: 'PlayerLeftClanEvent',
            clanTag: CLAN_TAG,
            playerTag: '#P2',
            playerName: 'Eve',
            membershipId: 12,
        },
        eventType: 'PlayerLeftClanEvent',
        eventId: '12',
        payload: {
            player_tag: '#P2',
            player_name: 'Eve',
            membership_id: 12,
        },
        categories: ['roster'],
    },
    {
        event: {
            type: 'PlayerRoleChangedEvent',
            clanTag: CLAN_TAG,
            playerTag: '#P3',
            playerName: 'Carl',
            oldRole: 'member',
            newRole: 'elder',
            snapshotId: 13,
        },
        eventType: 'PlayerRoleChangedEvent',
        eventId: '13',
        payload: {
            player_tag: '#P3',
            player_name: 'Carl',
            old_role: 'member',
            new_role: 'elder',
            snapshot_id: 13,
        },
        categories: ['roster'],
    },
    {
        event: {
            type: 'war_ended',
            clanTag: CLAN_TAG,
            warReference: {
                clanTag: CLAN_TAG,
                warId: 21,
                homeClanId: 22,
                opponentClanId: 23,
            },
        },
        eventType: 'war_ended',
        eventId: '21',
        payload: {
            war_reference: {
                clan_tag: CLAN_TAG,
                war_id: 21,
                home_clan_id: 22,
                opponent_clan_id: 23,
            },
        },
        categories: ['summaries', 'discipline'],
    },
    {
        event: {
            type: 'raids_ended',
            clanTag: CLAN_TAG,
            raidReference: { raidId: 31 },
        },
        eventType: 'raids_ended',
        eventId: '31',
        payload: {
            raid_reference: {
                raid_id: 31,
            },
        },
        categories: ['summaries', 'discipline'],
    },
    {
        event: {
            type: 'cwl_round_ended',
            clanTag: CLAN_TAG,
            cwlSeasonId: 41,
            warReference: {
                clanTag: CLAN_TAG,
                warId: 42,
                homeClanId: 43,
                opponentClanId: 44,
            },
        },
        eventType: 'cwl_round_ended',
        eventId: '42',
        payload: {
            cwl_season_id: 41,
            war_reference: {
                clan_tag: CLAN_TAG,
                war_id: 42,
                home_clan_id: 43,
                opponent_clan_id: 44,
            },
        },
        categories: ['summaries', 'discipline'],
    },
    {
        event: {
            type: 'SyncFailureEvent',
            clanTag: CLAN_TAG,
            serviceName: 'RaidService',
            errorMsg: 'timeout',
            attempts: 3,
            outageId: 51,
        },
        eventType: 'SyncFailureEvent',
        eventId: '51',
        payload: {
            service_name: 'RaidService',
            error_message: 'timeout',
            attempts: 3,
            outage_id: 51,
        },
        categories: ['system'],
    },
    {
        event: {
            type: 'SyncRecoveryEvent',
            clanTag: CLAN_TAG,
            serviceName: 'RaidService',
            outageId: 51,
        },
        eventType: 'SyncRecoveryEvent',
        eventId: '51',
        payload: {
            service_name: 'RaidService',
            outage_id: 51,
        },
        categories: ['system'],
    },
    {
        event: {
            type: 'war_reminder',
            clanTag: CLAN_TAG,
            warId: 61,
            endTime: 1700,
            warKind: 'cwl',
            kind: 'six_hours_left',
        },
        eventType: 'war_reminder',
        eventId: '61:six_hours_left',
        payload: {
            war_id: 61,
            end_time: 1700,
            war_kind: 'cwl',
            reminder_kind: 'six_hours_left',
        },
        categories: ['reminders'],
    },
    {
        event: {
            type: 'raid_reminder',
            clanTag: CLAN_TAG,
            raidReference: { raidId: 71 },
            endTime: 1800,
            kind: 'forty_eight_hours_left',
        },
        eventType: 'raid_reminder',
        eventId: '71:forty_eight_hours_left',
        payload: {
            raid_reference: {
                raid_id: 71,
            },
            end_time: 1800,
            reminder_kind: 'forty_eight_hours_left',
        },
        categories: ['reminders'],
    },
];

describe('DomainEventPayloadSerializer', () => {
    it('serializes all 10 application events with exact C++ and ADR-0004 persisted contracts', () => {
        const serializer = new DomainEventPayloadSerializer();

        expect(CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION).toBe(1);
        expect(ALL_EVENT_CASES).toHaveLength(10);

        for (const testCase of ALL_EVENT_CASES) {
            const record = serializer.serialize(testCase.event);
            expect(record.eventType).toBe(testCase.eventType);
            expect(record.eventId).toBe(testCase.eventId);
            expect(record.clanTag).toBe(CLAN_TAG);
            expect(record.payloadVersion).toBe(1);
            expect(JSON.parse(record.payload)).toEqual(testCase.payload);
        }
    });

    it('maps every application event to the exact target notification categories', () => {
        for (const testCase of ALL_EVENT_CASES) {
            expect(categoriesForEvent(testCase.event)).toEqual(testCase.categories);
        }
    });

    it('serializes optional remainingSeconds into remaining_seconds for war and raid reminders', () => {
        const serializer = new DomainEventPayloadSerializer();

        const warRecord = serializer.serialize({
            type: 'war_reminder',
            clanTag: CLAN_TAG,
            warId: 61,
            endTime: 1700,
            warKind: 'regular',
            kind: 'one_hour_left',
            remainingSeconds: 1800,
        });
        expect(warRecord.payloadVersion).toBe(1);
        expect(warRecord.eventId).toBe('61:one_hour_left');
        expect(JSON.parse(warRecord.payload)).toEqual({
            war_id: 61,
            end_time: 1700,
            war_kind: 'regular',
            reminder_kind: 'one_hour_left',
            remaining_seconds: 1800,
        });

        const raidRecord = serializer.serialize({
            type: 'raid_reminder',
            clanTag: CLAN_TAG,
            raidReference: { raidId: 71 },
            endTime: 1800,
            kind: 'six_hours_left',
            remainingSeconds: 13500,
        });
        expect(raidRecord.payloadVersion).toBe(1);
        expect(raidRecord.eventId).toBe('71:six_hours_left');
        expect(JSON.parse(raidRecord.payload)).toEqual({
            raid_reference: { raid_id: 71 },
            end_time: 1800,
            reminder_kind: 'six_hours_left',
            remaining_seconds: 13500,
        });
    });

    it('serializes optional attackSnapshot into attack_snapshot while preserving event_id and payload version 1', () => {
        const serializer = new DomainEventPayloadSerializer();

        const warEarlyRecord = serializer.serialize({
            type: 'war_reminder',
            clanTag: CLAN_TAG,
            warId: 61,
            endTime: 1704067200,
            warKind: 'regular',
            kind: 'six_hours_left',
            remainingSeconds: 21600,
            attackSnapshot: {
                snapshotAt: 1704045600,
                totalParticipants: 30,
                pendingParticipantsCount: 12,
            },
        });
        expect(warEarlyRecord.payloadVersion).toBe(1);
        expect(warEarlyRecord.eventId).toBe('61:six_hours_left');
        expect(JSON.parse(warEarlyRecord.payload)).toEqual({
            war_id: 61,
            end_time: 1704067200,
            war_kind: 'regular',
            reminder_kind: 'six_hours_left',
            remaining_seconds: 21600,
            attack_snapshot: {
                snapshot_at: 1704045600,
                total_participants: 30,
                pending_participants_count: 12,
            },
        });

        const raidFinalRecord = serializer.serialize({
            type: 'raid_reminder',
            clanTag: CLAN_TAG,
            raidReference: { raidId: 71 },
            endTime: 1704067200,
            kind: 'one_hour_left',
            remainingSeconds: 3600,
            attackSnapshot: {
                snapshotAt: 1704063600,
                totalParticipants: 35,
                pendingParticipantsCount: 2,
                pendingPlayers: [
                    { playerTag: '#P1', playerName: 'Alice', attacksUsed: 0, maxAttacks: 5 },
                    { playerTag: '#P2', playerName: 'Bob', attacksUsed: 3, maxAttacks: 6 },
                ],
            },
        });
        expect(raidFinalRecord.payloadVersion).toBe(1);
        expect(raidFinalRecord.eventId).toBe('71:one_hour_left');
        expect(JSON.parse(raidFinalRecord.payload)).toEqual({
            raid_reference: { raid_id: 71 },
            end_time: 1704067200,
            reminder_kind: 'one_hour_left',
            remaining_seconds: 3600,
            attack_snapshot: {
                snapshot_at: 1704063600,
                total_participants: 35,
                pending_participants_count: 2,
                pending_players: [
                    { player_tag: '#P1', player_name: 'Alice', attacks_used: 0, max_attacks: 5 },
                    { player_tag: '#P2', player_name: 'Bob', attacks_used: 3, max_attacks: 6 },
                ],
            },
        });
    });
});
