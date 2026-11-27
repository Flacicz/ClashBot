import { describe, expect, it } from 'vitest';

import {
    formatClockTime,
    formatCompactPlayerList,
    formatCompactPlayerSection,
    formatFreshnessFooter,
    formatPercentRu1,
    formatShortDate,
    formatShortDurationRu,
    formatTimeWithUtcOffset,
    STALE_DATA_THRESHOLD_SECONDS,
    STALE_DATA_WARNING_TEXT,
    type CompactPlayerListItem,
} from '../../src/common/compactPlayerList.js';

describe('compactPlayerList helpers', () => {
    it('formats unique players in a compact comma-separated line with HTML escaping', () => {
        const players: CompactPlayerListItem[] = [
            { playerTag: '#P1', playerName: 'Ник1' },
            { playerTag: '#P2', playerName: '<Hero>' },
            { playerTag: '#P3', playerName: 'Bob & Co' },
        ];

        expect(formatCompactPlayerList(players)).toBe('Ник1, &lt;Hero&gt;, Bob &amp; Co');
        expect(formatCompactPlayerSection('Без атак', players)).toBe(
            'Без атак (3): Ник1, &lt;Hero&gt;, Bob &amp; Co',
        );
    });

    it('appends player tags when nicknames collide within a list or across sections', () => {
        const noAttacks: CompactPlayerListItem[] = [
            { playerTag: '#P1', playerName: 'Alex' },
            { playerTag: '#P2', playerName: 'Unique' },
        ];
        const partial: CompactPlayerListItem[] = [
            { playerTag: '#P3', playerName: 'alex', suffix: '3/6' },
            { playerTag: '#P4', playerName: 'Bob', suffix: '2/5' },
        ];
        const combined = [...noAttacks, ...partial];

        expect(formatCompactPlayerSection('Без атак', noAttacks)).toBe(
            'Без атак (2): Alex, Unique',
        );
        expect(
            formatCompactPlayerSection('Без атак', noAttacks, { disambiguateAcross: combined }),
        ).toBe('Без атак (2): Alex (#P1), Unique');
        expect(
            formatCompactPlayerSection('Не все атаки', partial, { disambiguateAcross: combined }),
        ).toBe('Не все атаки (2): alex (#P3) 3/6, Bob 2/5');
    });

    it('returns empty string or null for empty player lists', () => {
        expect(formatCompactPlayerList([])).toBe('');
        expect(formatCompactPlayerSection('Без атак', [])).toBeNull();
    });

    it('formats Russian 1-decimal percentages with comma separator', () => {
        expect(formatPercentRu1(78.4)).toBe('78,4');
        expect(formatPercentRu1(70.1)).toBe('70,1');
        expect(formatPercentRu1(100)).toBe('100,0');
        expect(formatPercentRu1(0)).toBe('0,0');
        expect(formatPercentRu1(-0.01)).toBe('0,0');
        expect(formatPercentRu1(Number.NaN)).toBe('0,0');
    });

    it('formats short Russian durations across seconds, minutes, hours, and days', () => {
        expect(formatShortDurationRu(-10)).toBe('менее минуты');
        expect(formatShortDurationRu(59)).toBe('менее минуты');
        expect(formatShortDurationRu(60)).toBe('1 мин');
        expect(formatShortDurationRu(45 * 60)).toBe('45 мин');
        expect(formatShortDurationRu(5 * 3600)).toBe('5 ч');
        expect(formatShortDurationRu(5 * 3600 + 12 * 60)).toBe('5 ч 12 мин');
        expect(formatShortDurationRu(2 * 86_400 + 3 * 3600 + 15 * 60)).toBe('2 д 3 ч 15 мин');
    });

    it('formats clock time, time with UTC offset, and short date in subscription timezone', () => {
        const ts = Date.UTC(2026, 10, 14, 18, 0, 0) / 1000;
        expect(formatClockTime(ts, 3)).toBe('21:00');
        expect(formatTimeWithUtcOffset(ts, 3)).toBe('21:00 UTC+3');
        expect(formatTimeWithUtcOffset(ts, 0)).toBe('18:00 UTC+0');
        expect(formatTimeWithUtcOffset(ts, -5)).toBe('13:00 UTC-5');
        expect(formatShortDate(ts, 3)).toBe('14.11.2026');
        expect(formatShortDate(ts, 7)).toBe('15.11.2026');
        expect(formatClockTime(0, 3)).toBe('неизвестно');
        expect(formatTimeWithUtcOffset(0, 3)).toBe('неизвестно');
        expect(formatShortDate(-1, 3)).toBe('неизвестно');
    });

    it('formats freshness footer for missing, fresh (<1h), boundary (=1h), and stale (>1h) data', () => {
        const now = 1_763_133_600;

        expect(formatFreshnessFooter(null, now)).toBe('🔄 данные ещё не синхронизированы');
        expect(formatFreshnessFooter(now - 30, now)).toBe('🔄 обновлено менее минуты назад');
        expect(formatFreshnessFooter(now - 7 * 60, now)).toBe('🔄 обновлено 7 мин назад');
        expect(formatFreshnessFooter(now - 59 * 60, now)).toBe('🔄 обновлено 59 мин назад');
        expect(formatFreshnessFooter(now - STALE_DATA_THRESHOLD_SECONDS, now)).toBe(
            '🔄 обновлено 1 ч назад',
        );
        expect(formatFreshnessFooter(now - (STALE_DATA_THRESHOLD_SECONDS + 1), now)).toBe(
            `🔄 обновлено 1 ч назад\n${STALE_DATA_WARNING_TEXT}`,
        );
        expect(formatFreshnessFooter(now - 75 * 60, now)).toBe(
            `🔄 обновлено 1 ч 15 мин назад\n${STALE_DATA_WARNING_TEXT}`,
        );
        expect(formatFreshnessFooter(now - 26 * 3600, now)).toBe(
            `🔄 обновлено 1 д 2 ч назад\n${STALE_DATA_WARNING_TEXT}`,
        );
    });
});
