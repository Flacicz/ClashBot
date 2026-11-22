import { z } from 'zod';

import { parseTownHall } from './validation.js';

export const CALLBACK_COMMANDS = {
    MENU_START: 'menu:start',
    HELP_MAIN: 'help:main',
    CLANS_LINK: 'clans:link',
    CLANS_LIST: 'clans:list',
    CLANS_UNLINK: 'clans:unlink',
    GUIDES_TOWNHALLS: 'guides:townhalls',
    GUIDES_TOWNHALL: 'guides:townhall',
    GUIDES_STRATEGY: 'guides:strategy',
    GUIDES_GUIDE: 'guides:guide',
} as const;

export interface CallbackData {
    readonly command: string;
    readonly arguments: readonly string[];
}

export type KnownCallbackData =
    | { readonly kind: 'menu:start' }
    | { readonly kind: 'help:main' }
    | { readonly kind: 'clans:link' }
    | { readonly kind: 'clans:list' }
    | { readonly kind: 'clans:unlink'; readonly clanTag: string | null }
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

export function buildClanUnlinkCallbackData(clanTag: string): string {
    return `${CALLBACK_COMMANDS.CLANS_UNLINK}:${clanTag}`;
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
        case CALLBACK_COMMANDS.CLANS_LINK:
            return args.length === 0 ? { kind: 'clans:link' } : null;
        case CALLBACK_COMMANDS.CLANS_LIST:
            return args.length === 0 ? { kind: 'clans:list' } : null;
        case CALLBACK_COMMANDS.CLANS_UNLINK:
            if (args.length === 0) {
                return { kind: 'clans:unlink', clanTag: null };
            }
            if (args.length === 1 && args[0] !== undefined) {
                return { kind: 'clans:unlink', clanTag: args[0] };
            }
            return null;
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
