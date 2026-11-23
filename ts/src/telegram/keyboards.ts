import type { AttackGuide, AttackStrategy } from './attackGuideCatalog.js';
import {
    buildClanUnlinkCallbackData,
    buildGuideCallbackData,
    buildStrategyCallbackData,
    buildTownHallCallbackData,
    CALLBACK_COMMANDS,
} from './callbackData.js';
import { MAX_TOWN_HALL, MIN_TOWN_HALL } from './validation.js';

export interface InlineKeyboardButton {
    readonly text: string;
    readonly callback_data: string;
}

export interface InlineKeyboardMarkup {
    readonly inline_keyboard: readonly (readonly InlineKeyboardButton[])[];
}

const MAIN_MENU_BUTTON: InlineKeyboardButton = {
    text: '🏠 В главное меню',
    callback_data: CALLBACK_COMMANDS.MENU_START,
};

const TOWN_HALL_BUTTONS_PER_ROW = 3;

export function makeStartMenuKeyboard(): InlineKeyboardMarkup {
    return {
        inline_keyboard: [
            [{ text: '🎥 Гайды по атакам', callback_data: CALLBACK_COMMANDS.GUIDES_TOWNHALLS }],
            [{ text: '🔗 Подключить клан', callback_data: CALLBACK_COMMANDS.CLANS_LINK }],
            [{ text: '📋 Мои кланы', callback_data: CALLBACK_COMMANDS.CLANS_LIST }],
            [{ text: '❌ Отключить клан', callback_data: CALLBACK_COMMANDS.CLANS_UNLINK }],
            [{ text: '❓ Помощь', callback_data: CALLBACK_COMMANDS.HELP_MAIN }],
        ],
    };
}

export function makeMyClansNavigationKeyboard(): InlineKeyboardMarkup {
    return {
        inline_keyboard: [[MAIN_MENU_BUTTON]],
    };
}

export function makeLinkInstructionsKeyboard(): InlineKeyboardMarkup {
    return {
        inline_keyboard: [[MAIN_MENU_BUTTON]],
    };
}

export function makeHelpNavigationKeyboard(): InlineKeyboardMarkup {
    return {
        inline_keyboard: [[MAIN_MENU_BUTTON]],
    };
}

export function makeClanUnlinkKeyboard(clanTags: readonly string[]): InlineKeyboardMarkup {
    const rows: InlineKeyboardButton[][] = clanTags.map((clanTag) => [
        {
            text: `❌ ${clanTag}`,
            callback_data: buildClanUnlinkCallbackData(clanTag),
        },
    ]);

    rows.push([MAIN_MENU_BUTTON]);

    return {
        inline_keyboard: rows,
    };
}

export function makeGuideNavigationKeyboard(
    townHall: number,
    armyId: string,
    armyTitle: string,
): InlineKeyboardMarkup {
    return {
        inline_keyboard: [
            [
                {
                    text: `⬅️ Другие гайды: ${armyTitle}`,
                    callback_data: buildStrategyCallbackData(townHall, armyId),
                },
            ],
            [
                {
                    text: '⬅️ К выбору стратегий',
                    callback_data: buildTownHallCallbackData(townHall),
                },
            ],
            [MAIN_MENU_BUTTON],
        ],
    };
}

export function makeTownHallListKeyboard(): InlineKeyboardMarkup {
    const rows: InlineKeyboardButton[][] = [];

    for (let townHall = MIN_TOWN_HALL; townHall <= MAX_TOWN_HALL; townHall += 1) {
        if ((townHall - MIN_TOWN_HALL) % TOWN_HALL_BUTTONS_PER_ROW === 0) {
            rows.push([]);
        }

        const currentRow = rows[rows.length - 1];
        if (currentRow !== undefined) {
            currentRow.push({
                text: `Ратуша ${String(townHall)}`,
                callback_data: buildTownHallCallbackData(townHall),
            });
        }
    }

    return {
        inline_keyboard: rows,
    };
}

export function makeStrategyListKeyboard(
    townHall: number,
    strategies: readonly AttackStrategy[],
): InlineKeyboardMarkup {
    const rows: InlineKeyboardButton[][] = strategies.map((strategy) => [
        {
            text: strategy.title,
            callback_data: buildStrategyCallbackData(townHall, strategy.id),
        },
    ]);

    rows.push([
        {
            text: '⬅️ К выбору ратуши',
            callback_data: CALLBACK_COMMANDS.GUIDES_TOWNHALLS,
        },
    ]);

    return {
        inline_keyboard: rows,
    };
}

export function makeGuideListKeyboard(
    townHall: number,
    guides: readonly AttackGuide[],
): InlineKeyboardMarkup {
    const rows: InlineKeyboardButton[][] = guides.map((guide) => [
        {
            text: guide.title,
            callback_data: buildGuideCallbackData(townHall, guide.id),
        },
    ]);

    rows.push([
        {
            text: '⬅️ К выбору стратегий',
            callback_data: buildTownHallCallbackData(townHall),
        },
    ]);

    return {
        inline_keyboard: rows,
    };
}
