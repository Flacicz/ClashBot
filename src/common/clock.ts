import { AbortError } from './errors.js';

export interface Clock {
    now(): Date;
    nowMs(): number;
    nowEpochSeconds(): number;
    sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

function createAbortErrorFromSignal(signal: AbortSignal): AbortError {
    const reason: unknown = signal.reason;
    if (reason instanceof AbortError) {
        return reason;
    }
    return new AbortError('Operation was aborted', {
        cause: reason,
    });
}

export class SystemClock implements Clock {
    now(): Date {
        return new Date();
    }

    nowMs(): number {
        return Date.now();
    }

    nowEpochSeconds(): number {
        return Math.floor(Date.now() / 1000);
    }

    sleep(ms: number, signal?: AbortSignal): Promise<void> {
        if (signal?.aborted) {
            return Promise.reject(createAbortErrorFromSignal(signal));
        }
        if (ms <= 0) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve, reject) => {
            if (signal === undefined) {
                setTimeout(resolve, ms);
                return;
            }

            const onAbort = (): void => {
                clearTimeout(timer);
                reject(createAbortErrorFromSignal(signal));
            };

            const timer = setTimeout(() => {
                signal.removeEventListener('abort', onAbort);
                resolve();
            }, ms);

            signal.addEventListener('abort', onAbort, { once: true });
        });
    }
}

interface PendingWaiter {
    readonly wakeAtMs: number;
    readonly resolve: () => void;
    readonly cleanup: () => void;
}

export class FakeClock implements Clock {
    private currentMs: number;
    private readonly waiters = new Set<PendingWaiter>();

    constructor(initialMs = 0) {
        this.currentMs = initialMs;
    }

    now(): Date {
        return new Date(this.currentMs);
    }

    nowMs(): number {
        return this.currentMs;
    }

    nowEpochSeconds(): number {
        return Math.floor(this.currentMs / 1000);
    }

    pendingSleepCount(): number {
        return this.waiters.size;
    }

    setNow(ms: number): void {
        this.currentMs = ms;
        this.flushReadyWaiters();
    }

    advance(ms: number): void {
        if (ms < 0) {
            throw new RangeError(`Cannot advance FakeClock by negative duration: ${String(ms)}`);
        }
        this.currentMs += ms;
        this.flushReadyWaiters();
    }

    sleep(ms: number, signal?: AbortSignal): Promise<void> {
        if (signal?.aborted) {
            return Promise.reject(createAbortErrorFromSignal(signal));
        }
        if (ms <= 0) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve, reject) => {
            const wakeAtMs = this.currentMs + ms;

            if (signal === undefined) {
                this.waiters.add({
                    wakeAtMs,
                    resolve,
                    cleanup: () => undefined,
                });
                return;
            }

            const onAbort = (): void => {
                this.waiters.delete(waiter);
                reject(createAbortErrorFromSignal(signal));
            };

            const waiter: PendingWaiter = {
                wakeAtMs,
                resolve,
                cleanup: () => {
                    signal.removeEventListener('abort', onAbort);
                },
            };

            this.waiters.add(waiter);
            signal.addEventListener('abort', onAbort, { once: true });
        });
    }

    private flushReadyWaiters(): void {
        const ready: PendingWaiter[] = [];
        for (const waiter of this.waiters) {
            if (waiter.wakeAtMs <= this.currentMs) {
                ready.push(waiter);
            }
        }

        ready.sort((a, b) => a.wakeAtMs - b.wakeAtMs);
        for (const waiter of ready) {
            if (this.waiters.delete(waiter)) {
                waiter.cleanup();
                waiter.resolve();
            }
        }
    }
}
