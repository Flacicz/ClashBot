import type { ClanwarReference } from '../database/repos/clanwarRepo.js';
import type { DomainEventRecord } from '../database/repos/domainEventsRepo.js';
import {
    APPLICATION_EVENT_TYPES,
    getApplicationEventKey,
    type ApplicationEvent,
} from '../events/applicationEvents.js';

export const CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION = 1;

function serializeClanwarReference(reference: ClanwarReference): Record<string, unknown> {
    return {
        clan_tag: reference.clanTag,
        war_id: reference.warId,
        home_clan_id: reference.homeClanId,
        opponent_clan_id: reference.opponentClanId,
    };
}

function assertNever(value: never): never {
    throw new Error(`Unhandled application event in serializer: ${JSON.stringify(value)}`);
}

function buildPayload(event: ApplicationEvent): Record<string, unknown> {
    switch (event.type) {
        case APPLICATION_EVENT_TYPES.playerJoinedClan:
            return {
                player_tag: event.playerTag,
                player_name: event.playerName,
                membership_id: event.membershipId,
            };
        case APPLICATION_EVENT_TYPES.playerLeftClan:
            return {
                player_tag: event.playerTag,
                player_name: event.playerName,
                membership_id: event.membershipId,
            };
        case APPLICATION_EVENT_TYPES.playerRoleChanged:
            return {
                player_tag: event.playerTag,
                player_name: event.playerName,
                old_role: event.oldRole,
                new_role: event.newRole,
                snapshot_id: event.snapshotId,
            };
        case APPLICATION_EVENT_TYPES.warEnded:
            return {
                war_reference: serializeClanwarReference(event.warReference),
            };
        case APPLICATION_EVENT_TYPES.raidsEnded:
            return {
                raid_reference: {
                    raid_id: event.raidReference.raidId,
                },
            };
        case APPLICATION_EVENT_TYPES.cwlRoundEnded:
            return {
                cwl_season_id: event.cwlSeasonId,
                war_reference: serializeClanwarReference(event.warReference),
            };
        case APPLICATION_EVENT_TYPES.syncFailure:
            return {
                service_name: event.serviceName,
                error_message: event.errorMsg,
                attempts: event.attempts,
                outage_id: event.outageId,
            };
        case APPLICATION_EVENT_TYPES.syncRecovery:
            return {
                service_name: event.serviceName,
                outage_id: event.outageId,
            };
        case APPLICATION_EVENT_TYPES.warReminder:
            return {
                war_id: event.warId,
                end_time: event.endTime,
                war_kind: event.warKind,
                reminder_kind: event.kind,
                ...(event.remainingSeconds !== undefined
                    ? { remaining_seconds: event.remainingSeconds }
                    : {}),
            };
        case APPLICATION_EVENT_TYPES.raidReminder:
            return {
                raid_reference: {
                    raid_id: event.raidReference.raidId,
                },
                end_time: event.endTime,
                reminder_kind: event.kind,
                ...(event.remainingSeconds !== undefined
                    ? { remaining_seconds: event.remainingSeconds }
                    : {}),
            };
        default:
            return assertNever(event);
    }
}

export function serializeDomainEvent(event: ApplicationEvent): DomainEventRecord {
    return {
        eventType: event.type,
        eventId: getApplicationEventKey(event),
        payload: JSON.stringify(buildPayload(event)),
        payloadVersion: CURRENT_DOMAIN_EVENT_PAYLOAD_VERSION,
        clanTag: event.clanTag,
    };
}

export class DomainEventPayloadSerializer {
    serialize(event: ApplicationEvent): DomainEventRecord {
        return serializeDomainEvent(event);
    }
}
