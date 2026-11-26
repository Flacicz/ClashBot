import { describe, expect, it } from 'vitest';

import {
    ALL_NOTIFICATION_CATEGORIES,
    ALL_SUBSCRIPTION_PRESETS,
    MAX_TIMEZONE_OFFSET_HOURS,
    MIN_TIMEZONE_OFFSET_HOURS,
} from '../../src/models/subscription.js';
import {
    buildClanUnlinkCallbackData,
    buildGuideCallbackData,
    buildSettingsCategoryCallbackData,
    buildSettingsOpenCallbackData,
    buildSettingsPresetCallbackData,
    buildSettingsTimezoneAllCallbackData,
    buildSettingsTimezoneCallbackData,
    buildSettingsTimezoneSetCallbackData,
    buildStrategyCallbackData,
    buildTownHallCallbackData,
    CALLBACK_COMMANDS,
    isWithinCallbackDataLimit,
    MAX_CALLBACK_DATA_BYTES,
    parseCallbackContext,
    parseCallbackData,
    parseKnownCallbackData,
} from '../../src/telegram/callbackData.js';

function makeValidCallbackQuery(): Record<string, unknown> {
    return {
        id: 'callback-query-id',
        data: 'guides:townhall:10',
        from: {
            id: 123456789,
        },
        message: {
            message_id: 42,
            chat: {
                id: -1001234567890,
            },
        },
    };
}

describe('parseCallbackData', () => {
    it('parses command without arguments', () => {
        expect(parseCallbackData('menu:start')).toEqual({
            command: 'menu:start',
            arguments: [],
        });
    });

    it('parses command with one argument', () => {
        expect(parseCallbackData('guides:townhall:10')).toEqual({
            command: 'guides:townhall',
            arguments: ['10'],
        });
    });

    it('preserves multiple arguments in order', () => {
        expect(parseCallbackData('guides:strategy:10:zap_dragons:classic')).toEqual({
            command: 'guides:strategy',
            arguments: ['10', 'zap_dragons', 'classic'],
        });
    });

    it('returns null when there are fewer than two parts', () => {
        expect(parseCallbackData('')).toBeNull();
        expect(parseCallbackData('menu')).toBeNull();
    });

    it('returns null when any part is empty', () => {
        const invalidData = ['guides::10', ':townhall', 'guides:townhall:', ':', '::'];

        for (const data of invalidData) {
            expect(parseCallbackData(data), `Input: ${data}`).toBeNull();
        }
    });

    it('does not validate command name at low-level parser', () => {
        expect(parseCallbackData('unknown:command:value')).toEqual({
            command: 'unknown:command',
            arguments: ['value'],
        });
    });

    it('parses clan unlink and help callbacks', () => {
        expect(parseCallbackData('clans:unlink:#2PPLQ')).toEqual({
            command: 'clans:unlink',
            arguments: ['#2PPLQ'],
        });
        expect(parseCallbackData('help:main')).toEqual({
            command: 'help:main',
            arguments: [],
        });
    });
});

