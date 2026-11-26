import path from 'node:path';

import type { Context } from 'grammy';
import type { ApiResponse, ChatMember, Update, UserFromGetMe } from 'grammy/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CocApiError } from '../../src/api/errors.js';
import type { CompleteClanData } from '../../src/api/models.js';
import { DatabaseError } from '../../src/common/errors.js';
import {
    ClansRepo,
    Database,
    DomainEventsRepo,
    MigratorManager,
    NotificationRepo,
    SubscriptionRepo,
    TransactionManager,
} from '../../src/database/index.js';
import { DomainEventPayloadSerializer, DomainEventRecorder } from '../../src/domainEvents/index.js';
import { createLogger, type Logger } from '../../src/logging/index.js';
import { ClanInfoService, type WakeableClanManager } from '../../src/services/index.js';
import {
    AttackGuideCatalog,
    type ClanLookupApiClient,
    DEFERRED_SYNC_HINT_TEXT,
    PRIVATE_WAR_LOG_WARNING_TEXT,
    SUPERCELL_FAN_CONTENT_DISCLAIMER,
    TELEGRAM_BOT_ALLOWED_UPDATES,
    TELEGRAM_BOT_COMMANDS,
    TELEGRAM_BOT_DESCRIPTION,
    TELEGRAM_BOT_SHORT_DESCRIPTION,
    TelegramBotService,
} from '../../src/telegram/index.js';
import { type LoopbackServer, startLoopbackServer } from '../api/helpers/loopbackServer.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');

const TEST_BOT_INFO: UserFromGetMe = {
    id: 999000,
    is_bot: true,
    first_name: 'ClashBot',
    username: 'ClashTestBot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: true,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
};

type GrammyAbortSignal = Parameters<Context['api']['getChatMember']>[2];

interface RecordedApiCall {
    readonly method: string;
    readonly payload: Record<string, unknown>;
}

interface FakeTelegramTransport {
    readonly calls: RecordedApiCall[];
    readonly chatMembers: Map<string, ChatMember['status']>;
    failGetChatMember: boolean;
    failAnswerCallbackQuery: boolean;
    failSendMessage: boolean;
    failSetMyCommands: boolean;
    failSetMyDescription: boolean;
    failSetMyShortDescription: boolean;
    getUpdatesResponder?: (
        payload: Record<string, unknown>,
        signal?: GrammyAbortSignal,
    ) => Promise<ApiResponse<unknown>>;
    getChatMemberResponder?: (
        payload: Record<string, unknown>,
        signal?: GrammyAbortSignal,
    ) => Promise<ApiResponse<unknown>>;
    editMessageTextResponder?: (
        payload: Record<string, unknown>,
        signal?: GrammyAbortSignal,
    ) => Promise<ApiResponse<unknown>>;
    install(service: TelegramBotService): void;
    sentMessages(): Record<string, unknown>[];
    editedMessages(): Record<string, unknown>[];
    answeredCallbackQueries(): Record<string, unknown>[];
}

function memberKey(chatId: number, userId: number): string {
    return `${String(chatId)}:${String(userId)}`;
}

function createFakeTelegramTransport(db: Database): FakeTelegramTransport {
    const calls: RecordedApiCall[] = [];
    const chatMembers = new Map<string, ChatMember['status']>();
    let nextMessageId = 1000;

    const transport: FakeTelegramTransport = {
        calls,
        chatMembers,
        failGetChatMember: false,
        failAnswerCallbackQuery: false,
        failSendMessage: false,
        failSetMyCommands: false,
        failSetMyDescription: false,
        failSetMyShortDescription: false,
        install(service: TelegramBotService): void {
            service.bot.api.config.use(async (_prev, method, payload, signal) => {
                // Pure transactions invariant: no Telegram API call may ever occur inside an open SQLite transaction.
                expect(db.connection.inTransaction).toBe(false);

                const payloadRecord = payload as Record<string, unknown>;
                calls.push({ method, payload: { ...payloadRecord } });

                if (signal?.aborted) {
                    const abortError = new Error('The operation was aborted');
                    abortError.name = 'AbortError';
                    throw abortError;
                }

                if (method === 'getMe') {
                    return { ok: true, result: TEST_BOT_INFO } as ApiResponse<never>;
                }

                if (method === 'deleteWebhook') {
                    return { ok: true, result: true } as ApiResponse<never>;
                }

                if (method === 'setMyCommands') {
                    if (transport.failSetMyCommands) {
                        return {
                            ok: false,
                            error_code: 400,
                            description: 'Bad Request: failed to set commands',
                        };
                    }
                    return { ok: true, result: true } as ApiResponse<never>;
                }

                if (method === 'setMyDescription') {
                    if (transport.failSetMyDescription) {
                        return {
                            ok: false,
                            error_code: 400,
                            description: 'Bad Request: failed to set description',
                        };
                    }
                    return { ok: true, result: true } as ApiResponse<never>;
                }

                if (method === 'setMyShortDescription') {
                    if (transport.failSetMyShortDescription) {
                        return {
                            ok: false,
                            error_code: 400,
                            description: 'Bad Request: failed to set short description',
                        };
                    }
                    return { ok: true, result: true } as ApiResponse<never>;
                }

                if (method === 'getUpdates') {
                    if (transport.getUpdatesResponder !== undefined) {
                        return (await transport.getUpdatesResponder(
                            payloadRecord,
                            signal,
                        )) as ApiResponse<never>;
                    }
                    return { ok: true, result: [] } as ApiResponse<never>;
                }

                if (method === 'getChatMember') {
                    if (transport.getChatMemberResponder !== undefined) {
                        return (await transport.getChatMemberResponder(
                            payloadRecord,
                            signal,
                        )) as ApiResponse<never>;
                    }
                    if (transport.failGetChatMember) {
                        return {
                            ok: false,
                            error_code: 400,
                            description: 'Bad Request: user not found',
                        };
                    }
                    const chatId = Number(payloadRecord.chat_id);
                    const userId = Number(payloadRecord.user_id);
                    const status = chatMembers.get(memberKey(chatId, userId)) ?? 'member';
                    return {
                        ok: true,
                        result: {
                            status,
                            user: {
                                id: userId,
                                is_bot: false,
                                first_name: 'User',
                            },
                        },
                    } as ApiResponse<never>;
                }

                if (method === 'answerCallbackQuery') {
                    if (transport.failAnswerCallbackQuery) {
                        return {
                            ok: false,
                            error_code: 400,
                            description: 'Bad Request: query is too old',
                        };
                    }
                    return { ok: true, result: true } as ApiResponse<never>;
                }

                if (method === 'sendMessage') {
                    if (transport.failSendMessage) {
                        return {
                            ok: false,
                            error_code: 403,
                            description: 'Forbidden: bot was blocked by the user',
                        };
                    }
                    const messageId = nextMessageId;
                    nextMessageId += 1;
                    return {
                        ok: true,
                        result: {
                            message_id: messageId,
                            date: 1_700_000_000,
                            chat: { id: Number(payloadRecord.chat_id), type: 'private' },
                            text: typeof payloadRecord.text === 'string' ? payloadRecord.text : '',
                        },
                    } as ApiResponse<never>;
                }

                if (method === 'editMessageText') {
                    if (transport.editMessageTextResponder !== undefined) {
                        return (await transport.editMessageTextResponder(
                            payloadRecord,
                            signal,
                        )) as ApiResponse<never>;
                    }
                    return { ok: true, result: true } as ApiResponse<never>;
                }

                throw new Error(`Unexpected Telegram API method in test: ${method}`);
            });
        },
        sentMessages(): Record<string, unknown>[] {
            return calls.filter((call) => call.method === 'sendMessage').map((c) => c.payload);
        },
        editedMessages(): Record<string, unknown>[] {
            return calls.filter((call) => call.method === 'editMessageText').map((c) => c.payload);
        },
        answeredCallbackQueries(): Record<string, unknown>[] {
            return calls
                .filter((call) => call.method === 'answerCallbackQuery')
                .map((c) => c.payload);
        },
    };

    return transport;
}

function createTestCatalog(): AttackGuideCatalog {
    return AttackGuideCatalog.fromJson({
        guides: [
            {
                id: 'zap_dragons_th14',
                army_id: 'zap_dragons',
                army_title: 'Zap Dragons',
                variant_id: 'classic',
                variant_title: 'Classic',
                title: 'Zap Dragons TH14',
                town_halls: [14],
                youtube_url: 'https://youtube.example/zap-dragons-th14',
                sort_order: 1,
                enabled: true,
            },
            {
                id: 'universal_funnel',
                army_id: 'fundamentals',
                army_title: 'Фаннелинг',
                variant_id: 'basic',
                variant_title: 'База',
                title: 'Универсальный гайд по фаннелингу',
                town_halls: [],
                youtube_url: 'https://youtube.example/funnel',
                sort_order: 2,
                enabled: true,
            },
            {
                id: 'disabled_guide',
                army_id: 'disabled_army',
                army_title: 'Disabled',
                variant_id: 'v1',
                variant_title: 'V1',
                title: 'Hidden Guide',
                town_halls: [14],
                youtube_url: 'https://youtube.example/hidden',
                sort_order: 3,
                enabled: false,
            },
        ],
    });
}

function makeMessageUpdate(params: {
    readonly updateId?: number;
    readonly chatId: number;
    readonly chatType: 'private' | 'group' | 'supergroup' | 'channel';
    readonly text?: string;
    readonly userId?: number;
    readonly messageThreadId?: number;
    readonly title?: string;
    readonly firstName?: string;
    readonly lastName?: string;
    readonly username?: string;
    readonly omitFrom?: boolean;
}): Update {
    const chat: Record<string, unknown> = {
        id: params.chatId,
        type: params.chatType,
    };
    if (params.title !== undefined) {
        chat.title = params.title;
    }
    if (params.firstName !== undefined) {
        chat.first_name = params.firstName;
    }
    if (params.lastName !== undefined) {
        chat.last_name = params.lastName;
    }
    if (params.username !== undefined) {
        chat.username = params.username;
    }

    const message: Record<string, unknown> = {
        message_id: params.updateId ?? 1,
        date: 1_700_000_000,
        chat,
    };

    if (!params.omitFrom) {
        message.from = {
            id: params.userId ?? params.chatId,
            is_bot: false,
            first_name: params.firstName ?? 'Tester',
        };
    }

    if (params.text !== undefined) {
        message.text = params.text;
    }

    if (params.messageThreadId !== undefined) {
        message.message_thread_id = params.messageThreadId;
    }

    return {
        update_id: params.updateId ?? 1,
        message,
    } as unknown as Update;
}

function makeCallbackUpdate(params: {
    readonly updateId?: number;
    readonly queryId?: string;
    readonly data?: string;
    readonly chatId?: number;
    readonly chatType?: 'private' | 'group' | 'supergroup' | 'channel';
    readonly userId?: number;
    readonly messageId?: number;
    readonly messageThreadId?: number;
    readonly omitMessage?: boolean;
}): Update {
    const chatId = params.chatId ?? 5001;
    const chatType = params.chatType ?? 'private';
    const userId = params.userId ?? 5001;

    const callbackQuery: Record<string, unknown> = {
        id: params.queryId ?? 'callback-query-id',
        from: {
            id: userId,
            is_bot: false,
            first_name: 'Tester',
        },
        chat_instance: 'test-instance',
    };

    if (params.data !== undefined) {
        callbackQuery.data = params.data;
    }

    if (!params.omitMessage) {
        const message: Record<string, unknown> = {
            message_id: params.messageId ?? 77,
            date: 1_700_000_000,
            chat: {
                id: chatId,
                type: chatType,
            },
        };
        if (params.messageThreadId !== undefined) {
            message.message_thread_id = params.messageThreadId;
        }
        callbackQuery.message = message;
    }

    return {
        update_id: params.updateId ?? 100,
        callback_query: callbackQuery,
    } as unknown as Update;
}

function rowStatus(
    db: Database,
    table: 'domain_event_destinations' | 'notifications',
    id: number,
): string {
    const row = db.connection
        .prepare<[number], { status: string }>(`SELECT status FROM ${table} WHERE id = ?;`)
        .get(id);
    if (row === undefined) {
        throw new Error(`Row ${String(id)} not found in ${table}`);
    }
    return row.status;
}

function getInlineKeyboard(payload: Record<string, unknown> | undefined): readonly (readonly {
    readonly text: string;
    readonly callback_data: string;
}[])[] {
    expect(payload).toBeDefined();
    const replyMarkup = payload?.reply_markup as {
        readonly inline_keyboard: readonly (readonly {
            readonly text: string;
            readonly callback_data: string;
        }[])[];
    };
    return replyMarkup.inline_keyboard;
}

function makeCompleteClanData(overrides?: {
    readonly tag?: string;
    readonly name?: string;
    readonly membersCount?: number;
    readonly isWarLogPublic?: boolean;
}): CompleteClanData {
    const tag = overrides?.tag ?? '#2PPLQ';
    const name = overrides?.name ?? 'Dark Dragons';
    const membersCount = overrides?.membersCount ?? 45;
    const isWarLogPublic = overrides?.isWarLogPublic ?? true;

    return {
        clan: {
            tag,
            name,
            description: 'Active war clan',
            locationId: 32000193,
            locationName: 'Russia',
            chatLanguageId: 75000011,
            chatLanguage: 'Russian',
            isFamilyFriendly: false,
        },
        clanSnapshot: {
            clanTag: tag,
            type: 'inviteOnly',
            membersCount,
            clanLevel: 18,
            clanPoints: 45_000,
            clanBuilderBasePoints: 30_000,
            clanCapitalPoints: 4_200,
            capitalHallLevel: 10,
            capitalLeagueId: 85000018,
            requiredTrophies: 2_000,
            requiredBuilderBaseTrophies: 1_000,
            requiredTownhallLevel: 13,
            warFrequency: 'always',
            isWarLogPublic,
            warWinStreak: 7,
            warWins: 210,
            warTies: 5,
            warLosses: 50,
            warLeagueId: 48000013,
        },
        players: [
            { tag: '#PLAYER1', name: 'Chief One', clanTag: tag },
            { tag: '#PLAYER2', name: 'Chief Two', clanTag: tag },
        ],
        playerSnapshots: [
            {
                playerTag: '#PLAYER1',
                clanTag: tag,
                role: 'leader',
                townHallLevel: 16,
                expLevel: 230,
                clanRank: 1,
                leagueId: 29000022,
                builderBaseLeagueId: 44000010,
                trophies: 5_400,
                builderBaseTrophies: 4_000,
                donations: 1_500,
                donationsReceived: 800,
            },
            {
                playerTag: '#PLAYER2',
                clanTag: tag,
                role: 'member',
                townHallLevel: 15,
                expLevel: 210,
                clanRank: 2,
                leagueId: 29000021,
                builderBaseLeagueId: 44000010,
                trophies: 5_000,
                builderBaseTrophies: 3_500,
                donations: 600,
                donationsReceived: 700,
            },
        ],
    };
}

interface TestHarness {
    readonly db: Database;
    readonly clansRepo: ClansRepo;
    readonly subscriptionRepo: SubscriptionRepo;
    readonly domainEventsRepo: DomainEventsRepo;
    readonly notificationRepo: NotificationRepo;
    readonly transactionManager: TransactionManager;
    readonly transport: FakeTelegramTransport;
    readonly service: TelegramBotService;
}

