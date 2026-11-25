import { type Clock, SystemClock } from '../common/clock.js';
import { isAbortError } from '../common/errors.js';
import {
    DEFAULT_PENDING_DESTINATIONS_LIMIT,
    type DomainEventsRepo,
    type PendingDomainEventDestination,
} from '../database/repos/domainEventsRepo.js';
import { RetryPolicy } from '../database/retryPolicy.js';
import type { TransactionManager } from '../database/transactionManager.js';
import type { ApplicationEvent } from '../events/applicationEvents.js';
import type { Logger } from '../logging/logger.js';
import type {
    DomainEventMaterializer,
    WakeableNotificationWorker,
} from '../notifications/notificationService.js';
import { DomainEventPayloadDeserializer } from './domainEventPayloadDeserializer.js';

export const DEFAULT_DOMAIN_EVENT_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_DOMAIN_EVENT_RETRY_MAX_ATTEMPTS = 5;
export const DEFAULT_DOMAIN_EVENT_RETRY_INITIAL_DELAY_MS = 1_000;
export const DEFAULT_DOMAIN_EVENT_RETRY_MAX_DELAY_MS = 3_600_000;

export function createDefaultDomainEventRetryPolicy(): RetryPolicy {
    return new RetryPolicy({
        maxAttempts: DEFAULT_DOMAIN_EVENT_RETRY_MAX_ATTEMPTS,
        initialDelayMs: DEFAULT_DOMAIN_EVENT_RETRY_INITIAL_DELAY_MS,
        maxDelayMs: DEFAULT_DOMAIN_EVENT_RETRY_MAX_DELAY_MS,
        backoffStrategy: 'exponential',
    });
}

export interface DomainEventDeserializer {
    deserialize(
        clanTag: string,
        eventType: string,
        payload: string,
        payloadVersion: number,
    ): ApplicationEvent;
}

export interface DomainEventWorkerOptions {
    readonly pollIntervalMs?: number;
    readonly retryPolicy?: RetryPolicy;
    readonly batchSize?: number;
    readonly clock?: Clock;
    readonly logger?: Logger;
}

export interface DomainEventWorkerDependencies extends DomainEventWorkerOptions {
    readonly domainEventsRepo: DomainEventsRepo;
    readonly transactionManager: TransactionManager;
    readonly deserializer?: DomainEventDeserializer;
    readonly materializer?: DomainEventMaterializer;
    readonly notificationService?: DomainEventMaterializer;
    readonly notificationWorker?: WakeableNotificationWorker;
}

function isDomainEventWorkerDependencies(
    arg: DomainEventsRepo | DomainEventWorkerDependencies,
): arg is DomainEventWorkerDependencies {
    return 'domainEventsRepo' in arg;
}

function validatePositiveFinite(name: string, value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`DomainEventWorker ${name} must be a positive finite number`);
    }
}

export class DomainEventWorker {
    private readonly domainEventsRepo: DomainEventsRepo;
    private readonly deserializer: DomainEventDeserializer;
    private readonly materializer: DomainEventMaterializer;
    private readonly notificationWorker?: WakeableNotificationWorker;
    private readonly transactionManager: TransactionManager;
    private readonly pollIntervalMs: number;
    private readonly retryPolicy: RetryPolicy;
    private readonly batchSize: number;
    private readonly clock: Clock;
    private readonly logger?: Logger;

    private stopRequested = false;
    private wakeRequested = true;
    private activeSleepController: AbortController | undefined;

    constructor(deps: DomainEventWorkerDependencies);
    constructor(
        domainEventsRepo: DomainEventsRepo,
        deserializer: DomainEventDeserializer,
        materializer: DomainEventMaterializer,
        notificationWorker: WakeableNotificationWorker | undefined,
        transactionManager: TransactionManager,
        options?: DomainEventWorkerOptions,
    );
    constructor(
        repoOrDeps: DomainEventsRepo | DomainEventWorkerDependencies,
        deserializer?: DomainEventDeserializer,
        materializer?: DomainEventMaterializer,
        notificationWorker?: WakeableNotificationWorker,
        transactionManager?: TransactionManager,
        options: DomainEventWorkerOptions = {},
    ) {
        let deps: DomainEventWorkerDependencies;
        if (isDomainEventWorkerDependencies(repoOrDeps)) {
            deps = repoOrDeps;
        } else {
            if (transactionManager === undefined) {
                throw new Error('DomainEventWorker requires a transactionManager dependency');
            }
            deps = {
                domainEventsRepo: repoOrDeps,
                ...(deserializer !== undefined ? { deserializer } : {}),
                ...(materializer !== undefined ? { materializer } : {}),
                ...(notificationWorker !== undefined ? { notificationWorker } : {}),
                transactionManager,
                ...options,
            };
        }

        const resolvedMaterializer = deps.materializer ?? deps.notificationService;
        if (resolvedMaterializer === undefined) {
            throw new Error(
                'DomainEventWorker requires a materializer (or notificationService) dependency',
            );
        }

        const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_DOMAIN_EVENT_POLL_INTERVAL_MS;
        const batchSize = deps.batchSize ?? DEFAULT_PENDING_DESTINATIONS_LIMIT;
        validatePositiveFinite('pollIntervalMs', pollIntervalMs);
        validatePositiveFinite('batchSize', batchSize);

        this.domainEventsRepo = deps.domainEventsRepo;
        this.deserializer = deps.deserializer ?? new DomainEventPayloadDeserializer();
        this.materializer = resolvedMaterializer;
        if (deps.notificationWorker !== undefined) {
            this.notificationWorker = deps.notificationWorker;
        }
        this.transactionManager = deps.transactionManager;
        this.pollIntervalMs = pollIntervalMs;
        this.retryPolicy = deps.retryPolicy ?? createDefaultDomainEventRetryPolicy();
        this.batchSize = batchSize;
        this.clock = deps.clock ?? new SystemClock();
        if (deps.logger !== undefined) {
            this.logger = deps.logger;
        }
    }

