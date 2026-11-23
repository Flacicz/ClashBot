export const MIN_TOWN_HALL = 7;
export const MAX_TOWN_HALL = 18;

export type Audience = 'players' | 'management';

const UNSIGNED_INTEGER_PATTERN = /^\d+$/;

export function parseTownHall(value: string): number | null {
    if (!UNSIGNED_INTEGER_PATTERN.test(value)) {
        return null;
    }

    const townHall = Number(value);
    if (!Number.isSafeInteger(townHall) || townHall < MIN_TOWN_HALL || townHall > MAX_TOWN_HALL) {
        return null;
    }

    return townHall;
}

export function resolveAudience(chatType: string): Audience | null {
    if (chatType === 'private') {
        return 'management';
    }

    if (chatType === 'group' || chatType === 'supergroup') {
        return 'players';
    }

    return null;
}
