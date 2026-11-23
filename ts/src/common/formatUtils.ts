const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '\u300A': '&lt;', // 《
    '\u300B': '&gt;', // 》
};

const HTML_ESCAPE_PATTERN = /[&<>\u300A\u300B]/g;

const MOSCOW_UTC_OFFSET_SECONDS = 3 * 60 * 60;

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

/**
 * Formats a Unix timestamp (seconds) in Moscow time (UTC+3) as `DD.MM.YYYY HH:MM`,
 * or returns `"неизвестно"` for non-positive / non-finite timestamps,
 * matching C++ `utils::formatUnixToLocalDateTime`.
 */
export function formatUnixToMoscowDateTime(timestampSeconds: number): string {
    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
        return 'неизвестно';
    }

    const moscowMs = (Math.trunc(timestampSeconds) + MOSCOW_UTC_OFFSET_SECONDS) * 1000;
    const date = new Date(moscowMs);

    const day = pad2(date.getUTCDate());
    const month = pad2(date.getUTCMonth() + 1);
    const year = pad4(date.getUTCFullYear());
    const hours = pad2(date.getUTCHours());
    const minutes = pad2(date.getUTCMinutes());

    return `${day}.${month}.${year} ${hours}:${minutes}`;
}
