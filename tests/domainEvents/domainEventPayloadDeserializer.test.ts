import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../src/common/index.js';
import {
    CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
    DomainEventPayloadDeserializer,
    DomainEventPayloadSerializer,
    deserializeDomainEvent,
    deserializeDomainEventRecord,
} from '../../src/domainEvents/index.js';
import {
    APPLICATION_EVENT_TYPES,
    RAID_REMINDER_KINDS,
    WAR_REMINDER_KINDS,
    WAR_REMINDER_WAR_KINDS,
    type ApplicationEvent,
} from '../../src/events/index.js';

const CLAN_TAG = '#2PPLQ';

const ALL_EVENTS: readonly ApplicationEvent[] = [
    {
        type: APPLICATION_EVENT_TYPES.playerJoinedClan,
        clanTag: CLAN_TAG,
        playerTag: '#P1',
        playerName: 'Alice & <Bob>',
        membershipId: 11,
    },
    {
        type: APPLICATION_EVENT_TYPES.playerLeftClan,
        clanTag: CLAN_TAG,
        playerTag: '#P2',
        playerName: 'Eve',
        membershipId: 12,
    },
    {
        type: APPLICATION_EVENT_TYPES.playerRoleChanged,
        clanTag: CLAN_TAG,
        playerTag: '#P3',
        playerName: 'Carl',
        oldRole: 'member',
        newRole: 'admin',
        snapshotId: 13,
    },
    {
        type: APPLICATION_EVENT_TYPES.warEnded,
        clanTag: CLAN_TAG,
        warReference: {
            clanTag: CLAN_TAG,
            warId: 21,
            homeClanId: 22,
            opponentClanId: 23,
        },
    },
    {
        type: APPLICATION_EVENT_TYPES.raidsEnded,
        clanTag: CLAN_TAG,
        raidReference: { raidId: 31 },
    },
    {
        type: APPLICATION_EVENT_TYPES.cwlRoundEnded,
        clanTag: CLAN_TAG,
        cwlSeasonId: 41,
        warReference: {
            clanTag: CLAN_TAG,
            warId: 42,
            homeClanId: 43,
            opponentClanId: 44,
        },
    },
    {
        type: APPLICATION_EVENT_TYPES.syncFailure,
        clanTag: CLAN_TAG,
        serviceName: 'RaidService',
        errorMsg: 'timeout',
        attempts: 3,
        outageId: 51,
    },
    {
        type: APPLICATION_EVENT_TYPES.syncRecovery,
        clanTag: CLAN_TAG,
        serviceName: 'RaidService',
        outageId: 51,
    },
    {
        type: APPLICATION_EVENT_TYPES.warReminder,
        clanTag: CLAN_TAG,
        warId: 61,
        endTime: 1704067200,
        warKind: WAR_REMINDER_WAR_KINDS.cwl,
        kind: WAR_REMINDER_KINDS.sixHoursLeft,
    },
    {
        type: APPLICATION_EVENT_TYPES.raidReminder,
        clanTag: CLAN_TAG,
        raidReference: { raidId: 71 },
        endTime: 1704146400,
        kind: RAID_REMINDER_KINDS.fortyEightHoursLeft,
    },
];

