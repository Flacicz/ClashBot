import { describe, expect, it } from 'vitest';

import {
    ALL_NOTIFICATION_CATEGORIES,
    ALL_SUBSCRIPTION_PRESETS,
    getPresetCategories,
    isSubscriptionPreset,
    SUBSCRIPTION_PRESETS,
    toggleSubscriptionCategory,
    type SubscriptionCategories,
} from '../../src/models/subscription.js';
import {
    CIS_TIMEZONE_PRESETS,
    CUSTOM_PRESET_LABEL,
    formatPresetStatusLabel,
    formatSubscriptionSettingsText,
    formatTimezoneAllSelectText,
    formatTimezoneQuickSelectText,
    LAST_CATEGORY_ALERT_TEXT,
    NOTIFICATION_CATEGORY_LABELS,
    OTHER_TIMEZONE_BUTTON_LABEL,
    PENDING_CLAN_SYNC_NAME,
    resolveSynchronizedClanName,
    SUBSCRIPTION_PRESET_LABELS,
} from '../../src/telegram/subscriptionSettings.js';

describe('subscription preset and category helpers', () => {
    it('validates subscription preset strings', () => {
        for (const preset of ALL_SUBSCRIPTION_PRESETS) {
            expect(isSubscriptionPreset(preset)).toBe(true);
        }
        expect(isSubscriptionPreset('custom')).toBe(false);
        expect(isSubscriptionPreset('')).toBe(false);
    });

    it('toggles individual categories and rejects disabling the last enabled category', () => {
        const players = getPresetCategories(SUBSCRIPTION_PRESETS.players);
        const withoutRoster = toggleSubscriptionCategory(players, 'roster');
        expect(withoutRoster).toEqual({
            summaries: true,
            reminders: true,
            roster: false,
            discipline: false,
            system: false,
        });

        const withSystem = toggleSubscriptionCategory(players, 'system');
        expect(withSystem).toEqual({
            summaries: true,
            reminders: true,
            roster: true,
            discipline: false,
            system: true,
        });

        for (const category of ALL_NOTIFICATION_CATEGORIES) {
            const singleCategory: SubscriptionCategories = {
                summaries: category === 'summaries',
                reminders: category === 'reminders',
                roster: category === 'roster',
                discipline: category === 'discipline',
                system: category === 'system',
            };
            expect(toggleSubscriptionCategory(singleCategory, category)).toBeNull();
        }
    });

    it('resolves synchronized clan names and hides Pending synchronization placeholder', () => {
        expect(resolveSynchronizedClanName('Dark Dragons')).toBe('Dark Dragons');
        expect(resolveSynchronizedClanName('  Dark Dragons  ')).toBe('Dark Dragons');
        expect(resolveSynchronizedClanName(PENDING_CLAN_SYNC_NAME)).toBeNull();
        expect(resolveSynchronizedClanName('')).toBeNull();
        expect(resolveSynchronizedClanName('   ')).toBeNull();
        expect(resolveSynchronizedClanName(null)).toBeNull();
        expect(resolveSynchronizedClanName(undefined)).toBeNull();
    });

    it('formats preset status labels for all 3 presets and custom category combinations', () => {
        expect(formatPresetStatusLabel(getPresetCategories('players'))).toBe(
            SUBSCRIPTION_PRESET_LABELS.players,
        );
        expect(formatPresetStatusLabel(getPresetCategories('management'))).toBe(
            SUBSCRIPTION_PRESET_LABELS.management,
        );
        expect(formatPresetStatusLabel(getPresetCategories('all'))).toBe(
            SUBSCRIPTION_PRESET_LABELS.all,
        );
        expect(
            formatPresetStatusLabel({
                summaries: true,
                reminders: false,
                roster: false,
                discipline: false,
                system: false,
            }),
        ).toBe(CUSTOM_PRESET_LABEL);
    });

    it('formats settings screen HTML text with escaped synchronized clan name, preset status and optional extra lines', () => {
        const syncedText = formatSubscriptionSettingsText({
            clanTag: '#2PPLQ',
            clanName: 'Dragons <A&B>',
            categories: getPresetCategories('players'),
            extraLines: ['Правило зеркала: выкл', 'Часовой пояс: UTC+3'],
        });

        expect(syncedText).toContain('⚙️ <b>Настройки подписки</b>');
        expect(syncedText).toContain('Клан: <b>Dragons &lt;A&amp;B&gt;</b> (#2PPLQ)');
        expect(syncedText).toContain('Пресет: Игроки');
        expect(syncedText).toContain('Правило зеркала: выкл');
        expect(syncedText).toContain('Часовой пояс: UTC+3');

        const unsyncedText = formatSubscriptionSettingsText({
            clanTag: '#2PPLQ',
            clanName: PENDING_CLAN_SYNC_NAME,
            categories: {
                summaries: true,
                reminders: false,
                roster: true,
                discipline: false,
                system: false,
            },
        });

        expect(unsyncedText).toContain('Клан: #2PPLQ');
        expect(unsyncedText).not.toContain(PENDING_CLAN_SYNC_NAME);
        expect(unsyncedText).toContain('Пресет: своя настройка');
    });

    it('exposes exact Russian labels for presets, categories, and last-category alert', () => {
        expect(SUBSCRIPTION_PRESET_LABELS).toEqual({
            players: 'Игроки',
            management: 'Руководство',
            all: 'Всё вместе',
        });
        expect(NOTIFICATION_CATEGORY_LABELS).toEqual({
            summaries: 'Итоги и сравнения',
            reminders: 'Напоминания',
            roster: 'Кадры',
            discipline: 'Дисциплина и аналитика',
            system: 'Системные оповещения',
        });
        expect(LAST_CATEGORY_ALERT_TEXT).toBe('Оставьте хотя бы одну категорию или отключите клан');
        expect(OTHER_TIMEZONE_BUTTON_LABEL).toBe('🌍 Другой пояс');
        expect(CIS_TIMEZONE_PRESETS).toEqual([
            { offsetHours: 2, label: 'UTC+2 Кишинёв' },
            { offsetHours: 3, label: 'UTC+3 Москва/Минск' },
            { offsetHours: 4, label: 'UTC+4 Баку' },
            { offsetHours: 5, label: 'UTC+5 Астана/Ташкент' },
            { offsetHours: 6, label: 'UTC+6 Бишкек' },
            { offsetHours: 7, label: 'UTC+7 Новосибирск' },
        ]);
    });

    it('formats timezone line on settings screen and timezone picker screen texts', () => {
        const settingsWithTz = formatSubscriptionSettingsText({
            clanTag: '#2PPLQ',
            clanName: 'Dragons',
            categories: getPresetCategories('players'),
            timezoneOffsetHours: -5,
        });
        expect(settingsWithTz).toContain('Часовой пояс: UTC-5');

        const quickText = formatTimezoneQuickSelectText({
            clanTag: '#2PPLQ',
            clanName: 'Dragons <A&B>',
            timezoneOffsetHours: 3,
        });
        expect(quickText).toContain('🕒 <b>Часовой пояс подписки</b>');
        expect(quickText).toContain('Клан: <b>Dragons &lt;A&amp;B&gt;</b> (#2PPLQ)');
        expect(quickText).toContain('Текущий пояс: UTC+3');

        const allText = formatTimezoneAllSelectText({
            clanTag: '#2PPLQ',
            clanName: PENDING_CLAN_SYNC_NAME,
            timezoneOffsetHours: 14,
        });
        expect(allText).toContain('🌍 <b>Выбор часового пояса (UTC-12..UTC+14)</b>');
        expect(allText).toContain('Клан: #2PPLQ');
        expect(allText).not.toContain(PENDING_CLAN_SYNC_NAME);
        expect(allText).toContain('Текущий пояс: UTC+14');
    });
});
