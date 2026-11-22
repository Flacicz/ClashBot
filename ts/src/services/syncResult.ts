import type { ApplicationEvent } from '../events/applicationEvents.js';

export interface SyncResult {
    readonly serviceName: string;
    readonly clanTag: string;
    readonly successFlag: boolean;
    readonly errorMsg: string;
    readonly events: readonly ApplicationEvent[];
}

export function createSyncSuccess(
    serviceName: string,
    clanTag: string,
    events: readonly ApplicationEvent[] = [],
): SyncResult {
    return {
        serviceName,
        clanTag,
        successFlag: true,
        errorMsg: '',
        events,
    };
}

export function createSyncError(
    serviceName: string,
    clanTag: string,
    errorMsg: string,
): SyncResult {
    return {
        serviceName,
        clanTag,
        successFlag: false,
        errorMsg,
        events: [],
    };
}
