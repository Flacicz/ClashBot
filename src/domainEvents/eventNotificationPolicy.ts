import { APPLICATION_EVENT_TYPES, type ApplicationEvent } from '../events/applicationEvents.js';
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '../models/subscription.js';

const ROSTER_ONLY: readonly NotificationCategory[] = [NOTIFICATION_CATEGORIES.roster];
const REMINDERS_ONLY: readonly NotificationCategory[] = [NOTIFICATION_CATEGORIES.reminders];
const SYSTEM_ONLY: readonly NotificationCategory[] = [NOTIFICATION_CATEGORIES.system];
const SUMMARIES_AND_DISCIPLINE: readonly NotificationCategory[] = [
    NOTIFICATION_CATEGORIES.summaries,
    NOTIFICATION_CATEGORIES.discipline,
];

function assertNever(value: never): never {
    throw new Error(`Category policy is missing for event: ${JSON.stringify(value)}`);
}

export function categoriesForEvent(event: ApplicationEvent): readonly NotificationCategory[] {
    switch (event.type) {
        case APPLICATION_EVENT_TYPES.playerJoinedClan:
        case APPLICATION_EVENT_TYPES.playerLeftClan:
        case APPLICATION_EVENT_TYPES.playerRoleChanged:
            return ROSTER_ONLY;
        case APPLICATION_EVENT_TYPES.warReminder:
        case APPLICATION_EVENT_TYPES.raidReminder:
            return REMINDERS_ONLY;
        case APPLICATION_EVENT_TYPES.warEnded:
        case APPLICATION_EVENT_TYPES.raidsEnded:
        case APPLICATION_EVENT_TYPES.cwlRoundEnded:
            return SUMMARIES_AND_DISCIPLINE;
        case APPLICATION_EVENT_TYPES.syncFailure:
        case APPLICATION_EVENT_TYPES.syncRecovery:
            return SYSTEM_ONLY;
        default:
            return assertNever(event);
    }
}

export const EventNotificationPolicy = {
    categoriesFor: categoriesForEvent,
} as const;