describe('TelegramBotService', () => {
    const openDatabases: Database[] = [];
    const openServers: LoopbackServer[] = [];

    function createHarness(options?: {
        readonly skipBotInfo?: boolean;
        readonly pollingTimeoutSeconds?: number;
        readonly stopConfirmationTimeoutMs?: number;
        readonly cocApiClient?: ClanLookupApiClient;
        readonly clanManager?: WakeableClanManager;
        readonly logger?: Logger;
    }): TestHarness {
        const db = new Database(':memory:');
        openDatabases.push(db);
        const transactionManager = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactionManager);
        migrator.migrate(REAL_MIGRATIONS_PATH);

        const clansRepo = new ClansRepo(db);
        const subscriptionRepo = new SubscriptionRepo(db);
        const domainEventsRepo = new DomainEventsRepo(db);
        const notificationRepo = new NotificationRepo(db);
        const logger = options?.logger ?? createLogger({ level: 'silent' });
        const transport = createFakeTelegramTransport(db);

        const service = new TelegramBotService({
            telegramToken: 'test-bot-token',
            attackGuideCatalog: createTestCatalog(),
            clansRepo,
            subscriptionRepo,
            domainEventsRepo,
            notificationRepo,
            transactionManager,
            logger,
            ...(options?.cocApiClient !== undefined ? { cocApiClient: options.cocApiClient } : {}),
            ...(options?.clanManager !== undefined ? { clanManager: options.clanManager } : {}),
            ...(options?.pollingTimeoutSeconds !== undefined
                ? { pollingTimeoutSeconds: options.pollingTimeoutSeconds }
                : {}),
            ...(options?.stopConfirmationTimeoutMs !== undefined
                ? { stopConfirmationTimeoutMs: options.stopConfirmationTimeoutMs }
                : {}),
            ...(options?.skipBotInfo ? {} : { botConfig: { botInfo: TEST_BOT_INFO } }),
        });

        transport.install(service);

        return {
            db,
            clansRepo,
            subscriptionRepo,
            domainEventsRepo,
            notificationRepo,
            transactionManager,
            transport,
            service,
        };
    }

    afterEach(async () => {
        while (openServers.length > 0) {
            await openServers.pop()?.close();
        }
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    describe('commands: /start, /help, unknown commands and ignored messages', () => {
        it('sends the main menu on /start without disclaimer, preserving forum topic message_thread_id', async () => {
            const { service, transport } = createHarness();

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 12,
                    chatId: 1011,
                    chatType: 'private',
                    text: '/start@ClashTestBot',
                    messageThreadId: 13,
                }),
            );

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(1);
            expect(sent[0]?.chat_id).toBe(1011);
            expect(sent[0]?.message_thread_id).toBe(13);
            expect(sent[0]?.parse_mode).toBe('HTML');
            const text = String(sent[0]?.text);
            expect(text).toContain('Добро пожаловать');
            expect(text).not.toContain('Supercell');
            expect(text).not.toContain('fan-content-policy');
            const keyboard = getInlineKeyboard(sent[0]);
            expect(keyboard[0]?.[0]?.callback_data).toBe('guides:townhalls');
            expect(keyboard[1]?.[0]?.callback_data).toBe('clans:link');
            expect(keyboard[2]?.[0]?.callback_data).toBe('clans:list');
            expect(keyboard[3]?.[0]?.callback_data).toBe('clans:unlink');
            expect(keyboard[4]?.[0]?.callback_data).toBe('help:main');
        });

        it('handles /start <arg> the same as /start, omits message_thread_id in general chats, and ignores non-command messages', async () => {
            const { service, transport } = createHarness();

            await service.bot.handleUpdate(
                makeMessageUpdate({ chatId: 1011, chatType: 'private', text: '/start' }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: 1011,
                    chatType: 'private',
                    text: '/start deep_link_payload',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: -1012,
                    chatType: 'supergroup',
                    messageThreadId: 9,
                    text: '/start@ClashTestBot ref123 extra',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({ chatId: 1011, chatType: 'private', text: 'hello world' }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({ chatId: 1011, chatType: 'private' }),
            );

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(3);
            expect(sent[0]?.message_thread_id).toBeUndefined();
            expect(sent[1]?.message_thread_id).toBeUndefined();
            expect(sent[1]?.text).toBe(sent[0]?.text);
            expect(getInlineKeyboard(sent[1])).toEqual(getInlineKeyboard(sent[0]));
            expect(sent[2]?.message_thread_id).toBe(9);
            expect(sent[2]?.text).toBe(sent[0]?.text);
        });

        it('handles /help with commands, permissions, presets and Supercell Fan Content Policy disclaimer', async () => {
            const { service, transport } = createHarness();

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 20,
                    chatId: 1011,
                    chatType: 'private',
                    text: '/help',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 21,
                    chatId: -1015,
                    chatType: 'supergroup',
                    messageThreadId: 19,
                    text: '/help@ClashTestBot',
                }),
            );

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(2);
            expect(sent[0]?.chat_id).toBe(1011);
            expect(sent[0]?.message_thread_id).toBeUndefined();
            expect(sent[0]?.parse_mode).toBe('HTML');
            expect(sent[1]?.chat_id).toBe(-1015);
            expect(sent[1]?.message_thread_id).toBe(19);
            expect(sent[1]?.text).toBe(sent[0]?.text);

            const helpText = String(sent[0]?.text);
            expect(helpText).toContain('Помощь');
            expect(helpText).toContain('/start');
            expect(helpText).toContain('/help');
            expect(helpText).toContain('/link #ТЕГ_КЛАНА');
            expect(helpText).toContain('/unlink #ТЕГ_КЛАНА');
            expect(helpText).toContain('администраторы');
            expect(helpText).toContain('«Игроки»');
            expect(helpText).toContain('«Руководство»');
            expect(helpText).toContain('«Всё вместе»');
            expect(helpText).toContain(SUPERCELL_FAN_CONTENT_DISCLAIMER);
            expect(getInlineKeyboard(sent[0])[0]?.[0]?.callback_data).toBe('menu:start');
        });

        it('replies to unknown commands in private chats and stays silent in groups, supergroups and channels', async () => {
            const { service, transport } = createHarness();

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 30,
                    chatId: 1011,
                    chatType: 'private',
                    text: '/unknown #2PPLQ',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 31,
                    chatId: 1011,
                    chatType: 'private',
                    messageThreadId: 5,
                    text: '/foo@ClashTestBot',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 32,
                    chatId: -2001,
                    chatType: 'group',
                    userId: 42,
                    text: '/unknown',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 33,
                    chatId: -2002,
                    chatType: 'supergroup',
                    userId: 42,
                    text: '/unknown@ClashTestBot',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 34,
                    chatId: -2003,
                    chatType: 'channel',
                    userId: 42,
                    text: '/unknown',
                }),
            );

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(2);
            expect(sent[0]?.chat_id).toBe(1011);
            expect(sent[0]?.message_thread_id).toBeUndefined();
            expect(sent[0]?.text).toBe('Не знаю такой команды, см. /help');
            expect(sent[1]?.chat_id).toBe(1011);
            expect(sent[1]?.message_thread_id).toBe(5);
            expect(sent[1]?.text).toBe('Не знаю такой команды, см. /help');
        });

        it('ignores /start, /help, /link, /unlink and unknown commands addressed to another bot without side effects', async () => {
            const { service, transport, subscriptionRepo } = createHarness();
            const chatId = -1001;
            const userId = 42;
            transport.chatMembers.set(memberKey(chatId, userId), 'administrator');

            // Seed an existing subscription so /unlink@OtherBot proves it does not remove it.
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 1,
                    chatId,
                    chatType: 'supergroup',
                    title: 'Clan chat',
                    userId,
                    text: '/link #2PPLQ',
                }),
            );
            const subscriptionIdBefore = subscriptionRepo.getSubscriptionId(chatId, 0, '#2PPLQ');
            expect(subscriptionIdBefore).not.toBeNull();

            const callsBefore = transport.calls.length;

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 2,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/start@OtherBot payload',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 3,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/help@OtherBot',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 4,
                    chatId: 1011,
                    chatType: 'private',
                    userId: 1011,
                    text: '/unknown@OtherBot',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 5,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/link@OtherBot #2PP',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 6,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/link@OtherBot',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 7,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/link@OtherBot #INVALID',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 8,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/unlink@OtherBot #2PPLQ',
                }),
            );

            expect(transport.calls).toHaveLength(callsBefore);
            expect(subscriptionRepo.hasSubscription(chatId, 0, '#2PP')).toBe(false);
            expect(subscriptionRepo.getSubscriptionId(chatId, 0, '#2PPLQ')).toBe(
                subscriptionIdBefore,
            );
        });

        it('executes /start, /link, and /unlink addressed to own bot username case-insensitively', async () => {
            const { service, transport, subscriptionRepo } = createHarness();
            const chatId = -1002;
            const userId = 43;
            transport.chatMembers.set(memberKey(chatId, userId), 'administrator');

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 10,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/start@clashtestbot',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 11,
                    chatId,
                    chatType: 'supergroup',
                    title: 'Clan chat',
                    userId,
                    text: '/link@CLASHTESTBOT #2PPLQ',
                }),
            );

            expect(subscriptionRepo.hasSubscription(chatId, 0, '#2PPLQ')).toBe(true);

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 12,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/unlink@cLaShTeStBoT #2PPLQ',
                }),
            );

            expect(subscriptionRepo.hasSubscription(chatId, 0, '#2PPLQ')).toBe(false);
            expect(transport.sentMessages()).toHaveLength(3);
        });
    });

    describe('command: /link', () => {
        it('links a supergroup forum topic for an administrator with players preset by default (fallback without CoC API client)', async () => {
            const { service, transport, subscriptionRepo, clansRepo, db } = createHarness();
            const chatId = -1001;
            const userId = 42;
            const threadId = 17;

            transport.chatMembers.set(memberKey(chatId, userId), 'administrator');

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId,
                    chatType: 'supergroup',
                    title: 'Clan chat',
                    userId,
                    text: '/link@ClashTestBot 2pplq',
                    messageThreadId: threadId,
                }),
            );

            expect(subscriptionRepo.hasSubscription(chatId, threadId, '#2PPLQ')).toBe(true);
            expect(subscriptionRepo.getSubscription(chatId, threadId, '#2PPLQ')).toMatchObject({
                clanTag: '#2PPLQ',
                chatId,
                messageThreadId: threadId,
                categories: {
                    summaries: true,
                    reminders: true,
                    roster: true,
                    discipline: false,
                    system: false,
                },
                mirrorRuleEnabled: false,
                timezoneOffsetHours: 3,
            });
            expect(clansRepo.getTrackedClans()).toEqual(['#2PPLQ']);
            expect(clansRepo.getClanNameByTag('#2PPLQ')).toBe('Pending synchronization');

            const titleRow = db.connection
                .prepare<[number, number], { title: string }>(
                    'SELECT title FROM telegram_chats WHERE chat_id = ? AND message_thread_id = ?;',
                )
                .get(chatId, threadId);
            expect(titleRow?.title).toBe('Clan chat');

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(1);
            expect(sent[0]?.message_thread_id).toBe(threadId);
            expect(String(sent[0]?.text)).toContain('Подключён клан #2PPLQ.');
            expect(String(sent[0]?.text)).toContain(DEFERRED_SYNC_HINT_TEXT);
            expect(String(sent[0]?.text)).toContain('«Игроки»');
            expect(getInlineKeyboard(sent[0])).toEqual([
                [{ text: '⚙️ Настройки', callback_data: 'settings:open:#2PPLQ' }],
            ]);
        });

        it('links a private chat with management preset without calling getChatMember and resolves title fallbacks', async () => {
            const { service, transport, subscriptionRepo, db } = createHarness();

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: 1003,
                    chatType: 'private',
                    userId: 1003,
                    firstName: 'Clan',
                    lastName: 'Leader',
                    text: '/link #2PPLQ',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: 1004,
                    chatType: 'private',
                    userId: 1004,
                    username: 'leader_handle',
                    text: '/link #2PPLQ',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: 1005,
                    chatType: 'private',
                    userId: 1005,
                    text: '/link #2PPLQ',
                }),
            );

            expect(transport.calls.some((call) => call.method === 'getChatMember')).toBe(false);
            expect(subscriptionRepo.hasSubscription(1003, 0, '#2PPLQ')).toBe(true);
            expect(subscriptionRepo.getSubscription(1003, 0, '#2PPLQ')).toMatchObject({
                categories: {
                    summaries: false,
                    reminders: false,
                    roster: false,
                    discipline: true,
                    system: true,
                },
                mirrorRuleEnabled: false,
                timezoneOffsetHours: 3,
            });

            const getTitle = (chatId: number): string | undefined =>
                db.connection
                    .prepare<[number], { title: string }>(
                        'SELECT title FROM telegram_chats WHERE chat_id = ? AND message_thread_id = 0;',
                    )
                    .get(chatId)?.title;

            expect(getTitle(1003)).toBe('Clan Leader');
            expect(getTitle(1004)).toBe('leader_handle');
            expect(getTitle(1005)).toBe('Telegram-чат');

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(3);
            expect(String(sent[0]?.text)).toContain('Подключён клан #2PPLQ.');
            expect(String(sent[0]?.text)).toContain('«Руководство»');
            expect(String(sent[1]?.text)).toContain('Клан уже отслеживается в других чатах');
            expect(String(sent[1]?.text)).toContain('этот личный чат подключён');
            expect(getInlineKeyboard(sent[0])).toEqual([
                [{ text: '⚙️ Настройки', callback_data: 'settings:open:#2PPLQ' }],
            ]);
        });

        it('fetches clan from CoC API strictly outside SQLite transaction on /link, saves clan metadata and snapshot, replies with name, member count, preset and settings button, and preserves initial sync semantics', async () => {
            const observedInTransaction: boolean[] = [];
            const clanData = makeCompleteClanData({
                tag: '#2PPLQ',
                name: 'Dark <Dragons>',
                membersCount: 42,
                isWarLogPublic: true,
            });
            const getCompleteClanData = vi.fn<ClanLookupApiClient['getCompleteClanData']>();
            const notify = vi.fn();

            const {
                service,
                transport,
                clansRepo,
                subscriptionRepo,
                domainEventsRepo,
                transactionManager,
                db,
            } = createHarness({
                cocApiClient: { getCompleteClanData },
                clanManager: { notify },
            });
            getCompleteClanData.mockImplementation(async () => {
                observedInTransaction.push(db.connection.inTransaction);
                return await Promise.resolve(clanData);
            });

            const chatId = -1001;
            const userId = 42;
            transport.chatMembers.set(memberKey(chatId, userId), 'administrator');

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 1,
                    chatId,
                    chatType: 'supergroup',
                    title: 'Clan chat',
                    userId,
                    text: '/link #2PPLQ',
                }),
            );

            expect(getCompleteClanData).toHaveBeenCalledTimes(1);
            expect(getCompleteClanData).toHaveBeenCalledWith('#2PPLQ', undefined);
            expect(observedInTransaction).toEqual([false]);
            expect(notify).toHaveBeenCalledTimes(1);

            expect(clansRepo.getTrackedClans()).toEqual(['#2PPLQ']);
            expect(clansRepo.getClanNameByTag('#2PPLQ')).toBe('Dark <Dragons>');
            const snapshotRow = db.connection
                .prepare<[string], { members_count: number; is_war_log_public: number }>(
                    'SELECT members_count, is_war_log_public FROM clan_snapshots WHERE clan_tag = ? ORDER BY id DESC LIMIT 1;',
                )
                .get('#2PPLQ');
            expect(snapshotRow).toEqual({ members_count: 42, is_war_log_public: 1 });
            expect(clansRepo.getActiveMemberships('#2PPLQ')).toEqual([]);
            expect(clansRepo.getLatestPlayerSnapshots('#2PPLQ')).toEqual([]);

            // First background ClanInfoService sync must still treat this clan as initial sync (no spurious join events)
            const recorder = new DomainEventRecorder(
                new DomainEventPayloadSerializer(),
                subscriptionRepo,
                domainEventsRepo,
            );
            const clanInfoService = new ClanInfoService(
                clansRepo,
                { getCompleteClanData: vi.fn().mockResolvedValue(clanData) },
                transactionManager,
                recorder,
            );
            const syncResult = await clanInfoService.updateData('#2PPLQ');
            expect(syncResult.successFlag).toBe(true);
            expect(syncResult.events).toEqual([]);

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(1);
            const text = String(sent[0]?.text);
            expect(text).toContain(
                'Подключён клан <b>Dark &lt;Dragons&gt;</b> (#2PPLQ), 42 участника.',
            );
            expect(text).toContain('Пресет по умолчанию: «Игроки»');
            expect(text).not.toContain('🔒');
            expect(text).not.toContain('⏳');
            expect(getInlineKeyboard(sent[0])).toEqual([
                [{ text: '⚙️ Настройки', callback_data: 'settings:open:#2PPLQ' }],
            ]);

            // Clicking the settings entry button opens settings screen with the synchronized clan name immediately
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    updateId: 2,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    data: 'settings:open:#2PPLQ',
                }),
            );
            const edited = transport.editedMessages();
            expect(edited).toHaveLength(1);
            expect(String(edited[0]?.text)).toContain('Клан: <b>Dark &lt;Dragons&gt;</b> (#2PPLQ)');
        });

        it('includes the exact private war log warning when isWarLogPublic is false', async () => {
            const getCompleteClanData = vi.fn().mockResolvedValue(
                makeCompleteClanData({
                    tag: '#2PPLQ',
                    name: 'Secret Clan',
                    membersCount: 30,
                    isWarLogPublic: false,
                }),
            );

            const { service, transport, db } = createHarness({
                cocApiClient: { getCompleteClanData },
            });

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #2PPLQ',
                }),
            );

            const snapshotRow = db.connection
                .prepare<[string], { is_war_log_public: number }>(
                    'SELECT is_war_log_public FROM clan_snapshots WHERE clan_tag = ? ORDER BY id DESC LIMIT 1;',
                )
                .get('#2PPLQ');
            expect(snapshotRow).toEqual({ is_war_log_public: 0 });

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(1);
            const text = String(sent[0]?.text);
            expect(text).toContain('Подключён клан <b>Secret Clan</b> (#2PPLQ), 30 участников.');
            expect(text).toContain('Пресет по умолчанию: «Руководство»');
            expect(text).toContain(PRIVATE_WAR_LOG_WARNING_TEXT);
            expect(getInlineKeyboard(sent[0])).toEqual([
                [{ text: '⚙️ Настройки', callback_data: 'settings:open:#2PPLQ' }],
            ]);
        });

        it('rejects /link on CoC API 404 without creating clan, chat, subscription, or notifying ClanManager', async () => {
            const getCompleteClanData = vi
                .fn()
                .mockResolvedValueOnce(null)
                .mockRejectedValueOnce(
                    new CocApiError('HTTP 404', {
                        kind: 'not_found',
                        statusCode: 404,
                        endpoint: '/clans/%23999888',
                    }),
                );
            const notify = vi.fn();

            const { service, transport, clansRepo, subscriptionRepo, db } = createHarness({
                cocApiClient: { getCompleteClanData },
                clanManager: { notify },
            });

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 1,
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #2PPLQ',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 2,
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #999888',
                }),
            );

            expect(getCompleteClanData).toHaveBeenCalledTimes(2);
            expect(notify).not.toHaveBeenCalled();
            expect(clansRepo.getTrackedClans()).toEqual([]);
            expect(subscriptionRepo.getClanTagsForChat(2001, 0)).toEqual([]);
            const clansCount = db.connection
                .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM clans;')
                .get()?.count;
            const chatsCount = db.connection
                .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM telegram_chats;')
                .get()?.count;
            expect(clansCount).toBe(0);
            expect(chatsCount).toBe(0);

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(2);
            expect(String(sent[0]?.text)).toContain('Клан #2PPLQ не найден');
            expect(sent[0]?.reply_markup).toBeUndefined();
            expect(String(sent[1]?.text)).toContain('Клан #999888 не найден');
            expect(sent[1]?.reply_markup).toBeUndefined();
        });

        it('falls back to deferred synchronization on CoC API timeout, 5xx, and network errors', async () => {
            const getCompleteClanData = vi
                .fn()
                .mockRejectedValueOnce(
                    new CocApiError('Request timed out', {
                        kind: 'timeout',
                        endpoint: '/clans/%232PPLQ',
                    }),
                )
                .mockRejectedValueOnce(
                    new CocApiError('HTTP 503', {
                        kind: 'server_error',
                        statusCode: 503,
                        endpoint: '/clans/%23999888',
                    }),
                )
                .mockRejectedValueOnce(
                    new CocApiError('ECONNRESET', {
                        kind: 'network',
                        endpoint: '/clans/%23888222',
                    }),
                );
            const notify = vi.fn();

            const { service, transport, clansRepo, subscriptionRepo } = createHarness({
                cocApiClient: { getCompleteClanData },
                clanManager: { notify },
            });

            for (const [index, tag] of ['#2PPLQ', '#999888', '#888222'].entries()) {
                await service.bot.handleUpdate(
                    makeMessageUpdate({
                        updateId: index + 1,
                        chatId: 2001,
                        chatType: 'private',
                        userId: 2001,
                        text: `/link ${tag}`,
                    }),
                );
            }

            expect(getCompleteClanData).toHaveBeenCalledTimes(3);
            expect(notify).toHaveBeenCalledTimes(3);
            expect(clansRepo.getTrackedClans()).toEqual(['#2PPLQ', '#999888', '#888222']);
            expect(subscriptionRepo.getClanTagsForChat(2001, 0)).toEqual([
                '#2PPLQ',
                '#999888',
                '#888222',
            ]);
            expect(clansRepo.getClanNameByTag('#2PPLQ')).toBe('Pending synchronization');

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(3);
            for (const [index, tag] of ['#2PPLQ', '#999888', '#888222'].entries()) {
                expect(String(sent[index]?.text)).toContain(`Подключён клан ${tag}.`);
                expect(String(sent[index]?.text)).toContain(DEFERRED_SYNC_HINT_TEXT);
                expect(String(sent[index]?.text)).toContain('«Руководство»');
                expect(getInlineKeyboard(sent[index])).toEqual([
                    [{ text: '⚙️ Настройки', callback_data: `settings:open:${tag}` }],
                ]);
            }
        });

        it('is idempotent on repeated /link, preserves subscription_id and custom categories, skips CoC API and ClanManager wake, and replies with already-linked status', async () => {
            const getCompleteClanData = vi.fn().mockResolvedValue(
                makeCompleteClanData({
                    tag: '#2PPLQ',
                    name: 'Dark Dragons',
                    membersCount: 45,
                }),
            );
            const notify = vi.fn();

            const { service, transport, subscriptionRepo } = createHarness({
                cocApiClient: { getCompleteClanData },
                clanManager: { notify },
            });

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 1,
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #2PPLQ',
                }),
            );
            const firstSubscriptionId = subscriptionRepo.getSubscriptionId(2001, 0, '#2PPLQ');
            expect(firstSubscriptionId).not.toBeNull();

            // Customize categories before repeated /link to prove settings are preserved
            subscriptionRepo.updateSubscriptionCategories(2001, 0, '#2PPLQ', {
                summaries: true,
                reminders: false,
                roster: false,
                discipline: true,
                system: false,
            });

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 2,
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #2PPLQ',
                }),
            );
            const secondSubscription = subscriptionRepo.getSubscription(2001, 0, '#2PPLQ');
            expect(secondSubscription?.subscriptionId).toBe(firstSubscriptionId);
            expect(secondSubscription?.categories).toEqual({
                summaries: true,
                reminders: false,
                roster: false,
                discipline: true,
                system: false,
            });
            expect(getCompleteClanData).toHaveBeenCalledTimes(1);
            expect(notify).toHaveBeenCalledTimes(1);

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(2);
            expect(String(sent[1]?.text)).toContain('Клан <b>Dark Dragons</b> (#2PPLQ)');
            expect(String(sent[1]?.text)).toContain('уже подключён в этом личном чате');
            expect(String(sent[1]?.text)).toContain('Текущий пресет: своя настройка.');
            expect(getInlineKeyboard(sent[1])).toEqual([
                [{ text: '⚙️ Настройки', callback_data: 'settings:open:#2PPLQ' }],
            ]);
        });

        it('distinguishes linking a clan already tracked by another chat and reports fresh metadata plus war log warning', async () => {
            const getCompleteClanData = vi.fn().mockResolvedValue(
                makeCompleteClanData({
                    tag: '#2PPLQ',
                    name: 'Shared Clan',
                    membersCount: 48,
                    isWarLogPublic: false,
                }),
            );

            const { service, transport, subscriptionRepo } = createHarness({
                cocApiClient: { getCompleteClanData },
            });
            transport.chatMembers.set(memberKey(-1001, 42), 'administrator');

            // First chat links the clan
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 1,
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #2PPLQ',
                }),
            );

            // Second chat (supergroup topic) links the same already-tracked clan
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 2,
                    chatId: -1001,
                    chatType: 'supergroup',
                    title: 'Clan forum',
                    userId: 42,
                    messageThreadId: 15,
                    text: '/link #2PPLQ',
                }),
            );

            expect(getCompleteClanData).toHaveBeenCalledTimes(2);
            expect(subscriptionRepo.hasSubscription(2001, 0, '#2PPLQ')).toBe(true);
            expect(subscriptionRepo.hasSubscription(-1001, 15, '#2PPLQ')).toBe(true);

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(2);
            expect(String(sent[0]?.text)).not.toContain('уже отслеживается');
            expect(String(sent[1]?.text)).toContain(
                'Подключён клан <b>Shared Clan</b> (#2PPLQ), 48 участников.',
            );
            expect(String(sent[1]?.text)).toContain(
                'Клан уже отслеживается в других чатах — эта тема подключена к его обновлениям.',
            );
            expect(String(sent[1]?.text)).toContain('Пресет по умолчанию: «Игроки»');
            expect(String(sent[1]?.text)).toContain(PRIVATE_WAR_LOG_WARNING_TEXT);
            expect(getInlineKeyboard(sent[1])).toEqual([
                [{ text: '⚙️ Настройки', callback_data: 'settings:open:#2PPLQ' }],
            ]);
        });

        it('re-enables tracking and refreshes clan metadata when re-linking a previously unlinked clan via CoC API', async () => {
            const getCompleteClanData = vi.fn().mockResolvedValue(
                makeCompleteClanData({
                    tag: '#2PPLQ',
                    name: 'Renamed Clan',
                    membersCount: 35,
                    isWarLogPublic: true,
                }),
            );

            const { service, clansRepo, subscriptionRepo } = createHarness({
                cocApiClient: { getCompleteClanData },
            });

            // Simulate a previously synced and then unlinked clan (tracking_enabled = 0)
            clansRepo.insertMinimalClan('#2PPLQ');
            clansRepo.disableTracking('#2PPLQ');
            expect(clansRepo.getTrackedClans()).toEqual([]);

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #2PPLQ',
                }),
            );

            expect(clansRepo.getTrackedClans()).toEqual(['#2PPLQ']);
            expect(clansRepo.getClanNameByTag('#2PPLQ')).toBe('Renamed Clan');
            expect(subscriptionRepo.hasSubscription(2001, 0, '#2PPLQ')).toBe(true);
        });

        it('handles concurrent /link race cleanly as already_linked without changing subscription_id', async () => {
            let resolveLookup!: (value: CompleteClanData | null) => void;
            const lookupPromise = new Promise<CompleteClanData | null>((resolve) => {
                resolveLookup = resolve;
            });
            const getCompleteClanData = vi.fn().mockReturnValue(lookupPromise);

            const { service, transport, subscriptionRepo } = createHarness({
                cocApiClient: { getCompleteClanData },
            });

            const first = service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 1,
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #2PPLQ',
                }),
            );
            const second = service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 2,
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #2PPLQ',
                }),
            );

            resolveLookup(
                makeCompleteClanData({
                    tag: '#2PPLQ',
                    name: 'Race Clan',
                    membersCount: 25,
                }),
            );
            await Promise.all([first, second]);

            expect(subscriptionRepo.getSubscriptionId(2001, 0, '#2PPLQ')).not.toBeNull();
            const texts = transport.sentMessages().map((m) => String(m.text));
            expect(texts).toHaveLength(2);
            expect(texts.some((t) => t.includes('Подключён клан <b>Race Clan</b>'))).toBe(true);
            expect(texts.some((t) => t.includes('уже подключён'))).toBe(true);
        });

        it('notifies ClanManager strictly after /link transaction commits and skips notification on rejected or failed /link', async () => {
            const observedInTransaction: boolean[] = [];
            const observedTrackedOnNotify: string[][] = [];
            const notify = vi.fn();

            const { service, db, clansRepo, transactionManager, transport } = createHarness({
                clanManager: { notify },
            });
            notify.mockImplementation(() => {
                observedInTransaction.push(db.connection.inTransaction);
                observedTrackedOnNotify.push(clansRepo.getTrackedClans());
            });

            // Rejected /link (invalid tag, non-admin) must not wake ClanManager
            transport.chatMembers.set(memberKey(-1002, 43), 'member');
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 1,
                    chatId: -1002,
                    chatType: 'supergroup',
                    userId: 43,
                    text: '/link #2PPLQ',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 2,
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #BAD!',
                }),
            );
            expect(notify).not.toHaveBeenCalled();

            // Failed DB transaction must not wake ClanManager
            const txSpy = vi
                .spyOn(transactionManager, 'retryInTransaction')
                .mockImplementationOnce(() => {
                    throw new DatabaseError('sqlite busy', { sqliteCode: 'SQLITE_BUSY' });
                });
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 3,
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #2PPLQ',
                }),
            );
            txSpy.mockRestore();
            expect(notify).not.toHaveBeenCalled();

            // Successful /link notifies after commit with the new clan already tracked
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 4,
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #2PPLQ',
                }),
            );

            expect(notify).toHaveBeenCalledTimes(1);
            expect(observedInTransaction).toEqual([false]);
            expect(observedTrackedOnNotify).toEqual([['#2PPLQ']]);
        });

        it('rejects /link from non-administrator, private chat mismatch, unsupported chat types, invalid args and invalid tags without calling CoC API', async () => {
            const getCompleteClanData = vi.fn();
            const { service, transport, clansRepo } = createHarness({
                cocApiClient: { getCompleteClanData },
            });
            transport.chatMembers.set(memberKey(-1002, 43), 'member');

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: -1002,
                    chatType: 'group',
                    title: 'Clan chat',
                    userId: 43,
                    messageThreadId: 3,
                    text: '/link #2PPLQ',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: 3001,
                    chatType: 'private',
                    userId: 9999,
                    text: '/link #2PPLQ',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: -1008,
                    chatType: 'channel',
                    userId: 47,
                    text: '/link #2PPLQ',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: -1002,
                    chatType: 'supergroup',
                    userId: 43,
                    messageThreadId: 5,
                    text: '/link',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: -1002,
                    chatType: 'supergroup',
                    userId: 43,
                    messageThreadId: 5,
                    text: '/link #INVALID_TAG!',
                }),
            );

            expect(getCompleteClanData).not.toHaveBeenCalled();
            expect(clansRepo.getTrackedClans()).toEqual([]);
            const sent = transport.sentMessages();
            expect(sent).toHaveLength(5);
            expect(String(sent[0]?.text)).toContain('Только администратор');
            expect(sent[0]?.message_thread_id).toBe(3);
            expect(String(sent[1]?.text)).toContain('Только администратор');
            expect(String(sent[2]?.text)).toContain('не поддерживается');
            expect(String(sent[3]?.text)).toContain('Использование: /link #ТЕГ_КЛАНА');
            expect(sent[3]?.message_thread_id).toBe(5);
            expect(String(sent[4]?.text)).toContain('Некорректный тег клана');
            expect(String(sent[4]?.text)).toContain('Например: /link #2PPLQ');
            expect(sent[4]?.message_thread_id).toBe(5);
        });

        it('handles getChatMember API failure, DatabaseError, and malformed message without from', async () => {
            const { service, transport, clansRepo, transactionManager } = createHarness();
            transport.failGetChatMember = true;

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: -1007,
                    chatType: 'supergroup',
                    userId: 46,
                    text: '/link #2PPLQ',
                }),
            );

            expect(clansRepo.getTrackedClans()).toEqual([]);
            expect(String(transport.sentMessages()[0]?.text)).toContain('проверить права');

            transport.failGetChatMember = false;
            const txSpy = vi
                .spyOn(transactionManager, 'retryInTransaction')
                .mockImplementation(() => {
                    throw new DatabaseError('simulated db failure');
                });

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: 4001,
                    chatType: 'private',
                    userId: 4001,
                    text: '/link #2PPLQ',
                }),
            );
            txSpy.mockRestore();

            expect(String(transport.sentMessages()[1]?.text)).toContain(
                'Не удалось сохранить привязку',
            );

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: 4001,
                    chatType: 'private',
                    omitFrom: true,
                    text: '/link #2PPLQ',
                }),
            );
            expect(transport.sentMessages()).toHaveLength(2);
        });
    });

    describe('command: /unlink and subscription generation cancellation', () => {
        it('unlinks last subscription for creator, cleans up telegram_chats and disables tracking without deleting clan row', async () => {
            const { service, transport, clansRepo, subscriptionRepo, db } = createHarness();
            const chatId = -1004;
            const userId = 44;
            const threadId = 9;

            clansRepo.insertMinimalClan('#2PPLQ');
            subscriptionRepo.saveTelegramChat(chatId, threadId, 'Clan chat');
            subscriptionRepo.subscribeToChat(chatId, threadId, '#2PPLQ', 'players');
            transport.chatMembers.set(memberKey(chatId, userId), 'creator');

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId,
                    chatType: 'supergroup',
                    title: 'Clan chat',
                    userId,
                    messageThreadId: threadId,
                    text: '/unlink #2PPLQ',
                }),
            );

            expect(subscriptionRepo.hasSubscription(chatId, threadId, '#2PPLQ')).toBe(false);
            expect(subscriptionRepo.getClanTagsForChat(chatId, threadId)).toEqual([]);
            expect(clansRepo.getTrackedClans()).toEqual([]);
            expect(clansRepo.getClanNameByTag('#2PPLQ')).toBe('Pending synchronization');

            const chatRow = db.connection
                .prepare<[number, number]>(
                    'SELECT 1 FROM telegram_chats WHERE chat_id = ? AND message_thread_id = ?;',
                )
                .get(chatId, threadId);
            expect(chatRow).toBeUndefined();
            expect(String(transport.sentMessages()[0]?.text)).toContain('отвязан');
        });

        it('keeps clan tracking enabled when another subscription remains', async () => {
            const { service, transport, clansRepo, subscriptionRepo } = createHarness();

            clansRepo.insertMinimalClan('#2PPLQ');
            subscriptionRepo.saveTelegramChat(-1005, 0, 'First chat');
            subscriptionRepo.saveTelegramChat(-1006, 0, 'Second chat');
            subscriptionRepo.subscribeToChat(-1005, 0, '#2PPLQ', 'players');
            subscriptionRepo.subscribeToChat(-1006, 0, '#2PPLQ', 'players');
            transport.chatMembers.set(memberKey(-1005, 45), 'administrator');

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: -1005,
                    chatType: 'group',
                    userId: 45,
                    text: '/unlink #2PPLQ',
                }),
            );

            expect(subscriptionRepo.hasSubscription(-1005, 0, '#2PPLQ')).toBe(false);
            expect(subscriptionRepo.hasSubscription(-1006, 0, '#2PPLQ')).toBe(true);
            expect(clansRepo.getTrackedClans()).toEqual(['#2PPLQ']);
        });

        it('cancels only pending destinations and pending notifications of the current subscription generation, preserves sent/failed/other scopes, and creates a new generation on re-link', async () => {
            const {
                service,
                transport,
                clansRepo,
                subscriptionRepo,
                domainEventsRepo,
                notificationRepo,
                db,
            } = createHarness();
            const chatId = -1001;
            const otherChatId = 5001;
            const userId = 42;

            clansRepo.insertMinimalClan('#2PPLQ');
            clansRepo.insertMinimalClan('#999888');

            const subscribe = (
                targetChatId: number,
                topic: number,
                tag: string,
                preset: 'players' | 'management' | 'all',
            ): number => {
                subscriptionRepo.saveTelegramChat(targetChatId, topic, 'test chat');
                subscriptionRepo.subscribeToChat(targetChatId, topic, tag, preset);
                const id = subscriptionRepo.getSubscriptionId(targetChatId, topic, tag);
                if (id === null) {
                    throw new Error('Expected subscription_id');
                }
                return id;
            };

            const oldSubscription = subscribe(chatId, 7, '#2PPLQ', 'all');
            const otherTopic = subscribe(chatId, 8, '#2PPLQ', 'players');
            const otherChat = subscribe(otherChatId, 0, '#2PPLQ', 'management');
            const otherClan = subscribe(chatId, 7, '#999888', 'players');

            domainEventsRepo.appendEvent(
                {
                    eventType: 'war_ended',
                    eventId: '42',
                    payload: '{}',
                    payloadVersion: 1,
                    clanTag: '#2PPLQ',
                },
                [
                    {
                        chatId,
                        messageThreadId: 7,
                        category: 'summaries',
                        subscriptionId: oldSubscription,
                    },
                ],
            );
            domainEventsRepo.appendEvent(
                {
                    eventType: 'war_ended',
                    eventId: '43',
                    payload: '{}',
                    payloadVersion: 1,
                    clanTag: '#2PPLQ',
                },
                [
                    {
                        chatId,
                        messageThreadId: 7,
                        category: 'summaries',
                        subscriptionId: oldSubscription,
                    },
                    {
                        chatId,
                        messageThreadId: 7,
                        category: 'discipline',
                        subscriptionId: oldSubscription,
                    },
                    {
                        chatId,
                        messageThreadId: 8,
                        category: 'summaries',
                        subscriptionId: otherTopic,
                    },
                    {
                        chatId: otherChatId,
                        messageThreadId: 0,
                        category: 'discipline',
                        subscriptionId: otherChat,
                    },
                ],
            );
            domainEventsRepo.appendEvent(
                {
                    eventType: 'PlayerJoinedClanEvent',
                    eventId: '55',
                    payload: '{}',
                    payloadVersion: 1,
                    clanTag: '#999888',
                },
                [{ chatId, messageThreadId: 7, category: 'roster', subscriptionId: otherClan }],
            );

            const destinations = domainEventsRepo.getPendingDestinations(20);
            const findDestination = (eventId: string, subId: number, category?: string): number => {
                const match = destinations.find(
                    (d) =>
                        d.eventId === eventId &&
                        d.subscriptionId === subId &&
                        (category === undefined || d.category === category),
                );
                if (match === undefined) {
                    throw new Error(`Destination not found for ${eventId}/${String(subId)}`);
                }
                return match.destinationId;
            };

            const materializedTarget = findDestination('42', oldSubscription, 'summaries');
            const pendingTargetSummaries = findDestination('43', oldSubscription, 'summaries');
            const pendingTargetDiscipline = findDestination('43', oldSubscription, 'discipline');
            const unaffectedTopic = findDestination('43', otherTopic);
            const unaffectedChat = findDestination('43', otherChat);
            const unaffectedClan = findDestination('55', otherClan);

            expect(
                notificationRepo.enqueueDomainEventIfAbsent(
                    'report',
                    materializedTarget,
                    'pending_report',
                    '42',
                    chatId,
                    7,
                ),
            ).toBe(true);
            expect(
                notificationRepo.enqueueDomainEventIfAbsent(
                    'report',
                    materializedTarget,
                    'sent_report',
                    '42',
                    chatId,
                    7,
                ),
            ).toBe(true);
            expect(
                notificationRepo.enqueueDomainEventIfAbsent(
                    'report',
                    materializedTarget,
                    'failed_report',
                    '42',
                    chatId,
                    7,
                ),
            ).toBe(true);
            domainEventsRepo.markMaterialized(materializedTarget);

            const pendingNotifications = notificationRepo.getPending(10);
            const findNotification = (type: string): number => {
                const match = pendingNotifications.find((n) => n.eventType === type);
                if (match === undefined) {
                    throw new Error(`Notification not found: ${type}`);
                }
                return match.id;
            };

            const pendingNotification = findNotification('pending_report');
            const sentNotification = findNotification('sent_report');
            const failedNotification = findNotification('failed_report');
            expect(notificationRepo.claimForSending(sentNotification, 1_700_000_000)).toBe(true);
            expect(notificationRepo.markAsSent(sentNotification)).toBe(true);
            expect(notificationRepo.claimForSending(failedNotification, 1_700_000_000)).toBe(true);
            expect(notificationRepo.markAsFailed(failedNotification, 'permanent failure')).toBe(
                true,
            );

            transport.chatMembers.set(memberKey(chatId, userId), 'administrator');

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 100,
                    chatId,
                    chatType: 'supergroup',
                    title: 'test chat',
                    userId,
                    messageThreadId: 7,
                    text: '/unlink #2PPLQ',
                }),
            );

            expect(rowStatus(db, 'domain_event_destinations', materializedTarget)).toBe(
                'materialized',
            );
            expect(rowStatus(db, 'domain_event_destinations', pendingTargetSummaries)).toBe(
                'cancelled',
            );
            expect(rowStatus(db, 'domain_event_destinations', pendingTargetDiscipline)).toBe(
                'cancelled',
            );
            expect(rowStatus(db, 'notifications', pendingNotification)).toBe('cancelled');
            expect(rowStatus(db, 'notifications', sentNotification)).toBe('sent');
            expect(rowStatus(db, 'notifications', failedNotification)).toBe('failed');
            expect(rowStatus(db, 'domain_event_destinations', unaffectedTopic)).toBe('pending');
            expect(rowStatus(db, 'domain_event_destinations', unaffectedChat)).toBe('pending');
            expect(rowStatus(db, 'domain_event_destinations', unaffectedClan)).toBe('pending');

            // Repeated /unlink is safe and reports missing subscription
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 101,
                    chatId,
                    chatType: 'supergroup',
                    title: 'test chat',
                    userId,
                    messageThreadId: 7,
                    text: '/unlink #2PPLQ',
                }),
            );
            expect(String(transport.sentMessages()[1]?.text)).toContain(
                'Этот чат не привязан к клану #2PPLQ.',
            );

            // Re-linking creates a new subscription_id generation without un-cancelling old work
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 102,
                    chatId,
                    chatType: 'supergroup',
                    title: 'test chat',
                    userId,
                    messageThreadId: 7,
                    text: '/link #2PPLQ',
                }),
            );
            const newSubscription = subscriptionRepo.getSubscriptionId(chatId, 7, '#2PPLQ');
            expect(newSubscription).not.toBeNull();
            expect(newSubscription).not.toBe(oldSubscription);
            expect(rowStatus(db, 'domain_event_destinations', pendingTargetSummaries)).toBe(
                'cancelled',
            );
            expect(rowStatus(db, 'domain_event_destinations', pendingTargetDiscipline)).toBe(
                'cancelled',
            );
            expect(rowStatus(db, 'notifications', pendingNotification)).toBe('cancelled');
        });

        it('rejects /unlink on unsupported chat, invalid args, invalid tag, non-admin, API error and DB error', async () => {
            const { service, transport, transactionManager } = createHarness();
            transport.chatMembers.set(memberKey(-2001, 10), 'member');

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: -2001,
                    chatType: 'channel',
                    userId: 10,
                    text: '/unlink #2PPLQ',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: -2001,
                    chatType: 'group',
                    userId: 10,
                    text: '/unlink',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: -2001,
                    chatType: 'group',
                    userId: 10,
                    text: '/unlink #BAD!',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: -2001,
                    chatType: 'group',
                    userId: 10,
                    text: '/unlink #2PPLQ',
                }),
            );

            transport.failGetChatMember = true;
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: -2001,
                    chatType: 'group',
                    userId: 10,
                    text: '/unlink #2PPLQ',
                }),
            );
            transport.failGetChatMember = false;

            const txSpy = vi
                .spyOn(transactionManager, 'retryInTransaction')
                .mockImplementation(() => {
                    throw new DatabaseError('db error');
                });
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    chatId: 5005,
                    chatType: 'private',
                    userId: 5005,
                    text: '/unlink #2PPLQ',
                }),
            );
            txSpy.mockRestore();

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(6);
            expect(String(sent[0]?.text)).toContain('не поддерживается');
            expect(String(sent[1]?.text)).toContain('Использование: /unlink #ТЕГ_КЛАНА');
            expect(String(sent[2]?.text)).toContain('Некорректный тег клана');
            expect(String(sent[3]?.text)).toContain('Только администратор');
            expect(String(sent[4]?.text)).toContain('проверить права');
            expect(String(sent[5]?.text)).toContain('Не удалось отвязать чат');
        });
    });

    describe('callback navigation: menu, help, clans, guides', () => {
        it('handles menu:start, help:main and clans:link callbacks with answerCallbackQuery first', async () => {
            const { service, transport } = createHarness();

            await service.bot.handleUpdate(makeCallbackUpdate({ data: 'menu:start' }));
            await service.bot.handleUpdate(makeCallbackUpdate({ data: 'help:main' }));
            await service.bot.handleUpdate(makeCallbackUpdate({ data: 'clans:link' }));

            expect(transport.answeredCallbackQueries()).toHaveLength(3);
            expect(transport.calls[0]?.method).toBe('answerCallbackQuery');
            expect(transport.calls[1]?.method).toBe('editMessageText');

            const edited = transport.editedMessages();
            expect(edited).toHaveLength(3);
            expect(String(edited[0]?.text)).toContain('Добро пожаловать');
            expect(getInlineKeyboard(edited[0])[0]?.[0]?.callback_data).toBe('guides:townhalls');

            expect(String(edited[1]?.text)).toContain('Помощь');
            expect(String(edited[1]?.text)).toContain('/link #ТЕГ_КЛАНА');
            expect(String(edited[1]?.text)).toContain('«Игроки»');
            expect(String(edited[1]?.text)).toContain(SUPERCELL_FAN_CONTENT_DISCLAIMER);
            expect(getInlineKeyboard(edited[1])[0]?.[0]?.callback_data).toBe('menu:start');

            expect(String(edited[2]?.text)).toContain('/link #2PPLQ');
            expect(getInlineKeyboard(edited[2])[0]?.[0]?.callback_data).toBe('menu:start');
        });

        it('handles clans:list for empty, populated (topic-scoped), unsupported chat and DB error', async () => {
            const { service, transport, clansRepo, subscriptionRepo } = createHarness();

            await service.bot.handleUpdate(
                makeCallbackUpdate({ data: 'clans:list', chatId: 5001, userId: 5001 }),
            );
            expect(String(transport.editedMessages()[0]?.text)).toContain(
                'пока нет подключённых кланов',
            );

            clansRepo.insertMinimalClan('#2PPLQ');
            clansRepo.insertMinimalClan('#999888');
            subscriptionRepo.saveTelegramChat(-3001, 11, 'Topic 11');
            subscriptionRepo.saveTelegramChat(-3001, 12, 'Topic 12');
            subscriptionRepo.subscribeToChat(-3001, 11, '#2PPLQ', 'players');
            subscriptionRepo.subscribeToChat(-3001, 12, '#999888', 'players');

            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    data: 'clans:list',
                    chatId: -3001,
                    chatType: 'supergroup',
                    userId: 501,
                    messageThreadId: 11,
                }),
            );
            const topicText = String(transport.editedMessages()[1]?.text);
            expect(topicText).toContain('Подключённые кланы:');
            expect(topicText).toContain('• #2PPLQ');
            expect(topicText).not.toContain('#999888');

            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    data: 'clans:list',
                    chatId: -3002,
                    chatType: 'channel',
                    userId: 501,
                }),
            );
            expect(String(transport.editedMessages()[2]?.text)).toContain('не поддерживается');

            const repoSpy = vi
                .spyOn(subscriptionRepo, 'getClanTagsForChat')
                .mockImplementation(() => {
                    throw new DatabaseError('read failed');
                });
            await service.bot.handleUpdate(
                makeCallbackUpdate({ data: 'clans:list', chatId: 5001, userId: 5001 }),
            );
            repoSpy.mockRestore();
            expect(String(transport.editedMessages()[3]?.text)).toContain(
                'Не удалось загрузить список кланов',
            );
        });

        it('handles clans:unlink list, clan removal, repeat click, non-admin and API/DB errors', async () => {
            const {
                service,
                transport,
                clansRepo,
                subscriptionRepo,
                domainEventsRepo,
                notificationRepo,
                transactionManager,
                db,
            } = createHarness();
            const chatId = -4001;
            const adminId = 77;
            const memberId = 88;

            clansRepo.insertMinimalClan('#2PPLQ');
            subscriptionRepo.saveTelegramChat(chatId, 0, 'Clan group');
            subscriptionRepo.subscribeToChat(chatId, 0, '#2PPLQ', 'players');
            const subId = subscriptionRepo.getSubscriptionId(chatId, 0, '#2PPLQ');
            expect(subId).not.toBeNull();
            if (subId === null) {
                throw new Error('Expected subscription_id');
            }

            domainEventsRepo.appendEvent(
                {
                    eventType: 'war_ended',
                    eventId: '701',
                    payload: '{}',
                    payloadVersion: 1,
                    clanTag: '#2PPLQ',
                },
                [{ chatId, messageThreadId: 0, category: 'summaries', subscriptionId: subId }],
            );
            domainEventsRepo.appendEvent(
                {
                    eventType: 'war_ended',
                    eventId: '702',
                    payload: '{}',
                    payloadVersion: 1,
                    clanTag: '#2PPLQ',
                },
                [{ chatId, messageThreadId: 0, category: 'summaries', subscriptionId: subId }],
            );
            const dests = domainEventsRepo.getPendingDestinations(10);
            const materializedDest = dests.find((d) => d.eventId === '701');
            const pendingDest = dests.find((d) => d.eventId === '702');
            expect(materializedDest).toBeDefined();
            expect(pendingDest).toBeDefined();
            if (materializedDest === undefined || pendingDest === undefined) {
                throw new Error('Expected seeded destinations');
            }

            notificationRepo.enqueueDomainEventIfAbsent(
                'pending msg',
                materializedDest.destinationId,
                'war_ended',
                '701',
                chatId,
                0,
            );
            notificationRepo.enqueueDomainEventIfAbsent(
                'sent msg',
                materializedDest.destinationId,
                'war_comparison',
                '701',
                chatId,
                0,
            );
            domainEventsRepo.markMaterialized(materializedDest.destinationId);

            const queued = notificationRepo.getPending(10);
            const pendingNotif = queued.find((n) => n.eventType === 'war_ended');
            const sentNotif = queued.find((n) => n.eventType === 'war_comparison');
            if (pendingNotif === undefined || sentNotif === undefined) {
                throw new Error('Expected seeded notifications');
            }
            expect(notificationRepo.claimForSending(sentNotif.id, 1_700_000_000)).toBe(true);
            expect(notificationRepo.markAsSent(sentNotif.id)).toBe(true);

            transport.chatMembers.set(memberKey(chatId, adminId), 'administrator');
            transport.chatMembers.set(memberKey(chatId, memberId), 'member');

            // Non-admin is rejected via personal alert without overwriting the shared menu
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'non-admin-unlink',
                    data: 'clans:unlink',
                    chatId,
                    chatType: 'group',
                    userId: memberId,
                }),
            );
            expect(transport.editedMessages()).toHaveLength(0);
            expect(transport.answeredCallbackQueries()).toEqual([
                {
                    callback_query_id: 'non-admin-unlink',
                    text: 'Только администратор группы может управлять подключениями кланов.',
                    show_alert: true,
                },
            ]);

            // Admin sees list of linked clans
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'admin-unlink-list',
                    data: 'clans:unlink',
                    chatId,
                    chatType: 'group',
                    userId: adminId,
                }),
            );
            expect(transport.editedMessages()[0]?.text).toBe('Выберите клан для отключения:');
            expect(getInlineKeyboard(transport.editedMessages()[0])[0]?.[0]?.callback_data).toBe(
                'clans:unlink:#2PPLQ',
            );
            expect(transport.answeredCallbackQueries()[1]).toEqual({
                callback_query_id: 'admin-unlink-list',
            });

            // Admin clicks unlink button
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    data: 'clans:unlink:#2PPLQ',
                    chatId,
                    chatType: 'group',
                    userId: adminId,
                }),
            );
            expect(subscriptionRepo.hasSubscription(chatId, 0, '#2PPLQ')).toBe(false);
            expect(clansRepo.getTrackedClans()).toEqual([]);
            expect(rowStatus(db, 'domain_event_destinations', pendingDest.destinationId)).toBe(
                'cancelled',
            );
            expect(rowStatus(db, 'notifications', pendingNotif.id)).toBe('cancelled');
            expect(rowStatus(db, 'notifications', sentNotif.id)).toBe('sent');
            expect(String(transport.editedMessages()[1]?.text)).toContain(
                'Готово! Клан #2PPLQ отключён.',
            );

            // Clicking the same stale button again reports not linked
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    data: 'clans:unlink:#2PPLQ',
                    chatId,
                    chatType: 'group',
                    userId: adminId,
                }),
            );
            expect(String(transport.editedMessages()[2]?.text)).toContain(
                'Этот чат не привязан к клану #2PPLQ.',
            );

            // Empty list state after unlink
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    data: 'clans:unlink',
                    chatId,
                    chatType: 'group',
                    userId: adminId,
                }),
            );
            expect(transport.editedMessages()[3]?.text).toBe(
                'В этом чате нет подключённых кланов.',
            );

            // Unsupported chat type
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    data: 'clans:unlink',
                    chatId: -4002,
                    chatType: 'channel',
                    userId: adminId,
                }),
            );
            expect(String(transport.editedMessages()[4]?.text)).toContain('не поддерживается');

            // getChatMember error responds via personal alert without overwriting the shared menu
            const editsBeforePermissionError = transport.editedMessages().length;
            transport.failGetChatMember = true;
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'perm-check-error',
                    data: 'clans:unlink',
                    chatId,
                    chatType: 'group',
                    userId: adminId,
                }),
            );
            transport.failGetChatMember = false;
            expect(transport.editedMessages()).toHaveLength(editsBeforePermissionError);
            expect(transport.answeredCallbackQueries().at(-1)).toEqual({
                callback_query_id: 'perm-check-error',
                text: 'Не удалось проверить права пользователя. Попробуйте ещё раз позже.',
                show_alert: true,
            });

            // DB error during inline unlink
            const txSpy = vi
                .spyOn(transactionManager, 'retryInTransaction')
                .mockImplementation(() => {
                    throw new DatabaseError('unlink failed');
                });
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    data: 'clans:unlink:#2PPLQ',
                    chatId,
                    chatType: 'group',
                    userId: adminId,
                }),
            );
            txSpy.mockRestore();
            expect(String(transport.editedMessages()[5]?.text)).toContain(
                'Не удалось отключить клан',
            );
        });

        it('keeps shared group inline menu intact on repeated non-admin and permission-error unlink callbacks', async () => {
            const { service, transport, clansRepo, subscriptionRepo } = createHarness();
            const chatId = -4100;
            const adminId = 700;
            const memberId = 701;

            clansRepo.insertMinimalClan('#2PPLQ');
            subscriptionRepo.saveTelegramChat(chatId, 15, 'Forum clan chat');
            subscriptionRepo.subscribeToChat(chatId, 15, '#2PPLQ', 'players');
            transport.chatMembers.set(memberKey(chatId, adminId), 'administrator');
            transport.chatMembers.set(memberKey(chatId, memberId), 'member');

            // Repeated non-admin clicks on both clans:unlink and clans:unlink:#TAG
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-member-1',
                    data: 'clans:unlink',
                    chatId,
                    chatType: 'supergroup',
                    userId: memberId,
                    messageThreadId: 15,
                }),
            );
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-member-2',
                    data: 'clans:unlink:#2PPLQ',
                    chatId,
                    chatType: 'supergroup',
                    userId: memberId,
                    messageThreadId: 15,
                }),
            );

            // Permission check API error on clans:unlink:#TAG
            transport.failGetChatMember = true;
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-perm-err',
                    data: 'clans:unlink:#2PPLQ',
                    chatId,
                    chatType: 'supergroup',
                    userId: adminId,
                    messageThreadId: 15,
                }),
            );
            transport.failGetChatMember = false;

            // Failure in answerCallbackQuery during denial does not throw or overwrite the menu
            transport.failAnswerCallbackQuery = true;
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-member-fail-answer',
                    data: 'clans:unlink',
                    chatId,
                    chatType: 'supergroup',
                    userId: memberId,
                    messageThreadId: 15,
                }),
            );
            transport.failAnswerCallbackQuery = false;

            expect(transport.editedMessages()).toHaveLength(0);
            expect(transport.sentMessages()).toHaveLength(0);
            expect(subscriptionRepo.hasSubscription(chatId, 15, '#2PPLQ')).toBe(true);
            expect(transport.answeredCallbackQueries()).toEqual([
                {
                    callback_query_id: 'q-member-1',
                    text: 'Только администратор группы может управлять подключениями кланов.',
                    show_alert: true,
                },
                {
                    callback_query_id: 'q-member-2',
                    text: 'Только администратор группы может управлять подключениями кланов.',
                    show_alert: true,
                },
                {
                    callback_query_id: 'q-perm-err',
                    text: 'Не удалось проверить права пользователя. Попробуйте ещё раз позже.',
                    show_alert: true,
                },
                {
                    callback_query_id: 'q-member-fail-answer',
                    text: 'Только администратор группы может управлять подключениями кланов.',
                    show_alert: true,
                },
            ]);

            // Admin can still use the untouched menu right after
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-admin-ok',
                    data: 'clans:unlink',
                    chatId,
                    chatType: 'supergroup',
                    userId: adminId,
                    messageThreadId: 15,
                }),
            );
            expect(transport.editedMessages()).toHaveLength(1);
            expect(transport.editedMessages()[0]?.text).toBe('Выберите клан для отключения:');
            expect(transport.answeredCallbackQueries()).toHaveLength(5);
            expect(transport.answeredCallbackQueries()[4]).toEqual({
                callback_query_id: 'q-admin-ok',
            });
        });

        it('opens settings screen, applies all 3 presets, toggles categories to custom, and blocks disabling last category', async () => {
            const { service, transport, clansRepo, subscriptionRepo } = createHarness();
            const chatId = 6001;
            const userId = 6001;

            clansRepo.insertMinimalClan('#2PPLQ');
            subscriptionRepo.saveTelegramChat(chatId, 0, 'Leader Private');
            subscriptionRepo.subscribeToChat(chatId, 0, '#2PPLQ', 'management');
            const initialSubId = subscriptionRepo.getSubscriptionId(chatId, 0, '#2PPLQ');
            expect(initialSubId).not.toBeNull();

            // Open before clan sync: Pending synchronization placeholder is hidden, no getChatMember in private chat
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-open-unsynced',
                    data: 'settings:open:#2PPLQ',
                    chatId,
                    chatType: 'private',
                    userId,
                }),
            );
            expect(transport.calls.some((call) => call.method === 'getChatMember')).toBe(false);
            const openEdit = transport.editedMessages()[0];
            expect(String(openEdit?.text)).toContain('Клан: #2PPLQ');
            expect(String(openEdit?.text)).not.toContain('Pending synchronization');
            expect(String(openEdit?.text)).toContain('Пресет: Руководство');
            const openKeyboard = getInlineKeyboard(openEdit);
            expect(openKeyboard).toHaveLength(7);
            expect(openKeyboard[0]?.map((b) => b.text)).toEqual([
                'Игроки',
                'Руководство',
                'Всё вместе',
            ]);
            expect(openKeyboard[1]?.[0]?.text).toBe('▫️ Итоги и сравнения');
            expect(openKeyboard[4]?.[0]?.text).toBe('✅ Дисциплина и аналитика');
            expect(openKeyboard[5]?.[0]?.text).toBe('✅ Системные оповещения');
            expect(openKeyboard[6]?.[0]).toEqual({ text: '⬅️ Назад', callback_data: 'clans:list' });

            // Sync clan name (including HTML chars) and apply all 3 presets
            clansRepo.saveClan({
                tag: '#2PPLQ',
                name: 'Dark <Dragons>',
                description: 'desc',
                locationId: 0,
                locationName: '',
                chatLanguageId: 0,
                chatLanguage: '',
                isFamilyFriendly: true,
            });

            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-preset-players',
                    data: 'settings:preset:#2PPLQ:players',
                    chatId,
                    chatType: 'private',
                    userId,
                }),
            );
            expect(subscriptionRepo.getSubscription(chatId, 0, '#2PPLQ')?.categories).toEqual({
                summaries: true,
                reminders: true,
                roster: true,
                discipline: false,
                system: false,
            });
            expect(String(transport.editedMessages()[1]?.text)).toContain(
                'Клан: <b>Dark &lt;Dragons&gt;</b> (#2PPLQ)',
            );
            expect(String(transport.editedMessages()[1]?.text)).toContain('Пресет: Игроки');

            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-preset-all',
                    data: 'settings:preset:#2PPLQ:all',
                    chatId,
                    chatType: 'private',
                    userId,
                }),
            );
            expect(subscriptionRepo.getSubscription(chatId, 0, '#2PPLQ')?.categories).toEqual({
                summaries: true,
                reminders: true,
                roster: true,
                discipline: true,
                system: true,
            });
            expect(String(transport.editedMessages()[2]?.text)).toContain('Пресет: Всё вместе');

            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-preset-management',
                    data: 'settings:preset:#2PPLQ:management',
                    chatId,
                    chatType: 'private',
                    userId,
                }),
            );
            expect(subscriptionRepo.getSubscription(chatId, 0, '#2PPLQ')?.categories).toEqual({
                summaries: false,
                reminders: false,
                roster: false,
                discipline: true,
                system: true,
            });
            expect(String(transport.editedMessages()[3]?.text)).toContain('Пресет: Руководство');

            // Disable system -> only discipline remains -> custom preset status
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-toggle-system-off',
                    data: 'settings:category:#2PPLQ:system',
                    chatId,
                    chatType: 'private',
                    userId,
                }),
            );
            expect(subscriptionRepo.getSubscription(chatId, 0, '#2PPLQ')?.categories).toEqual({
                summaries: false,
                reminders: false,
                roster: false,
                discipline: true,
                system: false,
            });
            const customEdit = transport.editedMessages()[4];
            expect(String(customEdit?.text)).toContain('Пресет: своя настройка');
            expect(getInlineKeyboard(customEdit)[4]?.[0]?.text).toBe('✅ Дисциплина и аналитика');
            expect(getInlineKeyboard(customEdit)[5]?.[0]?.text).toBe('▫️ Системные оповещения');

            // Attempt to disable the LAST remaining category -> alert, no editMessageText, DB unchanged
            const editsBeforeLastCategory = transport.editedMessages().length;
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-disable-last',
                    data: 'settings:category:#2PPLQ:discipline',
                    chatId,
                    chatType: 'private',
                    userId,
                }),
            );
            expect(transport.editedMessages()).toHaveLength(editsBeforeLastCategory);
            expect(transport.answeredCallbackQueries().at(-1)).toEqual({
                callback_query_id: 'q-disable-last',
                text: 'Оставьте хотя бы одну категорию или отключите клан',
                show_alert: true,
            });
            expect(subscriptionRepo.getSubscription(chatId, 0, '#2PPLQ')?.categories).toEqual({
                summaries: false,
                reminders: false,
                roster: false,
                discipline: true,
                system: false,
            });

            // Re-enable system -> automatically recognizes preset "Руководство" again, same subscription_id
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-toggle-system-on',
                    data: 'settings:category:#2PPLQ:system',
                    chatId,
                    chatType: 'private',
                    userId,
                }),
            );
            expect(String(transport.editedMessages()[5]?.text)).toContain('Пресет: Руководство');
            expect(subscriptionRepo.getSubscriptionId(chatId, 0, '#2PPLQ')).toBe(initialSubId);
        });

        it('enforces group/supergroup admin and private owner permissions on settings callbacks without overwriting shared message', async () => {
            const { service, transport, clansRepo, subscriptionRepo } = createHarness();
            const chatId = -6100;
            const adminId = 801;
            const creatorId = 802;
            const memberId = 803;

            clansRepo.insertMinimalClan('#2PPLQ');
            subscriptionRepo.saveTelegramChat(chatId, 0, 'Clan Group');
            subscriptionRepo.subscribeToChat(chatId, 0, '#2PPLQ', 'players');
            transport.chatMembers.set(memberKey(chatId, adminId), 'administrator');
            transport.chatMembers.set(memberKey(chatId, creatorId), 'creator');
            transport.chatMembers.set(memberKey(chatId, memberId), 'member');

            // Regular member cannot open, apply preset, or toggle category; shared message untouched
            for (const [queryId, data] of [
                ['q-mem-open', 'settings:open:#2PPLQ'],
                ['q-mem-preset', 'settings:preset:#2PPLQ:all'],
                ['q-mem-cat', 'settings:category:#2PPLQ:discipline'],
            ] as const) {
                await service.bot.handleUpdate(
                    makeCallbackUpdate({
                        queryId,
                        data,
                        chatId,
                        chatType: 'group',
                        userId: memberId,
                    }),
                );
            }
            expect(transport.editedMessages()).toHaveLength(0);
            expect(subscriptionRepo.getSubscription(chatId, 0, '#2PPLQ')?.categories).toEqual({
                summaries: true,
                reminders: true,
                roster: true,
                discipline: false,
                system: false,
            });
            expect(transport.answeredCallbackQueries()).toEqual([
                {
                    callback_query_id: 'q-mem-open',
                    text: 'Только администратор группы может изменять настройки подписки.',
                    show_alert: true,
                },
                {
                    callback_query_id: 'q-mem-preset',
                    text: 'Только администратор группы может изменять настройки подписки.',
                    show_alert: true,
                },
                {
                    callback_query_id: 'q-mem-cat',
                    text: 'Только администратор группы может изменять настройки подписки.',
                    show_alert: true,
                },
            ]);

            // getChatMember error sends personal alert without overwriting shared message
            transport.failGetChatMember = true;
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-perm-err',
                    data: 'settings:preset:#2PPLQ:all',
                    chatId,
                    chatType: 'group',
                    userId: adminId,
                }),
            );
            transport.failGetChatMember = false;
            expect(transport.editedMessages()).toHaveLength(0);
            expect(transport.answeredCallbackQueries().at(-1)).toEqual({
                callback_query_id: 'q-perm-err',
                text: 'Не удалось проверить права пользователя. Попробуйте ещё раз позже.',
                show_alert: true,
            });

            // Unsupported chat type & private chat mismatch do not overwrite message
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-channel',
                    data: 'settings:open:#2PPLQ',
                    chatId: -6199,
                    chatType: 'channel',
                    userId: adminId,
                }),
            );
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-priv-mismatch',
                    data: 'settings:open:#2PPLQ',
                    chatId: 7777,
                    chatType: 'private',
                    userId: 8888,
                }),
            );
            expect(transport.editedMessages()).toHaveLength(0);
            expect(transport.answeredCallbackQueries().at(-2)).toEqual({
                callback_query_id: 'q-channel',
                text: 'Этот тип Telegram-чата пока не поддерживается.',
                show_alert: true,
            });
            expect(transport.answeredCallbackQueries().at(-1)).toEqual({
                callback_query_id: 'q-priv-mismatch',
                text: 'Только владелец чата может изменять настройки подписки.',
                show_alert: true,
            });

            // Creator and administrator succeed
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-creator-preset',
                    data: 'settings:preset:#2PPLQ:all',
                    chatId,
                    chatType: 'group',
                    userId: creatorId,
                }),
            );
            expect(transport.editedMessages()).toHaveLength(1);
            expect(String(transport.editedMessages()[0]?.text)).toContain('Пресет: Всё вместе');

            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-admin-toggle',
                    data: 'settings:category:#2PPLQ:roster',
                    chatId,
                    chatType: 'group',
                    userId: adminId,
                }),
            );
            expect(transport.editedMessages()).toHaveLength(2);
            expect(String(transport.editedMessages()[1]?.text)).toContain('Пресет: своя настройка');
        });

        it('isolates subscription settings between different forum topics of the same supergroup', async () => {
            const { service, transport, clansRepo, subscriptionRepo } = createHarness();
            const chatId = -6200;
            const adminId = 901;
            const topicA = 11;
            const topicB = 22;

            clansRepo.insertMinimalClan('#2PPLQ');
            subscriptionRepo.saveTelegramChat(chatId, topicA, 'Topic A');
            subscriptionRepo.saveTelegramChat(chatId, topicB, 'Topic B');
            subscriptionRepo.subscribeToChat(chatId, topicA, '#2PPLQ', 'players');
            subscriptionRepo.subscribeToChat(chatId, topicB, '#2PPLQ', 'players');
            transport.chatMembers.set(memberKey(chatId, adminId), 'administrator');

            // Change topic A to management preset and disable system
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-topic-a-preset',
                    data: 'settings:preset:#2PPLQ:management',
                    chatId,
                    chatType: 'supergroup',
                    userId: adminId,
                    messageThreadId: topicA,
                }),
            );
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-topic-a-cat',
                    data: 'settings:category:#2PPLQ:system',
                    chatId,
                    chatType: 'supergroup',
                    userId: adminId,
                    messageThreadId: topicA,
                }),
            );

            // Topic A updated, topic B completely untouched
            expect(subscriptionRepo.getSubscription(chatId, topicA, '#2PPLQ')?.categories).toEqual({
                summaries: false,
                reminders: false,
                roster: false,
                discipline: true,
                system: false,
            });
            expect(subscriptionRepo.getSubscription(chatId, topicB, '#2PPLQ')?.categories).toEqual({
                summaries: true,
                reminders: true,
                roster: true,
                discipline: false,
                system: false,
            });

            // Opening settings in topic B shows its own players preset
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-topic-b-open',
                    data: 'settings:open:#2PPLQ',
                    chatId,
                    chatType: 'supergroup',
                    userId: adminId,
                    messageThreadId: topicB,
                }),
            );
            expect(String(transport.editedMessages().at(-1)?.text)).toContain('Пресет: Игроки');
        });

        it('applies settings changes only to new events without cancelling already queued notifications and handles stale/DB/not-modified errors', async () => {
            const {
                service,
                transport,
                clansRepo,
                subscriptionRepo,
                domainEventsRepo,
                notificationRepo,
                transactionManager,
                db,
            } = createHarness();
            const chatId = 6300;
            const userId = 6300;

            clansRepo.insertMinimalClan('#2PPLQ');
            subscriptionRepo.saveTelegramChat(chatId, 0, 'Leader');
            subscriptionRepo.subscribeToChat(chatId, 0, '#2PPLQ', 'players');
            const subId = subscriptionRepo.getSubscriptionId(chatId, 0, '#2PPLQ');
            expect(subId).not.toBeNull();
            if (subId === null) {
                throw new Error('Expected subscription_id');
            }

            // Seed already-queued domain event destination + notification for summaries before changing preset
            domainEventsRepo.appendEvent(
                {
                    eventType: 'war_ended',
                    eventId: '8901',
                    payload: '{}',
                    payloadVersion: 1,
                    clanTag: '#2PPLQ',
                },
                [{ chatId, messageThreadId: 0, category: 'summaries', subscriptionId: subId }],
            );
            const [dest] = domainEventsRepo.getPendingDestinations(10);
            expect(dest).toBeDefined();
            if (dest === undefined) {
                throw new Error('Expected seeded destination');
            }
            notificationRepo.enqueueDomainEventIfAbsent(
                'existing war summary',
                dest.destinationId,
                'war_ended',
                '8901',
                chatId,
                0,
            );
            const [notif] = notificationRepo.getPending(10);
            expect(notif).toBeDefined();
            if (notif === undefined) {
                throw new Error('Expected seeded notification');
            }

            // Switch preset to management (disables summaries, enables discipline & system)
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-switch-mgmt',
                    data: 'settings:preset:#2PPLQ:management',
                    chatId,
                    chatType: 'private',
                    userId,
                }),
            );

            // Already queued destination and notification are NOT cancelled
            expect(rowStatus(db, 'domain_event_destinations', dest.destinationId)).toBe('pending');
            expect(rowStatus(db, 'notifications', notif.id)).toBe('pending');
            // Future event routing reflects the new categories
            expect(
                subscriptionRepo.getSubscriptionDestinationsForClan('#2PPLQ', 'summaries'),
            ).toEqual([]);
            expect(
                subscriptionRepo.getSubscriptionDestinationsForClan('#2PPLQ', 'discipline'),
            ).toEqual([{ subscriptionId: subId, chatId, messageThreadId: 0 }]);

            // Clicking the already-active preset when Telegram responds "message is not modified" succeeds cleanly
            transport.editMessageTextResponder = () =>
                Promise.resolve({
                    ok: false,
                    error_code: 400,
                    description: 'Bad Request: message is not modified',
                });
            await expect(
                service.bot.handleUpdate(
                    makeCallbackUpdate({
                        queryId: 'q-not-modified',
                        data: 'settings:preset:#2PPLQ:management',
                        chatId,
                        chatType: 'private',
                        userId,
                    }),
                ),
            ).resolves.toBeUndefined();
            transport.editMessageTextResponder = undefined;

            // Stale button for unlinked clan shows personal alert without editing
            const editsBeforeErrors = transport.editedMessages().length;
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-unlinked',
                    data: 'settings:open:#999888',
                    chatId,
                    chatType: 'private',
                    userId,
                }),
            );
            expect(transport.editedMessages()).toHaveLength(editsBeforeErrors);
            expect(transport.answeredCallbackQueries().at(-1)).toEqual({
                callback_query_id: 'q-unlinked',
                text: 'Этот чат не привязан к клану #999888.',
                show_alert: true,
            });

            // DB error during settings update shows personal alert without editing
            const txSpy = vi
                .spyOn(transactionManager, 'retryInTransaction')
                .mockImplementation(() => {
                    throw new DatabaseError('settings write failed');
                });
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'q-db-err',
                    data: 'settings:preset:#2PPLQ:all',
                    chatId,
                    chatType: 'private',
                    userId,
                }),
            );
            txSpy.mockRestore();
            expect(transport.editedMessages()).toHaveLength(editsBeforeErrors);
            expect(transport.answeredCallbackQueries().at(-1)).toEqual({
                callback_query_id: 'q-db-err',
                text: 'Не удалось обновить настройки. Попробуйте ещё раз позже.',
                show_alert: true,
            });
        });

        it('navigates all attack guide screens (TH7-TH18 -> strategies -> guides -> two HTML messages)', async () => {
            const { service, transport } = createHarness();

            await service.bot.handleUpdate(makeCallbackUpdate({ data: 'guides:townhalls' }));
            const thEdit = transport.editedMessages()[0];
            expect(thEdit?.text).toBe('Выберите ратушу:');
            const thKeyboard = getInlineKeyboard(thEdit);
            expect(thKeyboard).toHaveLength(4);
            expect(thKeyboard[0]?.[0]?.callback_data).toBe('guides:townhall:7');
            expect(thKeyboard[2]?.[1]?.callback_data).toBe('guides:townhall:14');
            expect(thKeyboard[3]?.[2]?.callback_data).toBe('guides:townhall:18');

            await service.bot.handleUpdate(makeCallbackUpdate({ data: 'guides:townhall:14' }));
            const strategyEdit = transport.editedMessages()[1];
            expect(strategyEdit?.text).toBe('Выберите стратегию:');
            const strategyKeyboard = getInlineKeyboard(strategyEdit);
            // zap_dragons + universal fundamentals + back button (disabled_army excluded)
            expect(strategyKeyboard).toHaveLength(3);
            expect(strategyKeyboard[0]?.[0]?.callback_data).toBe('guides:strategy:14:zap_dragons');
            expect(strategyKeyboard[1]?.[0]?.callback_data).toBe('guides:strategy:14:fundamentals');
            expect(strategyKeyboard[2]?.[0]?.callback_data).toBe('guides:townhalls');

            await service.bot.handleUpdate(
                makeCallbackUpdate({ data: 'guides:strategy:14:zap_dragons' }),
            );
            const guideEdit = transport.editedMessages()[2];
            expect(guideEdit?.text).toBe('Выберите гайд:');
            const guideKeyboard = getInlineKeyboard(guideEdit);
            expect(guideKeyboard).toHaveLength(2);
            expect(guideKeyboard[0]?.[0]?.callback_data).toBe('guides:guide:14:zap_dragons_th14');
            expect(guideKeyboard[1]?.[0]?.callback_data).toBe('guides:townhall:14');

            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    data: 'guides:guide:14:zap_dragons_th14',
                    chatId: -5001,
                    chatType: 'supergroup',
                    messageThreadId: 21,
                }),
            );
            const sent = transport.sentMessages();
            expect(sent).toHaveLength(2);
            expect(sent[0]?.parse_mode).toBe('HTML');
            expect(sent[0]?.message_thread_id).toBe(21);
            expect(sent[0]?.text).toBe(
                'Zap Dragons TH14\nhttps://youtube.example/zap-dragons-th14',
            );
            expect(sent[1]?.parse_mode).toBe('HTML');
            expect(sent[1]?.message_thread_id).toBe(21);
            expect(String(sent[1]?.text)).toContain('вернуться');
            const navKeyboard = getInlineKeyboard(sent[1]);
            expect(navKeyboard[0]?.[0]?.callback_data).toBe('guides:strategy:14:zap_dragons');
            expect(navKeyboard[1]?.[0]?.callback_data).toBe('guides:townhall:14');
            expect(navKeyboard[2]?.[0]?.callback_data).toBe('menu:start');
        });

        it('answers and safely ignores stale, unknown, broken callbacks and continues when answerCallbackQuery fails', async () => {
            const { service, transport } = createHarness();

            const brokenPayloads = [
                'invalid-callback-data',
                '',
                'unknown:command',
                'guides:townhall:6',
                'guides:townhall:19',
                'guides:strategy:14:missing_strategy',
                'guides:guide:14:disabled_guide',
                'guides:guide:14:missing_guide',
                'clans:unlink:#BAD_TAG!',
                'clans:unlink:#2PPLQ:extra',
            ];

            for (const data of brokenPayloads) {
                await service.bot.handleUpdate(makeCallbackUpdate({ data }));
            }

            expect(transport.answeredCallbackQueries()).toHaveLength(brokenPayloads.length);
            expect(transport.editedMessages()).toHaveLength(0);
            expect(transport.sentMessages()).toHaveLength(0);

            // Missing message in callback_query is ignored without throwing
            await service.bot.handleUpdate(
                makeCallbackUpdate({ data: 'menu:start', omitMessage: true }),
            );
            expect(transport.editedMessages()).toHaveLength(0);

            // Failure in answerCallbackQuery does not stop handling the callback screen
            transport.failAnswerCallbackQuery = true;
            await service.bot.handleUpdate(makeCallbackUpdate({ data: 'help:main' }));
            expect(transport.editedMessages()).toHaveLength(1);
            expect(String(transport.editedMessages()[0]?.text)).toContain('Помощь');
        });

        it('escapes HTML special characters in guide title and youtubeUrl before sending', async () => {
            const { db, clansRepo, subscriptionRepo, domainEventsRepo, transactionManager } =
                createHarness();
            const transport = createFakeTelegramTransport(db);
            const htmlCatalog = AttackGuideCatalog.fromJson({
                guides: [
                    {
                        id: 'html_special_guide',
                        army_id: 'zap_dragons',
                        army_title: 'Zap & Dragons',
                        variant_id: 'classic',
                        variant_title: 'Classic',
                        title: 'TH14 <Zap> & Dragons',
                        town_halls: [14],
                        youtube_url: 'https://www.youtube.com/watch?v=abc123&t=42',
                        sort_order: 1,
                        enabled: true,
                    },
                ],
            });
            const service = new TelegramBotService({
                telegramToken: 'test-bot-token',
                attackGuideCatalog: htmlCatalog,
                clansRepo,
                subscriptionRepo,
                domainEventsRepo,
                transactionManager,
                logger: createLogger({ level: 'silent' }),
                botConfig: { botInfo: TEST_BOT_INFO },
            });
            transport.install(service);

            // Repeat twice to verify deterministic, idempotent escaping
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'html-guide-1',
                    data: 'guides:guide:14:html_special_guide',
                }),
            );
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'html-guide-2',
                    data: 'guides:guide:14:html_special_guide',
                }),
            );

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(4);
            expect(sent[0]?.parse_mode).toBe('HTML');
            expect(sent[0]?.text).toBe(
                'TH14 &lt;Zap&gt; &amp; Dragons\nhttps://www.youtube.com/watch?v=abc123&amp;t=42',
            );
            expect(sent[2]?.text).toBe(sent[0]?.text);
        });

        it('ignores guide callback when guide is incompatible with callback townHall and allows universal guides', async () => {
            const { service, transport } = createHarness();

            // zap_dragons_th14 is only for TH14; requesting it under TH15 must be ignored
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'mismatch-1',
                    data: 'guides:guide:15:zap_dragons_th14',
                }),
            );
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'mismatch-2',
                    data: 'guides:guide:15:zap_dragons_th14',
                }),
            );

            expect(transport.answeredCallbackQueries()).toHaveLength(2);
            expect(transport.sentMessages()).toHaveLength(0);
            expect(transport.editedMessages()).toHaveLength(0);

            // Universal guide (empty town_halls) is compatible with any valid TH (e.g. TH15)
            await service.bot.handleUpdate(
                makeCallbackUpdate({
                    queryId: 'universal-th15',
                    data: 'guides:guide:15:universal_funnel',
                }),
            );

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(2);
            expect(sent[0]?.text).toBe(
                'Универсальный гайд по фаннелингу\nhttps://youtube.example/funnel',
            );
            const navKeyboard = getInlineKeyboard(sent[1]);
            expect(navKeyboard[0]?.[0]?.callback_data).toBe('guides:strategy:15:fundamentals');
        });
    });

    describe('long polling, transient API errors and AbortSignal shutdown', () => {
        it('returns immediately if AbortSignal is already aborted before start()', async () => {
            const { service, transport } = createHarness();
            const controller = new AbortController();
            controller.abort();

            await service.start(controller.signal);

            expect(transport.calls).toHaveLength(0);
        });

        it('registers setMyCommands, setMyDescription and setMyShortDescription with Fan Content Policy disclaimer on start()', async () => {
            const { service, transport } = createHarness();
            const controller = new AbortController();

            transport.getUpdatesResponder = async (payload, signal) => {
                if (payload.limit === 1 || controller.signal.aborted) {
                    return { ok: true, result: [] };
                }

                return await new Promise<ApiResponse<unknown>>((_resolve, reject) => {
                    queueMicrotask(() => {
                        controller.abort();
                    });
                    signal?.addEventListener(
                        'abort',
                        () => {
                            const err = new Error('Aborted');
                            err.name = 'AbortError';
                            reject(err);
                        },
                        { once: true },
                    );
                });
            };

            await service.start(controller.signal);

            const commandsCall = transport.calls.find((call) => call.method === 'setMyCommands');
            const descriptionCall = transport.calls.find(
                (call) => call.method === 'setMyDescription',
            );
            const shortDescriptionCall = transport.calls.find(
                (call) => call.method === 'setMyShortDescription',
            );

            expect(commandsCall?.payload.commands).toEqual(TELEGRAM_BOT_COMMANDS);
            expect(
                (commandsCall?.payload.commands as { command: string }[]).map((c) => c.command),
            ).toEqual(['start', 'help', 'link', 'unlink']);

            expect(descriptionCall?.payload.description).toBe(TELEGRAM_BOT_DESCRIPTION);
            expect(String(descriptionCall?.payload.description)).toContain(
                SUPERCELL_FAN_CONTENT_DISCLAIMER,
            );
            expect(TELEGRAM_BOT_DESCRIPTION.length).toBeLessThanOrEqual(512);

            expect(shortDescriptionCall?.payload.short_description).toBe(
                TELEGRAM_BOT_SHORT_DESCRIPTION,
            );
            expect(String(shortDescriptionCall?.payload.short_description)).toContain('Supercell');
            expect(TELEGRAM_BOT_SHORT_DESCRIPTION.length).toBeLessThanOrEqual(120);
        });

        it('logs warnings and still starts polling when setMyCommands, setMyDescription or setMyShortDescription fail', async () => {
            const logger = createLogger({ level: 'silent' });
            const warnSpy = vi.spyOn(logger, 'warn');
            const { service, transport } = createHarness({ logger });
            const controller = new AbortController();

            transport.failSetMyCommands = true;
            transport.failSetMyDescription = true;
            transport.failSetMyShortDescription = true;

            let pollCount = 0;
            transport.getUpdatesResponder = async (payload, signal) => {
                if (payload.limit === 1 || controller.signal.aborted) {
                    return { ok: true, result: [] };
                }

                pollCount += 1;
                if (pollCount === 1) {
                    return {
                        ok: true,
                        result: [
                            makeMessageUpdate({
                                updateId: 40,
                                chatId: 1040,
                                chatType: 'private',
                                text: '/help',
                            }),
                        ],
                    };
                }

                return await new Promise<ApiResponse<unknown>>((_resolve, reject) => {
                    queueMicrotask(() => {
                        controller.abort();
                    });
                    signal?.addEventListener(
                        'abort',
                        () => {
                            const err = new Error('Aborted');
                            err.name = 'AbortError';
                            reject(err);
                        },
                        { once: true },
                    );
                });
            };

            await service.start(controller.signal);

            expect(pollCount).toBe(2);
            expect(transport.calls.filter((c) => c.method === 'setMyCommands')).toHaveLength(1);
            expect(transport.calls.filter((c) => c.method === 'setMyDescription')).toHaveLength(1);
            expect(
                transport.calls.filter((c) => c.method === 'setMyShortDescription'),
            ).toHaveLength(1);
            expect(transport.sentMessages()).toHaveLength(1);
            expect(String(transport.sentMessages()[0]?.text)).toContain(
                SUPERCELL_FAN_CONTENT_DISCLAIMER,
            );

            const warnedMethods = warnSpy.mock.calls
                .map((args) => (args[0] as { method?: string } | undefined)?.method)
                .filter((method): method is string => method !== undefined);
            expect(warnedMethods).toEqual([
                'setMyCommands',
                'setMyDescription',
                'setMyShortDescription',
            ]);
        });

        it('polls with allowed_updates=[message, callback_query, my_chat_member], handles middleware errors without crashing and stops on AbortSignal', async () => {
            const { service, transport, subscriptionRepo } = createHarness({
                pollingTimeoutSeconds: 2,
            });
            const controller = new AbortController();
            let pollCount = 0;

            transport.getUpdatesResponder = async (payload, signal) => {
                if (payload.limit === 1 || controller.signal.aborted) {
                    return { ok: true, result: [] };
                }

                pollCount += 1;

                if (pollCount === 1) {
                    expect(payload.allowed_updates).toEqual([...TELEGRAM_BOT_ALLOWED_UPDATES]);
                    expect(payload.timeout).toBe(2);

                    // First update triggers a sendMessage 403 error, second update still succeeds
                    transport.failSendMessage = true;
                    return {
                        ok: true,
                        result: [
                            makeMessageUpdate({
                                updateId: 1,
                                chatId: 6001,
                                chatType: 'private',
                                userId: 6001,
                                text: '/start',
                            }),
                        ],
                    };
                }

                if (pollCount === 2) {
                    transport.failSendMessage = false;
                    return {
                        ok: true,
                        result: [
                            makeMessageUpdate({
                                updateId: 2,
                                chatId: 6001,
                                chatType: 'private',
                                userId: 6001,
                                text: '/link #2PPLQ',
                            }),
                        ],
                    };
                }

                // Wait on 3rd poll until aborted
                return await new Promise<ApiResponse<unknown>>((_resolve, reject) => {
                    queueMicrotask(() => {
                        controller.abort();
                    });
                    signal?.addEventListener(
                        'abort',
                        () => {
                            const err = new Error('Aborted');
                            err.name = 'AbortError';
                            reject(err);
                        },
                        { once: true },
                    );
                });
            };

            await service.start(controller.signal);

            expect(pollCount).toBe(3);
            expect(subscriptionRepo.hasSubscription(6001, 0, '#2PPLQ')).toBe(true);
            expect(service.isRunning()).toBe(false);
        });

        it('recovers after a transient getUpdates API error (HTTP 500) and processes subsequent updates', async () => {
            const { service, transport } = createHarness();
            const controller = new AbortController();
            let pollCount = 0;

            transport.getUpdatesResponder = async (payload, signal) => {
                if (payload.limit === 1 || controller.signal.aborted) {
                    return { ok: true, result: [] };
                }

                pollCount += 1;
                if (pollCount === 1) {
                    return {
                        ok: false,
                        error_code: 500,
                        description: 'Internal Server Error',
                    };
                }
                if (pollCount === 2) {
                    return {
                        ok: true,
                        result: [
                            makeMessageUpdate({
                                updateId: 14,
                                chatId: 1014,
                                chatType: 'private',
                                text: '/start',
                            }),
                        ],
                    };
                }

                return await new Promise<ApiResponse<unknown>>((_resolve, reject) => {
                    queueMicrotask(() => {
                        controller.abort();
                    });
                    signal?.addEventListener(
                        'abort',
                        () => {
                            const err = new Error('Aborted');
                            err.name = 'AbortError';
                            reject(err);
                        },
                        { once: true },
                    );
                });
            };

            await service.start(controller.signal);

            expect(pollCount).toBe(3);
            const sent = transport.sentMessages();
            expect(sent).toHaveLength(1);
            expect(String(sent[0]?.text)).toContain('Добро пожаловать');
        }, 10_000);

        it('aborts an active long poll against a loopback HTTP server promptly on AbortSignal', async () => {
            const db = new Database(':memory:');
            openDatabases.push(db);
            const txManager = new TransactionManager(db);
            new MigratorManager(db, txManager).migrate(REAL_MIGRATIONS_PATH);

            let resolvePollStarted!: () => void;
            const pollStarted = new Promise<void>((resolve) => {
                resolvePollStarted = resolve;
            });

            const server = await startLoopbackServer((_req, res, recorded) => {
                if (
                    recorded.url.endsWith('/deleteWebhook') ||
                    recorded.url.endsWith('/setMyCommands') ||
                    recorded.url.endsWith('/setMyDescription') ||
                    recorded.url.endsWith('/setMyShortDescription')
                ) {
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ ok: true, result: true }));
                    return;
                }
                if (recorded.url.endsWith('/getUpdates')) {
                    resolvePollStarted();
                    // Keep the long-poll connection open until client aborts
                    return;
                }
                res.statusCode = 404;
                res.end();
            });
            openServers.push(server);

            const service = new TelegramBotService({
                telegramToken: 'loopback-token',
                attackGuideCatalog: createTestCatalog(),
                clansRepo: new ClansRepo(db),
                subscriptionRepo: new SubscriptionRepo(db),
                domainEventsRepo: new DomainEventsRepo(db),
                transactionManager: txManager,
                logger: createLogger({ level: 'silent' }),
                pollingTimeoutSeconds: 2,
                stopConfirmationTimeoutMs: 150,
                botConfig: {
                    botInfo: TEST_BOT_INFO,
                    client: {
                        apiRoot: server.baseUrl,
                    },
                },
            });

            const controller = new AbortController();
            const runPromise = service.start(controller.signal);

            await pollStarted;
            const stopStart = Date.now();
            controller.abort();
            await runPromise;
            const elapsedMs = Date.now() - stopStart;

            expect(elapsedMs).toBeLessThan(2000);
            expect(service.isRunning()).toBe(false);
        });

        it('cancels in-flight update processing without DB writes, error replies or processing the next update', async () => {
            const { service, transport, subscriptionRepo } = createHarness();
            const controller = new AbortController();
            let pollCount = 0;

            transport.getUpdatesResponder = () => {
                pollCount += 1;
                if (pollCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        result: [
                            makeMessageUpdate({
                                updateId: 1,
                                chatId: -1001,
                                chatType: 'supergroup',
                                title: 'Clan',
                                userId: 42,
                                text: '/link #2PPLQ',
                            }),
                            makeMessageUpdate({
                                updateId: 2,
                                chatId: -1001,
                                chatType: 'supergroup',
                                title: 'Clan',
                                userId: 42,
                                text: '/start',
                            }),
                        ],
                    });
                }
                return Promise.resolve({ ok: true, result: [] });
            };

            transport.getChatMemberResponder = async (_payload, signal) => {
                return await new Promise<ApiResponse<unknown>>((_resolve, reject) => {
                    queueMicrotask(() => {
                        controller.abort();
                    });
                    signal?.addEventListener(
                        'abort',
                        () => {
                            const err = new Error('Aborted during getChatMember');
                            err.name = 'AbortError';
                            reject(err);
                        },
                        { once: true },
                    );
                });
            };

            await service.start(controller.signal);

            expect(subscriptionRepo.hasSubscription(-1001, 0, '#2PPLQ')).toBe(false);
            expect(transport.sentMessages()).toHaveLength(0);
        });
    });

    describe('chat migration (migrate_to_chat_id / migrate_from_chat_id) and my_chat_member lifecycle', () => {
        it('subscribes to my_chat_member in TELEGRAM_BOT_ALLOWED_UPDATES', () => {
            expect(TELEGRAM_BOT_ALLOWED_UPDATES).toEqual([
                'message',
                'callback_query',
                'my_chat_member',
            ]);
        });

        it('atomically migrates telegram_chats, clan_subscriptions, pending destinations and notifications on message.migrate_to_chat_id and ignores duplicate migrate_from_chat_id', async () => {
            const { service, db, clansRepo, subscriptionRepo, domainEventsRepo, notificationRepo } =
                createHarness();
            const oldChatId = -500;
            const newChatId = -1005000001;

            clansRepo.insertMinimalClan('#2PPLQ');
            subscriptionRepo.saveTelegramChat(oldChatId, 0, 'Old Group');
            subscriptionRepo.subscribeToChat(oldChatId, 0, '#2PPLQ', 'players');
            const originalSubId = subscriptionRepo.getSubscriptionId(oldChatId, 0, '#2PPLQ');
            expect(originalSubId).not.toBeNull();

            // Seed one pending destination and one materialized destination with a pending notification
            domainEventsRepo.appendEvent(
                {
                    eventType: 'war_ended',
                    eventId: 'mig-dest-1',
                    payload: '{}',
                    payloadVersion: 1,
                    clanTag: '#2PPLQ',
                },
                [
                    {
                        chatId: oldChatId,
                        messageThreadId: 0,
                        category: 'summaries',
                        subscriptionId: originalSubId ?? 0,
                    },
                ],
            );
            domainEventsRepo.appendEvent(
                {
                    eventType: 'war_ended',
                    eventId: 'mig-notif-1',
                    payload: '{}',
                    payloadVersion: 1,
                    clanTag: '#2PPLQ',
                },
                [
                    {
                        chatId: oldChatId,
                        messageThreadId: 0,
                        category: 'summaries',
                        subscriptionId: originalSubId ?? 0,
                    },
                ],
            );
            const pendingDests = domainEventsRepo.getPendingDestinations(10);
            const matDest = pendingDests.find((d) => d.eventId === 'mig-notif-1');
            expect(matDest).toBeDefined();
            domainEventsRepo.markMaterialized(matDest?.destinationId ?? 0);
            notificationRepo.enqueueDomainEventIfAbsent(
                'Pending war report',
                matDest?.destinationId ?? 0,
                'war_ended',
                'mig-notif-1',
                oldChatId,
                0,
            );

            // Receive migrate_to_chat_id service message in old group
            await service.bot.handleUpdate({
                update_id: 501,
                message: {
                    message_id: 501,
                    date: 1_700_000_000,
                    chat: { id: oldChatId, type: 'group', title: 'Upgraded Group' },
                    migrate_to_chat_id: newChatId,
                },
            } as unknown as Update);

            expect(subscriptionRepo.hasSubscription(oldChatId, 0, '#2PPLQ')).toBe(false);
            expect(subscriptionRepo.getSubscriptionId(newChatId, 0, '#2PPLQ')).toBe(originalSubId);

            const migratedDest = domainEventsRepo.getPendingDestinations(10);
            expect(migratedDest).toHaveLength(1);
            expect(migratedDest[0]?.chatId).toBe(newChatId);

            const migratedNotifs = notificationRepo.getPending(10);
            expect(migratedNotifs).toHaveLength(1);
            expect(migratedNotifs[0]?.chatId).toBe(newChatId);

            const titleRow = db.connection
                .prepare<[number], { title: string }>(
                    'SELECT title FROM telegram_chats WHERE chat_id = ? AND message_thread_id = 0;',
                )
                .get(newChatId);
            expect(titleRow?.title).toBe('Upgraded Group');

            // Follow-up migrate_from_chat_id service message in new supergroup is an idempotent no-op
            await service.bot.handleUpdate({
                update_id: 502,
                message: {
                    message_id: 502,
                    date: 1_700_000_001,
                    chat: { id: newChatId, type: 'supergroup', title: 'Upgraded Group' },
                    migrate_from_chat_id: oldChatId,
                },
            } as unknown as Update);

            expect(subscriptionRepo.getSubscriptionId(newChatId, 0, '#2PPLQ')).toBe(originalSubId);
            expect(notificationRepo.getPending(10)).toHaveLength(1);
        });

        it('migrates subscriptions and queues on message.migrate_from_chat_id even when migrate_to_chat_id was missed', async () => {
            const { service, clansRepo, subscriptionRepo, notificationRepo } = createHarness();
            const oldChatId = -600;
            const newChatId = -1006000001;

            clansRepo.insertMinimalClan('#2PPLQ');
            subscriptionRepo.saveTelegramChat(oldChatId, 0, 'Old Group');
            subscriptionRepo.subscribeToChat(oldChatId, 0, '#2PPLQ', 'players');
            const originalSubId = subscriptionRepo.getSubscriptionId(oldChatId, 0, '#2PPLQ');
            notificationRepo.enqueueIfAbsent('Legacy pending', 'war_ended', 'mf-1', oldChatId, 0);

            await service.bot.handleUpdate({
                update_id: 601,
                message: {
                    message_id: 601,
                    date: 1_700_000_000,
                    chat: { id: newChatId, type: 'supergroup', title: 'New Supergroup' },
                    migrate_from_chat_id: oldChatId,
                },
            } as unknown as Update);

            expect(subscriptionRepo.getSubscriptionId(newChatId, 0, '#2PPLQ')).toBe(originalSubId);
            const pendingNotifs = notificationRepo.getPending(10);
            expect(pendingNotifs).toHaveLength(1);
            expect(pendingNotifs[0]?.chatId).toBe(newChatId);
        });

        it('automatically disables subscriptions and cancels pending queues on my_chat_member kicked, left, and restricted without send rights', async () => {
            const {
                service,
                db,
                clansRepo,
                subscriptionRepo,
                domainEventsRepo,
                notificationRepo,
                transport,
            } = createHarness();

            clansRepo.insertMinimalClan('#2PPLQ');
            clansRepo.insertMinimalClan('#SOLE');

            // Chat -7001 (multi-topic supergroup, kicked)
            subscriptionRepo.saveTelegramChat(-7001, 0, 'Group General');
            subscriptionRepo.saveTelegramChat(-7001, 15, 'Group Topic');
            subscriptionRepo.subscribeToChat(-7001, 0, '#2PPLQ', 'players');
            subscriptionRepo.subscribeToChat(-7001, 15, '#SOLE', 'players');
            // Chat -7002 (healthy supergroup keeping #2PPLQ tracked)
            subscriptionRepo.saveTelegramChat(-7002, 0, 'Healthy Group');
            subscriptionRepo.subscribeToChat(-7002, 0, '#2PPLQ', 'players');
            // Private chat 7003 (user blocks bot -> kicked)
            subscriptionRepo.saveTelegramChat(7003, 0, 'Leader PM');
            subscriptionRepo.subscribeToChat(7003, 0, '#2PPLQ', 'management');
            // Group -7004 (bot left)
            subscriptionRepo.saveTelegramChat(-7004, 0, 'Left Group');
            subscriptionRepo.subscribeToChat(-7004, 0, '#2PPLQ', 'players');
            // Group -7005 (bot restricted with can_send_messages = false)
            subscriptionRepo.saveTelegramChat(-7005, 0, 'Muted Group');
            subscriptionRepo.subscribeToChat(-7005, 0, '#2PPLQ', 'players');

            const sub7001Topic = subscriptionRepo.getSubscriptionId(-7001, 15, '#SOLE') ?? 0;
            const sub7003 = subscriptionRepo.getSubscriptionId(7003, 0, '#2PPLQ') ?? 0;

            // Pending destination for -7001 topic 15
            domainEventsRepo.appendEvent(
                {
                    eventType: 'war_ended',
                    eventId: 'mcm-1',
                    payload: '{}',
                    payloadVersion: 1,
                    clanTag: '#SOLE',
                },
                [
                    {
                        chatId: -7001,
                        messageThreadId: 15,
                        category: 'summaries',
                        subscriptionId: sub7001Topic,
                    },
                ],
            );
            // Pending notification for private chat 7003
            domainEventsRepo.appendEvent(
                {
                    eventType: 'war_ended',
                    eventId: 'mcm-2',
                    payload: '{}',
                    payloadVersion: 1,
                    clanTag: '#2PPLQ',
                },
                [
                    {
                        chatId: 7003,
                        messageThreadId: 0,
                        category: 'discipline',
                        subscriptionId: sub7003,
                    },
                ],
            );
            const dest7003 = domainEventsRepo
                .getPendingDestinations(10)
                .find((d) => d.eventId === 'mcm-2');
            expect(dest7003).toBeDefined();
            domainEventsRepo.markMaterialized(dest7003?.destinationId ?? 0);
            notificationRepo.enqueueDomainEventIfAbsent(
                'Management alert',
                dest7003?.destinationId ?? 0,
                'war_violations',
                'mcm-2',
                7003,
                0,
            );
            const notif7003Id = notificationRepo.getPending(10)[0]?.id ?? 0;

            const makeMyChatMemberUpdate = (
                updateId: number,
                chatId: number,
                chatType: 'private' | 'group' | 'supergroup',
                oldStatus: string,
                newMember: Record<string, unknown>,
            ): Update =>
                ({
                    update_id: updateId,
                    my_chat_member: {
                        chat: { id: chatId, type: chatType },
                        from: { id: 1, is_bot: false, first_name: 'Admin' },
                        date: 1_700_000_000,
                        old_chat_member: { status: oldStatus, user: TEST_BOT_INFO },
                        new_chat_member: { user: TEST_BOT_INFO, ...newMember },
                    },
                }) as unknown as Update;

            // 1. Kicked from multi-topic supergroup -7001 -> disables both topics and untracks #SOLE
            await service.bot.handleUpdate(
                makeMyChatMemberUpdate(701, -7001, 'supergroup', 'administrator', {
                    status: 'kicked',
                    until_date: 0,
                }),
            );
            expect(subscriptionRepo.getSubscriptionsForChat(-7001)).toEqual([]);
            expect(clansRepo.getTrackedClans()).toEqual(['#2PPLQ']);
            expect(domainEventsRepo.getPendingDestinations(10)).toEqual([]);

            // 2. Blocked in private chat 7003 -> disables subscription and cancels pending notification
            await service.bot.handleUpdate(
                makeMyChatMemberUpdate(702, 7003, 'private', 'member', {
                    status: 'kicked',
                    until_date: 0,
                }),
            );
            expect(subscriptionRepo.getSubscriptionsForChat(7003)).toEqual([]);
            expect(rowStatus(db, 'notifications', notif7003Id)).toBe('cancelled');

            // 3. Removed (left) from group -7004
            await service.bot.handleUpdate(
                makeMyChatMemberUpdate(703, -7004, 'group', 'member', { status: 'left' }),
            );
            expect(subscriptionRepo.getSubscriptionsForChat(-7004)).toEqual([]);

            // 4. Restricted without can_send_messages in group -7005
            await service.bot.handleUpdate(
                makeMyChatMemberUpdate(704, -7005, 'supergroup', 'member', {
                    status: 'restricted',
                    is_member: true,
                    can_send_messages: false,
                }),
            );
            expect(subscriptionRepo.getSubscriptionsForChat(-7005)).toEqual([]);

            // 5. Non-blocking transitions on healthy chat -7002 MUST NOT disable subscriptions
            await service.bot.handleUpdate(
                makeMyChatMemberUpdate(705, -7002, 'supergroup', 'administrator', {
                    status: 'member',
                }),
            );
            await service.bot.handleUpdate(
                makeMyChatMemberUpdate(706, -7002, 'supergroup', 'member', {
                    status: 'restricted',
                    is_member: true,
                    can_send_messages: true,
                }),
            );
            expect(subscriptionRepo.hasSubscription(-7002, 0, '#2PPLQ')).toBe(true);

            // Zero Telegram HTTP calls were made during my_chat_member handling
            expect(transport.calls).toHaveLength(0);
        });
    });
});