describe('callback_data builders and parseKnownCallbackData', () => {
    it('builds exact C++-compatible callback_data strings', () => {
        expect(CALLBACK_COMMANDS.MENU_START).toBe('menu:start');
        expect(CALLBACK_COMMANDS.HELP_MAIN).toBe('help:main');
        expect(CALLBACK_COMMANDS.CLANS_LINK).toBe('clans:link');
        expect(CALLBACK_COMMANDS.CLANS_LIST).toBe('clans:list');
        expect(CALLBACK_COMMANDS.CLANS_UNLINK).toBe('clans:unlink');
        expect(CALLBACK_COMMANDS.GUIDES_TOWNHALLS).toBe('guides:townhalls');
        expect(buildClanUnlinkCallbackData('#2PPLQ')).toBe('clans:unlink:#2PPLQ');
        expect(buildTownHallCallbackData(12)).toBe('guides:townhall:12');
        expect(buildStrategyCallbackData(14, 'zap_dragons')).toBe('guides:strategy:14:zap_dragons');
        expect(buildGuideCallbackData(15, 'th15_root_riders')).toBe(
            'guides:guide:15:th15_root_riders',
        );
    });

    it('round-trips all known callback actions', () => {
        expect(parseKnownCallbackData('menu:start')).toEqual({ kind: 'menu:start' });
        expect(parseKnownCallbackData('help:main')).toEqual({ kind: 'help:main' });
        expect(parseKnownCallbackData('clans:link')).toEqual({ kind: 'clans:link' });
        expect(parseKnownCallbackData('clans:list')).toEqual({ kind: 'clans:list' });
        expect(parseKnownCallbackData('clans:unlink')).toEqual({
            kind: 'clans:unlink',
            clanTag: null,
        });
        expect(parseKnownCallbackData(buildClanUnlinkCallbackData('#2PPLQ'))).toEqual({
            kind: 'clans:unlink',
            clanTag: '#2PPLQ',
        });
        expect(parseKnownCallbackData('guides:townhalls')).toEqual({ kind: 'guides:townhalls' });
        expect(parseKnownCallbackData(buildTownHallCallbackData(7))).toEqual({
            kind: 'guides:townhall',
            townHall: 7,
        });
        expect(parseKnownCallbackData(buildStrategyCallbackData(18, 'root_riders'))).toEqual({
            kind: 'guides:strategy',
            townHall: 18,
            armyId: 'root_riders',
        });
        expect(parseKnownCallbackData(buildGuideCallbackData(12, 'th12_zap'))).toEqual({
            kind: 'guides:guide',
            townHall: 12,
            guideId: 'th12_zap',
        });
        expect(parseKnownCallbackData(buildSettingsOpenCallbackData('#2PPLQ'))).toEqual({
            kind: 'settings:open',
            clanTag: '#2PPLQ',
        });
        expect(parseKnownCallbackData('settings:open:2pplq')).toEqual({
            kind: 'settings:open',
            clanTag: '#2PPLQ',
        });
        for (const preset of ALL_SUBSCRIPTION_PRESETS) {
            expect(
                parseKnownCallbackData(buildSettingsPresetCallbackData('#2PPLQ', preset)),
            ).toEqual({
                kind: 'settings:preset',
                clanTag: '#2PPLQ',
                preset,
            });
        }
        for (const category of ALL_NOTIFICATION_CATEGORIES) {
            expect(
                parseKnownCallbackData(buildSettingsCategoryCallbackData('#2PPLQ', category)),
            ).toEqual({
                kind: 'settings:category',
                clanTag: '#2PPLQ',
                category,
            });
        }
        expect(parseKnownCallbackData(buildSettingsTimezoneCallbackData('#2PPLQ'))).toEqual({
            kind: 'settings:tz',
            clanTag: '#2PPLQ',
        });
        expect(parseKnownCallbackData(buildSettingsTimezoneAllCallbackData('#2PPLQ'))).toEqual({
            kind: 'settings:tzall',
            clanTag: '#2PPLQ',
        });
        for (
            let offset = MIN_TIMEZONE_OFFSET_HOURS;
            offset <= MAX_TIMEZONE_OFFSET_HOURS;
            offset += 1
        ) {
            expect(
                parseKnownCallbackData(buildSettingsTimezoneSetCallbackData('#2PPLQ', offset)),
            ).toEqual({
                kind: 'settings:tzset',
                clanTag: '#2PPLQ',
                timezoneOffsetHours: offset,
            });
        }
    });

    it('keeps all settings callback_data strictly within Telegram 64-byte UTF-8 limit even for max-length clan tags', () => {
        const longestClanTag = '#PYLQGRJCUV0289P';
        const timezoneOffsets: number[] = [];
        for (
            let offset = MIN_TIMEZONE_OFFSET_HOURS;
            offset <= MAX_TIMEZONE_OFFSET_HOURS;
            offset += 1
        ) {
            timezoneOffsets.push(offset);
        }
        const payloads: string[] = [
            buildSettingsOpenCallbackData(longestClanTag),
            buildSettingsTimezoneCallbackData(longestClanTag),
            buildSettingsTimezoneAllCallbackData(longestClanTag),
            ...ALL_SUBSCRIPTION_PRESETS.map((preset) =>
                buildSettingsPresetCallbackData(longestClanTag, preset),
            ),
            ...ALL_NOTIFICATION_CATEGORIES.map((category) =>
                buildSettingsCategoryCallbackData(longestClanTag, category),
            ),
            ...timezoneOffsets.map((offset) =>
                buildSettingsTimezoneSetCallbackData(longestClanTag, offset),
            ),
        ];

        for (const payload of payloads) {
            expect(
                Buffer.byteLength(payload, 'utf8'),
                `Payload "${payload}" exceeds ${String(MAX_CALLBACK_DATA_BYTES)} bytes`,
            ).toBeLessThanOrEqual(MAX_CALLBACK_DATA_BYTES);
            expect(isWithinCallbackDataLimit(payload)).toBe(true);
            expect(parseKnownCallbackData(payload)).not.toBeNull();
        }

        const oversized = `guides:guide:15:${'a'.repeat(60)}`;
        expect(isWithinCallbackDataLimit(oversized)).toBe(false);
        expect(parseKnownCallbackData(oversized)).toBeNull();
    });

    it('rejects unknown commands, invalid town halls, invalid settings arguments, and wrong argument counts', () => {
        const invalidCallbacks = [
            'unknown:action',
            'menu:start:extra',
            'help:main:extra',
            'clans:link:extra',
            'clans:list:extra',
            'clans:unlink:#2PPLQ:extra',
            'settings:open',
            'settings:open:#INVALID!',
            'settings:open:#2PPLQ:extra',
            'settings:preset:#2PPLQ',
            'settings:preset:#2PPLQ:unknown',
            'settings:preset:#BAD!:players',
            'settings:preset:#2PPLQ:players:extra',
            'settings:category:#2PPLQ',
            'settings:category:#2PPLQ:unknown',
            'settings:category:#BAD!:summaries',
            'settings:category:#2PPLQ:summaries:extra',
            'settings:tz',
            'settings:tz:#BAD!',
            'settings:tz:#2PPLQ:extra',
            'settings:tzall',
            'settings:tzall:#BAD!',
            'settings:tzall:#2PPLQ:extra',
            'settings:tzset:#2PPLQ',
            'settings:tzset:#BAD!:3',
            'settings:tzset:#2PPLQ:-13',
            'settings:tzset:#2PPLQ:15',
            'settings:tzset:#2PPLQ:-0',
            'settings:tzset:#2PPLQ:03',
            'settings:tzset:#2PPLQ:+3',
            'settings:tzset:#2PPLQ:3.5',
            'settings:tzset:#2PPLQ:abc',
            'settings:tzset:#2PPLQ:3:extra',
            'guides:townhalls:extra',
            'guides:townhall',
            'guides:townhall:6',
            'guides:townhall:19',
            'guides:townhall:abc',
            'guides:townhall:10:extra',
            'guides:strategy:10',
            'guides:strategy:6:zap_dragons',
            'guides:strategy:10:zap_dragons:extra',
            'guides:guide:10',
            'guides:guide:19:guide_id',
            'guides:guide:10:guide_id:extra',
            '',
            'guides::10',
        ];

        for (const data of invalidCallbacks) {
            expect(parseKnownCallbackData(data), `Input: ${data}`).toBeNull();
        }
    });
});

