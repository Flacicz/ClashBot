import { type Clock, SystemClock } from '../common/clock.js';
import { AbortError, isAbortError } from '../common/errors.js';
import {
    DEFAULT_PENDING_NOTIFICATIONS_LIMIT,
    type NotificationRepo,
    type PendingNotification,
} from '../database/repos/notificationRepo.js';
import { RetryPolicy } from '../database/retryPolicy.js';
import type { Logger } from '../logging/logger.js';
import type { WakeableNotificationWorker } from './notificationService.js';
import { classifyTelegramError, type TelegramGateway } from './telegramGateway.js';

export const DEFAULT_NOTIFICATION_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_TELEGRAM_RETRY_MAX_ATTEMPTS = 4;
export const DEFAULT_TELEGRAM_RETRY_INITIAL_DELAY_MS = 500;
export const DEFAULT_TELEGRAM_RETRY_MAX_DELAY_MS = 8_000;

export function createDefaultTelegramRetryPolicy(): RetryPolicy {
    return new RetryPolicy({
        maxAttempts: DEFAULT_TELEGRAM_RETRY_MAX_ATTEMPTS,
        initialDelayMs: DEFAULT_TELEGRAM_RETRY_INITIAL_DELAY_MS,
        maxDelayMs: DEFAULT_TELEGRAM_RETRY_MAX_DELAY_MS,
        backoffStrategy: 'exponential',
    });
}

export interface NotificationWorkerOptions {
    readonly pollIntervalMs?: number;
    readonly retryPolicy?: RetryPolicy;
    readonly batchSize?: number;
    readonly clock?: Clock;
    readonly logger?: Logger;
}

export interface NotificationWorkerDependencies extends NotificationWorkerOptions {
    readonly notificationRepo: NotificationRepo;
    readonly telegramGateway: TelegramGateway;
}

function isNotificationWorkerDependencies(
    arg: NotificationRepo | NotificationWorkerDependencies,
): arg is NotificationWorkerDependencies {
    return 'notificationRepo' in arg;
}

function validatePositiveFinite(name: string, value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`NotificationWorker ${name} must be a positive finite number`);
    }
}

export class NotificationWorker implements WakeableNotificationWorker {
    private readonly notificationRepo: NotificationRepo;
    private readonly telegramGateway: TelegramGateway;
    private readonly pollIntervalMs: number;
    private readonly retryPolicy: RetryPolicy;
    private readonly batchSize: number;
    private readonly clock: Clock;
    private readonly logger?: Logger;

    private stopRequested = false;
    private wakeRequested = true;
    private readonly stopController = new AbortController();
    private activeSleepController: AbortController | undefined;

    constructor(deps: NotificationWorkerDependencies);
    constructor(
        notificationRepo: NotificationRepo,
        telegramGateway: TelegramGateway,
        options?: NotificationWorkerOptions,
    );
    constructor(
        repoOrDeps: NotificationRepo | NotificationWorkerDependencies,
        telegramGateway?: TelegramGateway,
        options: NotificationWorkerOptions = {},
    ) {
        let deps: NotificationWorkerDependencies;
        if (isNotificationWorkerDependencies(repoOrDeps)) {
            deps = repoOrDeps;
        } else {
            if (telegramGateway === undefined) {
                throw new Error('NotificationWorker requires a telegramGateway dependency');
            }
            deps = {
                notificationRepo: repoOrDeps,
                telegramGateway,
                ...options,
            };
        }

        const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_NOTIFICATION_POLL_INTERVAL_MS;
        const batchSize = deps.batchSize ?? DEFAULT_PENDING_NOTIFICATIONS_LIMIT;
        validatePositiveFinite('pollIntervalMs', pollIntervalMs);
        validatePositiveFinite('batchSize', batchSize);

        this.notificationRepo = deps.notificationRepo;
        this.telegramGateway = deps.telegramGateway;
        this.pollIntervalMs = pollIntervalMs;
        this.retryPolicy = deps.retryPolicy ?? createDefaultTelegramRetryPolicy();
        this.batchSize = batchSize;
        this.clock = deps.clock ?? new SystemClock();
        if (deps.logger !== undefined) {
            this.logger = deps.logger;
        }
    }

