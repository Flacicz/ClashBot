import { formatUtcOffset } from '../common/formatUtils.js';
import {
    ALL_NOTIFICATION_CATEGORIES,
    ALL_SUBSCRIPTION_PRESETS,
    isCategoryEnabled,
    MAX_TIMEZONE_OFFSET_HOURS,
    MIN_TIMEZONE_OFFSET_HOURS,
    type SubscriptionCategories,
} from '../models/subscription.js';
import type { AttackGuide, AttackStrategy } from './attackGuideCatalog.js';
import {
    buildClanCardCallbackData,
    buildClansListCallbackData,
    buildClanUnlinkAskCallbackData,
    buildClanUnlinkCallbackData,
    buildClanUnlinkCancelCallbackData,
    buildClanUnlinkConfirmCallbackData,
    buildClanUnlinkListCallbackData,
    buildGuideCallbackData,
    buildSettingsCategoryCallbackData,
    buildSettingsMirrorCallbackData,
    buildSettingsOpenCallbackData,
    buildSettingsPresetCallbackData,
    buildSettingsTimezoneAllCallbackData,
    buildSettingsTimezoneCallbackData,
    buildSettingsTimezoneSetCallbackData,
    buildStrategyCallbackData,
    buildTownHallCallbackData,
    CALLBACK_COMMANDS,
    type UnlinkCallbackSource,
} from './callbackData.js';
import {
    CLAN_TRACKING_STATUS_ICONS,
    formatClanButtonLabel,
    type ClanTrackingStatus,
    type PaginatedSlice,
} from './myClans.js';
import {
    CIS_TIMEZONE_PRESETS,
    MIRROR_RULE_LABEL,
    NOTIFICATION_CATEGORY_LABELS,
    OTHER_TIMEZONE_BUTTON_LABEL,
    SUBSCRIPTION_PRESET_LABELS,
} from './subscriptionSettings.js';
import { MAX_TOWN_HALL, MIN_TOWN_HALL } from './validation.js';

export interface InlineKeyboardButton {
    readonly text: string;
    readonly callback_data: string;
}

export interface InlineKeyboardMarkup {
    readonly inline_keyboard: readonly (readonly InlineKeyboardButton[])[];
}

export interface SubscriptionSettingsKeyboardOptions {
    readonly timezoneOffsetHours?: number;
    readonly extraRows?: readonly (readonly InlineKeyboardButton[])[];
    readonly backButton?: InlineKeyboardButton;
}

export interface MyClansKeyboardItem {
    readonly clanTag: string;
    readonly clanName?: string | null;
    readonly status: ClanTrackingStatus;
}

export interface ClanUnlinkKeyboardItem {
    readonly clanTag: string;
    readonly clanName?: string | null;
}

const MAIN_MENU_BUTTON: InlineKeyboardButton = {
    text: '🏠 В главное меню',
    callback_data: CALLBACK_COMMANDS.MENU_START,
};

const DEFAULT_SETTINGS_BACK_BUTTON: InlineKeyboardButton = {
    text: '⬅️ Назад',
    callback_data: CALLBACK_COMMANDS.CLANS_LIST,
};

const TOWN_HALL_BUTTONS_PER_ROW = 3;
const TIMEZONE_GRID_BUTTONS_PER_ROW = 3;

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

function makePaginationRow(
    pageSlice: Pick<PaginatedSlice<unknown>, 'page' | 'totalPages' | 'hasPrev' | 'hasNext'>,
    buildPageCallbackData: (page: number) => string,
): InlineKeyboardButton[] {
    if (pageSlice.totalPages <= 1) {
        return [];
    }

    const row: InlineKeyboardButton[] = [];
    if (pageSlice.hasPrev) {
        row.push({
            text: '⬅️ Пред.',
            callback_data: buildPageCallbackData(pageSlice.page - 1),
        });
    }
    if (pageSlice.hasNext) {
        row.push({
            text: 'След. ➡️',
            callback_data: buildPageCallbackData(pageSlice.page + 1),
        });
    }
    return row;
}

export function makeMyClansListKeyboard(
    pageSlice: PaginatedSlice<MyClansKeyboardItem>,
): InlineKeyboardMarkup {
    const rows: InlineKeyboardButton[][] = pageSlice.items.map((item) => [
        {
            text: formatClanButtonLabel(
                item.clanTag,
                item.clanName,
                CLAN_TRACKING_STATUS_ICONS[item.status],
            ),
            callback_data: buildClanCardCallbackData(item.clanTag, pageSlice.page),
        },
    ]);

    const paginationRow = makePaginationRow(pageSlice, buildClansListCallbackData);
    if (paginationRow.length > 0) {
        rows.push(paginationRow);
    }

    rows.push([MAIN_MENU_BUTTON]);

    return {
        inline_keyboard: rows,
    };
}

