import { z } from 'zod';

import { ValidationError } from '../common/errors.js';
import type { ClanwarReference } from '../database/repos/clanwarRepo.js';
import type { DomainEventRecord } from '../database/repos/domainEventsRepo.js';
import {
    APPLICATION_EVENT_TYPES,
    RAID_REMINDER_KINDS,
    WAR_REMINDER_KINDS,
    WAR_REMINDER_WAR_KINDS,
    type ApplicationEvent,
} from '../events/applicationEvents.js';
import { CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION } from './domainEventPayloadSerializer.js';

const safeIntSchema = z.number().int().safe();

const clanwarReferenceSchema = z.object({
    clan_tag: z.string(),
    war_id: safeIntSchema,
    home_clan_id: safeIntSchema,
    opponent_clan_id: safeIntSchema,
});

const raidReferenceSchema = z.object({
    raid_id: safeIntSchema,
});

const warKindSchema = z.enum([WAR_REMINDER_WAR_KINDS.regular, WAR_REMINDER_WAR_KINDS.cwl]);

const warReminderKindSchema = z.enum([
    WAR_REMINDER_KINDS.started,
    WAR_REMINDER_KINDS.sixHoursLeft,
    WAR_REMINDER_KINDS.oneHourLeft,
]);

const raidReminderKindSchema = z.enum([
    RAID_REMINDER_KINDS.started,
    RAID_REMINDER_KINDS.fortyEightHoursLeft,
    RAID_REMINDER_KINDS.twentyFourHoursLeft,
    RAID_REMINDER_KINDS.sixHoursLeft,
    RAID_REMINDER_KINDS.oneHourLeft,
]);

const playerMembershipPayloadSchema = z.object({
    player_tag: z.string(),
    player_name: z.string(),
    membership_id: safeIntSchema,
});

const playerRoleChangedPayloadSchema = z.object({
    player_tag: z.string(),
    player_name: z.string(),
    old_role: z.string(),
    new_role: z.string(),
    snapshot_id: safeIntSchema,
});

const warEndedPayloadSchema = z.object({
    war_reference: clanwarReferenceSchema,
});

const raidsEndedPayloadSchema = z.object({
    raid_reference: raidReferenceSchema,
});

const cwlRoundEndedPayloadSchema = z.object({
    cwl_season_id: safeIntSchema,
    war_reference: clanwarReferenceSchema,
});

const syncFailurePayloadSchema = z.object({
    service_name: z.string(),
    error_message: z.string(),
    attempts: safeIntSchema,
    outage_id: safeIntSchema,
});

const syncRecoveryPayloadSchema = z.object({
    service_name: z.string(),
    outage_id: safeIntSchema,
});

const warReminderPayloadSchema = z.object({
    war_id: safeIntSchema,
    end_time: safeIntSchema,
    war_kind: warKindSchema,
    reminder_kind: warReminderKindSchema,
    remaining_seconds: safeIntSchema.nonnegative().optional(),
});

const raidReminderPayloadSchema = z.object({
    raid_reference: raidReferenceSchema,
    end_time: safeIntSchema,
    reminder_kind: raidReminderKindSchema,
    remaining_seconds: safeIntSchema.nonnegative().optional(),
});

function toClanwarReference(parsed: z.infer<typeof clanwarReferenceSchema>): ClanwarReference {
    return {
        clanTag: parsed.clan_tag,
        warId: parsed.war_id,
        homeClanId: parsed.home_clan_id,
        opponentClanId: parsed.opponent_clan_id,
    };
}

function parsePayloadWithSchema<T>(
    eventType: string,
    schema: z.ZodType<T>,
    rawPayload: unknown,
): T {
    const result = schema.safeParse(rawPayload);
    if (!result.success) {
        const issues = result.error.issues
            .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
            .join('; ');
        throw new ValidationError(
            `DomainEventPayloadDeserializer: invalid payload for '${eventType}': ${issues}`,
            {
                cause: result.error,
                context: { eventType },
            },
        );
    }
    return result.data;
}

