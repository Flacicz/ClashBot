import { SystemClock, type Clock } from '../common/clock.js';
import { AbortError, DatabaseError, isAbortError } from '../common/errors.js';
import type { ClansRepo } from '../database/repos/clansRepo.js';
import type { SyncOutageRepo } from '../database/repos/syncOutageRepo.js';
import { RetryPolicy } from '../database/retryPolicy.js';
import type { TransactionManager } from '../database/transactionManager.js';
import type { DomainEventRecorder } from '../domainEvents/domainEventRecorder.js';
import { APPLICATION_EVENT_TYPES, type ApplicationEvent } from '../events/applicationEvents.js';
import type { Logger } from '../logging/logger.js';
import { createSyncError, type SyncResult } from './syncResult.js';
import type { SyncService } from './syncService.js';

export const DEFAULT_SYNC_CYCLE_INTERVAL_MS = 15 * 60 * 1000;
export const DEFAULT_CLAN_LOAD_RETRY_DELAY_MS = 30 * 1000;
export const DEFAULT_SYNC_MAX_ATTEMPTS = 3;
export const DEFAULT_SYNC_RETRY_DELAY_MS = 2 * 1000;

export type TrackedClansReader = Pick<ClansRepo, 'getTrackedClans'>;

export interface ClanManagerOptions {
    readonly retryPolicy?: RetryPolicy;
    readonly clock?: Clock;
    readonly cycleIntervalMs?: number;
    readonly clanLoadRetryDelayMs?: number;
    readonly logger?: Logger;
}

function createDefaultSyncRetryPolicy(): RetryPolicy {
    return new RetryPolicy({
        maxAttempts: DEFAULT_SYNC_MAX_ATTEMPTS,
        initialDelayMs: DEFAULT_SYNC_RETRY_DELAY_MS,
        maxDelayMs: DEFAULT_SYNC_RETRY_DELAY_MS,
        backoffStrategy: 'linear',
    });
}

function validateNonNegativeDuration(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`ClanManager ${name} must be a non-negative finite number`);
    }
}

export class ClanManager {
    private readonly services: readonly SyncService[];
    private readonly clansRepo: TrackedClansReader;
    private readonly syncOutageRepo: SyncOutageRepo;
    private readonly transactionManager: TransactionManager;
    private readonly domainEventRecorder: DomainEventRecorder;
    private readonly retryPolicy: RetryPolicy;
    private readonly clock: Clock;
    private readonly cycleIntervalMs: number;
    private readonly clanLoadRetryDelayMs: number;
    private readonly logger?: Logger;

    constructor(
        services: readonly SyncService[],
        clansRepo: TrackedClansReader,
        syncOutageRepo: SyncOutageRepo,
        transactionManager: TransactionManager,
        domainEventRecorder: DomainEventRecorder,
        options: ClanManagerOptions = {},
    ) {
        const cycleIntervalMs = options.cycleIntervalMs ?? DEFAULT_SYNC_CYCLE_INTERVAL_MS;
        const clanLoadRetryDelayMs =
            options.clanLoadRetryDelayMs ?? DEFAULT_CLAN_LOAD_RETRY_DELAY_MS;

        validateNonNegativeDuration('cycleIntervalMs', cycleIntervalMs);
        validateNonNegativeDuration('clanLoadRetryDelayMs', clanLoadRetryDelayMs);

        this.services = [...services];
        this.clansRepo = clansRepo;
        this.syncOutageRepo = syncOutageRepo;
        this.transactionManager = transactionManager;
        this.domainEventRecorder = domainEventRecorder;
        this.retryPolicy = options.retryPolicy ?? createDefaultSyncRetryPolicy();
        this.clock = options.clock ?? new SystemClock();
        this.cycleIntervalMs = cycleIntervalMs;
        this.clanLoadRetryDelayMs = clanLoadRetryDelayMs;
        if (options.logger !== undefined) {
            this.logger = options.logger;
        }
    }

