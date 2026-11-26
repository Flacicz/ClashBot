import { escapeHtml } from '../common/formatUtils.js';
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
    readonly extraLines?: readonly string[];
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

export function formatSubscriptionSettingsText(view: SubscriptionSettingsView): string {
    const synchronizedName = resolveSynchronizedClanName(view.clanName);
    const clanLine =
        synchronizedName !== null
            ? `Клан: <b>${escapeHtml(synchronizedName)}</b> (${escapeHtml(view.clanTag)})`
            : `Клан: ${escapeHtml(view.clanTag)}`;
    const presetLabel = formatPresetStatusLabel(view.categories);

    const lines = [
        '⚙️ <b>Настройки подписки</b>',
        clanLine,
        `Пресет: ${presetLabel}`,
        ...(view.extraLines ?? []),
        '',
        'Выберите пресет или настройте категории уведомлений вручную:',
    ];

    return lines.join('\n');
}
