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

export interface WakeableClanManager {
    notify(): void;
}

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

function computeNextDueMs(
    scheduledDueMs: number,
    finishedNowMs: number,
    cycleIntervalMs: number,
): number {
    if (cycleIntervalMs === 0) {
        return finishedNowMs;
    }
    if (finishedNowMs < scheduledDueMs) {
        return finishedNowMs + cycleIntervalMs;
    }

    const next = scheduledDueMs + cycleIntervalMs;
    if (next > finishedNowMs) {
        return next;
    }

    const missedIntervals = Math.floor((finishedNowMs - scheduledDueMs) / cycleIntervalMs) + 1;
    return scheduledDueMs + missedIntervals * cycleIntervalMs;
}

export class ClanManager implements WakeableClanManager {
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

    private readonly nextDueByClan = new Map<string, number>();
    private wakeRequested = false;
    private activeSleepController: AbortController | undefined;

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

    notify(): void {
        this.wakeRequested = true;
        this.activeSleepController?.abort();
    }

    async syncAll(signal?: AbortSignal): Promise<void> {
        while (!signal?.aborted) {
            this.wakeRequested = false;

            let targetClans: string[];

            try {
                targetClans = this.clansRepo.getTrackedClans();
            } catch (error: unknown) {
                if (error instanceof DatabaseError) {
                    this.logger?.error({ err: error }, '[Manager] Failed to load tracked clans');
                    const slept = await this.sleepInterruptible(
                        this.clanLoadRetryDelayMs,
                        signal,
                        false,
                    );
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

            const loopNowMs = this.clock.nowMs();
            const trackedSet = new Set(targetClans);
            for (const trackedTag of this.nextDueByClan.keys()) {
                if (!trackedSet.has(trackedTag)) {
                    this.nextDueByClan.delete(trackedTag);
                }
            }

            const newDueClans: string[] = [];
            const existingDueClans: string[] = [];
            for (const clanTag of targetClans) {
                const scheduledDue = this.nextDueByClan.get(clanTag);
                if (scheduledDue === undefined) {
                    this.nextDueByClan.set(clanTag, loopNowMs);
                    newDueClans.push(clanTag);
                } else if (scheduledDue <= loopNowMs) {
                    existingDueClans.push(clanTag);
                }
            }

            const dueClans = [...newDueClans, ...existingDueClans];

            if (dueClans.length > 0) {
                this.logger?.info(
                    {
                        trackedClansCount: targetClans.length,
                        dueClansCount: dueClans.length,
                    },
                    '[Manager] Starting synchronization cycle',
                );
            }

            let cycleCancelled = false;
            let wokeMidCycle = false;

            for (const clanTag of dueClans) {
                if (signal?.aborted) {
                    break;
                }

                const scheduledDueMs = this.nextDueByClan.get(clanTag) ?? loopNowMs;
                cycleCancelled = await this.syncClan(clanTag, signal);
                if (cycleCancelled || signal?.aborted) {
                    break;
                }

                const finishedNowMs = this.clock.nowMs();
                this.nextDueByClan.set(
                    clanTag,
                    computeNextDueMs(scheduledDueMs, finishedNowMs, this.cycleIntervalMs),
                );

                if (this.isWakeRequested()) {
                    wokeMidCycle = true;
                    break;
                }
            }

            if (cycleCancelled || signal?.aborted) {
                break;
            }

            if (wokeMidCycle || this.isWakeRequested()) {
                continue;
            }

            const sleepDurationMs = this.computeSleepDurationMs(targetClans, this.clock.nowMs());

            if (dueClans.length > 0) {
                this.logger?.info(
                    {
                        cycleIntervalMs: this.cycleIntervalMs,
                        sleepDurationMs,
                    },
                    '[Manager] Cycle finished. Sleeping before next cycle',
                );
            }

            const continued = await this.sleepInterruptible(sleepDurationMs, signal, true);
            if (!continued) {
                break;
            }
        }

        this.logger?.info('[Manager] Synchronization cycle stopped gracefully.');
    }

    private async syncClan(clanTag: string, signal?: AbortSignal): Promise<boolean> {
        for (const service of this.services) {
            if (signal?.aborted) {
                return true;
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
                        return true;
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
                    return true;
                }

                this.logger?.error(
                    { err: error, service: serviceName, clanTag },
                    '[Manager] Unhandled exception while synchronizing service for clan',
                );
            }
        }

        return false;
    }

    private computeSleepDurationMs(targetClans: readonly string[], nowMs: number): number {
        if (targetClans.length === 0) {
            return this.cycleIntervalMs;
        }

        let earliestDueMs = Number.POSITIVE_INFINITY;
        for (const clanTag of targetClans) {
            const dueMs = this.nextDueByClan.get(clanTag);
            if (dueMs === undefined) {
                return 0;
            }
            if (dueMs < earliestDueMs) {
                earliestDueMs = dueMs;
            }
        }

        if (!Number.isFinite(earliestDueMs)) {
            return this.cycleIntervalMs;
        }

        return Math.max(0, earliestDueMs - nowMs);
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

    private isWakeRequested(): boolean {
        return this.wakeRequested;
    }

    private async sleepInterruptible(
        ms: number,
        signal: AbortSignal | undefined,
        allowWake: boolean,
    ): Promise<boolean> {
        if (signal?.aborted) {
            return false;
        }
        if (allowWake && this.isWakeRequested()) {
            return true;
        }

        if (!allowWake) {
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

        const sleepController = new AbortController();
        this.activeSleepController = sleepController;

        const onExternalAbort = (): void => {
            sleepController.abort(signal?.reason);
        };
        signal?.addEventListener('abort', onExternalAbort, { once: true });

        try {
            await this.clock.sleep(ms, sleepController.signal);
            return !signal?.aborted;
        } catch (error: unknown) {
            if (signal?.aborted) {
                return false;
            }
            if (isAbortError(error)) {
                return true;
            }
            throw error;
        } finally {
            signal?.removeEventListener('abort', onExternalAbort);
            if (this.activeSleepController === sleepController) {
                this.activeSleepController = undefined;
            }
        }
    }
}