    requestStop(): void {
        this.stopRequested = true;
        this.activeSleepController?.abort();
    }

    isStopRequested(): boolean {
        return this.stopRequested;
    }

    notify(): void {
        this.wakeRequested = true;
        this.activeSleepController?.abort();
    }

    async run(signal?: AbortSignal): Promise<void> {
        while (!this.shouldStop(signal)) {
            const woke = await this.waitForWakeOrPoll(signal);
            if (!woke || this.shouldStop(signal)) {
                break;
            }

            try {
                this.processPending(signal);
            } catch (error: unknown) {
                if (isAbortError(error) || this.shouldStop(signal)) {
                    break;
                }
                this.logger?.error(
                    { err: error },
                    '[DomainEventWorker] Failed to process pending destinations',
                );
            }
        }
    }

    processPending(signal?: AbortSignal): void {
        if (this.shouldStop(signal)) {
            return;
        }

        const destinations = this.domainEventsRepo.getPendingDestinations(
            this.batchSize,
            this.clock.nowEpochSeconds(),
        );

        for (const destination of destinations) {
            if (this.shouldStop(signal)) {
                return;
            }

            try {
                const materialized = this.transactionManager.retryInTransaction(() => {
                    if (!this.domainEventsRepo.markMaterialized(destination.destinationId)) {
                        return false;
                    }

                    const deserialized = this.deserializer.deserialize(
                        destination.clanTag,
                        destination.eventType,
                        destination.payload,
                        destination.payloadVersion,
                    );

                    this.materializer.materialize(deserialized, destination);
                    return true;
                });

                if (materialized) {
                    this.notificationWorker?.notify();
                }
            } catch (error: unknown) {
                if (isAbortError(error) || this.shouldStop(signal)) {
                    return;
                }

                const errorMessage = error instanceof Error ? error.message : String(error);
                this.handleFailure(destination, errorMessage);

                if (this.shouldStop(signal)) {
                    return;
                }
            }

            if (this.shouldStop(signal)) {
                return;
            }
        }
    }

    nextAttemptAt(attempt: number): number {
        const delayMs = this.retryPolicy.delayForAttempt(attempt);
        const computedDelaySeconds = Math.floor((delayMs + 999) / 1_000);
        const delaySeconds = Math.max(1, computedDelaySeconds);

        return this.clock.nowEpochSeconds() + delaySeconds;
    }

    private handleFailure(destination: PendingDomainEventDestination, errorMessage: string): void {
        const nextAttempt = destination.attempts + 1;
        const scheduledAt = this.nextAttemptAt(nextAttempt);

        try {
            this.transactionManager.retryInTransaction(() => {
                this.domainEventsRepo.reschedule(
                    destination.destinationId,
                    scheduledAt,
                    errorMessage,
                );
            });

            if (nextAttempt >= this.retryPolicy.maxAttempts) {
                this.logger?.error(
                    {
                        destinationId: destination.destinationId,
                        attempts: nextAttempt,
                        threshold: this.retryPolicy.maxAttempts,
                        nextAttemptAt: scheduledAt,
                        error: errorMessage,
                    },
                    `[DomainEventWorker] Destination ${String(destination.destinationId)} reached the retry alert threshold; it remains pending and will continue retrying: ${errorMessage}`,
                );
            } else {
                this.logger?.warn(
                    {
                        destinationId: destination.destinationId,
                        attempt: nextAttempt,
                        nextAttempt: nextAttempt + 1,
                        nextAttemptAt: scheduledAt,
                        error: errorMessage,
                    },
                    `[DomainEventWorker] Destination ${String(destination.destinationId)} rescheduled for attempt ${String(nextAttempt + 1)}: ${errorMessage}`,
                );
            }
        } catch (rescheduleError: unknown) {
            this.logger?.error(
                {
                    err: rescheduleError,
                    destinationId: destination.destinationId,
                    originalError: errorMessage,
                },
                `[DomainEventWorker] Failed to reschedule destination ${String(destination.destinationId)} after error '${errorMessage}'`,
            );
        }
    }

    private shouldStop(signal?: AbortSignal): boolean {
        return this.stopRequested || (signal?.aborted ?? false);
    }

    private async waitForWakeOrPoll(signal?: AbortSignal): Promise<boolean> {
        if (this.shouldStop(signal)) {
            return false;
        }

        if (this.wakeRequested) {
            this.wakeRequested = false;
            return true;
        }

        const sleepController = new AbortController();
        this.activeSleepController = sleepController;

        const onExternalAbort = (): void => {
            sleepController.abort(signal?.reason);
        };
        signal?.addEventListener('abort', onExternalAbort, { once: true });

        try {
            await this.clock.sleep(this.pollIntervalMs, sleepController.signal);
        } catch (error: unknown) {
            if (this.shouldStop(signal)) {
                return false;
            }
            if (!isAbortError(error)) {
                throw error;
            }
        } finally {
            signal?.removeEventListener('abort', onExternalAbort);
            if (this.activeSleepController === sleepController) {
                this.activeSleepController = undefined;
            }
        }

        if (this.shouldStop(signal)) {
            return false;
        }

        this.wakeRequested = false;
        return true;
    }
}
