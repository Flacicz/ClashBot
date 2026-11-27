import { DEFAULT_TIMEZONE_OFFSET_HOURS } from '../models/subscription.js';
import { escapeHtml, formatUtcOffset } from './formatUtils.js';

export const STALE_DATA_THRESHOLD_SECONDS = 60 * 60;

export const STALE_DATA_WARNING_TEXT = '⚠️ данные могли устареть — возможен сбой синхронизации';

const SECONDS_PER_HOUR = 60 * 60;

const FIXED_1_FORMATTER = new Intl.NumberFormat('en-US', {
    useGrouping: false,
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    roundingMode: 'halfEven',
});

export interface CompactPlayerListItem {
    readonly playerTag: string;
    readonly playerName: string;
    readonly suffix?: string;
}

export interface CompactPlayerListOptions {
    /**
     * Optional broader cohort (for example, all pending players across both "Без атак"
     * and "1 из 2" sections) used to detect duplicate nicknames consistently across sections.
     */
    readonly disambiguateAcross?: readonly CompactPlayerListItem[];
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

function pad4(value: number): string {
    return String(value).padStart(4, '0');
}

function toOffsetUtcDate(timestampSeconds: number, timezoneOffsetHours: number): Date {
    const shiftedMs =
        (Math.trunc(timestampSeconds) + timezoneOffsetHours * SECONDS_PER_HOUR) * 1000;
    return new Date(shiftedMs);
}

function normalizePlayerNameKey(playerName: string): string {
    return playerName.trim().toLowerCase();
}

/**
 * Returns normalized player names that correspond to two or more distinct player tags.
 */
export function findDuplicatePlayerNameKeys(
    players: readonly CompactPlayerListItem[],
): ReadonlySet<string> {
    const tagsByName = new Map<string, Set<string>>();

    for (const player of players) {
        const key = normalizePlayerNameKey(player.playerName);
        let tags = tagsByName.get(key);
        if (tags === undefined) {
            tags = new Set<string>();
            tagsByName.set(key, tags);
        }
        tags.add(player.playerTag);
    }

    const duplicates = new Set<string>();
    for (const [key, tags] of tagsByName) {
        if (tags.size > 1) {
            duplicates.add(key);
        }
    }

    return duplicates;
}

export function formatCompactPlayerItem(
    player: CompactPlayerListItem,
    duplicateNameKeys: ReadonlySet<string>,
): string {
    const escapedName = escapeHtml(player.playerName);
    const nameWithOptionalTag = duplicateNameKeys.has(normalizePlayerNameKey(player.playerName))
        ? `${escapedName} (${escapeHtml(player.playerTag)})`
        : escapedName;

    if (player.suffix !== undefined && player.suffix.length > 0) {
        return `${nameWithOptionalTag} ${escapeHtml(player.suffix)}`;
    }

    return nameWithOptionalTag;
}

/**
 * Formats players into a compact comma-separated single line with HTML escaping.
 * Appends `(#TAG)` whenever two or more players share the same nickname.
 */
export function formatCompactPlayerList(
    players: readonly CompactPlayerListItem[],
    options?: CompactPlayerListOptions,
): string {
    if (players.length === 0) {
        return '';
    }

    const duplicateNameKeys = findDuplicatePlayerNameKeys(options?.disambiguateAcross ?? players);
    return players.map((player) => formatCompactPlayerItem(player, duplicateNameKeys)).join(', ');
}

/**
 * Formats a compact labeled player section like `Без атак (3): Ник1, Ник2, Ник3`,
 * or returns `null` when `players` is empty.
 */
export function formatCompactPlayerSection(
    label: string,
    players: readonly CompactPlayerListItem[],
    options?: CompactPlayerListOptions,
): string | null {
    if (players.length === 0) {
        return null;
    }

    return `${label} (${String(players.length)}): ${formatCompactPlayerList(players, options)}`;
}

/**
 * Formats a percentage value to 1 decimal place with a Russian comma separator
 * (`78.4` → `"78,4"`), safely falling back to `"0,0"` for non-finite values.
 */
export function formatPercentRu1(value: number): string {
    if (!Number.isFinite(value) || value === 0) {
        return '0,0';
    }

    const formatted = FIXED_1_FORMATTER.format(value);
    return (formatted === '-0.0' ? '0.0' : formatted).replace('.', ',');
}

/**
 * Formats a duration in seconds in compact Russian form (`5 ч 12 мин`, `45 мин`,
 * `2 д 3 ч`, or `менее минуты` for durations under 60 seconds).
 */
export function formatShortDurationRu(durationSeconds: number): string {
    if (!Number.isFinite(durationSeconds) || durationSeconds < 60) {
        return 'менее минуты';
    }

    const totalMinutes = Math.round(durationSeconds / 60);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    const parts: string[] = [];
    if (days > 0) {
        parts.push(`${String(days)} д`);
    }
    if (hours > 0) {
        parts.push(`${String(hours)} ч`);
    }
    if (minutes > 0) {
        parts.push(`${String(minutes)} мин`);
    }

    return parts.length > 0 ? parts.join(' ') : 'менее минуты';
}

/**
 * Formats a Unix timestamp (seconds) in the given integer UTC offset as `HH:MM`,
 * or returns `"неизвестно"` for non-positive / non-finite timestamps.
 */
export function formatClockTime(
    timestampSeconds: number,
    timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
): string {
    formatUtcOffset(timezoneOffsetHours);

    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
        return 'неизвестно';
    }

