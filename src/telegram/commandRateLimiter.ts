import { SystemClock, type Clock } from '../common/clock.js';
import { ValidationError } from '../common/errors.js';

export const DEFAULT_COMMAND_RATE_LIMIT_MAX_REQUESTS = 5;
export const DEFAULT_COMMAND_RATE_LIMIT_WINDOW_MS = 60_000;

const STALE_SWEEP_KEY_THRESHOLD = 1_000;

export interface CommandRateLimiterOptions {
    readonly maxRequests?: number;
    readonly windowMs?: number;
    readonly clock?: Clock;
}

export interface CommandRateLimitDecision {
    readonly allowed: boolean;
    readonly remaining: number;
    readonly retryAfterMs: number;
}

/**
 * In-memory sliding-window rate limiter keyed by user (or composite key).
 * Reusable across Telegram management commands (/link, /unlink) and future read commands.
 */
export class CommandRateLimiter {
    readonly maxRequests: number;
    readonly windowMs: number;
    private readonly clock: Clock;
    private readonly timestampsByKey = new Map<string, number[]>();

    constructor(options?: CommandRateLimiterOptions) {
        const maxRequests = options?.maxRequests ?? DEFAULT_COMMAND_RATE_LIMIT_MAX_REQUESTS;
        const windowMs = options?.windowMs ?? DEFAULT_COMMAND_RATE_LIMIT_WINDOW_MS;

        if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) {
            throw new ValidationError(
                `CommandRateLimiter maxRequests must be a positive integer, got ${String(maxRequests)}`,
                { context: { maxRequests } },
            );
        }

        if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
            throw new ValidationError(
                `CommandRateLimiter windowMs must be a positive integer, got ${String(windowMs)}`,
                { context: { windowMs } },
            );
        }

        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.clock = options?.clock ?? new SystemClock();
    }

    consume(key: string | number): CommandRateLimitDecision {
        const nowMs = this.clock.nowMs();
        const cutoffMs = nowMs - this.windowMs;
        const normalizedKey = String(key);

        if (this.timestampsByKey.size >= STALE_SWEEP_KEY_THRESHOLD) {
            this.pruneStaleKeys(cutoffMs);
        }

        const existing = this.timestampsByKey.get(normalizedKey);
        const active =
            existing !== undefined ? existing.filter((timestamp) => timestamp > cutoffMs) : [];

        if (active.length >= this.maxRequests) {
            this.timestampsByKey.set(normalizedKey, active);
            const oldestActive = active[0] ?? nowMs;
            const retryAfterMs = Math.max(0, oldestActive + this.windowMs - nowMs);
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs,
            };
        }

        active.push(nowMs);
        this.timestampsByKey.set(normalizedKey, active);
        return {
            allowed: true,
            remaining: this.maxRequests - active.length,
            retryAfterMs: 0,
        };
    }

    reset(key?: string | number): void {
        if (key === undefined) {
            this.timestampsByKey.clear();
            return;
        }
        this.timestampsByKey.delete(String(key));
    }

    getTrackedKeyCount(): number {
        return this.timestampsByKey.size;
    }

    private pruneStaleKeys(cutoffMs: number): void {
        for (const [key, timestamps] of this.timestampsByKey) {
            const latest = timestamps[timestamps.length - 1];
            if (latest === undefined || latest <= cutoffMs) {
                this.timestampsByKey.delete(key);
            }
        }
    }
}
