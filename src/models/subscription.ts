export const NOTIFICATION_CATEGORIES = {
    summaries: 'summaries',
    reminders: 'reminders',
    roster: 'roster',
    discipline: 'discipline',
    system: 'system',
} as const;

export type NotificationCategory =
    (typeof NOTIFICATION_CATEGORIES)[keyof typeof NOTIFICATION_CATEGORIES];

export const ALL_NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
    NOTIFICATION_CATEGORIES.summaries,
    NOTIFICATION_CATEGORIES.reminders,
    NOTIFICATION_CATEGORIES.roster,
    NOTIFICATION_CATEGORIES.discipline,
    NOTIFICATION_CATEGORIES.system,
];

export interface SubscriptionCategories {
    readonly summaries: boolean;
    readonly reminders: boolean;
    readonly roster: boolean;
    readonly discipline: boolean;
    readonly system: boolean;
}

export const SUBSCRIPTION_PRESETS = {
    players: 'players',
    management: 'management',
    all: 'all',
} as const;

export type SubscriptionPreset = (typeof SUBSCRIPTION_PRESETS)[keyof typeof SUBSCRIPTION_PRESETS];

export const SUBSCRIPTION_PRESET_CATEGORIES: Readonly<
    Record<SubscriptionPreset, SubscriptionCategories>
> = {
    [SUBSCRIPTION_PRESETS.players]: {
        summaries: true,
        reminders: true,
        roster: true,
        discipline: false,
        system: false,
    },
    [SUBSCRIPTION_PRESETS.management]: {
        summaries: false,
        reminders: false,
        roster: false,
        discipline: true,
        system: true,
    },
    [SUBSCRIPTION_PRESETS.all]: {
        summaries: true,
        reminders: true,
        roster: true,
        discipline: true,
        system: true,
    },
};

export const MIN_TIMEZONE_OFFSET_HOURS = -12;
export const MAX_TIMEZONE_OFFSET_HOURS = 14;
export const DEFAULT_TIMEZONE_OFFSET_HOURS = 3;
export const DEFAULT_NEW_SUBSCRIPTION_MIRROR_RULE_ENABLED = false;

export interface SubscriptionSettings {
    readonly categories: SubscriptionCategories;
    readonly mirrorRuleEnabled: boolean;
    readonly timezoneOffsetHours: number;
}

export function isNotificationCategory(value: string): value is NotificationCategory {
    return (
        value === NOTIFICATION_CATEGORIES.summaries ||
        value === NOTIFICATION_CATEGORIES.reminders ||
        value === NOTIFICATION_CATEGORIES.roster ||
        value === NOTIFICATION_CATEGORIES.discipline ||
        value === NOTIFICATION_CATEGORIES.system
    );
}

export function getPresetCategories(preset: SubscriptionPreset): SubscriptionCategories {
    return { ...SUBSCRIPTION_PRESET_CATEGORIES[preset] };
}

export function hasAnyEnabledCategory(categories: SubscriptionCategories): boolean {
    return (
        categories.summaries ||
        categories.reminders ||
        categories.roster ||
        categories.discipline ||
        categories.system
    );
}

export function isCategoryEnabled(
    categories: SubscriptionCategories,
    category: NotificationCategory,
): boolean {
    switch (category) {
        case NOTIFICATION_CATEGORIES.summaries:
            return categories.summaries;
        case NOTIFICATION_CATEGORIES.reminders:
            return categories.reminders;
        case NOTIFICATION_CATEGORIES.roster:
            return categories.roster;
        case NOTIFICATION_CATEGORIES.discipline:
            return categories.discipline;
        case NOTIFICATION_CATEGORIES.system:
            return categories.system;
    }
}

export function categoriesEqual(
    left: SubscriptionCategories,
    right: SubscriptionCategories,
): boolean {
    return (
        left.summaries === right.summaries &&
        left.reminders === right.reminders &&
        left.roster === right.roster &&
        left.discipline === right.discipline &&
        left.system === right.system
    );
}

export function resolvePresetForCategories(
    categories: SubscriptionCategories,
): SubscriptionPreset | null {
    if (categoriesEqual(categories, SUBSCRIPTION_PRESET_CATEGORIES.players)) {
        return SUBSCRIPTION_PRESETS.players;
    }
    if (categoriesEqual(categories, SUBSCRIPTION_PRESET_CATEGORIES.management)) {
        return SUBSCRIPTION_PRESETS.management;
    }
    if (categoriesEqual(categories, SUBSCRIPTION_PRESET_CATEGORIES.all)) {
        return SUBSCRIPTION_PRESETS.all;
    }
    return null;
}

export function isValidTimezoneOffsetHours(offsetHours: number): boolean {
    return (
        Number.isInteger(offsetHours) &&
        offsetHours >= MIN_TIMEZONE_OFFSET_HOURS &&
        offsetHours <= MAX_TIMEZONE_OFFSET_HOURS
    );
}

export function createDefaultSubscriptionSettings(
    preset: SubscriptionPreset,
): SubscriptionSettings {
    return {
        categories: getPresetCategories(preset),
        mirrorRuleEnabled: DEFAULT_NEW_SUBSCRIPTION_MIRROR_RULE_ENABLED,
        timezoneOffsetHours: DEFAULT_TIMEZONE_OFFSET_HOURS,
    };
}