    requestStop(): void {
        this.stopRequested = true;
        if (!this.stopController.signal.aborted) {
            this.stopController.abort(new AbortError('NotificationWorker stop requested'));
        }
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
                await this.processPending(signal);
            } catch (error: unknown) {
                if (isAbortError(error) || this.shouldStop(signal)) {
                    break;
                }
                this.logger?.error(
                    { err: error },
                    '[NotificationWorker] Failed to process pending notifications',
                );
            }
        }
    }

    async processPending(signal?: AbortSignal): Promise<void> {
        if (this.shouldStop(signal)) {
            return;
        }

        let remaining = this.batchSize;

        while (remaining > 0 && !this.shouldStop(signal)) {
            const notifications = this.notificationRepo.getPending(
                remaining,
                this.clock.nowEpochSeconds(),
            );

            if (notifications.length === 0) {
                return;
            }

            let unlockedNextPart = false;

            for (const notification of notifications) {
                if (this.shouldStop(signal)) {
                    return;
                }

                if (!this.notificationRepo.isPending(notification.id)) {
                    continue;
                }

                remaining -= 1;

                const { signal: requestSignal, cleanup } = this.createRequestSignal(signal);

                try {
                    await this.telegramGateway.sendMessage(
                        notification.chatId,
                        notification.messageText,
                        notification.messageThreadId,
                        requestSignal,
                    );
                } catch (error: unknown) {
                    const classification = classifyTelegramError(error, requestSignal);
                    if (classification.kind === 'aborted' || this.shouldStop(signal)) {
                        return;
                    }

                    this.handleFailure(
                        notification,
                        classification.message,
                        classification.retryable,
                        classification.retryAfterSeconds,
                    );

                    if (this.shouldStop(signal)) {
                        return;
                    }
                    continue;
                } finally {
                    cleanup();
                }

                let markedAsSent = false;
                try {
                    markedAsSent = this.notificationRepo.markAsSent(notification.id);
                } catch (error: unknown) {
                    this.logger?.error(
                        {
                            err: error,
                            notificationId: notification.id,
                        },
                        `[NotificationWorker] Failed to mark notification ${String(notification.id)} as sent`,
                    );
                }

                if (this.shouldStop(signal)) {
                    return;
                }

                if (markedAsSent && notification.partIndex < notification.partCount) {
                    unlockedNextPart = true;
                    if (remaining === 0) {
                        this.wakeRequested = true;
                    }
                    break;
                }
            }

            if (!unlockedNextPart) {
                return;
            }
        }
    }

    nextAttemptAt(attempt: number, retryAfterSeconds?: number): number {
        let delayMs = this.retryPolicy.delayForAttempt(attempt);

        if (
            retryAfterSeconds !== undefined &&
            Number.isFinite(retryAfterSeconds) &&
            retryAfterSeconds > 0
        ) {
            const retryAfterDelayMs = Math.ceil(retryAfterSeconds) * 1_000;
            delayMs = Math.max(delayMs, retryAfterDelayMs);
        }

        const computedDelaySeconds = Math.floor((delayMs + 999) / 1_000);
        const delaySeconds = Math.max(1, computedDelaySeconds);

        return this.clock.nowEpochSeconds() + delaySeconds;
    }

    private handleFailure(
        notification: PendingNotification,
        errorMessage: string,
        retryable: boolean,
        retryAfterSeconds?: number,
    ): void {
        const nextAttempt = notification.attempts + 1;
        const attemptsExhausted = nextAttempt >= this.retryPolicy.maxAttempts;

        try {
            if (!retryable || attemptsExhausted) {
                this.notificationRepo.markAsFailed(notification.id, errorMessage);
                this.logger?.error(
                    {
                        notificationId: notification.id,
                        attempts: nextAttempt,
                        retryable,
                        error: errorMessage,
                    },
                    `[NotificationWorker] Notification ${String(notification.id)} permanently failed: ${errorMessage}`,
                );
                return;
            }

            const scheduledAt = this.nextAttemptAt(nextAttempt, retryAfterSeconds);
            this.notificationRepo.reschedule(notification.id, scheduledAt, errorMessage);
            this.logger?.warn(
                {
                    notificationId: notification.id,
                    attempt: nextAttempt,
                    nextAttemptAt: scheduledAt,
                    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
                    error: errorMessage,
                },
                `[NotificationWorker] Notification ${String(notification.id)} rescheduled after attempt ${String(nextAttempt)}: ${errorMessage}`,
            );
        } catch (databaseError: unknown) {
            this.logger?.error(
                {
                    err: databaseError,
                    notificationId: notification.id,
                    deliveryError: errorMessage,
                },
                `[NotificationWorker] Failed to update notification ${String(notification.id)} after delivery error`,
            );
        }
    }

    private shouldStop(signal?: AbortSignal): boolean {
        return this.stopRequested || (signal?.aborted ?? false);
    }

    private createRequestSignal(externalSignal?: AbortSignal): {
        readonly signal: AbortSignal;
        readonly cleanup: () => void;
    } {
        if (externalSignal === undefined) {
            return {
                signal: this.stopController.signal,
                cleanup: () => undefined,
            };
        }

        const controller = new AbortController();
        const abortFromStop = (): void => {
            controller.abort(this.stopController.signal.reason);
        };
        const abortFromExternal = (): void => {
            controller.abort(externalSignal.reason);
        };

        if (this.stopController.signal.aborted) {
            abortFromStop();
        } else if (externalSignal.aborted) {
            abortFromExternal();
        } else {
            this.stopController.signal.addEventListener('abort', abortFromStop, { once: true });
            externalSignal.addEventListener('abort', abortFromExternal, { once: true });
        }

        return {
            signal: controller.signal,
            cleanup: () => {
                this.stopController.signal.removeEventListener('abort', abortFromStop);
                externalSignal.removeEventListener('abort', abortFromExternal);
            },
        };
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
