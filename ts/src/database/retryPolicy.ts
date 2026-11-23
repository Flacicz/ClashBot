export type BackoffStrategy = 'linear' | 'exponential';

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_INITIAL_DELAY_MS = 100;
export const DEFAULT_MAX_DELAY_MS = 3_600_000;

export interface RetryPolicyOptions {
    readonly maxAttempts?: number;
    readonly initialDelayMs?: number;
    readonly maxDelayMs?: number;
    readonly backoffStrategy?: BackoffStrategy;
}

export class RetryPolicy {
    readonly maxAttempts: number;
    readonly initialDelayMs: number;
    readonly maxDelayMs: number;
    readonly backoffStrategy: BackoffStrategy;

    constructor(options: RetryPolicyOptions = {}) {
        const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
        const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
        const backoffStrategy = options.backoffStrategy ?? 'linear';

        if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
            throw new RangeError('RetryPolicy maxAttempts must be a positive integer');
        }
        if (!Number.isFinite(initialDelayMs) || initialDelayMs < 0) {
            throw new RangeError('RetryPolicy initialDelayMs must not be negative');
        }
        if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0) {
            throw new RangeError('RetryPolicy maxDelayMs must not be negative');
        }
        if (maxDelayMs < initialDelayMs) {
            throw new RangeError('RetryPolicy maxDelayMs must not be less than initialDelayMs');
        }

        this.maxAttempts = maxAttempts;
        this.initialDelayMs = initialDelayMs;
        this.maxDelayMs = maxDelayMs;
        this.backoffStrategy = backoffStrategy;
    }

    delayForAttempt(attempt: number): number {
        if (attempt <= 0 || this.initialDelayMs === 0) {
            return 0;
        }

        if (this.backoffStrategy === 'linear') {
            return Math.min(this.maxDelayMs, this.initialDelayMs * attempt);
        }

        let delay = this.initialDelayMs;
        for (let currentAttempt = 1; currentAttempt < attempt; currentAttempt += 1) {
            if (delay >= this.maxDelayMs || delay > this.maxDelayMs / 2) {
                return this.maxDelayMs;
            }
            delay *= 2;
        }

        return delay;
    }
}
