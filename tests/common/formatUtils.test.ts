import { describe, expect, it } from 'vitest';

import {
    escapeHtml,
    formatUnixToDate,
    formatUnixToDateTime,
    formatUtcOffset,
    removeTrailingNewlines,
    ValidationError,
} from '../../src/common/index.js';

describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
        expect(escapeHtml('A&B <player>')).toBe('A&amp;B &lt;player&gt;');
    });

    it('escapes decorative CJK angle brackets matching C++ StringUtils', () => {
        expect(escapeHtml('《ТУРАН》')).toBe('&lt;ТУРАН&gt;');
    });

    it('escapes repeated special characters in a single pass', () => {
        expect(escapeHtml('&&<<>>《》')).toBe('&amp;&amp;&lt;&lt;&gt;&gt;&lt;&gt;');
    });

    it('handles empty string and leaves regular text and quotes unchanged', () => {
        expect(escapeHtml('')).toBe('');
        expect(escapeHtml('Flacicz "clan" #2J8PJ9VLG')).toBe('Flacicz "clan" #2J8PJ9VLG');
    });
});

describe('removeTrailingNewlines', () => {
    it('removes all trailing newlines', () => {
        expect(removeTrailingNewlines('Отчет\n\n\n')).toBe('Отчет');
    });

    it('preserves internal newlines', () => {
        expect(removeTrailingNewlines('Первая строка\n\nВторая строка\n')).toBe(
            'Первая строка\n\nВторая строка',
        );
    });

    it('handles empty and already trimmed strings', () => {
        expect(removeTrailingNewlines('')).toBe('');
        expect(removeTrailingNewlines('Отчет')).toBe('Отчет');
    });
});

describe('formatUtcOffset', () => {
    it('formats negative, zero, and positive integer UTC offsets without country labels', () => {
        expect(formatUtcOffset(-12)).toBe('UTC-12');
        expect(formatUtcOffset(-5)).toBe('UTC-5');
        expect(formatUtcOffset(-0)).toBe('UTC+0');
        expect(formatUtcOffset(0)).toBe('UTC+0');
        expect(formatUtcOffset(3)).toBe('UTC+3');
        expect(formatUtcOffset(14)).toBe('UTC+14');
    });

    it('throws ValidationError for out-of-range or non-integer UTC offsets', () => {
        for (const invalidOffset of [-13, 15, 3.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => formatUtcOffset(invalidOffset)).toThrow(ValidationError);
        }
    });
});

describe('formatUnixToDateTime', () => {
    it('formats Unix timestamp with default UTC+3 offset and explicit offsets (UTC-5, UTC+0, UTC+3, UTC+14)', () => {
        // 2024-01-01 00:00:00 UTC
        expect(formatUnixToDateTime(1704067200)).toBe('01.01.2024 03:00 (UTC+3)');
        expect(formatUnixToDateTime(1704067200, -5)).toBe('31.12.2023 19:00 (UTC-5)');
        expect(formatUnixToDateTime(1704067200, 0)).toBe('01.01.2024 00:00 (UTC+0)');
        expect(formatUnixToDateTime(1704067200, 3)).toBe('01.01.2024 03:00 (UTC+3)');
        expect(formatUnixToDateTime(1704067200, 14)).toBe('01.01.2024 14:00 (UTC+14)');
    });

    it('handles midnight rollover into next day and leap day across offsets', () => {
        // 2024-01-01 22:00:00 UTC
        expect(formatUnixToDateTime(1704146400)).toBe('02.01.2024 01:00 (UTC+3)');
        expect(formatUnixToDateTime(1704146400, -5)).toBe('01.01.2024 17:00 (UTC-5)');
        expect(formatUnixToDateTime(1704146400, 14)).toBe('02.01.2024 12:00 (UTC+14)');
        // 2024-02-29 12:00:00 UTC
        expect(formatUnixToDateTime(1709208000)).toBe('29.02.2024 15:00 (UTC+3)');
        expect(formatUnixToDateTime(1709208000, 14)).toBe('01.03.2024 02:00 (UTC+14)');
    });

    it('returns неизвестно for zero, negative, and non-finite timestamps regardless of offset', () => {
        for (const offset of [-5, 0, 3, 14]) {
            expect(formatUnixToDateTime(0, offset)).toBe('неизвестно');
            expect(formatUnixToDateTime(-1, offset)).toBe('неизвестно');
            expect(formatUnixToDateTime(Number.NaN, offset)).toBe('неизвестно');
            expect(formatUnixToDateTime(Number.POSITIVE_INFINITY, offset)).toBe('неизвестно');
        }
    });

    it('throws ValidationError for invalid timezone offsets', () => {
        expect(() => formatUnixToDateTime(1704067200, -13)).toThrow(ValidationError);
        expect(() => formatUnixToDateTime(1704067200, 15)).toThrow(ValidationError);
        expect(() => formatUnixToDateTime(0, 1.5)).toThrow(ValidationError);
    });
});

describe('formatUnixToDate', () => {
    it('formats Unix timestamp as DD.MM.YYYY (UTC+N) across negative, zero, and positive offsets', () => {
        // 2024-01-01 00:00:00 UTC -> previous day in UTC-5
        expect(formatUnixToDate(1704067200)).toBe('01.01.2024 (UTC+3)');
        expect(formatUnixToDate(1704067200, -5)).toBe('31.12.2023 (UTC-5)');
        expect(formatUnixToDate(1704067200, 0)).toBe('01.01.2024 (UTC+0)');
        expect(formatUnixToDate(1704067200, 3)).toBe('01.01.2024 (UTC+3)');
        expect(formatUnixToDate(1704067200, 14)).toBe('01.01.2024 (UTC+14)');
        // 2024-01-01 22:00:00 UTC -> next day in UTC+3 and UTC+14
        expect(formatUnixToDate(1704146400, -5)).toBe('01.01.2024 (UTC-5)');
        expect(formatUnixToDate(1704146400, 3)).toBe('02.01.2024 (UTC+3)');
        expect(formatUnixToDate(1704146400, 14)).toBe('02.01.2024 (UTC+14)');
    });

    it('returns неизвестно for zero, negative, and non-finite timestamps', () => {
        expect(formatUnixToDate(0, -5)).toBe('неизвестно');
        expect(formatUnixToDate(-10, 0)).toBe('неизвестно');
        expect(formatUnixToDate(Number.NaN, 14)).toBe('неизвестно');
    });
});
