import { isCocApiError } from '../api/errors.js';
import type { ClashOfClansApi, Clanwar, CompleteClanwarData } from '../api/models.js';
import { SystemClock, type Clock } from '../common/clock.js';
import { AbortError, isAbortError } from '../common/errors.js';
import type { ClanwarReference, ClanwarRepo } from '../database/repos/clanwarRepo.js';
import type { SyncServiceName } from '../database/repos/syncOutageRepo.js';
import type { TransactionManager } from '../database/transactionManager.js';
import type { DomainEventRecorder } from '../domainEvents/domainEventRecorder.js';
import {
    APPLICATION_EVENT_TYPES,
    WAR_REMINDER_KINDS,
    WAR_REMINDER_WAR_KINDS,
    type ApplicationEvent,
} from '../events/applicationEvents.js';
import type { Logger } from '../logging/logger.js';
import { buildWarReminderAttackSnapshot, selectWarReminders } from './reminders.js';
import { createSyncError, createSyncSuccess, type SyncResult } from './syncResult.js';
import type { SyncService } from './syncService.js';

export const CLANWAR_SERVICE_NAME: SyncServiceName = 'ClanwarService';

export type ClanwarApiClient = Pick<ClashOfClansApi, 'getCompleteClanwarData'>;

function errorMessageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal: AbortSignal | undefined, serviceName: string): void {
    if (!signal?.aborted) {
        return;
    }
    const reason: unknown = signal.reason;
    if (reason instanceof AbortError) {
        throw reason;
    }
    throw new AbortError(`[Service: ${serviceName}] Operation aborted`, { cause: reason });
}

function isPrivateWarLogError(error: unknown): boolean {
    if (!isCocApiError(error) || error.kind !== 'forbidden') {
        return false;
    }

    if (error.responseBody === undefined || error.responseBody.trim().length === 0) {
        return true;
    }

    try {
        const parsed: unknown = JSON.parse(error.responseBody);
        if (typeof parsed === 'object' && parsed !== null) {
            const reason =
                'reason' in parsed && typeof parsed.reason === 'string' ? parsed.reason : undefined;
            const message =
                'message' in parsed && typeof parsed.message === 'string'
                    ? parsed.message
                    : undefined;

            if (reason === 'accessDenied.invalidIp') {
                return false;
            }
            if (message?.toLowerCase().includes('invalid authorization') === true) {
                return false;
            }
        }
    } catch {
        // Non-JSON 403 body is still treated as a private war log response.
    }

    return true;
}

interface GeneratedWarEvents {
    readonly events: ApplicationEvent[];
    readonly skippedEvents: ApplicationEvent[];
}

function generateEvents(
    clanTag: string,
    clanwar: Clanwar,
    warReference: ClanwarReference,
    clanwarRepo: ClanwarRepo,
    nowEpochSeconds: number,
): GeneratedWarEvents {
    const events: ApplicationEvent[] = [];
    const skippedEvents: ApplicationEvent[] = [];

    if (clanwar.state !== 'warEnded') {
        const selection = selectWarReminders(clanwar.startTime, clanwar.endTime, nowEpochSeconds);

        for (const kind of selection.skippedKinds) {
            skippedEvents.push({
                type: APPLICATION_EVENT_TYPES.warReminder,
                clanTag,
                warId: warReference.warId,
                endTime: clanwar.endTime,
                warKind: WAR_REMINDER_WAR_KINDS.regular,
                kind,
            });
        }

        if (selection.activeKind !== null) {
            const isCountdown = selection.activeKind !== WAR_REMINDER_KINDS.started;
            const attackSnapshot = isCountdown
                ? buildWarReminderAttackSnapshot(
                      clanwarRepo.getWarMemberAttackCounts(warReference),
                      clanwar.attacksPerMember,
                      nowEpochSeconds,
                      selection.activeKind === WAR_REMINDER_KINDS.oneHourLeft,
                  )
                : undefined;

            events.push({
                type: APPLICATION_EVENT_TYPES.warReminder,
                clanTag,
                warId: warReference.warId,
                endTime: clanwar.endTime,
                warKind: WAR_REMINDER_WAR_KINDS.regular,
                kind: selection.activeKind,
                ...(isCountdown ? { remainingSeconds: selection.remainingSeconds } : {}),
                ...(attackSnapshot !== undefined ? { attackSnapshot } : {}),
            });
        }
    }

    if (clanwar.state === 'warEnded') {
        events.push({
            type: APPLICATION_EVENT_TYPES.warEnded,
            clanTag,
            warReference,
        });
    }

    return { events, skippedEvents };
}