export function deserializeDomainEvent(
    clanTag: string,
    eventType: string,
    payload: string,
    payloadVersion: number,
): ApplicationEvent {
    if (payloadVersion !== CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION) {
        throw new ValidationError(
            `DomainEventPayloadDeserializer: unsupported payload version ${String(payloadVersion)}`,
            {
                context: { clanTag, eventType, payloadVersion },
            },
        );
    }

    let parsedJson: unknown;
    try {
        parsedJson = JSON.parse(payload) as unknown;
    } catch (error) {
        throw new ValidationError(
            `DomainEventPayloadDeserializer: invalid JSON payload for '${eventType}'`,
            {
                cause: error,
                context: { clanTag, eventType },
            },
        );
    }

    switch (eventType) {
        case APPLICATION_EVENT_TYPES.playerJoinedClan: {
            const data = parsePayloadWithSchema(
                eventType,
                playerMembershipPayloadSchema,
                parsedJson,
            );
            return {
                type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                clanTag,
                playerTag: data.player_tag,
                playerName: data.player_name,
                membershipId: data.membership_id,
            };
        }
        case APPLICATION_EVENT_TYPES.playerLeftClan: {
            const data = parsePayloadWithSchema(
                eventType,
                playerMembershipPayloadSchema,
                parsedJson,
            );
            return {
                type: APPLICATION_EVENT_TYPES.playerLeftClan,
                clanTag,
                playerTag: data.player_tag,
                playerName: data.player_name,
                membershipId: data.membership_id,
            };
        }
        case APPLICATION_EVENT_TYPES.playerRoleChanged: {
            const data = parsePayloadWithSchema(
                eventType,
                playerRoleChangedPayloadSchema,
                parsedJson,
            );
            return {
                type: APPLICATION_EVENT_TYPES.playerRoleChanged,
                clanTag,
                playerTag: data.player_tag,
                playerName: data.player_name,
                oldRole: data.old_role,
                newRole: data.new_role,
                snapshotId: data.snapshot_id,
            };
        }
        case APPLICATION_EVENT_TYPES.warEnded: {
            const data = parsePayloadWithSchema(eventType, warEndedPayloadSchema, parsedJson);
            return {
                type: APPLICATION_EVENT_TYPES.warEnded,
                clanTag,
                warReference: toClanwarReference(data.war_reference),
            };
        }
        case APPLICATION_EVENT_TYPES.raidsEnded: {
            const data = parsePayloadWithSchema(eventType, raidsEndedPayloadSchema, parsedJson);
            return {
                type: APPLICATION_EVENT_TYPES.raidsEnded,
                clanTag,
                raidReference: { raidId: data.raid_reference.raid_id },
            };
        }
        case APPLICATION_EVENT_TYPES.cwlRoundEnded: {
            const data = parsePayloadWithSchema(eventType, cwlRoundEndedPayloadSchema, parsedJson);
            return {
                type: APPLICATION_EVENT_TYPES.cwlRoundEnded,
                clanTag,
                cwlSeasonId: data.cwl_season_id,
                warReference: toClanwarReference(data.war_reference),
            };
        }
        case APPLICATION_EVENT_TYPES.syncFailure: {
            const data = parsePayloadWithSchema(eventType, syncFailurePayloadSchema, parsedJson);
            return {
                type: APPLICATION_EVENT_TYPES.syncFailure,
                clanTag,
                serviceName: data.service_name,
                errorMsg: data.error_message,
                attempts: data.attempts,
                outageId: data.outage_id,
            };
        }
        case APPLICATION_EVENT_TYPES.syncRecovery: {
            const data = parsePayloadWithSchema(eventType, syncRecoveryPayloadSchema, parsedJson);
            return {
                type: APPLICATION_EVENT_TYPES.syncRecovery,
                clanTag,
                serviceName: data.service_name,
                outageId: data.outage_id,
            };
        }
        case APPLICATION_EVENT_TYPES.warReminder: {
            const data = parsePayloadWithSchema(eventType, warReminderPayloadSchema, parsedJson);
            return {
                type: APPLICATION_EVENT_TYPES.warReminder,
                clanTag,
                warId: data.war_id,
                endTime: data.end_time,
                warKind: data.war_kind,
                kind: data.reminder_kind,
                ...(data.remaining_seconds !== undefined
                    ? { remainingSeconds: data.remaining_seconds }
                    : {}),
            };
        }
        case APPLICATION_EVENT_TYPES.raidReminder: {
            const data = parsePayloadWithSchema(eventType, raidReminderPayloadSchema, parsedJson);
            return {
                type: APPLICATION_EVENT_TYPES.raidReminder,
                clanTag,
                raidReference: { raidId: data.raid_reference.raid_id },
                endTime: data.end_time,
                kind: data.reminder_kind,
                ...(data.remaining_seconds !== undefined
                    ? { remainingSeconds: data.remaining_seconds }
                    : {}),
            };
        }
        default:
            throw new ValidationError(
                `DomainEventPayloadDeserializer: unknown event type '${eventType}'`,
                {
                    context: { clanTag, eventType },
                },
            );
    }
}

export function deserializeDomainEventRecord(
    record: Pick<DomainEventRecord, 'clanTag' | 'eventType' | 'payload' | 'payloadVersion'>,
): ApplicationEvent {
    return deserializeDomainEvent(
        record.clanTag,
        record.eventType,
        record.payload,
        record.payloadVersion,
    );
}

export class DomainEventPayloadDeserializer {
    deserialize(
        clanTag: string,
        eventType: string,
        payload: string,
        payloadVersion: number,
    ): ApplicationEvent {
        return deserializeDomainEvent(clanTag, eventType, payload, payloadVersion);
    }
}
