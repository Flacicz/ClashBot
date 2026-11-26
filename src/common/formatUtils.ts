import {
    DEFAULT_TIMEZONE_OFFSET_HOURS,
    MAX_TIMEZONE_OFFSET_HOURS,
    MIN_TIMEZONE_OFFSET_HOURS,
    isValidTimezoneOffsetHours,
} from '../models/subscription.js';
import { ValidationError } from './errors.js';

const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '\u300A': '&lt;', // 《
    '\u300B': '&gt;', // 》
};

const HTML_ESCAPE_PATTERN = /[&<>\u300A\u300B]/g;

const SECONDS_PER_HOUR = 60 * 60;

/**
 * Escapes HTML special characters and decorative CJK angle brackets (`《`, `》`)
 * in a single pass, matching C++ `utils::escapeHTML`.
 */
export function escapeHtml(value: string): string {
    return value.replace(HTML_ESCAPE_PATTERN, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

/**
 * Removes all trailing `\n` characters while preserving internal newlines,
 * matching C++ `utils::removeTrailingNewlines`.
 */
export function removeTrailingNewlines(value: string): string {
    return value.replace(/\n+$/, '');
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

function pad4(value: number): string {
    return String(value).padStart(4, '0');
}

function assertValidTimezoneOffsetHours(timezoneOffsetHours: number): void {
    if (!isValidTimezoneOffsetHours(timezoneOffsetHours)) {
        throw new ValidationError(
            `Invalid timezone offset hours: ${String(timezoneOffsetHours)} (expected integer between ${String(MIN_TIMEZONE_OFFSET_HOURS)} and ${String(MAX_TIMEZONE_OFFSET_HOURS)})`,
            { context: { timezoneOffsetHours } },
        );
    }
}

/**
 * Formats an integer UTC offset in hours as `UTC+N` (for `>= 0`, including `UTC+0`)
 * or `UTC-N` (for `< 0`), without country or city names.
 */
export function formatUtcOffset(timezoneOffsetHours: number): string {
    assertValidTimezoneOffsetHours(timezoneOffsetHours);
    if (timezoneOffsetHours < 0) {
        return `UTC${String(timezoneOffsetHours)}`;
    }
    return `UTC+${String(timezoneOffsetHours === 0 ? 0 : timezoneOffsetHours)}`;
}

function toOffsetUtcDate(timestampSeconds: number, timezoneOffsetHours: number): Date {
    const shiftedMs =
        (Math.trunc(timestampSeconds) + timezoneOffsetHours * SECONDS_PER_HOUR) * 1000;
    return new Date(shiftedMs);
}

/**
 * Formats a Unix timestamp (seconds) in the given integer UTC offset as
 * `DD.MM.YYYY HH:MM (UTC+N)` / `DD.MM.YYYY HH:MM (UTC-N)`,
 * or returns `"неизвестно"` for non-positive / non-finite timestamps.
 */
export function formatUnixToDateTime(
    timestampSeconds: number,
    timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
): string {
    const utcOffset = formatUtcOffset(timezoneOffsetHours);

    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
        return 'неизвестно';
    }

    const date = toOffsetUtcDate(timestampSeconds, timezoneOffsetHours);

    const day = pad2(date.getUTCDate());
    const month = pad2(date.getUTCMonth() + 1);
    const year = pad4(date.getUTCFullYear());
    const hours = pad2(date.getUTCHours());
    const minutes = pad2(date.getUTCMinutes());

    return `${day}.${month}.${year} ${hours}:${minutes} (${utcOffset})`;
}

/**
 * Formats a Unix timestamp (seconds) in the given integer UTC offset as
 * `DD.MM.YYYY (UTC+N)` / `DD.MM.YYYY (UTC-N)`,
 * or returns `"неизвестно"` for non-positive / non-finite timestamps.
 */
export function formatUnixToDate(
    timestampSeconds: number,
    timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
): string {
    const utcOffset = formatUtcOffset(timezoneOffsetHours);

    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
        return 'неизвестно';
    }

    const date = toOffsetUtcDate(timestampSeconds, timezoneOffsetHours);

    const day = pad2(date.getUTCDate());
    const month = pad2(date.getUTCMonth() + 1);
    const year = pad4(date.getUTCFullYear());

    return `${day}.${month}.${year} (${utcOffset})`;
}

export function pluralizeRu(value: number, one: string, few: string, many: string): string {
    const abs = Math.abs(Math.trunc(value));
    const mod100 = abs % 100;
    const mod10 = abs % 10;

    if (mod100 >= 11 && mod100 <= 14) {
        return many;
    }
    if (mod10 === 1) {
        return one;
    }
    if (mod10 >= 2 && mod10 <= 4) {
        return few;
    }
    return many;
}

function isRussianSingularOne(value: number): boolean {
    const abs = Math.abs(Math.trunc(value));
    return abs % 10 === 1 && abs % 100 !== 11;
}

/**
 * Formats an actual remaining duration (in seconds) as a Russian phrase for reminders,
 * e.g. `"остался 1 час"`, `"осталось 3 часа 45 минут"`, `"осталась 21 минута"`,
 * or `"осталось менее минуты"` for durations under 60 seconds.
 */
export function formatRemainingTimePhrase(remainingSeconds: number): string {
    if (!Number.isFinite(remainingSeconds) || remainingSeconds < 60) {
        return 'осталось менее минуты';
    }

    const totalMinutes = Math.round(remainingSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0) {
        const verb = isRussianSingularOne(hours) ? 'остался' : 'осталось';
        const hoursPart = `${String(hours)} ${pluralizeRu(hours, 'час', 'часа', 'часов')}`;
        if (minutes > 0) {
            const minutesPart = `${String(minutes)} ${pluralizeRu(minutes, 'минута', 'минуты', 'минут')}`;
            return `${verb} ${hoursPart} ${minutesPart}`;
        }
        return `${verb} ${hoursPart}`;
    }

    const verb = isRussianSingularOne(minutes) ? 'осталась' : 'осталось';
    return `${verb} ${String(minutes)} ${pluralizeRu(minutes, 'минута', 'минуты', 'минут')}`;
}