export function makeClanCardKeyboard(clanTag: string, page = 1): InlineKeyboardMarkup {
    return {
        inline_keyboard: [
            [makeSubscriptionSettingsButton(clanTag)],
            [
                {
                    text: '❌ Отключить',
                    callback_data: buildClanUnlinkAskCallbackData(clanTag, 'card', page),
                },
            ],
            [
                {
                    text: '⬅️ Назад',
                    callback_data: buildClansListCallbackData(page),
                },
            ],
        ],
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

export function makeClanUnlinkListKeyboard(
    pageSlice: PaginatedSlice<ClanUnlinkKeyboardItem>,
): InlineKeyboardMarkup {
    const rows: InlineKeyboardButton[][] = pageSlice.items.map((item) => [
        {
            text: formatClanButtonLabel(item.clanTag, item.clanName, '❌'),
            callback_data: buildClanUnlinkAskCallbackData(item.clanTag, 'unlink', pageSlice.page),
        },
    ]);

    const paginationRow = makePaginationRow(pageSlice, buildClanUnlinkListCallbackData);
    if (paginationRow.length > 0) {
        rows.push(paginationRow);
    }

    rows.push([MAIN_MENU_BUTTON]);

    return {
        inline_keyboard: rows,
    };
}

export function makeClanUnlinkConfirmKeyboard(
    clanTag: string,
    source: UnlinkCallbackSource,
    page = 1,
): InlineKeyboardMarkup {
    return {
        inline_keyboard: [
            [
                {
                    text: 'Да, отключить',
                    callback_data: buildClanUnlinkConfirmCallbackData(clanTag, source, page),
                },
                {
                    text: 'Отмена',
                    callback_data: buildClanUnlinkCancelCallbackData(clanTag, source, page),
                },
            ],
        ],
    };
}

export function makeSubscriptionSettingsButton(clanTag: string): InlineKeyboardButton {
    return {
        text: '⚙️ Настройки',
        callback_data: buildSettingsOpenCallbackData(clanTag),
    };
}

export function makeSubscriptionSettingsEntryKeyboard(clanTag: string): InlineKeyboardMarkup {
    return {
        inline_keyboard: [[makeSubscriptionSettingsButton(clanTag)]],
    };
}

export function makeMirrorRuleToggleButton(
    clanTag: string,
    mirrorRuleEnabled: boolean,
): InlineKeyboardButton {
    const indicator = mirrorRuleEnabled ? '✅' : '▫️';
    return {
        text: `${indicator} ${MIRROR_RULE_LABEL}`,
        callback_data: buildSettingsMirrorCallbackData(clanTag),
    };
}

export function makeSubscriptionSettingsTimezoneButton(
    clanTag: string,
    timezoneOffsetHours: number,
): InlineKeyboardButton {
    return {
        text: `🕒 Часовой пояс: ${formatUtcOffset(timezoneOffsetHours)}`,
        callback_data: buildSettingsTimezoneCallbackData(clanTag),
    };
}

export function makeSubscriptionSettingsKeyboard(
    clanTag: string,
    categories: SubscriptionCategories,
    options?: SubscriptionSettingsKeyboardOptions,
): InlineKeyboardMarkup {
    const presetRow: InlineKeyboardButton[] = ALL_SUBSCRIPTION_PRESETS.map((preset) => ({
        text: SUBSCRIPTION_PRESET_LABELS[preset],
        callback_data: buildSettingsPresetCallbackData(clanTag, preset),
    }));

    const categoryRows: InlineKeyboardButton[][] = ALL_NOTIFICATION_CATEGORIES.map((category) => {
        const indicator = isCategoryEnabled(categories, category) ? '✅' : '▫️';
        return [
            {
                text: `${indicator} ${NOTIFICATION_CATEGORY_LABELS[category]}`,
                callback_data: buildSettingsCategoryCallbackData(clanTag, category),
            },
        ];
    });

    const extraRows: readonly (readonly InlineKeyboardButton[])[] = options?.extraRows ?? [];
    const timezoneRows: readonly (readonly InlineKeyboardButton[])[] =
        options?.timezoneOffsetHours !== undefined
            ? [[makeSubscriptionSettingsTimezoneButton(clanTag, options.timezoneOffsetHours)]]
            : [];
    const backButton = options?.backButton ?? DEFAULT_SETTINGS_BACK_BUTTON;

    return {
        inline_keyboard: [presetRow, ...categoryRows, ...extraRows, ...timezoneRows, [backButton]],
    };
}

export function makeTimezoneQuickSelectKeyboard(
    clanTag: string,
    currentTimezoneOffsetHours: number,
): InlineKeyboardMarkup {
    const presetRows: InlineKeyboardButton[][] = CIS_TIMEZONE_PRESETS.map((preset) => [
        {
            text:
                preset.offsetHours === currentTimezoneOffsetHours
                    ? `✅ ${preset.label}`
                    : preset.label,
            callback_data: buildSettingsTimezoneSetCallbackData(clanTag, preset.offsetHours),
        },
    ]);

    return {
        inline_keyboard: [
            ...presetRows,
            [
                {
                    text: OTHER_TIMEZONE_BUTTON_LABEL,
                    callback_data: buildSettingsTimezoneAllCallbackData(clanTag),
                },
            ],
            [
                {
                    text: '⬅️ Назад',
                    callback_data: buildSettingsOpenCallbackData(clanTag),
                },
            ],
        ],
    };
}

export function makeTimezoneAllSelectKeyboard(
    clanTag: string,
    currentTimezoneOffsetHours: number,
): InlineKeyboardMarkup {
    const rows: InlineKeyboardButton[][] = [];

    for (let offset = MIN_TIMEZONE_OFFSET_HOURS; offset <= MAX_TIMEZONE_OFFSET_HOURS; offset += 1) {
        if ((offset - MIN_TIMEZONE_OFFSET_HOURS) % TIMEZONE_GRID_BUTTONS_PER_ROW === 0) {
            rows.push([]);
        }

        const currentRow = rows[rows.length - 1];
        if (currentRow !== undefined) {
            const label = formatUtcOffset(offset);
            currentRow.push({
                text: offset === currentTimezoneOffsetHours ? `✅ ${label}` : label,
                callback_data: buildSettingsTimezoneSetCallbackData(clanTag, offset),
            });
        }
    }

    rows.push([
        {
            text: '⬅️ Назад',
            callback_data: buildSettingsTimezoneCallbackData(clanTag),
        },
    ]);

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
