import { describe, expect, it } from 'vitest';

import { FakeClock } from '../../src/common/clock.js';
import { ValidationError } from '../../src/common/errors.js';
import {
    CommandRateLimiter,
    DEFAULT_COMMAND_RATE_LIMIT_MAX_REQUESTS,
    DEFAULT_COMMAND_RATE_LIMIT_WINDOW_MS,
} from '../../src/telegram/index.js';

describe('CommandRateLimiter', () => {
    it('allows up to 5 commands per minute by default and blocks the 6th until the window resets', () => {
        const clock = new FakeClock(1_000_000);
        const limiter = new CommandRateLimiter({ clock });

        expect(limiter.maxRequests).toBe(DEFAULT_COMMAND_RATE_LIMIT_MAX_REQUESTS);
        expect(limiter.windowMs).toBe(DEFAULT_COMMAND_RATE_LIMIT_WINDOW_MS);

        for (let i = 1; i <= 5; i += 1) {
            const decision = limiter.consume(42);
            expect(decision).toEqual({
                allowed: true,
                remaining: 5 - i,
                retryAfterMs: 0,
            });
        }

        const blocked = limiter.consume(42);
        expect(blocked).toEqual({
            allowed: false,
            remaining: 0,
            retryAfterMs: 60_000,
        });

        // Rejected attempts must not extend the lockout window.
        clock.advance(59_999);
        expect(limiter.consume(42)).toEqual({
            allowed: false,
            remaining: 0,
            retryAfterMs: 1,
        });

        clock.advance(1);
        expect(limiter.consume(42)).toEqual({
            allowed: true,
            remaining: 4,
            retryAfterMs: 0,
        });
    });

    it('uses a sliding window for staggered requests', () => {
        const clock = new FakeClock(0);
        const limiter = new CommandRateLimiter({
            maxRequests: 3,
            windowMs: 60_000,
            clock,
        });

        expect(limiter.consume('user:1').allowed).toBe(true); // t = 0
        clock.advance(10_000);
        expect(limiter.consume('user:1').allowed).toBe(true); // t = 10s
        clock.advance(10_000);
        expect(limiter.consume('user:1').allowed).toBe(true); // t = 20s

        clock.advance(5_000); // t = 25s
        expect(limiter.consume('user:1')).toEqual({
            allowed: false,
            remaining: 0,
            retryAfterMs: 35_000,
        });

        // At t = 60s, the t = 0 slot expires; only 1 new slot opens.
        clock.advance(35_000);
        expect(limiter.consume('user:1')).toEqual({
            allowed: true,
            remaining: 0,
            retryAfterMs: 0,
        });
        expect(limiter.consume('user:1')).toEqual({
            allowed: false,
            remaining: 0,
            retryAfterMs: 10_000,
        });

        // At t = 70s, the t = 10s slot expires.
        clock.advance(10_000);
        expect(limiter.consume('user:1').allowed).toBe(true);
    });

    it('isolates limits per key and supports explicit reset', () => {
        const clock = new FakeClock(5_000);
        const limiter = new CommandRateLimiter({ maxRequests: 2, windowMs: 60_000, clock });

        expect(limiter.consume(100).allowed).toBe(true);
        expect(limiter.consume(100).allowed).toBe(true);
        expect(limiter.consume(100).allowed).toBe(false);

        // Different user key has an independent bucket.
        expect(limiter.consume(200).allowed).toBe(true);
        expect(limiter.consume('read:100').allowed).toBe(true);

        limiter.reset(100);
        expect(limiter.consume(100).allowed).toBe(true);

        limiter.reset();
        expect(limiter.getTrackedKeyCount()).toBe(0);
    });

    it('prunes stale keys when tracked keys exceed the sweep threshold', () => {
        const clock = new FakeClock(0);
        const limiter = new CommandRateLimiter({ maxRequests: 5, windowMs: 60_000, clock });

        for (let userId = 1; userId <= 1_000; userId += 1) {
            expect(limiter.consume(userId).allowed).toBe(true);
        }
        expect(limiter.getTrackedKeyCount()).toBe(1_000);

        clock.advance(60_000);
        expect(limiter.consume(999_999).allowed).toBe(true);
        expect(limiter.getTrackedKeyCount()).toBe(1);
    });

    it('throws ValidationError on non-positive or non-integer configuration', () => {
        expect(() => new CommandRateLimiter({ maxRequests: 0 })).toThrow(ValidationError);
        expect(() => new CommandRateLimiter({ maxRequests: -2 })).toThrow(ValidationError);
        expect(() => new CommandRateLimiter({ maxRequests: 1.5 })).toThrow(ValidationError);
        expect(() => new CommandRateLimiter({ windowMs: 0 })).toThrow(ValidationError);
        expect(() => new CommandRateLimiter({ windowMs: -1_000 })).toThrow(ValidationError);
        expect(() => new CommandRateLimiter({ windowMs: 12.5 })).toThrow(ValidationError);
    });
});