    async syncAll(signal?: AbortSignal): Promise<void> {
        while (!signal?.aborted) {
            let targetClans: string[];

            try {
                targetClans = this.clansRepo.getTrackedClans();
            } catch (error: unknown) {
                if (error instanceof DatabaseError) {
                    this.logger?.error({ err: error }, '[Manager] Failed to load tracked clans');
                    const slept = await this.sleepInterruptible(this.clanLoadRetryDelayMs, signal);
                    if (!slept) {
                        break;
                    }
                    continue;
                }
                throw error;
            }

            if (signal?.aborted) {
                break;
            }

            this.logger?.info(
                { trackedClansCount: targetClans.length },
                '[Manager] Starting synchronization cycle',
            );

            let cycleCancelled = false;
            for (const clanTag of targetClans) {
                if (cycleCancelled || signal?.aborted) {
                    break;
                }

                for (const service of this.services) {
                    if (cycleCancelled || signal?.aborted) {
                        break;
                    }

                    const serviceName = service.getServiceName();
                    this.logger?.debug(
                        { service: serviceName, clanTag },
                        '[Manager] Synchronizing service for clan',
                    );

                    try {
                        const result = await this.syncWithRetry(service, clanTag, signal);

                        if (!result.successFlag) {
                            if (signal?.aborted) {
                                this.logger?.info(
                                    { service: serviceName, clanTag },
                                    '[Manager] Synchronization interrupted during shutdown',
                                );
                                cycleCancelled = true;
                                break;
                            }

                            this.logger?.error(
                                {
                                    service: serviceName,
                                    clanTag,
                                    maxAttempts: this.retryPolicy.maxAttempts,
                                    errorMsg: result.errorMsg,
                                },
                                '[ClanManager] Service completely failed after max attempts',
                            );
                            this.handleSyncFailure(result);
                            continue;
                        }

                        this.handleSyncRecovery(result);
                    } catch (error: unknown) {
                        if (isAbortError(error) || signal?.aborted) {
                            this.logger?.info(
                                { service: serviceName, clanTag },
                                '[Manager] Synchronization cancelled during shutdown',
                            );
                            cycleCancelled = true;
                            break;
                        }

                        this.logger?.error(
                            { err: error, service: serviceName, clanTag },
                            '[Manager] Unhandled exception while synchronizing service for clan',
                        );
                    }
                }
            }

            if (cycleCancelled || signal?.aborted) {
                break;
            }

            this.logger?.info(
                { cycleIntervalMs: this.cycleIntervalMs },
                '[Manager] Cycle finished. Sleeping before next cycle',
            );

            const slept = await this.sleepInterruptible(this.cycleIntervalMs, signal);
            if (!slept) {
                break;
            }
        }

        this.logger?.info('[Manager] Synchronization cycle stopped gracefully.');
    }

    private async syncWithRetry(
        service: SyncService,
        clanTag: string,
        signal?: AbortSignal,
    ): Promise<SyncResult> {
        const serviceName = service.getServiceName();
        let result = createSyncError(serviceName, clanTag, '');

        for (let attempt = 1; attempt <= this.retryPolicy.maxAttempts; attempt += 1) {
            if (signal?.aborted) {
                throw new AbortError('Clan synchronization cancelled during shutdown');
            }

            result = await service.updateData(clanTag, signal);

            if (result.successFlag) {
                return result;
            }

            if (signal?.aborted) {
                throw new AbortError('Clan synchronization cancelled during shutdown');
            }

            if (attempt < this.retryPolicy.maxAttempts) {
                this.logger?.warn(
                    {
                        service: serviceName,
                        clanTag,
                        attempt,
                        maxAttempts: this.retryPolicy.maxAttempts,
                    },
                    '[Manager] Service failed for clan, retrying',
                );

                await this.clock.sleep(this.retryPolicy.delayForAttempt(attempt), signal);
            }
        }

        return result;
    }

    private handleSyncFailure(syncResult: SyncResult): void {
        this.transactionManager.retryInTransaction(() => {
            const outage = this.syncOutageRepo.recordFailure(
                syncResult.clanTag,
                syncResult.serviceName,
            );

            const events: readonly ApplicationEvent[] = [
                {
                    type: APPLICATION_EVENT_TYPES.syncFailure,
                    clanTag: syncResult.clanTag,
                    serviceName: syncResult.serviceName,
                    errorMsg: syncResult.errorMsg,
                    attempts: outage.failureCount,
                    outageId: outage.id,
                },
            ];

            this.domainEventRecorder.recordAll(events);
        });
    }

    private handleSyncRecovery(syncResult: SyncResult): void {
        this.transactionManager.retryInTransaction(() => {
            const outageId = this.syncOutageRepo.getOpenOutageId(
                syncResult.clanTag,
                syncResult.serviceName,
            );

            if (outageId === null) {
                return;
            }

            this.syncOutageRepo.markRecovered(outageId);

            const events: readonly ApplicationEvent[] = [
                {
                    type: APPLICATION_EVENT_TYPES.syncRecovery,
                    clanTag: syncResult.clanTag,
                    serviceName: syncResult.serviceName,
                    outageId,
                },
            ];

            this.domainEventRecorder.recordAll(events);
        });
    }

    private async sleepInterruptible(ms: number, signal?: AbortSignal): Promise<boolean> {
        try {
            await this.clock.sleep(ms, signal);
            return !signal?.aborted;
        } catch (error: unknown) {
            if (isAbortError(error) || signal?.aborted) {
                return false;
            }
            throw error;
        }
    }
}
