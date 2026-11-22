import { describe, expect, it } from 'vitest';

import { FakeClock, SystemClock } from '../../src/common/clock.js';
import { AbortError, isAbortError } from '../../src/common/errors.js';

describe('SystemClock', () => {
    it('returns current time as Date, ms, and epoch seconds', () => {
        const clock = new SystemClock();
        const before = Date.now();
        const nowMs = clock.nowMs();
        const nowDate = clock.now();
        const nowSec = clock.nowEpochSeconds();
        const after = Date.now();

        expect(nowMs).toBeGreaterThanOrEqual(before);
        expect(nowMs).toBeLessThanOrEqual(after);
        expect(nowDate.getTime()).toBeGreaterThanOrEqual(before);
        expect(nowDate.getTime()).toBeLessThanOrEqual(after);
        expect(nowSec).toBe(Math.floor(nowMs / 1000));
    });

    it('resolves sleep after the requested duration', async () => {
        const clock = new SystemClock();
        await expect(clock.sleep(10)).resolves.toBeUndefined();
    });

    it('resolves immediately for non-positive sleep duration when not aborted', async () => {
        const clock = new SystemClock();
        await expect(clock.sleep(0)).resolves.toBeUndefined();
        await expect(clock.sleep(-5)).resolves.toBeUndefined();
    });

    it('rejects immediately if AbortSignal is already aborted', async () => {
        const clock = new SystemClock();
        const controller = new AbortController();
        controller.abort(new Error('shutdown'));

        const err = await clock.sleep(10_000, controller.signal).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AbortError);
        expect(isAbortError(err)).toBe(true);
    });

    it('cancels pending sleep promptly when AbortSignal aborts', async () => {
        const clock = new SystemClock();
        const controller = new AbortController();

        const start = Date.now();
        const sleepPromise = clock.sleep(10_000, controller.signal);
        setTimeout(() => {
            controller.abort();
        }, 15);

        await expect(sleepPromise).rejects.toBeInstanceOf(AbortError);
        expect(Date.now() - start).toBeLessThan(1_000);
    });
});

describe('FakeClock', () => {
    it('advances deterministic time and resolves waiters in order', async () => {
        const clock = new FakeClock(1_700_000_000_000);
        expect(clock.nowMs()).toBe(1_700_000_000_000);
        expect(clock.nowEpochSeconds()).toBe(1_700_000_000);
        expect(clock.now().getTime()).toBe(1_700_000_000_000);

        const events: string[] = [];
        const first = clock.sleep(500).then(() => {
            events.push('first');
        });
        const second = clock.sleep(1_000).then(() => {
            events.push('second');
        });

        expect(clock.pendingSleepCount()).toBe(2);

        clock.advance(499);
        await Promise.resolve();
        expect(events).toEqual([]);

        clock.advance(1);
        await first;
        expect(events).toEqual(['first']);
        expect(clock.pendingSleepCount()).toBe(1);

        clock.advance(500);
        await second;
        expect(events).toEqual(['first', 'second']);
        expect(clock.pendingSleepCount()).toBe(0);
    });

    it('rejects FakeClock.sleep immediately on pre-aborted or mid-sleep AbortSignal', async () => {
        const clock = new FakeClock(0);

        const alreadyAborted = new AbortController();
        alreadyAborted.abort();
        await expect(clock.sleep(100, alreadyAborted.signal)).rejects.toBeInstanceOf(AbortError);
        expect(clock.pendingSleepCount()).toBe(0);

        const controller = new AbortController();
        const pending = clock.sleep(5_000, controller.signal);
        expect(clock.pendingSleepCount()).toBe(1);

        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(AbortError);
        expect(clock.pendingSleepCount()).toBe(0);
    });

    it('rejects negative advance values', () => {
        const clock = new FakeClock(1_000);
        expect(() => {
            clock.advance(-1);
        }).toThrow();
    });
});
