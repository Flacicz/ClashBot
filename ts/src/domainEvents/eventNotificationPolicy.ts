import { APPLICATION_EVENT_TYPES, type ApplicationEvent } from '../events/applicationEvents.js';
import type { Audience } from '../telegram/validation.js';

const PLAYERS_ONLY: readonly Audience[] = ['players'];
const MANAGEMENT_ONLY: readonly Audience[] = ['management'];
const PLAYERS_AND_MANAGEMENT: readonly Audience[] = ['players', 'management'];

function assertNever(value: never): never {
    throw new Error(`Audience policy is missing for event: ${JSON.stringify(value)}`);
}

export function audiencesForEvent(event: ApplicationEvent): readonly Audience[] {
    switch (event.type) {
        case APPLICATION_EVENT_TYPES.playerJoinedClan:
        case APPLICATION_EVENT_TYPES.playerLeftClan:
        case APPLICATION_EVENT_TYPES.playerRoleChanged:
        case APPLICATION_EVENT_TYPES.warReminder:
        case APPLICATION_EVENT_TYPES.raidReminder:
            return PLAYERS_ONLY;
        case APPLICATION_EVENT_TYPES.warEnded:
        case APPLICATION_EVENT_TYPES.raidsEnded:
        case APPLICATION_EVENT_TYPES.cwlRoundEnded:
            return PLAYERS_AND_MANAGEMENT;
        case APPLICATION_EVENT_TYPES.syncFailure:
        case APPLICATION_EVENT_TYPES.syncRecovery:
            return MANAGEMENT_ONLY;
        default:
            return assertNever(event);
    }
}
