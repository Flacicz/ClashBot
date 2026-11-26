import { describe, expect, it } from 'vitest';

import { getPresetCategories } from '../../src/models/subscription.js';
import type { AttackGuide, AttackStrategy } from '../../src/telegram/attackGuideCatalog.js';
import { MAX_CALLBACK_DATA_BYTES } from '../../src/telegram/callbackData.js';
import {
    makeClanUnlinkKeyboard,
    makeGuideListKeyboard,
    makeGuideNavigationKeyboard,
    makeHelpNavigationKeyboard,
    makeLinkInstructionsKeyboard,
    makeMyClansNavigationKeyboard,
    makeStartMenuKeyboard,
    makeStrategyListKeyboard,
    makeSubscriptionSettingsButton,
    makeSubscriptionSettingsEntryKeyboard,
    makeSubscriptionSettingsKeyboard,
    makeSubscriptionSettingsTimezoneButton,
    makeTimezoneAllSelectKeyboard,
    makeTimezoneQuickSelectKeyboard,
    makeTownHallListKeyboard,
} from '../../src/telegram/keyboards.js';

function makeGuide(id: string, title: string): AttackGuide {
    return {
        id,
        armyId: 'army',
        armyTitle: 'Army',
        variantId: 'classic',
        variantTitle: 'Classic',
        title,
        townHalls: [15],
        youtubeUrl: `https://example.com/${id}`,
        sortOrder: 0,
        enabled: true,
    };
}

