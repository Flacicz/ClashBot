export const UNKNOWN_API_TIME = '00000000T00000';

const COMPACT_ISO_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/;
const DIGITS_ONLY_PATTERN = /^\d+$/;

export function extractApiTime(value: string | undefined): string {
    if (value === undefined || value.length === 0 || value === UNKNOWN_API_TIME) {
        return '';
    }

    const dotIndex = value.indexOf('.');
    return dotIndex === -1 ? value : value.slice(0, dotIndex);
}

export function parseApiTimeToUnix(iso: string): number {
    let value = iso;

    if (value.endsWith('Z')) {
        value = value.slice(0, -1);
    }

    const dotIndex = value.indexOf('.');
    if (dotIndex !== -1) {
        const fraction = value.slice(dotIndex + 1);
        if (dotIndex !== 15 || fraction.length === 0 || !DIGITS_ONLY_PATTERN.test(fraction)) {
            return 0;
        }
        value = value.slice(0, dotIndex);
    }

    const match = COMPACT_ISO_PATTERN.exec(value);
    if (match === null) {
        return 0;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);

    if (
        year < 1 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31 ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59 ||
        second < 0 ||
        second > 59
    ) {
        return 0;
    }

    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (year < 100) {
        date.setUTCFullYear(year);
    }

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day ||
        date.getUTCHours() !== hour ||
        date.getUTCMinutes() !== minute ||
        date.getUTCSeconds() !== second
    ) {
        return 0;
    }

    return Math.floor(date.getTime() / 1000);
}
