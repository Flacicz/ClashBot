import { escapeHtml, formatUtcOffset } from '../common/formatUtils.js';
import {
    NOTIFICATION_CATEGORIES,
    SUBSCRIPTION_PRESETS,
    resolvePresetForCategories,
    type NotificationCategory,
    type SubscriptionCategories,
    type SubscriptionPreset,
} from '../models/subscription.js';

export const PENDING_CLAN_SYNC_NAME = 'Pending synchronization';
export const CUSTOM_PRESET_LABEL = 'своя настройка';
export const LAST_CATEGORY_ALERT_TEXT = 'Оставьте хотя бы одну категорию или отключите клан';
export const OTHER_TIMEZONE_BUTTON_LABEL = '🌍 Другой пояс';

export interface TimezonePresetOption {
    readonly offsetHours: number;
    readonly label: string;
}

export const CIS_TIMEZONE_PRESETS: readonly TimezonePresetOption[] = [
    { offsetHours: 2, label: 'UTC+2 Кишинёв' },
    { offsetHours: 3, label: 'UTC+3 Москва/Минск' },
    { offsetHours: 4, label: 'UTC+4 Баку' },
    { offsetHours: 5, label: 'UTC+5 Астана/Ташкент' },
    { offsetHours: 6, label: 'UTC+6 Бишкек' },
    { offsetHours: 7, label: 'UTC+7 Новосибирск' },
];

export const SUBSCRIPTION_PRESET_LABELS: Readonly<Record<SubscriptionPreset, string>> = {
    [SUBSCRIPTION_PRESETS.players]: 'Игроки',
    [SUBSCRIPTION_PRESETS.management]: 'Руководство',
    [SUBSCRIPTION_PRESETS.all]: 'Всё вместе',
};

export const NOTIFICATION_CATEGORY_LABELS: Readonly<Record<NotificationCategory, string>> = {
    [NOTIFICATION_CATEGORIES.summaries]: 'Итоги и сравнения',
    [NOTIFICATION_CATEGORIES.reminders]: 'Напоминания',
    [NOTIFICATION_CATEGORIES.roster]: 'Кадры',
    [NOTIFICATION_CATEGORIES.discipline]: 'Дисциплина и аналитика',
    [NOTIFICATION_CATEGORIES.system]: 'Системные оповещения',
};

export interface SubscriptionSettingsView {
    readonly clanTag: string;
    readonly clanName?: string | null;
    readonly categories: SubscriptionCategories;
    readonly timezoneOffsetHours?: number;
    readonly extraLines?: readonly string[];
}

export interface SubscriptionTimezoneView {
    readonly clanTag: string;
    readonly clanName?: string | null;
    readonly timezoneOffsetHours: number;
}

export function resolveSynchronizedClanName(clanName: string | null | undefined): string | null {
    if (clanName === null || clanName === undefined) {
        return null;
    }

    const trimmed = clanName.trim();
    if (trimmed.length === 0 || trimmed === PENDING_CLAN_SYNC_NAME) {
        return null;
    }

    return trimmed;
}

export function formatPresetStatusLabel(categories: SubscriptionCategories): string {
    const preset = resolvePresetForCategories(categories);
    return preset !== null ? SUBSCRIPTION_PRESET_LABELS[preset] : CUSTOM_PRESET_LABEL;
}

function formatClanLine(clanTag: string, clanName: string | null | undefined): string {
    const synchronizedName = resolveSynchronizedClanName(clanName);
    return synchronizedName !== null
        ? `Клан: <b>${escapeHtml(synchronizedName)}</b> (${escapeHtml(clanTag)})`
        : `Клан: ${escapeHtml(clanTag)}`;
}

export function formatSubscriptionSettingsText(view: SubscriptionSettingsView): string {
    const clanLine = formatClanLine(view.clanTag, view.clanName);
    const presetLabel = formatPresetStatusLabel(view.categories);
    const timezoneLine =
        view.timezoneOffsetHours !== undefined
            ? [`Часовой пояс: ${formatUtcOffset(view.timezoneOffsetHours)}`]
            : [];

    const lines = [
        '⚙️ <b>Настройки подписки</b>',
        clanLine,
        `Пресет: ${presetLabel}`,
        ...(view.extraLines ?? []),
        ...timezoneLine,
        '',
        'Выберите пресет или настройте категории уведомлений вручную:',
    ];

    return lines.join('\n');
}

export function formatTimezoneQuickSelectText(view: SubscriptionTimezoneView): string {
    return [
        '🕒 <b>Часовой пояс подписки</b>',
        formatClanLine(view.clanTag, view.clanName),
        `Текущий пояс: ${formatUtcOffset(view.timezoneOffsetHours)}`,
        '',
        'Выберите часовой пояс (без автоперехода на летнее время):',
    ].join('\n');
}

export function formatTimezoneAllSelectText(view: SubscriptionTimezoneView): string {
    return [
        '🌍 <b>Выбор часового пояса (UTC-12..UTC+14)</b>',
        formatClanLine(view.clanTag, view.clanName),
        `Текущий пояс: ${formatUtcOffset(view.timezoneOffsetHours)}`,
        '',
        'Выберите смещение от UTC (без автоперехода на летнее время):',
    ].join('\n');
}
