import type { ClashOfClansApi, Clanwar, CompleteClanwarsLeagueData } from '../api/models.js';
import { SystemClock, type Clock } from '../common/clock.js';
import { AbortError, isAbortError } from '../common/errors.js';
import type { ClanwarReference, ClanwarRepo } from '../database/repos/clanwarRepo.js';
import type { ClanwarsLeagueRepo } from '../database/repos/clanwarsLeagueRepo.js';
import type { SyncServiceName } from '../database/repos/syncOutageRepo.js';
import type { TransactionManager } from '../database/transactionManager.js';
import type { DomainEventRecorder } from '../domainEvents/domainEventRecorder.js';
import {
    APPLICATION_EVENT_TYPES,
    WAR_REMINDER_WAR_KINDS,
    type ApplicationEvent,
} from '../events/applicationEvents.js';
import type { Logger } from '../logging/logger.js';
import { getActiveWarReminderKinds } from './reminders.js';
import { createSyncError, createSyncSuccess, type SyncResult } from './syncResult.js';
import type { SyncService } from './syncService.js';

export const CLANWAR_LEAGUE_SERVICE_NAME: SyncServiceName = 'ClanwarLeagueService';

export type ClanwarLeagueApiClient = Pick<ClashOfClansApi, 'getCompleteClanwarsLeagueData'>;

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

function generateRoundEvents(
    clanTag: string,
    cwlSeasonId: number,
    war: Clanwar,
    warReference: ClanwarReference,
    nowEpochSeconds: number,
): ApplicationEvent[] {
    const events: ApplicationEvent[] = [];

    for (const kind of getActiveWarReminderKinds(war.startTime, war.endTime, nowEpochSeconds)) {
        events.push({
            type: APPLICATION_EVENT_TYPES.warReminder,
            clanTag,
            warId: warReference.warId,
            endTime: war.endTime,
            warKind: WAR_REMINDER_WAR_KINDS.cwl,
            kind,
        });
    }

    if (war.state === 'warEnded') {
        events.push({
            type: APPLICATION_EVENT_TYPES.cwlRoundEnded,
            clanTag,
            cwlSeasonId,
            warReference,
        });
    }

    return events;
}

export class ClanwarLeagueService implements SyncService {
    private readonly clanwarRepo: ClanwarRepo;
    private readonly clanwarsLeagueRepo: ClanwarsLeagueRepo;
    private readonly apiClient: ClanwarLeagueApiClient;
    private readonly transactionManager: TransactionManager;
    private readonly domainEventRecorder: DomainEventRecorder;
    private readonly clock: Clock;
    private readonly logger?: Logger;

    constructor(
        clanwarRepo: ClanwarRepo,
        clanwarsLeagueRepo: ClanwarsLeagueRepo,
        apiClient: ClanwarLeagueApiClient,
        transactionManager: TransactionManager,
        domainEventRecorder: DomainEventRecorder,
        clock: Clock = new SystemClock(),
        logger?: Logger,
    ) {
        this.clanwarRepo = clanwarRepo;
        this.clanwarsLeagueRepo = clanwarsLeagueRepo;
        this.apiClient = apiClient;
        this.transactionManager = transactionManager;
        this.domainEventRecorder = domainEventRecorder;
        this.clock = clock;
        if (logger !== undefined) {
            this.logger = logger;
        }
    }

    getServiceName(): string {
        return CLANWAR_LEAGUE_SERVICE_NAME;
    }

    async updateData(clanTag: string, signal?: AbortSignal): Promise<SyncResult> {
        const serviceName = this.getServiceName();
        this.logger?.info({ service: serviceName, clanTag }, 'Starting CWL data update');

        throwIfAborted(signal, serviceName);

        let completeLeagueData: CompleteClanwarsLeagueData | null;
        try {
            completeLeagueData = await this.apiClient.getCompleteClanwarsLeagueData(
                clanTag,
                signal,
            );
        } catch (error: unknown) {
            if (isAbortError(error)) {
                throw error;
            }
            const message = errorMessageOf(error);
            this.logger?.error(
                { err: error, service: serviceName, clanTag },
                'Failed to fetch CWL data from CoC API',
            );
            return createSyncError(serviceName, clanTag, message);
        }

        throwIfAborted(signal, serviceName);

        if (completeLeagueData === null) {
            this.logger?.info(
                { service: serviceName, clanTag },
                'No active Clan War League season for clan',
            );
            return createSyncSuccess(serviceName, clanTag);
        }

        const { clanwarsLeagueSeason, clanwarsLeagueMembers, warDetails } = completeLeagueData;

        try {
            const syncResult = this.transactionManager.retryInTransaction(() => {
                const events: ApplicationEvent[] = [];
                const cwlSeasonId = this.clanwarsLeagueRepo.saveCompleteCWLData(
                    clanwarsLeagueSeason,
                    clanwarsLeagueMembers,
                );
                const nowEpochSeconds = this.clock.nowEpochSeconds();

                for (const { roundNumber, clanwar, clans, attacks, members } of warDetails) {
                    const warToSave: Clanwar = {
                        ...clanwar,
                        seasonId: cwlSeasonId,
                        roundNumber,
                    };

                    const warReference = this.clanwarRepo.saveCompleteClanwarData(
                        warToSave,
                        clans,
                        attacks,
                        members,
                    );

                    const roundEvents = generateRoundEvents(
                        clanTag,
                        cwlSeasonId,
                        warToSave,
                        warReference,
                        nowEpochSeconds,
                    );
                    events.push(...roundEvents);
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
                    warsCount: warDetails.length,
                    membersCount: clanwarsLeagueMembers.length,
                    eventsGenerated: syncResult.events.length,
                },
                'Successfully updated Clan War League data',
            );

            return syncResult;
        } catch (error: unknown) {
            const message = errorMessageOf(error);
            this.logger?.error(
                { err: error, service: serviceName, clanTag },
                'Database transaction failed while updating CWL data',
            );
            return createSyncError(serviceName, clanTag, message);
        }
    }
}
