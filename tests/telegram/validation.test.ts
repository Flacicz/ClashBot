import { describe, expect, it } from 'vitest';

import {
    MAX_TOWN_HALL,
    MIN_TOWN_HALL,
    isSupportedTelegramChatType,
    parseTownHall,
    resolveDefaultPreset,
} from '../../src/telegram/validation.js';

describe('parseTownHall', () => {
    it('accepts town hall range boundaries and all supported values (TH7-TH18)', () => {
        expect(MIN_TOWN_HALL).toBe(7);
        expect(MAX_TOWN_HALL).toBe(18);
        expect(parseTownHall('7')).toBe(7);
        expect(parseTownHall('18')).toBe(18);

        for (let th = MIN_TOWN_HALL; th <= MAX_TOWN_HALL; th += 1) {
            expect(parseTownHall(String(th))).toBe(th);
        }
    });

    it('rejects empty input', () => {
        expect(parseTownHall('')).toBeNull();
    });

    it('rejects non-numeric, padded, signed, and fractional values', () => {
        const invalidValues = ['abc', '7x', 'x7', ' 7', '7 ', '+7', '7.0', '10.5', '1e1'];

        for (const value of invalidValues) {
            expect(parseTownHall(value), `Input: ${value}`).toBeNull();
        }
    });

    it('rejects values outside the supported TH7-TH18 range', () => {
        const invalidValues = ['-1', '0', '6', '19', '100'];

        for (const value of invalidValues) {
            expect(parseTownHall(value), `Input: ${value}`).toBeNull();
        }
    });

    it('is idempotent on repeated calls', () => {
        expect(parseTownHall('12')).toBe(12);
        expect(parseTownHall('12')).toBe(12);
        expect(parseTownHall('6')).toBeNull();
        expect(parseTownHall('6')).toBeNull();
    });
});

describe('resolveDefaultPreset & isSupportedTelegramChatType', () => {
    it('resolves private chat to management preset', () => {
        expect(resolveDefaultPreset('private')).toBe('management');
        expect(isSupportedTelegramChatType('private')).toBe(true);
    });

    it('resolves group and supergroup chats to players preset', () => {
        expect(resolveDefaultPreset('group')).toBe('players');
        expect(resolveDefaultPreset('supergroup')).toBe('players');
        expect(isSupportedTelegramChatType('group')).toBe(true);
        expect(isSupportedTelegramChatType('supergroup')).toBe(true);
    });

    it('rejects unsupported chat types', () => {
        expect(resolveDefaultPreset('channel')).toBeNull();
        expect(resolveDefaultPreset('')).toBeNull();
        expect(resolveDefaultPreset('PRIVATE')).toBeNull();
        expect(isSupportedTelegramChatType('channel')).toBe(false);
        expect(isSupportedTelegramChatType('')).toBe(false);
        expect(isSupportedTelegramChatType('PRIVATE')).toBe(false);
    });
});