    const date = toOffsetUtcDate(timestampSeconds, timezoneOffsetHours);
    return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

/**
 * Formats a Unix timestamp (seconds) as `HH:MM UTC+N` / `HH:MM UTC-N`,
 * or returns `"неизвестно"` for non-positive / non-finite timestamps.
 */
export function formatTimeWithUtcOffset(
    timestampSeconds: number,
    timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
): string {
    const utcOffset = formatUtcOffset(timezoneOffsetHours);

    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
        return 'неизвестно';
    }

    const date = toOffsetUtcDate(timestampSeconds, timezoneOffsetHours);
    return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} ${utcOffset}`;
}

/**
 * Formats a Unix timestamp (seconds) in the given integer UTC offset as `DD.MM.YYYY`,
 * or returns `"неизвестно"` for non-positive / non-finite timestamps.
 */
export function formatShortDate(
    timestampSeconds: number,
    timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
): string {
    formatUtcOffset(timezoneOffsetHours);

    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
        return 'неизвестно';
    }

    const date = toOffsetUtcDate(timestampSeconds, timezoneOffsetHours);
    return `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${pad4(date.getUTCFullYear())}`;
}

/**
 * Formats the data freshness footer shown at the bottom of interactive SQLite views.
 * Appends a staleness warning line when data is strictly older than 1 hour.
 */
export function formatFreshnessFooter(
    updatedAtSeconds: number | null,
    nowEpochSeconds: number,
): string {
    if (updatedAtSeconds === null || !Number.isFinite(updatedAtSeconds) || updatedAtSeconds <= 0) {
        return '🔄 данные ещё не синхронизированы';
    }

    const ageSeconds = Math.max(0, Math.trunc(nowEpochSeconds) - Math.trunc(updatedAtSeconds));
    const ageMinutes = Math.floor(ageSeconds / 60);

    let updatedLine: string;
    if (ageSeconds < 60) {
        updatedLine = '🔄 обновлено менее минуты назад';
    } else if (ageMinutes < 60) {
        updatedLine = `🔄 обновлено ${String(ageMinutes)} мин назад`;
    } else if (ageMinutes < 24 * 60) {
        const hours = Math.floor(ageMinutes / 60);
        const minutes = ageMinutes % 60;
        updatedLine =
            minutes > 0
                ? `🔄 обновлено ${String(hours)} ч ${String(minutes)} мин назад`
                : `🔄 обновлено ${String(hours)} ч назад`;
    } else {
        const days = Math.floor(ageMinutes / (24 * 60));
        const hours = Math.floor((ageMinutes % (24 * 60)) / 60);
        updatedLine =
            hours > 0
                ? `🔄 обновлено ${String(days)} д ${String(hours)} ч назад`
                : `🔄 обновлено ${String(days)} д назад`;
    }

    if (ageSeconds > STALE_DATA_THRESHOLD_SECONDS) {
        return `${updatedLine}\n${STALE_DATA_WARNING_TEXT}`;
    }

    return updatedLine;
}
