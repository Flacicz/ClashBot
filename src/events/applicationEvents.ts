import type { ClanwarReference } from '../database/repos/clanwarRepo.js';
import type { RaidReference } from '../models/raid.js';

export const APPLICATION_EVENT_TYPES = {
    playerJoinedClan: 'PlayerJoinedClanEvent',
    playerLeftClan: 'PlayerLeftClanEvent',
    playerRoleChanged: 'PlayerRoleChangedEvent',
    warEnded: 'war_ended',
    raidsEnded: 'raids_ended',
    cwlRoundEnded: 'cwl_round_ended',
    syncFailure: 'SyncFailureEvent',
    syncRecovery: 'SyncRecoveryEvent',
    warReminder: 'war_reminder',
    raidReminder: 'raid_reminder',
} as const;

export type ApplicationEventType =
    (typeof APPLICATION_EVENT_TYPES)[keyof typeof APPLICATION_EVENT_TYPES];

export const WAR_REMINDER_WAR_KINDS = {
    regular: 'regular',
    cwl: 'cwl',
} as const;

export type WarReminderWarKind =
    (typeof WAR_REMINDER_WAR_KINDS)[keyof typeof WAR_REMINDER_WAR_KINDS];

export const WAR_REMINDER_KINDS = {
    started: 'started',
    sixHoursLeft: 'six_hours_left',
    oneHourLeft: 'one_hour_left',
} as const;

export type WarReminderKind = (typeof WAR_REMINDER_KINDS)[keyof typeof WAR_REMINDER_KINDS];

export const RAID_REMINDER_KINDS = {
    started: 'started',
    fortyEightHoursLeft: 'forty_eight_hours_left',
    twentyFourHoursLeft: 'twenty_four_hours_left',
    sixHoursLeft: 'six_hours_left',
    oneHourLeft: 'one_hour_left',
} as const;

export type RaidReminderKind = (typeof RAID_REMINDER_KINDS)[keyof typeof RAID_REMINDER_KINDS];

export interface PlayerJoinedClanEvent {
    readonly type: typeof APPLICATION_EVENT_TYPES.playerJoinedClan;
    readonly clanTag: string;
    readonly playerTag: string;
    readonly playerName: string;
    readonly membershipId: number;
}

export interface PlayerLeftClanEvent {
    readonly type: typeof APPLICATION_EVENT_TYPES.playerLeftClan;
    readonly clanTag: string;
    readonly playerTag: string;
    readonly playerName: string;
    readonly membershipId: number;
}

export interface PlayerRoleChangedEvent {
    readonly type: typeof APPLICATION_EVENT_TYPES.playerRoleChanged;
    readonly clanTag: string;
    readonly playerTag: string;
    readonly playerName: string;
    readonly oldRole: string;
    readonly newRole: string;
    readonly snapshotId: number;
}

export interface WarEndedEvent {
    readonly type: typeof APPLICATION_EVENT_TYPES.warEnded;
    readonly clanTag: string;
    readonly warReference: ClanwarReference;
}

export interface RaidsEndedEvent {
    readonly type: typeof APPLICATION_EVENT_TYPES.raidsEnded;
    readonly clanTag: string;
    readonly raidReference: RaidReference;
}

export interface ClanwarsLeagueRoundEndedEvent {
    readonly type: typeof APPLICATION_EVENT_TYPES.cwlRoundEnded;
    readonly clanTag: string;
    readonly cwlSeasonId: number;
    readonly warReference: ClanwarReference;
}

export interface SyncFailureEvent {
    readonly type: typeof APPLICATION_EVENT_TYPES.syncFailure;
    readonly clanTag: string;
    readonly serviceName: string;
    readonly errorMsg: string;
    readonly attempts: number;
    readonly outageId: number;
}

export interface SyncRecoveryEvent {
    readonly type: typeof APPLICATION_EVENT_TYPES.syncRecovery;
    readonly clanTag: string;
    readonly serviceName: string;
    readonly outageId: number;
}

export interface WarReminderEvent {
    readonly type: typeof APPLICATION_EVENT_TYPES.warReminder;
    readonly clanTag: string;
    readonly warId: number;
    readonly endTime: number;
    readonly warKind: WarReminderWarKind;
    readonly kind: WarReminderKind;
    readonly remainingSeconds?: number;
}

export interface RaidReminderEvent {
    readonly type: typeof APPLICATION_EVENT_TYPES.raidReminder;
    readonly clanTag: string;
    readonly raidReference: RaidReference;
    readonly endTime: number;
    readonly kind: RaidReminderKind;
    readonly remainingSeconds?: number;
}

export type ApplicationEvent =
    | PlayerJoinedClanEvent
    | PlayerLeftClanEvent
    | PlayerRoleChangedEvent
    | WarEndedEvent
    | RaidsEndedEvent
    | ClanwarsLeagueRoundEndedEvent
    | SyncFailureEvent
    | SyncRecoveryEvent
    | WarReminderEvent
    | RaidReminderEvent;

function assertNever(value: never): never {
    throw new Error(`Unhandled application event: ${JSON.stringify(value)}`);
}

export function getApplicationEventKey(event: ApplicationEvent): string {
    switch (event.type) {
        case APPLICATION_EVENT_TYPES.playerJoinedClan:
            return String(event.membershipId);
        case APPLICATION_EVENT_TYPES.playerLeftClan:
            return String(event.membershipId);
        case APPLICATION_EVENT_TYPES.playerRoleChanged:
            return String(event.snapshotId);
        case APPLICATION_EVENT_TYPES.warEnded:
            return String(event.warReference.warId);
        case APPLICATION_EVENT_TYPES.raidsEnded:
            return String(event.raidReference.raidId);
        case APPLICATION_EVENT_TYPES.cwlRoundEnded:
            return String(event.warReference.warId);
        case APPLICATION_EVENT_TYPES.syncFailure:
            return String(event.outageId);
        case APPLICATION_EVENT_TYPES.syncRecovery:
            return String(event.outageId);
        case APPLICATION_EVENT_TYPES.warReminder:
            return `${String(event.warId)}:${event.kind}`;
        case APPLICATION_EVENT_TYPES.raidReminder:
            return `${String(event.raidReference.raidId)}:${event.kind}`;
        default:
            return assertNever(event);
    }
}
