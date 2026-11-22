import { describe, expect, it } from 'vitest';

import { extractApiTime, parseApiTimeToUnix } from '../../src/api/timeParser.js';

describe('extractApiTime', () => {
    it('strips milliseconds from standard CoC API timestamps', () => {
        expect(extractApiTime('20260820T084359.000Z')).toBe('20260820T084359');
        expect(extractApiTime('20260820T084359.123Z')).toBe('20260820T084359');
    });

    it('preserves timestamps without fractional seconds', () => {
        expect(extractApiTime('20240101T000000Z')).toBe('20240101T000000Z');
        expect(extractApiTime('20240101T000000')).toBe('20240101T000000');
    });

    it('returns empty string for missing, empty, or sentinel API time', () => {
        expect(extractApiTime(undefined)).toBe('');
        expect(extractApiTime('')).toBe('');
        expect(extractApiTime('00000000T00000')).toBe('');
    });
});

describe('parseApiTimeToUnix', () => {
    it('parses CoC API timestamps with and without milliseconds or Z suffix', () => {
        expect(parseApiTimeToUnix('20240101T000000.000Z')).toBe(1704067200);
        expect(parseApiTimeToUnix('20240101T000000.123Z')).toBe(1704067200);
        expect(parseApiTimeToUnix('20240101T000000Z')).toBe(1704067200);
        expect(parseApiTimeToUnix('20240101T000000')).toBe(1704067200);
    });

    it('accepts valid leap day timestamps', () => {
        expect(parseApiTimeToUnix('20240229T120000Z')).toBe(1709208000);
    });

    it('returns 0 for empty, malformed, or out-of-range timestamps', () => {
        expect(parseApiTimeToUnix('')).toBe(0);
        expect(parseApiTimeToUnix('invalid')).toBe(0);
        expect(parseApiTimeToUnix('00000000T00000')).toBe(0);
        expect(parseApiTimeToUnix('20240101T000000.ABCZ')).toBe(0);
        expect(parseApiTimeToUnix('20240101T000000.Z')).toBe(0);
        expect(parseApiTimeToUnix('20240101T000000ABC')).toBe(0);
        expect(parseApiTimeToUnix('20240230T120000Z')).toBe(0);
        expect(parseApiTimeToUnix('20230229T120000Z')).toBe(0);
        expect(parseApiTimeToUnix('20240101T240000Z')).toBe(0);
        expect(parseApiTimeToUnix('20241301T000000Z')).toBe(0);
    });
});
