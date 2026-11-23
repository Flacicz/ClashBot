import { describe, expect, it } from 'vitest';

import type { AttackGuide, AttackStrategy } from '../../src/telegram/attackGuideCatalog.js';
import {
    makeClanUnlinkKeyboard,
    makeGuideListKeyboard,
    makeGuideNavigationKeyboard,
    makeHelpNavigationKeyboard,
    makeLinkInstructionsKeyboard,
    makeMyClansNavigationKeyboard,
    makeStartMenuKeyboard,
    makeStrategyListKeyboard,
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
});