describe('Telegram inline keyboards', () => {
    it('builds exact start menu keyboard JSON', () => {
        expect(makeStartMenuKeyboard()).toEqual({
            inline_keyboard: [
                [{ text: '🎥 Гайды по атакам', callback_data: 'guides:townhalls' }],
                [{ text: '🔗 Подключить клан', callback_data: 'clans:link' }],
                [{ text: '📋 Мои кланы', callback_data: 'clans:list' }],
                [{ text: '❌ Отключить клан', callback_data: 'clans:unlink' }],
                [{ text: '❓ Помощь', callback_data: 'help:main' }],
            ],
        });
    });

    it('builds clan and help navigation keyboards with main menu button', () => {
        const expected = {
            inline_keyboard: [[{ text: '🏠 В главное меню', callback_data: 'menu:start' }]],
        };

        expect(makeMyClansNavigationKeyboard()).toEqual(expected);
        expect(makeLinkInstructionsKeyboard()).toEqual(expected);
        expect(makeHelpNavigationKeyboard()).toEqual(expected);
    });

    it('builds clan unlink keyboard for each clan and appends main menu button', () => {
        expect(makeClanUnlinkKeyboard(['#2PPLQ', '#ABC123'])).toEqual({
            inline_keyboard: [
                [{ text: '❌ #2PPLQ', callback_data: 'clans:unlink:#2PPLQ' }],
                [{ text: '❌ #ABC123', callback_data: 'clans:unlink:#ABC123' }],
                [{ text: '🏠 В главное меню', callback_data: 'menu:start' }],
            ],
        });
    });

    it('keeps only main menu button when clan unlink list is empty', () => {
        expect(makeClanUnlinkKeyboard([])).toEqual({
            inline_keyboard: [[{ text: '🏠 В главное меню', callback_data: 'menu:start' }]],
        });
    });

    it('uses arguments in guide navigation keyboard', () => {
        expect(makeGuideNavigationKeyboard(12, 'zap_dragons', 'Землетрясение + драконы')).toEqual({
            inline_keyboard: [
                [
                    {
                        text: '⬅️ Другие гайды: Землетрясение + драконы',
                        callback_data: 'guides:strategy:12:zap_dragons',
                    },
                ],
                [{ text: '⬅️ К выбору стратегий', callback_data: 'guides:townhall:12' }],
                [{ text: '🏠 В главное меню', callback_data: 'menu:start' }],
            ],
        });

        expect(makeGuideNavigationKeyboard(16, 'root_riders', 'Всадники на кабанах')).toEqual({
            inline_keyboard: [
                [
                    {
                        text: '⬅️ Другие гайды: Всадники на кабанах',
                        callback_data: 'guides:strategy:16:root_riders',
                    },
                ],
                [{ text: '⬅️ К выбору стратегий', callback_data: 'guides:townhall:16' }],
                [{ text: '🏠 В главное меню', callback_data: 'menu:start' }],
            ],
        });
    });

    it('builds TH7-TH18 buttons in 4 rows of 3', () => {
        const result = makeTownHallListKeyboard();

        expect(result.inline_keyboard).toHaveLength(4);

        let townHall = 7;
        for (const row of result.inline_keyboard) {
            expect(row).toHaveLength(3);
            for (const button of row) {
                expect(button).toEqual({
                    text: `Ратуша ${String(townHall)}`,
                    callback_data: `guides:townhall:${String(townHall)}`,
                });
                townHall += 1;
            }
        }

        expect(townHall).toBe(19);
    });

    it('builds strategy list keyboard with town hall and back button', () => {
        const strategies: AttackStrategy[] = [
            { id: 'zap_dragons', title: 'Землетрясение + драконы' },
            { id: 'root_riders', title: 'Всадники на кабанах' },
        ];

        expect(makeStrategyListKeyboard(14, strategies)).toEqual({
            inline_keyboard: [
                [
                    {
                        text: 'Землетрясение + драконы',
                        callback_data: 'guides:strategy:14:zap_dragons',
                    },
                ],
                [
                    {
                        text: 'Всадники на кабанах',
                        callback_data: 'guides:strategy:14:root_riders',
                    },
                ],
                [{ text: '⬅️ К выбору ратуши', callback_data: 'guides:townhalls' }],
            ],
        });
    });

    it('keeps only back button when strategy list is empty', () => {
        expect(makeStrategyListKeyboard(10, [])).toEqual({
            inline_keyboard: [[{ text: '⬅️ К выбору ратуши', callback_data: 'guides:townhalls' }]],
        });
    });

    it('builds guide list keyboard with town hall and back button', () => {
        const guides: AttackGuide[] = [
            makeGuide('zap_dragons', 'Гайд по драконам'),
            makeGuide('root_riders', 'Гайд по всадникам'),
        ];

        expect(makeGuideListKeyboard(15, guides)).toEqual({
            inline_keyboard: [
                [{ text: 'Гайд по драконам', callback_data: 'guides:guide:15:zap_dragons' }],
                [{ text: 'Гайд по всадникам', callback_data: 'guides:guide:15:root_riders' }],
                [{ text: '⬅️ К выбору стратегий', callback_data: 'guides:townhall:15' }],
            ],
        });
    });

    it('keeps only back button when guide list is empty', () => {
        expect(makeGuideListKeyboard(11, [])).toEqual({
            inline_keyboard: [
                [{ text: '⬅️ К выбору стратегий', callback_data: 'guides:townhall:11' }],
            ],
        });
    });

    it('builds subscription settings entry button and keyboard for /link and My Clans cards', () => {
        expect(makeSubscriptionSettingsButton('#2PPLQ')).toEqual({
            text: '⚙️ Настройки',
            callback_data: 'settings:open:#2PPLQ',
        });
        expect(makeSubscriptionSettingsEntryKeyboard('#2PPLQ')).toEqual({
            inline_keyboard: [[{ text: '⚙️ Настройки', callback_data: 'settings:open:#2PPLQ' }]],
        });
    });

    it('builds subscription settings keyboard with 3 presets, 5 category toggles, back button, and extensible slots', () => {
        const keyboard = makeSubscriptionSettingsKeyboard('#2PPLQ', getPresetCategories('players'));

        expect(keyboard).toEqual({
            inline_keyboard: [
                [
                    { text: 'Игроки', callback_data: 'settings:preset:#2PPLQ:players' },
                    { text: 'Руководство', callback_data: 'settings:preset:#2PPLQ:management' },
                    { text: 'Всё вместе', callback_data: 'settings:preset:#2PPLQ:all' },
                ],
                [
                    {
                        text: '✅ Итоги и сравнения',
                        callback_data: 'settings:category:#2PPLQ:summaries',
                    },
                ],
                [{ text: '✅ Напоминания', callback_data: 'settings:category:#2PPLQ:reminders' }],
                [{ text: '✅ Кадры', callback_data: 'settings:category:#2PPLQ:roster' }],
                [
                    {
                        text: '▫️ Дисциплина и аналитика',
                        callback_data: 'settings:category:#2PPLQ:discipline',
                    },
                ],
                [
                    {
                        text: '▫️ Системные оповещения',
                        callback_data: 'settings:category:#2PPLQ:system',
                    },
                ],
                [{ text: '⬅️ Назад', callback_data: 'clans:list' }],
            ],
        });

        const extended = makeSubscriptionSettingsKeyboard(
            '#PYLQGRJCUV0289P',
            getPresetCategories('management'),
            {
                extraRows: [
                    [
                        {
                            text: '▫️ Первая атака не по зеркалу',
                            callback_data: 'settings:mirror:#PYLQGRJCUV0289P',
                        },
                    ],
                    [
                        {
                            text: '🕒 Часовой пояс: UTC+3',
                            callback_data: 'settings:tz:#PYLQGRJCUV0289P',
                        },
                    ],
                ],
                backButton: { text: '⬅️ К карточке клана', callback_data: 'clans:list' },
            },
        );

        expect(extended.inline_keyboard).toHaveLength(9);
        expect(extended.inline_keyboard[6]?.[0]?.text).toBe('▫️ Первая атака не по зеркалу');
        expect(extended.inline_keyboard[7]?.[0]?.text).toBe('🕒 Часовой пояс: UTC+3');
        expect(extended.inline_keyboard[8]?.[0]).toEqual({
            text: '⬅️ К карточке клана',
            callback_data: 'clans:list',
        });

        for (const row of extended.inline_keyboard) {
            for (const button of row) {
                expect(Buffer.byteLength(button.callback_data, 'utf8')).toBeLessThanOrEqual(
                    MAX_CALLBACK_DATA_BYTES,
                );
            }
        }
    });

    it('renders timezone button in settings keyboard when timezoneOffsetHours option is provided', () => {
        expect(makeSubscriptionSettingsTimezoneButton('#2PPLQ', -5)).toEqual({
            text: '🕒 Часовой пояс: UTC-5',
            callback_data: 'settings:tz:#2PPLQ',
        });

        const keyboard = makeSubscriptionSettingsKeyboard(
            '#2PPLQ',
            getPresetCategories('players'),
            {
                timezoneOffsetHours: 0,
            },
        );
        expect(keyboard.inline_keyboard).toHaveLength(8);
        expect(keyboard.inline_keyboard[6]).toEqual([
            { text: '🕒 Часовой пояс: UTC+0', callback_data: 'settings:tz:#2PPLQ' },
        ]);
        expect(keyboard.inline_keyboard[7]).toEqual([
            { text: '⬅️ Назад', callback_data: 'clans:list' },
        ]);
    });

    it('builds CIS quick-pick timezone keyboard with 6 presets, Other timezone button, Back button, and <= 64 byte callbacks', () => {
        const longestTag = '#PYLQGRJCUV0289P';
        const keyboard = makeTimezoneQuickSelectKeyboard(longestTag, 3);

        expect(keyboard).toEqual({
            inline_keyboard: [
                [{ text: 'UTC+2 Кишинёв', callback_data: `settings:tzset:${longestTag}:2` }],
                [
                    {
                        text: '✅ UTC+3 Москва/Минск',
                        callback_data: `settings:tzset:${longestTag}:3`,
                    },
                ],
                [{ text: 'UTC+4 Баку', callback_data: `settings:tzset:${longestTag}:4` }],
                [
                    {
                        text: 'UTC+5 Астана/Ташкент',
                        callback_data: `settings:tzset:${longestTag}:5`,
                    },
                ],
                [{ text: 'UTC+6 Бишкек', callback_data: `settings:tzset:${longestTag}:6` }],
                [{ text: 'UTC+7 Новосибирск', callback_data: `settings:tzset:${longestTag}:7` }],
                [{ text: '🌍 Другой пояс', callback_data: `settings:tzall:${longestTag}` }],
                [{ text: '⬅️ Назад', callback_data: `settings:open:${longestTag}` }],
            ],
        });

        for (const row of keyboard.inline_keyboard) {
            for (const button of row) {
                expect(Buffer.byteLength(button.callback_data, 'utf8')).toBeLessThanOrEqual(
                    MAX_CALLBACK_DATA_BYTES,
                );
            }
        }
    });

    it('builds full UTC-12..UTC+14 timezone grid in 9 rows of 3 plus Back button within 64-byte callback limit', () => {
        const longestTag = '#PYLQGRJCUV0289P';
        const keyboard = makeTimezoneAllSelectKeyboard(longestTag, -5);

        // 27 integer offsets (-12..14) / 3 = 9 rows + 1 Back row = 10 rows
        expect(keyboard.inline_keyboard).toHaveLength(10);
        const offsetButtons = keyboard.inline_keyboard.slice(0, 9).flat();
        expect(offsetButtons).toHaveLength(27);
        expect(offsetButtons[0]).toEqual({
            text: 'UTC-12',
            callback_data: `settings:tzset:${longestTag}:-12`,
        });
        expect(offsetButtons[7]).toEqual({
            text: '✅ UTC-5',
            callback_data: `settings:tzset:${longestTag}:-5`,
        });
        expect(offsetButtons[12]).toEqual({
            text: 'UTC+0',
            callback_data: `settings:tzset:${longestTag}:0`,
        });
        expect(offsetButtons[26]).toEqual({
            text: 'UTC+14',
            callback_data: `settings:tzset:${longestTag}:14`,
        });
        expect(keyboard.inline_keyboard[9]).toEqual([
            { text: '⬅️ Назад', callback_data: `settings:tz:${longestTag}` },
        ]);

        for (const row of keyboard.inline_keyboard) {
            for (const button of row) {
                expect(Buffer.byteLength(button.callback_data, 'utf8')).toBeLessThanOrEqual(
                    MAX_CALLBACK_DATA_BYTES,
                );
            }
        }
    });
});
