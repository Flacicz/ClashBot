import path from 'node:path';

import type { Context } from 'grammy';
import type { ApiResponse, ChatMember, Update, UserFromGetMe } from 'grammy/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { createLogger } from '../../src/logging/index.js';
import {
    AttackGuideCatalog,
    TELEGRAM_BOT_ALLOWED_UPDATES,
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
    getUpdatesResponder?: (
        payload: Record<string, unknown>,
        signal?: GrammyAbortSignal,
    ) => Promise<ApiResponse<unknown>>;
    getChatMemberResponder?: (
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
        const logger = createLogger({ level: 'silent' });
        const transport = createFakeTelegramTransport(db);

        const service = new TelegramBotService({
            telegramToken: 'test-bot-token',
            attackGuideCatalog: createTestCatalog(),
            clansRepo,
            subscriptionRepo,
            domainEventsRepo,
            transactionManager,
            logger,
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

    describe('commands: /start and ignored messages', () => {
        it('sends the main menu on /start preserving forum topic message_thread_id', async () => {
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
            expect(String(sent[0]?.text)).toContain('Добро пожаловать');
            const keyboard = getInlineKeyboard(sent[0]);
            expect(keyboard[0]?.[0]?.callback_data).toBe('guides:townhalls');
            expect(keyboard[1]?.[0]?.callback_data).toBe('clans:link');
            expect(keyboard[2]?.[0]?.callback_data).toBe('clans:list');
            expect(keyboard[3]?.[0]?.callback_data).toBe('clans:unlink');
            expect(keyboard[4]?.[0]?.callback_data).toBe('help:main');
        });

        it('omits message_thread_id in general chats and ignores /start with args or unknown commands', async () => {
            const { service, transport } = createHarness();

            await service.bot.handleUpdate(
                makeMessageUpdate({ chatId: 1011, chatType: 'private', text: '/start' }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({ chatId: 1011, chatType: 'private', text: '/start extra' }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({ chatId: 1011, chatType: 'private', text: '/unknown #2PPLQ' }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({ chatId: 1011, chatType: 'private', text: 'hello world' }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({ chatId: 1011, chatType: 'private' }),
            );

            const sent = transport.sentMessages();
            expect(sent).toHaveLength(1);
            expect(sent[0]?.message_thread_id).toBeUndefined();
        });

        it('ignores /start, /link, and /unlink addressed to another bot without side effects', async () => {
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
            const subscriptionIdBefore = subscriptionRepo.getSubscriptionId(
                chatId,
                0,
                '#2PPLQ',
                'players',
            );
            expect(subscriptionIdBefore).not.toBeNull();

            const callsBefore = transport.calls.length;

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 2,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/start@OtherBot',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 3,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/link@OtherBot #2PP',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 4,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/link@OtherBot',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 5,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/link@OtherBot #INVALID',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 6,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/unlink@OtherBot #2PPLQ',
                }),
            );
            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 7,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/unlink@OtherBot #2PPLQ',
                }),
            );

            expect(transport.calls).toHaveLength(callsBefore);
            expect(subscriptionRepo.hasSubscription(chatId, 0, '#2PP', 'players')).toBe(false);
            expect(subscriptionRepo.getSubscriptionId(chatId, 0, '#2PPLQ', 'players')).toBe(
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

            expect(subscriptionRepo.hasSubscription(chatId, 0, '#2PPLQ', 'players')).toBe(true);

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 12,
                    chatId,
                    chatType: 'supergroup',
                    userId,
                    text: '/unlink@cLaShTeStBoT #2PPLQ',
                }),
            );

            expect(subscriptionRepo.hasSubscription(chatId, 0, '#2PPLQ', 'players')).toBe(false);
            expect(transport.sentMessages()).toHaveLength(3);
        });
    });

    describe('command: /link', () => {
        it('links a supergroup forum topic for an administrator with players audience', async () => {
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

            expect(subscriptionRepo.hasSubscription(chatId, threadId, '#2PPLQ', 'players')).toBe(
                true,
            );
            expect(subscriptionRepo.hasSubscription(chatId, threadId, '#2PPLQ', 'management')).toBe(
                false,
            );
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
            expect(String(sent[0]?.text)).toContain('Готово! Общий чат привязан к клану #2PPLQ');
            expect(String(sent[0]?.text)).toContain('обычные отчёты и уведомления для игроков');
        });

        it('links a private chat as management without calling getChatMember and resolves title fallbacks', async () => {
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
            expect(subscriptionRepo.hasSubscription(1003, 0, '#2PPLQ', 'management')).toBe(true);
            expect(subscriptionRepo.hasSubscription(1003, 0, '#2PPLQ', 'players')).toBe(false);

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
            expect(String(sent[0]?.text)).toContain('Личный чат');
            expect(String(sent[0]?.text)).toContain('управленческие уведомления');
        });

        it('is idempotent on repeated /link and preserves the existing subscription_id generation', async () => {
            const { service, subscriptionRepo } = createHarness();

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 1,
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #2PPLQ',
                }),
            );
            const firstSubscriptionId = subscriptionRepo.getSubscriptionId(
                2001,
                0,
                '#2PPLQ',
                'management',
            );
            expect(firstSubscriptionId).not.toBeNull();

            await service.bot.handleUpdate(
                makeMessageUpdate({
                    updateId: 2,
                    chatId: 2001,
                    chatType: 'private',
                    userId: 2001,
                    text: '/link #2PPLQ',
                }),
            );
            const secondSubscriptionId = subscriptionRepo.getSubscriptionId(
                2001,
                0,
                '#2PPLQ',
                'management',
            );
            expect(secondSubscriptionId).toBe(firstSubscriptionId);
        });

        it('rejects /link from non-administrator, private chat mismatch, unsupported chat types, invalid args and invalid tags', async () => {
            const { service, transport, clansRepo } = createHarness();
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

            expect(subscriptionRepo.hasSubscription(chatId, threadId, '#2PPLQ', 'players')).toBe(
                false,
            );
            expect(subscriptionRepo.getClanTagsForChat(chatId, threadId, 'players')).toEqual([]);
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

            expect(subscriptionRepo.hasSubscription(-1005, 0, '#2PPLQ', 'players')).toBe(false);
            expect(subscriptionRepo.hasSubscription(-1006, 0, '#2PPLQ', 'players')).toBe(true);
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
            const userId = 42;

            clansRepo.insertMinimalClan('#2PPLQ');
            clansRepo.insertMinimalClan('#999888');

            const subscribe = (
                topic: number,
                tag: string,
                audience: 'players' | 'management',
            ): number => {
                subscriptionRepo.saveTelegramChat(chatId, topic, 'test chat');
                subscriptionRepo.subscribeToChat(chatId, topic, tag, audience);
                const id = subscriptionRepo.getSubscriptionId(chatId, topic, tag, audience);
                if (id === null) {
                    throw new Error('Expected subscription_id');
                }
                return id;
            };

            const oldSubscription = subscribe(7, '#2PPLQ', 'players');
            const otherTopic = subscribe(8, '#2PPLQ', 'players');
            const management = subscribe(7, '#2PPLQ', 'management');
            const otherClan = subscribe(7, '#999888', 'players');

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
                        audience: 'players',
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
                        audience: 'players',
                        subscriptionId: oldSubscription,
                    },
                    { chatId, messageThreadId: 8, audience: 'players', subscriptionId: otherTopic },
                    {
                        chatId,
                        messageThreadId: 7,
                        audience: 'management',
                        subscriptionId: management,
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
                [{ chatId, messageThreadId: 7, audience: 'players', subscriptionId: otherClan }],
            );

            const destinations = domainEventsRepo.getPendingDestinations(20);
            const findDestination = (eventId: string, subId: number): number => {
                const match = destinations.find(
                    (d) => d.eventId === eventId && d.subscriptionId === subId,
                );
                if (match === undefined) {
                    throw new Error(`Destination not found for ${eventId}/${String(subId)}`);
                }
                return match.destinationId;
            };

            const materializedTarget = findDestination('42', oldSubscription);
            const pendingTarget = findDestination('43', oldSubscription);
            const unaffectedTopic = findDestination('43', otherTopic);
            const unaffectedAudience = findDestination('43', management);
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
            expect(rowStatus(db, 'domain_event_destinations', pendingTarget)).toBe('cancelled');
            expect(rowStatus(db, 'notifications', pendingNotification)).toBe('cancelled');
            expect(rowStatus(db, 'notifications', sentNotification)).toBe('sent');
            expect(rowStatus(db, 'notifications', failedNotification)).toBe('failed');
            expect(rowStatus(db, 'domain_event_destinations', unaffectedTopic)).toBe('pending');
            expect(rowStatus(db, 'domain_event_destinations', unaffectedAudience)).toBe('pending');
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
            const newSubscription = subscriptionRepo.getSubscriptionId(
                chatId,
                7,
                '#2PPLQ',
                'players',
            );
            expect(newSubscription).not.toBeNull();
            expect(newSubscription).not.toBe(oldSubscription);
            expect(rowStatus(db, 'domain_event_destinations', pendingTarget)).toBe('cancelled');
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
            const subId = subscriptionRepo.getSubscriptionId(chatId, 0, '#2PPLQ', 'players');
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
                [{ chatId, messageThreadId: 0, audience: 'players', subscriptionId: subId }],
            );
            domainEventsRepo.appendEvent(
                {
                    eventType: 'war_ended',
                    eventId: '702',
                    payload: '{}',
                    payloadVersion: 1,
                    clanTag: '#2PPLQ',
                },
                [{ chatId, messageThreadId: 0, audience: 'players', subscriptionId: subId }],
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
            expect(subscriptionRepo.hasSubscription(chatId, 0, '#2PPLQ', 'players')).toBe(false);
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
            expect(subscriptionRepo.hasSubscription(chatId, 15, '#2PPLQ', 'players')).toBe(true);
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

        it('polls with allowed_updates=[message, callback_query], handles middleware errors without crashing and stops on AbortSignal', async () => {
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
            expect(subscriptionRepo.hasSubscription(6001, 0, '#2PPLQ', 'management')).toBe(true);
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
                if (recorded.url.endsWith('/deleteWebhook')) {
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

            expect(subscriptionRepo.hasSubscription(-1001, 0, '#2PPLQ', 'players')).toBe(false);
            expect(transport.sentMessages()).toHaveLength(0);
        });
    });
});
