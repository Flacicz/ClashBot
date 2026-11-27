import { z } from 'zod';

import {
    isNotificationCategory,
    isSubscriptionPreset,
    isValidTimezoneOffsetHours,
    type NotificationCategory,
    type SubscriptionPreset,
} from '../models/subscription.js';
import { parseClanTag } from './commands.js';
import { parseTownHall } from './validation.js';
import { type ViewCallbackSource, type ViewCommandName } from './viewCommon.js';

export const MAX_CALLBACK_DATA_BYTES = 64;

export const CALLBACK_COMMANDS = {
    MENU_START: 'menu:start',
    HELP_MAIN: 'help:main',
    VIEW_WAR: 'view:war',
    VIEW_CWL: 'view:cwl',
    VIEW_RAID: 'view:raid',
    CLANS_LINK: 'clans:link',
    CLANS_LIST: 'clans:list',
    CLANS_CARD: 'clans:card',
    CLANS_UNLINK: 'clans:unlink',
    CLANS_UNLINK_LIST: 'clans:unlink_list',
    CLANS_UNLINK_ASK: 'clans:unlink_ask',
    CLANS_UNLINK_CONFIRM: 'clans:unlink_confirm',
    CLANS_UNLINK_CANCEL: 'clans:unlink_cancel',
    SETTINGS_OPEN: 'settings:open',
    SETTINGS_PRESET: 'settings:preset',
    SETTINGS_CATEGORY: 'settings:category',
    SETTINGS_MIRROR: 'settings:mirror',
    SETTINGS_TZ: 'settings:tz',
    SETTINGS_TZ_ALL: 'settings:tzall',
    SETTINGS_TZ_SET: 'settings:tzset',
    GUIDES_TOWNHALLS: 'guides:townhalls',
    GUIDES_TOWNHALL: 'guides:townhall',
    GUIDES_STRATEGY: 'guides:strategy',
    GUIDES_GUIDE: 'guides:guide',
} as const;

export type UnlinkCallbackSource = 'card' | 'unlink';

export interface CallbackData {
    readonly command: string;
    readonly arguments: readonly string[];
}

export type KnownCallbackData =
    | { readonly kind: 'menu:start' }
    | { readonly kind: 'help:main' }
    | { readonly kind: 'view:open'; readonly view: ViewCommandName }
    | {
          readonly kind: 'view:clan';
          readonly view: ViewCommandName;
          readonly clanTag: string;
          readonly source: ViewCallbackSource;
      }
    | { readonly kind: 'clans:link' }
    | { readonly kind: 'clans:list'; readonly page: number }
    | { readonly kind: 'clans:card'; readonly clanTag: string; readonly page: number }
    | { readonly kind: 'clans:unlink'; readonly clanTag: string | null }
    | { readonly kind: 'clans:unlink_list'; readonly page: number }
    | {
          readonly kind: 'clans:unlink_ask';
          readonly clanTag: string;
          readonly source: UnlinkCallbackSource;
          readonly page: number;
      }
    | {
          readonly kind: 'clans:unlink_confirm';
          readonly clanTag: string;
          readonly source: UnlinkCallbackSource;
          readonly page: number;
      }
    | {
          readonly kind: 'clans:unlink_cancel';
          readonly clanTag: string;
          readonly source: UnlinkCallbackSource;
          readonly page: number;
      }
    | { readonly kind: 'settings:open'; readonly clanTag: string }
    | {
          readonly kind: 'settings:preset';
          readonly clanTag: string;
          readonly preset: SubscriptionPreset;
      }
    | {
          readonly kind: 'settings:category';
          readonly clanTag: string;
          readonly category: NotificationCategory;
      }
    | { readonly kind: 'settings:mirror'; readonly clanTag: string }
    | { readonly kind: 'settings:tz'; readonly clanTag: string }
    | { readonly kind: 'settings:tzall'; readonly clanTag: string }
    | {
          readonly kind: 'settings:tzset';
          readonly clanTag: string;
          readonly timezoneOffsetHours: number;
      }
    | { readonly kind: 'guides:townhalls' }
    | { readonly kind: 'guides:townhall'; readonly townHall: number }
    | { readonly kind: 'guides:strategy'; readonly townHall: number; readonly armyId: string }
    | { readonly kind: 'guides:guide'; readonly townHall: number; readonly guideId: string };

