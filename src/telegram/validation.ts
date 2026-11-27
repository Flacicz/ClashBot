import { SUBSCRIPTION_PRESETS, type SubscriptionPreset } from '../models/subscription.js';

export const MIN_TOWN_HALL = 7;
export const MAX_TOWN_HALL = 18;

export type SupportedTelegramChatType = 'private' | 'group' | 'supergroup';

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

export function isSupportedTelegramChatType(
    chatType: string,
): chatType is SupportedTelegramChatType {
    return chatType === 'private' || chatType === 'group' || chatType === 'supergroup';
}

export function resolveDefaultPreset(chatType: string): SubscriptionPreset | null {
    if (chatType === 'private') {
        return SUBSCRIPTION_PRESETS.management;
    }

    if (chatType === 'group' || chatType === 'supergroup') {
        return SUBSCRIPTION_PRESETS.players;
    }

    return null;
}