export class ClanwarService implements SyncService {
    private readonly clanwarRepo: ClanwarRepo;
    private readonly apiClient: ClanwarApiClient;
    private readonly transactionManager: TransactionManager;
    private readonly domainEventRecorder: DomainEventRecorder;
    private readonly clock: Clock;
    private readonly logger?: Logger;

    constructor(
        clanwarRepo: ClanwarRepo,
        apiClient: ClanwarApiClient,
        transactionManager: TransactionManager,
        domainEventRecorder: DomainEventRecorder,
        clock: Clock = new SystemClock(),
        logger?: Logger,
    ) {
        this.clanwarRepo = clanwarRepo;
        this.apiClient = apiClient;
        this.transactionManager = transactionManager;
        this.domainEventRecorder = domainEventRecorder;
        this.clock = clock;
        if (logger !== undefined) {
            this.logger = logger;
        }
    }

    getServiceName(): string {
        return CLANWAR_SERVICE_NAME;
    }

    async updateData(clanTag: string, signal?: AbortSignal): Promise<SyncResult> {
        const serviceName = this.getServiceName();
        this.logger?.info({ service: serviceName, clanTag }, 'Starting clan war update');

        throwIfAborted(signal, serviceName);

        let completeData: CompleteClanwarData | null;
        try {
            completeData = await this.apiClient.getCompleteClanwarData(clanTag, signal);
        } catch (error: unknown) {
            if (isAbortError(error)) {
                throw error;
            }
            if (isPrivateWarLogError(error)) {
                this.logger?.info(
                    { service: serviceName, clanTag },
                    'Clan war log is private; skipping regular war sync',
                );
                return createSyncSuccess(serviceName, clanTag);
            }
            const message = errorMessageOf(error);
            this.logger?.error(
                { err: error, service: serviceName, clanTag },
                'Failed to fetch clan war data from CoC API',
            );
            return createSyncError(serviceName, clanTag, message);
        }

        throwIfAborted(signal, serviceName);

        if (completeData === null || completeData.clanwar.state === 'notInWar') {
            this.logger?.info({ service: serviceName, clanTag }, 'No active clan war for clan');
            return createSyncSuccess(serviceName, clanTag);
        }

        const { clanwar, clans, attacks, members } = completeData;

        try {
            const syncResult = this.transactionManager.retryInTransaction(() => {
                const nowEpochSeconds = this.clock.nowEpochSeconds();
                const warReference = this.clanwarRepo.saveCompleteClanwarData(
                    clanwar,
                    clans,
                    attacks,
                    members,
                    nowEpochSeconds,
                );

                const { events, skippedEvents } = generateEvents(
                    clanTag,
                    clanwar,
                    warReference,
                    this.clanwarRepo,
                    nowEpochSeconds,
                );

                if (skippedEvents.length > 0) {
                    this.domainEventRecorder.recordSkipped(skippedEvents);
                }

                if (events.length > 0) {
                    this.domainEventRecorder.recordAll(events);
                }

                return createSyncSuccess(serviceName, clanTag, events);
            });

            this.logger?.info(
                {
                    service: serviceName,
                    clanTag,
                    membersCount: members[0].length + members[1].length,
                    attacksCount: attacks.length,
                    eventsGenerated: syncResult.events.length,
                },
                'Successfully updated clan war',
            );

            return syncResult;
        } catch (error: unknown) {
            const message = errorMessageOf(error);
            this.logger?.error(
                { err: error, service: serviceName, clanTag },
                'Database transaction failed while updating clan war',
            );
            return createSyncError(serviceName, clanTag, message);
        }
    }
}