export interface CallbackContext {
    readonly queryId: string;
    readonly data: string;
    readonly chatId: number;
    readonly messageId: number;
    readonly messageThreadId: number;
    readonly userId: number;
    readonly chatType: string;
}

const callbackQuerySchema = z.object({
    id: z.string(),
    data: z.string().optional().default(''),
    from: z.object({
        id: z.number().int(),
    }),
    message: z.object({
        message_id: z.number().int(),
        message_thread_id: z.number().int().optional().default(0),
        chat: z.object({
            id: z.number().int(),
            type: z.string().optional().default(''),
        }),
    }),
});

export function isWithinCallbackDataLimit(data: string): boolean {
    return Buffer.byteLength(data, 'utf8') <= MAX_CALLBACK_DATA_BYTES;
}

const POSITIVE_INT_PATTERN = /^[1-9]\d*$/;

function parsePositivePage(raw: string): number | null {
    if (!POSITIVE_INT_PATTERN.test(raw)) {
        return null;
    }
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

function encodeUnlinkSource(source: UnlinkCallbackSource): 'c' | 'u' {
    return source === 'card' ? 'c' : 'u';
}

function parseUnlinkSource(raw: string): UnlinkCallbackSource | null {
    if (raw === 'c') {
        return 'card';
    }
    if (raw === 'u') {
        return 'unlink';
    }
    return null;
}

function encodeViewSource(source: ViewCallbackSource): 'm' | 'c' {
    return source === 'menu' ? 'm' : 'c';
}

function parseViewSource(raw: string): ViewCallbackSource | null {
    if (raw === 'm') {
        return 'menu';
    }
    if (raw === 'c') {
        return 'command';
    }
    return null;
}

export function buildViewEntryCallbackData(view: ViewCommandName): string {
    return `view:${view}`;
}

export function buildViewClanCallbackData(
    view: ViewCommandName,
    clanTag: string,
    source: ViewCallbackSource,
): string {
    return `view:${view}:${clanTag}:${encodeViewSource(source)}`;
}

export function buildClansListCallbackData(page = 1): string {
    return page <= 1
        ? CALLBACK_COMMANDS.CLANS_LIST
        : `${CALLBACK_COMMANDS.CLANS_LIST}:${String(page)}`;
}

export function buildClanCardCallbackData(clanTag: string, page = 1): string {
    return page <= 1
        ? `${CALLBACK_COMMANDS.CLANS_CARD}:${clanTag}`
        : `${CALLBACK_COMMANDS.CLANS_CARD}:${clanTag}:${String(page)}`;
}

export function buildClanUnlinkListCallbackData(page = 1): string {
    return page <= 1
        ? CALLBACK_COMMANDS.CLANS_UNLINK
        : `${CALLBACK_COMMANDS.CLANS_UNLINK_LIST}:${String(page)}`;
}

export function buildClanUnlinkCallbackData(clanTag: string): string {
    return `${CALLBACK_COMMANDS.CLANS_UNLINK}:${clanTag}`;
}

export function buildClanUnlinkAskCallbackData(
    clanTag: string,
    source: UnlinkCallbackSource,
    page = 1,
): string {
    return `${CALLBACK_COMMANDS.CLANS_UNLINK_ASK}:${clanTag}:${encodeUnlinkSource(source)}:${String(Math.max(1, Math.trunc(page)))}`;
}

export function buildClanUnlinkConfirmCallbackData(
    clanTag: string,
    source: UnlinkCallbackSource,
    page = 1,
): string {
    return `${CALLBACK_COMMANDS.CLANS_UNLINK_CONFIRM}:${clanTag}:${encodeUnlinkSource(source)}:${String(Math.max(1, Math.trunc(page)))}`;
}

export function buildClanUnlinkCancelCallbackData(
    clanTag: string,
    source: UnlinkCallbackSource,
    page = 1,
): string {
    return `${CALLBACK_COMMANDS.CLANS_UNLINK_CANCEL}:${clanTag}:${encodeUnlinkSource(source)}:${String(Math.max(1, Math.trunc(page)))}`;
}

export function buildSettingsOpenCallbackData(clanTag: string): string {
    return `${CALLBACK_COMMANDS.SETTINGS_OPEN}:${clanTag}`;
}

export function buildSettingsPresetCallbackData(
    clanTag: string,
    preset: SubscriptionPreset,
): string {
    return `${CALLBACK_COMMANDS.SETTINGS_PRESET}:${clanTag}:${preset}`;
}

export function buildSettingsCategoryCallbackData(
    clanTag: string,
    category: NotificationCategory,
): string {
    return `${CALLBACK_COMMANDS.SETTINGS_CATEGORY}:${clanTag}:${category}`;
}

export function buildSettingsMirrorCallbackData(clanTag: string): string {
    return `${CALLBACK_COMMANDS.SETTINGS_MIRROR}:${clanTag}`;
}

export function buildSettingsTimezoneCallbackData(clanTag: string): string {
    return `${CALLBACK_COMMANDS.SETTINGS_TZ}:${clanTag}`;
}

export function buildSettingsTimezoneAllCallbackData(clanTag: string): string {
    return `${CALLBACK_COMMANDS.SETTINGS_TZ_ALL}:${clanTag}`;
}

export function buildSettingsTimezoneSetCallbackData(
    clanTag: string,
    timezoneOffsetHours: number,
): string {
    const normalizedOffset = timezoneOffsetHours === 0 ? 0 : timezoneOffsetHours;
    return `${CALLBACK_COMMANDS.SETTINGS_TZ_SET}:${clanTag}:${String(normalizedOffset)}`;
}

export function buildTownHallCallbackData(townHall: number): string {
    return `${CALLBACK_COMMANDS.GUIDES_TOWNHALL}:${String(townHall)}`;
}

export function buildStrategyCallbackData(townHall: number, armyId: string): string {
    return `${CALLBACK_COMMANDS.GUIDES_STRATEGY}:${String(townHall)}:${armyId}`;
}

export function buildGuideCallbackData(townHall: number, guideId: string): string {
    return `${CALLBACK_COMMANDS.GUIDES_GUIDE}:${String(townHall)}:${guideId}`;
}

const TIMEZONE_OFFSET_ARG_PATTERN = /^(?:0|-?[1-9]\d?)$/;

function parseTimezoneOffsetArg(raw: string): number | null {
    if (!TIMEZONE_OFFSET_ARG_PATTERN.test(raw)) {
        return null;
    }

    const parsed = Number(raw);
    return isValidTimezoneOffsetHours(parsed) ? parsed : null;
}

export function parseCallbackData(data: string): CallbackData | null {
    const parts = data.split(':');
    if (parts.length < 2) {
        return null;
    }

    for (const part of parts) {
        if (part.length === 0) {
            return null;
        }
    }

    const prefix = parts[0];
    const action = parts[1];
    if (prefix === undefined || action === undefined) {
        return null;
    }

    return {
        command: `${prefix}:${action}`,
        arguments: parts.slice(2),
    };
}

export function parseKnownCallbackData(data: string): KnownCallbackData | null {
    if (!isWithinCallbackDataLimit(data)) {
        return null;
    }

    const parsed = parseCallbackData(data);
    if (parsed === null) {
        return null;
    }

    const args = parsed.arguments;

    switch (parsed.command) {
        case CALLBACK_COMMANDS.MENU_START:
            return args.length === 0 ? { kind: 'menu:start' } : null;
        case CALLBACK_COMMANDS.HELP_MAIN:
            return args.length === 0 ? { kind: 'help:main' } : null;
        case CALLBACK_COMMANDS.VIEW_WAR:
        case CALLBACK_COMMANDS.VIEW_CWL:
        case CALLBACK_COMMANDS.VIEW_RAID: {
            const view: ViewCommandName =
                parsed.command === CALLBACK_COMMANDS.VIEW_WAR
                    ? 'war'
                    : parsed.command === CALLBACK_COMMANDS.VIEW_CWL
                      ? 'cwl'
                      : 'raid';
            if (args.length === 0) {
                return { kind: 'view:open', view };
            }
            if (args.length === 2 && args[0] !== undefined && args[1] !== undefined) {
                const clanTag = parseClanTag(args[0]);
                const source = parseViewSource(args[1]);
                if (clanTag === null || source === null) {
                    return null;
                }
                return { kind: 'view:clan', view, clanTag, source };
            }
            return null;
        }
        case CALLBACK_COMMANDS.CLANS_LINK:
            return args.length === 0 ? { kind: 'clans:link' } : null;
        case CALLBACK_COMMANDS.CLANS_LIST: {
            if (args.length === 0) {
                return { kind: 'clans:list', page: 1 };
            }
            if (args.length === 1 && args[0] !== undefined) {
                const page = parsePositivePage(args[0]);
                return page !== null ? { kind: 'clans:list', page } : null;
            }
            return null;
        }
        case CALLBACK_COMMANDS.CLANS_CARD: {
            if (args.length === 1 && args[0] !== undefined) {
                const clanTag = parseClanTag(args[0]);
                return clanTag !== null ? { kind: 'clans:card', clanTag, page: 1 } : null;
            }
            if (args.length === 2 && args[0] !== undefined && args[1] !== undefined) {
                const clanTag = parseClanTag(args[0]);
                const page = parsePositivePage(args[1]);
                return clanTag !== null && page !== null
                    ? { kind: 'clans:card', clanTag, page }
                    : null;
            }
            return null;
        }
        case CALLBACK_COMMANDS.CLANS_UNLINK: {
            if (args.length === 0) {
                return { kind: 'clans:unlink', clanTag: null };
            }
            if (args.length === 1 && args[0] !== undefined) {
                const clanTag = parseClanTag(args[0]);
                return clanTag !== null ? { kind: 'clans:unlink', clanTag } : null;
            }
            return null;
        }
        case CALLBACK_COMMANDS.CLANS_UNLINK_LIST: {
            if (args.length !== 1 || args[0] === undefined) {
                return null;
            }
            const page = parsePositivePage(args[0]);
            return page !== null ? { kind: 'clans:unlink_list', page } : null;
        }
        case CALLBACK_COMMANDS.CLANS_UNLINK_ASK:
        case CALLBACK_COMMANDS.CLANS_UNLINK_CONFIRM:
        case CALLBACK_COMMANDS.CLANS_UNLINK_CANCEL: {
            if (
                args.length !== 3 ||
                args[0] === undefined ||
                args[1] === undefined ||
                args[2] === undefined
            ) {
                return null;
            }
            const clanTag = parseClanTag(args[0]);
            const source = parseUnlinkSource(args[1]);
            const page = parsePositivePage(args[2]);
            if (clanTag === null || source === null || page === null) {
                return null;
            }
            return { kind: parsed.command, clanTag, source, page };
        }
        case CALLBACK_COMMANDS.SETTINGS_OPEN: {
            if (args.length !== 1 || args[0] === undefined) {
                return null;
            }
            const clanTag = parseClanTag(args[0]);
            return clanTag !== null ? { kind: 'settings:open', clanTag } : null;
        }
        case CALLBACK_COMMANDS.SETTINGS_PRESET: {
            if (args.length !== 2 || args[0] === undefined || args[1] === undefined) {
                return null;
            }
            const clanTag = parseClanTag(args[0]);
            if (clanTag === null || !isSubscriptionPreset(args[1])) {
                return null;
            }
            return { kind: 'settings:preset', clanTag, preset: args[1] };
        }
        case CALLBACK_COMMANDS.SETTINGS_CATEGORY: {
            if (args.length !== 2 || args[0] === undefined || args[1] === undefined) {
                return null;
            }
            const clanTag = parseClanTag(args[0]);
            if (clanTag === null || !isNotificationCategory(args[1])) {
                return null;
            }
            return { kind: 'settings:category', clanTag, category: args[1] };
        }
        case CALLBACK_COMMANDS.SETTINGS_MIRROR: {
            if (args.length !== 1 || args[0] === undefined) {
                return null;
            }
            const clanTag = parseClanTag(args[0]);
            return clanTag !== null ? { kind: 'settings:mirror', clanTag } : null;
        }
        case CALLBACK_COMMANDS.SETTINGS_TZ: {
            if (args.length !== 1 || args[0] === undefined) {
                return null;
            }
            const clanTag = parseClanTag(args[0]);
            return clanTag !== null ? { kind: 'settings:tz', clanTag } : null;
        }
        case CALLBACK_COMMANDS.SETTINGS_TZ_ALL: {
            if (args.length !== 1 || args[0] === undefined) {
                return null;
            }
            const clanTag = parseClanTag(args[0]);
            return clanTag !== null ? { kind: 'settings:tzall', clanTag } : null;
        }
        case CALLBACK_COMMANDS.SETTINGS_TZ_SET: {
            if (args.length !== 2 || args[0] === undefined || args[1] === undefined) {
                return null;
            }
            const clanTag = parseClanTag(args[0]);
            const timezoneOffsetHours = parseTimezoneOffsetArg(args[1]);
            if (clanTag === null || timezoneOffsetHours === null) {
                return null;
            }
            return { kind: 'settings:tzset', clanTag, timezoneOffsetHours };
        }
        case CALLBACK_COMMANDS.GUIDES_TOWNHALLS:
            return args.length === 0 ? { kind: 'guides:townhalls' } : null;
        case CALLBACK_COMMANDS.GUIDES_TOWNHALL: {
            if (args.length !== 1 || args[0] === undefined) {
                return null;
            }
            const townHall = parseTownHall(args[0]);
            return townHall !== null ? { kind: 'guides:townhall', townHall } : null;
        }
        case CALLBACK_COMMANDS.GUIDES_STRATEGY: {
            if (args.length !== 2 || args[0] === undefined || args[1] === undefined) {
                return null;
            }
            const townHall = parseTownHall(args[0]);
            return townHall !== null
                ? { kind: 'guides:strategy', townHall, armyId: args[1] }
                : null;
        }
        case CALLBACK_COMMANDS.GUIDES_GUIDE: {
            if (args.length !== 2 || args[0] === undefined || args[1] === undefined) {
                return null;
            }
            const townHall = parseTownHall(args[0]);
            return townHall !== null ? { kind: 'guides:guide', townHall, guideId: args[1] } : null;
        }
        default:
            return null;
    }
}

export function parseCallbackContext(callbackQuery: unknown): CallbackContext | null {
    const result = callbackQuerySchema.safeParse(callbackQuery);
    if (!result.success) {
        return null;
    }

    const parsed = result.data;
    return {
        queryId: parsed.id,
        data: parsed.data,
        chatId: parsed.message.chat.id,
        messageId: parsed.message.message_id,
        messageThreadId: parsed.message.message_thread_id,
        userId: parsed.from.id,
        chatType: parsed.message.chat.type,
    };
}
