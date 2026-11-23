import { describe, expect, it } from 'vitest';

import {
    escapeHtml,
    formatUnixToMoscowDateTime,
    removeTrailingNewlines,
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

describe('formatUnixToMoscowDateTime', () => {
    it('formats Unix timestamp in Moscow time (UTC+3)', () => {
        expect(formatUnixToMoscowDateTime(1704067200)).toBe('01.01.2024 03:00');
    });

    it('handles midnight rollover into next day in UTC+3', () => {
        expect(formatUnixToMoscowDateTime(1704146400)).toBe('02.01.2024 01:00');
    });

    it('handles leap day correctly', () => {
        expect(formatUnixToMoscowDateTime(1709208000)).toBe('29.02.2024 15:00');
    });

    it('returns неизвестно for zero, negative, and non-finite timestamps', () => {
        expect(formatUnixToMoscowDateTime(0)).toBe('неизвестно');
        expect(formatUnixToMoscowDateTime(-1)).toBe('неизвестно');
        expect(formatUnixToMoscowDateTime(Number.NaN)).toBe('неизвестно');
        expect(formatUnixToMoscowDateTime(Number.POSITIVE_INFINITY)).toBe('неизвестно');
    });
});
