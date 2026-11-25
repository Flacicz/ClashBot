import type {
    ClanRaid,
    ClashOfClansApi,
    CompleteRaidData,
    PlayerRaidSnapshot,
} from '../api/models.js';
import { SystemClock, type Clock } from '../common/clock.js';
import { AbortError, isAbortError } from '../common/errors.js';
import type { ClansRepo } from '../database/repos/clansRepo.js';
import type { RaidRepo } from '../database/repos/raidRepo.js';
import type { SyncServiceName } from '../database/repos/syncOutageRepo.js';
import type { TransactionManager } from '../database/transactionManager.js';
import type { DomainEventRecorder } from '../domainEvents/domainEventRecorder.js';
import {
    APPLICATION_EVENT_TYPES,
    RAID_REMINDER_KINDS,
    type ApplicationEvent,
} from '../events/applicationEvents.js';
import type { Logger } from '../logging/logger.js';
import type { RaidReference } from '../models/raid.js';
import { selectRaidReminders } from './reminders.js';
import { createSyncError, createSyncSuccess, type SyncResult } from './syncResult.js';
import type { SyncService } from './syncService.js';

export const RAID_SERVICE_NAME: SyncServiceName = 'RaidService';

export type RaidApiClient = Pick<ClashOfClansApi, 'getCompleteRaidData'>;

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

interface GeneratedRaidEvents {
    readonly events: ApplicationEvent[];
    readonly skippedEvents: ApplicationEvent[];
}

function generateEvents(
    clanTag: string,
    clanRaid: ClanRaid,
    reference: RaidReference,
    nowEpochSeconds: number,
): GeneratedRaidEvents {
    const events: ApplicationEvent[] = [];
    const skippedEvents: ApplicationEvent[] = [];

    if (clanRaid.state !== 'ended') {
        const selection = selectRaidReminders(
            clanRaid.startTime,
            clanRaid.endTime,
            nowEpochSeconds,
        );

        for (const kind of selection.skippedKinds) {
            skippedEvents.push({
                type: APPLICATION_EVENT_TYPES.raidReminder,
                clanTag,
                raidReference: reference,
                endTime: clanRaid.endTime,
                kind,
            });
        }

        if (selection.activeKind !== null) {
            events.push({
                type: APPLICATION_EVENT_TYPES.raidReminder,
                clanTag,
                raidReference: reference,
                endTime: clanRaid.endTime,
                kind: selection.activeKind,
                ...(selection.activeKind !== RAID_REMINDER_KINDS.started
                    ? { remainingSeconds: selection.remainingSeconds }
                    : {}),
            });
        }
    }

    if (clanRaid.state === 'ended') {
        events.push({
            type: APPLICATION_EVENT_TYPES.raidsEnded,
            clanTag,
            raidReference: reference,
        });
    }

    return { events, skippedEvents };
}

export class RaidService implements SyncService {
    private readonly clansRepo: ClansRepo;
    private readonly raidRepo: RaidRepo;
    private readonly apiClient: RaidApiClient;
    private readonly transactionManager: TransactionManager;
    private readonly domainEventRecorder: DomainEventRecorder;
    private readonly clock: Clock;
    private readonly logger?: Logger;

    constructor(
        clansRepo: ClansRepo,
        raidRepo: RaidRepo,
        apiClient: RaidApiClient,
        transactionManager: TransactionManager,
        domainEventRecorder: DomainEventRecorder,
        clock: Clock = new SystemClock(),
        logger?: Logger,
    ) {
        this.clansRepo = clansRepo;
        this.raidRepo = raidRepo;
        this.apiClient = apiClient;
        this.transactionManager = transactionManager;
        this.domainEventRecorder = domainEventRecorder;
        this.clock = clock;
        if (logger !== undefined) {
            this.logger = logger;
        }
    }

    getServiceName(): string {
        return RAID_SERVICE_NAME;
    }

    private ensurePlayersExist(players: readonly PlayerRaidSnapshot[]): void {
        for (const player of players) {
            this.clansRepo.insertMinimal(player.playerTag, player.playerName);
        }
    }

    async updateData(clanTag: string, signal?: AbortSignal): Promise<SyncResult> {
        const serviceName = this.getServiceName();
        this.logger?.info({ service: serviceName, clanTag }, 'Starting capital raid data update');

        throwIfAborted(signal, serviceName);

        let completeRaidData: CompleteRaidData | null;
        try {
            completeRaidData = await this.apiClient.getCompleteRaidData(clanTag, signal);
        } catch (error: unknown) {
            if (isAbortError(error)) {
                throw error;
            }
            const message = errorMessageOf(error);
            this.logger?.error(
                { err: error, service: serviceName, clanTag },
                'Failed to fetch capital raid data from CoC API',
            );
            return createSyncError(serviceName, clanTag, message);
        }

        throwIfAborted(signal, serviceName);

        if (completeRaidData === null) {
            this.logger?.info(
                { service: serviceName, clanTag },
                'No active or historical capital raid data for clan',
            );
            return createSyncSuccess(serviceName, clanTag);
        }

        const { clanRaid, playerRaidSnapshots } = completeRaidData;

        try {
            const syncResult = this.transactionManager.retryInTransaction(() => {
                this.ensurePlayersExist(playerRaidSnapshots);

                const nowEpochSeconds = this.clock.nowEpochSeconds();
                const reference = this.raidRepo.saveCompleteRaidData(
                    clanRaid,
                    playerRaidSnapshots,
                    nowEpochSeconds,
                );

                const { events, skippedEvents } = generateEvents(
                    clanTag,
                    clanRaid,
                    reference,
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
                    participantsCount: playerRaidSnapshots.length,
                    eventsGenerated: syncResult.events.length,
                },
                'Successfully updated capital raid data',
            );

            return syncResult;
        } catch (error: unknown) {
            const message = errorMessageOf(error);
            this.logger?.error(
                { err: error, service: serviceName, clanTag },
                'Database transaction failed while updating capital raid data',
            );
            return createSyncError(serviceName, clanTag, message);
        }
    }
}