describe('parseCallbackContext', () => {
    it('parses all fields from a valid callback query including defaults', () => {
        const result = parseCallbackContext(makeValidCallbackQuery());

        expect(result).toEqual({
            queryId: 'callback-query-id',
            data: 'guides:townhall:10',
            chatId: -1001234567890,
            messageId: 42,
            messageThreadId: 0,
            userId: 123456789,
            chatType: '',
        });
    });

    it('parses optional message_thread_id and chat.type when present', () => {
        const query = makeValidCallbackQuery();
        const message = query.message as Record<string, unknown>;
        message.message_thread_id = 777;
        (message.chat as Record<string, unknown>).type = 'supergroup';

        const result = parseCallbackContext(query);

        expect(result).toEqual({
            queryId: 'callback-query-id',
            data: 'guides:townhall:10',
            chatId: -1001234567890,
            messageId: 42,
            messageThreadId: 777,
            userId: 123456789,
            chatType: 'supergroup',
        });
    });

    it('uses empty data when data field is missing', () => {
        const query = makeValidCallbackQuery();
        delete query.data;

        const result = parseCallbackContext(query);

        expect(result).toEqual({
            queryId: 'callback-query-id',
            data: '',
            chatId: -1001234567890,
            messageId: 42,
            messageThreadId: 0,
            userId: 123456789,
            chatType: '',
        });
    });

    it('returns null when required fields are missing or have wrong types', () => {
        const mutations: ((q: Record<string, unknown>) => void)[] = [
            (q) => {
                delete q.from;
            },
            (q) => {
                delete (q.from as Record<string, unknown>).id;
            },
            (q) => {
                (q.from as Record<string, unknown>).id = 'invalid';
            },
            (q) => {
                delete q.id;
            },
            (q) => {
                q.id = 123;
            },
            (q) => {
                q.data = 123;
            },
            (q) => {
                delete q.message;
            },
            (q) => {
                q.message = 'invalid';
            },
            (q) => {
                delete (q.message as Record<string, unknown>).chat;
            },
            (q) => {
                delete ((q.message as Record<string, unknown>).chat as Record<string, unknown>).id;
            },
            (q) => {
                ((q.message as Record<string, unknown>).chat as Record<string, unknown>).id =
                    'invalid';
            },
            (q) => {
                delete (q.message as Record<string, unknown>).message_id;
            },
            (q) => {
                (q.message as Record<string, unknown>).message_id = 'invalid';
            },
        ];

        for (const mutate of mutations) {
            const query = makeValidCallbackQuery();
            mutate(query);
            expect(parseCallbackContext(query)).toBeNull();
        }
    });

    it('returns null for empty object, null, primitives, and arrays', () => {
        expect(parseCallbackContext({})).toBeNull();
        expect(parseCallbackContext(null)).toBeNull();
        expect(parseCallbackContext(undefined)).toBeNull();
        expect(parseCallbackContext([])).toBeNull();
        expect(parseCallbackContext('string')).toBeNull();
    });
});