describe('DomainEventPayloadDeserializer', () => {
    it('round-trips all 10 application events with exact equality', () => {
        const serializer = new DomainEventPayloadSerializer();
        const deserializer = new DomainEventPayloadDeserializer();

        expect(ALL_EVENTS).toHaveLength(10);

        for (const event of ALL_EVENTS) {
            const record = serializer.serialize(event);
            const restored = deserializer.deserialize(
                record.clanTag,
                record.eventType,
                record.payload,
                record.payloadVersion,
            );

            expect(restored).toEqual(event);

            const restoredFromRecord = deserializeDomainEventRecord(record);
            expect(restoredFromRecord).toEqual(event);

            const reserialized = serializer.serialize(restored);
            expect(reserialized).toEqual(record);
        }
    });

    it('round-trips all war reminder and raid reminder variants', () => {
        const serializer = new DomainEventPayloadSerializer();

        for (const warKind of Object.values(WAR_REMINDER_WAR_KINDS)) {
            for (const kind of Object.values(WAR_REMINDER_KINDS)) {
                const event: ApplicationEvent = {
                    type: APPLICATION_EVENT_TYPES.warReminder,
                    clanTag: CLAN_TAG,
                    warId: 100,
                    endTime: 1704067200,
                    warKind,
                    kind,
                };
                const record = serializer.serialize(event);
                expect(deserializeDomainEventRecord(record)).toEqual(event);
            }
        }

        for (const kind of Object.values(RAID_REMINDER_KINDS)) {
            const event: ApplicationEvent = {
                type: APPLICATION_EVENT_TYPES.raidReminder,
                clanTag: CLAN_TAG,
                raidReference: { raidId: 200 },
                endTime: 1704067200,
                kind,
            };
            const record = serializer.serialize(event);
            expect(deserializeDomainEventRecord(record)).toEqual(event);
        }

        const warWithRemaining: ApplicationEvent = {
            type: APPLICATION_EVENT_TYPES.warReminder,
            clanTag: CLAN_TAG,
            warId: 101,
            endTime: 1704067200,
            warKind: WAR_REMINDER_WAR_KINDS.regular,
            kind: WAR_REMINDER_KINDS.oneHourLeft,
            remainingSeconds: 1800,
        };
        expect(deserializeDomainEventRecord(serializer.serialize(warWithRemaining))).toEqual(
            warWithRemaining,
        );

        const raidWithRemaining: ApplicationEvent = {
            type: APPLICATION_EVENT_TYPES.raidReminder,
            clanTag: CLAN_TAG,
            raidReference: { raidId: 201 },
            endTime: 1704067200,
            kind: RAID_REMINDER_KINDS.sixHoursLeft,
            remainingSeconds: 13500,
        };
        expect(deserializeDomainEventRecord(serializer.serialize(raidWithRemaining))).toEqual(
            raidWithRemaining,
        );

        const warWithCounterSnapshot: ApplicationEvent = {
            type: APPLICATION_EVENT_TYPES.warReminder,
            clanTag: CLAN_TAG,
            warId: 102,
            endTime: 1704067200,
            warKind: WAR_REMINDER_WAR_KINDS.regular,
            kind: WAR_REMINDER_KINDS.sixHoursLeft,
            remainingSeconds: 21600,
            attackSnapshot: {
                snapshotAt: 1704045600,
                totalParticipants: 30,
                pendingParticipantsCount: 12,
            },
        };
        expect(deserializeDomainEventRecord(serializer.serialize(warWithCounterSnapshot))).toEqual(
            warWithCounterSnapshot,
        );

        const warWithListSnapshot: ApplicationEvent = {
            type: APPLICATION_EVENT_TYPES.warReminder,
            clanTag: CLAN_TAG,
            warId: 103,
            endTime: 1704067200,
            warKind: WAR_REMINDER_WAR_KINDS.cwl,
            kind: WAR_REMINDER_KINDS.oneHourLeft,
            remainingSeconds: 3600,
            attackSnapshot: {
                snapshotAt: 1704063600,
                totalParticipants: 15,
                pendingParticipantsCount: 1,
                pendingPlayers: [
                    {
                        playerTag: '#P1',
                        playerName: 'Alice & <Bob>',
                        attacksUsed: 0,
                        maxAttacks: 1,
                    },
                ],
            },
        };
        expect(deserializeDomainEventRecord(serializer.serialize(warWithListSnapshot))).toEqual(
            warWithListSnapshot,
        );

        const raidWithAllUsedSnapshot: ApplicationEvent = {
            type: APPLICATION_EVENT_TYPES.raidReminder,
            clanTag: CLAN_TAG,
            raidReference: { raidId: 202 },
            endTime: 1704067200,
            kind: RAID_REMINDER_KINDS.oneHourLeft,
            remainingSeconds: 3600,
            attackSnapshot: {
                snapshotAt: 1704063600,
                totalParticipants: 35,
                pendingParticipantsCount: 0,
                pendingPlayers: [],
            },
        };
        expect(deserializeDomainEventRecord(serializer.serialize(raidWithAllUsedSnapshot))).toEqual(
            raidWithAllUsedSnapshot,
        );
    });

    it('keeps full backward compatibility when deserializing historical war_reminder and raid_reminder payloads without attack_snapshot or remaining_seconds', () => {
        const legacyWar = deserializeDomainEvent(
            CLAN_TAG,
            APPLICATION_EVENT_TYPES.warReminder,
            JSON.stringify({
                war_id: 99,
                end_time: 1704067200,
                war_kind: 'regular',
                reminder_kind: 'one_hour_left',
            }),
            CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
        );
        expect(legacyWar).toEqual({
            type: APPLICATION_EVENT_TYPES.warReminder,
            clanTag: CLAN_TAG,
            warId: 99,
            endTime: 1704067200,
            warKind: WAR_REMINDER_WAR_KINDS.regular,
            kind: WAR_REMINDER_KINDS.oneHourLeft,
        });
        expect('attackSnapshot' in legacyWar).toBe(false);

        const legacyRaid = deserializeDomainEvent(
            CLAN_TAG,
            APPLICATION_EVENT_TYPES.raidReminder,
            JSON.stringify({
                raid_reference: { raid_id: 88 },
                end_time: 1704067200,
                reminder_kind: 'six_hours_left',
                remaining_seconds: 18000,
            }),
            CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
        );
        expect(legacyRaid).toEqual({
            type: APPLICATION_EVENT_TYPES.raidReminder,
            clanTag: CLAN_TAG,
            raidReference: { raidId: 88 },
            endTime: 1704067200,
            kind: RAID_REMINDER_KINDS.sixHoursLeft,
            remainingSeconds: 18000,
        });
        expect('attackSnapshot' in legacyRaid).toBe(false);
    });

    it('is deterministic across repeated deserializations of the same payload', () => {
        const serializer = new DomainEventPayloadSerializer();
        const sampleEvent: ApplicationEvent = {
            type: APPLICATION_EVENT_TYPES.playerJoinedClan,
            clanTag: CLAN_TAG,
            playerTag: '#P1',
            playerName: 'Alice & <Bob>',
            membershipId: 11,
        };
        const record = serializer.serialize(sampleEvent);

        const first = deserializeDomainEvent(
            record.clanTag,
            record.eventType,
            record.payload,
            record.payloadVersion,
        );
        const second = deserializeDomainEvent(
            record.clanTag,
            record.eventType,
            record.payload,
            record.payloadVersion,
        );

        expect(first).toEqual(second);
    });

    it('rejects unsupported payload versions with ValidationError', () => {
        for (const version of [0, 2, -1, 1.5]) {
            expect(() =>
                deserializeDomainEvent(
                    CLAN_TAG,
                    APPLICATION_EVENT_TYPES.playerJoinedClan,
                    '{}',
                    version,
                ),
            ).toThrow(ValidationError);
            expect(() =>
                deserializeDomainEvent(
                    CLAN_TAG,
                    APPLICATION_EVENT_TYPES.playerJoinedClan,
                    '{}',
                    version,
                ),
            ).toThrow(/unsupported payload version/i);
        }
    });

    it('rejects unknown event types with ValidationError', () => {
        expect(() =>
            deserializeDomainEvent(
                CLAN_TAG,
                'UnknownEvent',
                '{}',
                CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
            ),
        ).toThrow(ValidationError);
        expect(() =>
            deserializeDomainEvent(
                CLAN_TAG,
                'UnknownEvent',
                '{}',
                CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
            ),
        ).toThrow(/unknown event type/i);
    });

    it('rejects malformed JSON payload with ValidationError', () => {
        for (const badJson of ['{', '', 'not-json', '{"a":']) {
            expect(() =>
                deserializeDomainEvent(
                    CLAN_TAG,
                    APPLICATION_EVENT_TYPES.playerJoinedClan,
                    badJson,
                    CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
                ),
            ).toThrow(ValidationError);
        }
    });

    it('rejects missing fields, wrong types, and invalid enum values with ValidationError', () => {
        for (const eventType of Object.values(APPLICATION_EVENT_TYPES)) {
            expect(() =>
                deserializeDomainEvent(
                    CLAN_TAG,
                    eventType,
                    '{}',
                    CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
                ),
            ).toThrow(ValidationError);
        }

        // Non-object JSON
        expect(() =>
            deserializeDomainEvent(
                CLAN_TAG,
                APPLICATION_EVENT_TYPES.playerJoinedClan,
                '[]',
                CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
            ),
        ).toThrow(ValidationError);

        // Wrong field type (float instead of int)
        expect(() =>
            deserializeDomainEvent(
                CLAN_TAG,
                APPLICATION_EVENT_TYPES.playerJoinedClan,
                JSON.stringify({
                    player_tag: '#P1',
                    player_name: 'Alice',
                    membership_id: 11.5,
                }),
                CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
            ),
        ).toThrow(ValidationError);

        // Unknown war_kind
        expect(() =>
            deserializeDomainEvent(
                CLAN_TAG,
                APPLICATION_EVENT_TYPES.warReminder,
                JSON.stringify({
                    war_id: 1,
                    end_time: 1704067200,
                    war_kind: 'friendly',
                    reminder_kind: 'started',
                }),
                CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
            ),
        ).toThrow(ValidationError);

        // Unknown raid reminder_kind
        expect(() =>
            deserializeDomainEvent(
                CLAN_TAG,
                APPLICATION_EVENT_TYPES.raidReminder,
                JSON.stringify({
                    raid_reference: { raid_id: 1 },
                    end_time: 1704067200,
                    reminder_kind: 'twelve_hours_left',
                }),
                CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
            ),
        ).toThrow(ValidationError);

        // Negative or non-integer remaining_seconds
        for (const badRemaining of [-1, 12.5]) {
            expect(() =>
                deserializeDomainEvent(
                    CLAN_TAG,
                    APPLICATION_EVENT_TYPES.warReminder,
                    JSON.stringify({
                        war_id: 1,
                        end_time: 1704067200,
                        war_kind: 'regular',
                        reminder_kind: 'one_hour_left',
                        remaining_seconds: badRemaining,
                    }),
                    CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
                ),
            ).toThrow(ValidationError);
            expect(() =>
                deserializeDomainEvent(
                    CLAN_TAG,
                    APPLICATION_EVENT_TYPES.raidReminder,
                    JSON.stringify({
                        raid_reference: { raid_id: 1 },
                        end_time: 1704067200,
                        reminder_kind: 'one_hour_left',
                        remaining_seconds: badRemaining,
                    }),
                    CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
                ),
            ).toThrow(ValidationError);
        }

        // Invalid attack_snapshot variants
        const invalidSnapshots: readonly Record<string, unknown>[] = [
            { snapshot_at: -1, total_participants: 10, pending_participants_count: 2 },
            { snapshot_at: 1000, total_participants: 5, pending_participants_count: 6 },
            {
                snapshot_at: 1000,
                total_participants: 10,
                pending_participants_count: 1,
                pending_players: [
                    { player_tag: '#P1', player_name: 'Alice', attacks_used: 2, max_attacks: 2 },
                ],
            },
            {
                snapshot_at: 1000,
                total_participants: 10,
                pending_participants_count: 1,
                pending_players: [
                    { player_tag: '#P1', player_name: 'Alice', attacks_used: 0, max_attacks: 0 },
                ],
            },
        ];
        for (const badSnapshot of invalidSnapshots) {
            expect(() =>
                deserializeDomainEvent(
                    CLAN_TAG,
                    APPLICATION_EVENT_TYPES.warReminder,
                    JSON.stringify({
                        war_id: 1,
                        end_time: 1704067200,
                        war_kind: 'regular',
                        reminder_kind: 'one_hour_left',
                        attack_snapshot: badSnapshot,
                    }),
                    CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
                ),
            ).toThrow(ValidationError);
            expect(() =>
                deserializeDomainEvent(
                    CLAN_TAG,
                    APPLICATION_EVENT_TYPES.raidReminder,
                    JSON.stringify({
                        raid_reference: { raid_id: 1 },
                        end_time: 1704067200,
                        reminder_kind: 'one_hour_left',
                        attack_snapshot: badSnapshot,
                    }),
                    CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
                ),
            ).toThrow(ValidationError);
        }
    });
});
