import { Bot, type BotConfig, type Context, HttpError } from 'grammy';
import type {
    Chat,
    InlineKeyboardMarkup as GrammyInlineKeyboardMarkup,
    Message,
    Update,
} from 'grammy/types';

import { DatabaseError, isAbortError } from '../common/errors.js';
import type {
    ClansRepo,
    DomainEventsRepo,
    SubscriptionRepo,
    TransactionManager,
} from '../database/index.js';
import { createLogger, type Logger } from '../logging/logger.js';
import type { AttackGuideCatalog } from './attackGuideCatalog.js';
import {
    type CallbackContext,
    parseCallbackContext,
    parseKnownCallbackData,
} from './callbackData.js';
import { type BotCommand, parseBotCommand, parseClanTag } from './commands.js';
import {
    type InlineKeyboardMarkup,
    makeClanUnlinkKeyboard,
    makeGuideListKeyboard,
    makeGuideNavigationKeyboard,
    makeHelpNavigationKeyboard,
    makeLinkInstructionsKeyboard,
    makeMyClansNavigationKeyboard,
    makeStartMenuKeyboard,
    makeStrategyListKeyboard,
    makeTownHallListKeyboard,
} from './keyboards.js';
import { type Audience, resolveAudience } from './validation.js';

export const TELEGRAM_BOT_ALLOWED_UPDATES = ['message', 'callback_query'] as const;
export const DEFAULT_POLLING_TIMEOUT_SECONDS = 2;
export const DEFAULT_STOP_CONFIRMATION_TIMEOUT_MS = 2_000;

const GENERAL_CHAT_THREAD_ID = 0;

const START_MENU_TEXT = 'Добро пожаловать! Выберите раздел:';
const HELP_TEXT =
    '❓ Помощь\n\n' +
    'Подключить клан:\n' +
    '/link #ТЕГ_КЛАНА\n\n' +
    'Отключить клан:\n' +
    '/unlink #ТЕГ_КЛАНА\n\n' +
    'Кнопка «📋 Мои кланы» показывает подключённые кланы.\n\n' +
    'В группе подключать и отключать кланы могут только администраторы ' +
    'и создатель группы. Бот должен быть администратором группы.';
const LINK_INSTRUCTIONS_TEXT =
    'Чтобы подключить клан, отправьте команду:\n\n' +
    '/link #ТЕГ_КЛАНА\n\n' +
    'Например:\n' +
    '/link #2PPLQ';
const ONLY_ADMIN_TEXT = 'Только администратор группы может управлять подключениями кланов.';
const PERMISSION_CHECK_ERROR_TEXT =
    'Не удалось проверить права пользователя. Попробуйте ещё раз позже.';

export interface TelegramBotServiceDependencies {
    readonly telegramToken: string;
    readonly attackGuideCatalog: AttackGuideCatalog;
    readonly clansRepo: ClansRepo;
    readonly subscriptionRepo: SubscriptionRepo;
    readonly domainEventsRepo: DomainEventsRepo;
    readonly transactionManager: TransactionManager;
    readonly logger?: Logger;
    readonly botConfig?: BotConfig<Context>;
    readonly pollingTimeoutSeconds?: number;
    readonly stopConfirmationTimeoutMs?: number;
}

type GrammyAbortSignal = Parameters<Context['api']['getChatMember']>[2];
type ClanSubscriptionCommand = Exclude<BotCommand, { readonly kind: 'start' }>;

function toGrammyAbortSignal(signal: AbortSignal | undefined): GrammyAbortSignal {
    // grammY types reference the legacy abort-controller package, while Node.js 24 native AbortSignal is runtime-compatible.
    return signal as unknown as GrammyAbortSignal;
}

function toGrammyReplyMarkup(markup: InlineKeyboardMarkup): GrammyInlineKeyboardMarkup {
    return {
        inline_keyboard: markup.inline_keyboard.map((row) =>
            row.map((button) => ({
                text: button.text,
                callback_data: button.callback_data,
            })),
        ),
    };
}

function resolveChatTitle(chat: Chat): string {
    if ('title' in chat && typeof chat.title === 'string' && chat.title.length > 0) {
        return chat.title;
    }

    const firstName =
        'first_name' in chat && typeof chat.first_name === 'string' ? chat.first_name : '';
    const lastName =
        'last_name' in chat && typeof chat.last_name === 'string' ? chat.last_name : '';

    if (firstName.length > 0 && lastName.length > 0) {
        return `${firstName} ${lastName}`;
    }

    if (firstName.length > 0) {
        return firstName;
    }

    if ('username' in chat && typeof chat.username === 'string' && chat.username.length > 0) {
        return chat.username;
    }

    return 'Telegram-чат';
}

export class TelegramBotService {
    readonly bot: Bot;
    private readonly attackGuideCatalog: AttackGuideCatalog;
    private readonly clansRepo: ClansRepo;
    private readonly subscriptionRepo: SubscriptionRepo;
    private readonly domainEventsRepo: DomainEventsRepo;
    private readonly transactionManager: TransactionManager;
    private readonly logger: Logger;
    private readonly pollingTimeoutSeconds: number;
    private readonly stopConfirmationTimeoutMs: number;
    private activeSignal: AbortSignal | undefined;

    constructor(deps: TelegramBotServiceDependencies) {
        this.attackGuideCatalog = deps.attackGuideCatalog;
        this.clansRepo = deps.clansRepo;
        this.subscriptionRepo = deps.subscriptionRepo;
        this.domainEventsRepo = deps.domainEventsRepo;
        this.transactionManager = deps.transactionManager;
        this.logger = deps.logger ?? createLogger({ name: 'TelegramBotService' });
        this.pollingTimeoutSeconds = deps.pollingTimeoutSeconds ?? DEFAULT_POLLING_TIMEOUT_SECONDS;
        this.stopConfirmationTimeoutMs =
            deps.stopConfirmationTimeoutMs ?? DEFAULT_STOP_CONFIRMATION_TIMEOUT_MS;

        const defaultRequestTimeoutSeconds = Math.max(10, this.pollingTimeoutSeconds + 5);
        const mergedBotConfig: BotConfig<Context> = {
            ...deps.botConfig,
            client: {
                timeoutSeconds: defaultRequestTimeoutSeconds,
                ...deps.botConfig?.client,
            },
        };

        this.bot = new Bot(deps.telegramToken, mergedBotConfig);
        this.installTransportGuards();
        this.registerHandlers();
    }

    isRunning(): boolean {
        return this.bot.isRunning();
    }

    async handleUpdate(update: Update): Promise<void> {
        await this.bot.handleUpdate(update);
    }

    async start(signal?: AbortSignal): Promise<void> {
        if (signal?.aborted) {
            return;
        }

        this.activeSignal = signal;
        let stopPromise: Promise<void> | undefined;

        const onAbort = (): void => {
            stopPromise = this.stop();
        };

        signal?.addEventListener('abort', onAbort, { once: true });

        try {
            await this.bot.start({
                allowed_updates: [...TELEGRAM_BOT_ALLOWED_UPDATES],
                timeout: this.pollingTimeoutSeconds,
                onStart: (botInfo) => {
                    this.logger.info(
                        { username: botInfo.username },
                        'TelegramBotService long polling started',
                    );
                },
            });
        } catch (error: unknown) {
            if (signal?.aborted || this.isCancelledError(error)) {
                this.logger.info('TelegramBotService polling cancelled during shutdown');
                return;
            }
            throw error;
        } finally {
            signal?.removeEventListener('abort', onAbort);
            this.activeSignal = undefined;
            if (stopPromise !== undefined) {
                await stopPromise;
            }
        }
    }

    async stop(): Promise<void> {
        if (!this.bot.isRunning()) {
            return;
        }

        try {
            await this.bot.stop();
        } catch (error: unknown) {
            this.logger.warn(
                { err: error },
                'TelegramBotService stop confirmation request did not complete cleanly',
            );
        }
    }

    private installTransportGuards(): void {
        this.bot.api.config.use(async (prev, method, payload, signal) => {
            const effectiveSignal =
                method === 'getUpdates' && signal === undefined && !this.bot.isRunning()
                    ? toGrammyAbortSignal(AbortSignal.timeout(this.stopConfirmationTimeoutMs))
                    : signal;

            try {
                const response = await prev(method, payload, effectiveSignal);
                if (method === 'getUpdates' && !response.ok && this.bot.isRunning()) {
                    this.logger.error(
                        {
                            method,
                            errorCode: response.error_code,
                            description: response.description,
                        },
                        'Telegram getUpdates returned API error',
                    );
                }
                return response;
            } catch (error: unknown) {
                if (
                    method === 'getUpdates' &&
                    this.bot.isRunning() &&
                    !this.isCancelledError(error) &&
                    !effectiveSignal?.aborted
                ) {
                    this.logger.error({ err: error, method }, 'Telegram getUpdates request failed');
                }
                throw error;
            }
        });
    }

    private registerHandlers(): void {
        this.bot.catch((botError) => {
            if (this.isCancelledError(botError.error)) {
                this.logger.info(
                    { updateId: botError.ctx.update.update_id },
                    'Update processing cancelled during shutdown',
                );
                return;
            }

            this.logger.error(
                { err: botError.error, updateId: botError.ctx.update.update_id },
                'Failed to process Telegram update',
            );
        });

        this.bot.on('message', async (ctx) => {
            if (this.activeSignal?.aborted) {
                return;
            }
            await this.handleMessage(ctx.api, ctx.message, ctx.me.username);
        });

        this.bot.on('callback_query', async (ctx) => {
            if (this.activeSignal?.aborted) {
                return;
            }
            await this.handleCallbackQuery(ctx.api, ctx.callbackQuery);
        });
    }

    private isCancelledError(error: unknown): boolean {
        if (this.activeSignal?.aborted) {
            return true;
        }
        if (isAbortError(error)) {
            return true;
        }
        if (error instanceof HttpError && isAbortError(error.error)) {
            return true;
        }
        return false;
    }

    private async sendHtmlMessage(
        api: Context['api'],
        chatId: number,
        text: string,
        messageThreadId: number = GENERAL_CHAT_THREAD_ID,
        replyMarkup?: InlineKeyboardMarkup,
    ): Promise<void> {
        const other: Parameters<Context['api']['sendMessage']>[2] = {
            parse_mode: 'HTML',
            ...(messageThreadId !== GENERAL_CHAT_THREAD_ID
                ? { message_thread_id: messageThreadId }
                : {}),
            ...(replyMarkup !== undefined
                ? { reply_markup: toGrammyReplyMarkup(replyMarkup) }
                : {}),
        };

        await api.sendMessage(chatId, text, other, toGrammyAbortSignal(this.activeSignal));
    }

    private async editHtmlMessage(
        api: Context['api'],
        chatId: number,
        messageId: number,
        text: string,
        replyMarkup?: InlineKeyboardMarkup,
    ): Promise<void> {
        const other: Parameters<Context['api']['editMessageText']>[3] = {
            parse_mode: 'HTML',
            ...(replyMarkup !== undefined
                ? { reply_markup: toGrammyReplyMarkup(replyMarkup) }
                : {}),
        };

        await api.editMessageText(
            chatId,
            messageId,
            text,
            other,
            toGrammyAbortSignal(this.activeSignal),
        );
    }

    private async safeAnswerCallbackQuery(
        api: Context['api'],
        queryId: string,
        other?: Parameters<Context['api']['answerCallbackQuery']>[1],
    ): Promise<void> {
        try {
            await api.answerCallbackQuery(queryId, other, toGrammyAbortSignal(this.activeSignal));
        } catch (error: unknown) {
            if (this.isCancelledError(error)) {
                return;
            }
            this.logger.error({ err: error, queryId }, 'Failed to answer callback query');
        }
    }

    private async handleMessage(
        api: Context['api'],
        message: Message,
        ownBotUsername: string,
    ): Promise<void> {
        const text = 'text' in message && typeof message.text === 'string' ? message.text : '';
        const command = parseBotCommand(text);
        if (command === null) {
            return;
        }

        if (
            command.botUsername !== undefined &&
            command.botUsername.toLowerCase() !== ownBotUsername.toLowerCase()
        ) {
            return;
        }

        const chatId = message.chat.id;
        const messageThreadId = message.message_thread_id ?? GENERAL_CHAT_THREAD_ID;

        if (command.kind === 'start') {
            await this.sendStartMenu(api, chatId, messageThreadId);
            return;
        }

        if (message.from === undefined) {
            this.logger.warn(
                { chatId, command: command.kind },
                'Ignoring command message without sender metadata',
            );
            return;
        }

        const userId = message.from.id;

        if (command.kind === 'link') {
            await this.handleLinkCommand(
                api,
                chatId,
                userId,
                messageThreadId,
                message.chat,
                command,
            );
            return;
        }

        await this.handleUnlinkCommand(api, chatId, userId, messageThreadId, message.chat, command);
    }

    private async canManageCurrentChat(
        api: Context['api'],
        chatId: number,
        userId: number,
        chatType: string,
        audience: Audience,
    ): Promise<boolean> {
        if (audience === 'management') {
            return chatType === 'private' && chatId === userId;
        }

        if (chatType !== 'group' && chatType !== 'supergroup') {
            return false;
        }

        const member = await api.getChatMember(
            chatId,
            userId,
            toGrammyAbortSignal(this.activeSignal),
        );
        return member.status === 'administrator' || member.status === 'creator';
    }

    private linkClanToChat(
        chatId: number,
        messageThreadId: number,
        title: string,
        clanTag: string,
        audience: Audience,
    ): void {
        this.transactionManager.retryInTransaction(() => {
            this.clansRepo.insertMinimalClan(clanTag);
            this.subscriptionRepo.saveTelegramChat(chatId, messageThreadId, title);
            this.subscriptionRepo.subscribeToChat(chatId, messageThreadId, clanTag, audience);
        });
    }

    private unlinkClanFromChat(
        chatId: number,
        messageThreadId: number,
        clanTag: string,
        audience: Audience,
    ): boolean {
        return this.transactionManager.retryInTransaction(() => {
            const subscriptionId = this.subscriptionRepo.getSubscriptionId(
                chatId,
                messageThreadId,
                clanTag,
                audience,
            );
            if (subscriptionId === null) {
                return false;
            }

            this.domainEventsRepo.cancelForSubscription(subscriptionId);
            this.subscriptionRepo.unsubscribeFromChat(chatId, messageThreadId, clanTag, audience);

            if (!this.subscriptionRepo.hasSubscriptionsForChat(chatId, messageThreadId)) {
                this.subscriptionRepo.deleteTelegramChat(chatId, messageThreadId);
            }

            if (!this.subscriptionRepo.hasSubscriptionsForClan(clanTag)) {
                this.clansRepo.disableTracking(clanTag);
            }

            return true;
        });
    }

    private async handleLinkCommand(
        api: Context['api'],
        chatId: number,
        userId: number,
        messageThreadId: number,
        chat: Chat,
        command: ClanSubscriptionCommand,
    ): Promise<void> {
        const audience = resolveAudience(chat.type);
        if (audience === null) {
            await this.sendHtmlMessage(
                api,
                chatId,
                'Этот тип Telegram-чата пока не поддерживается для привязки.',
                messageThreadId,
            );
            return;
        }

        if (command.status === 'invalid_arguments') {
            await this.sendHtmlMessage(
                api,
                chatId,
                'Использование: /link #ТЕГ_КЛАНА\nНапример: /link #2PPLQ',
                messageThreadId,
            );
            return;
        }

        if (command.status === 'invalid_clan_tag') {
            await this.sendHtmlMessage(
                api,
                chatId,
                'Некорректный тег клана. Используйте формат #TAG или TAG.',
                messageThreadId,
            );
            return;
        }

        let canManage: boolean;
        try {
            canManage = await this.canManageCurrentChat(api, chatId, userId, chat.type, audience);
        } catch (error: unknown) {
            if (this.isCancelledError(error)) {
                return;
            }
            this.logger.error({ err: error, chatId }, 'Failed to check permissions for /link');
            await this.sendHtmlMessage(api, chatId, PERMISSION_CHECK_ERROR_TEXT, messageThreadId);
            return;
        }

        if (this.activeSignal?.aborted) {
            return;
        }

        if (!canManage) {
            await this.sendHtmlMessage(api, chatId, ONLY_ADMIN_TEXT, messageThreadId);
            return;
        }

        const title = resolveChatTitle(chat);
        const { clanTag } = command;

        try {
            this.linkClanToChat(chatId, messageThreadId, title, clanTag, audience);
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger.error({ err: error, chatId, clanTag }, 'Failed to link clan to chat');
                await this.sendHtmlMessage(
                    api,
                    chatId,
                    'Не удалось сохранить привязку. Попробуйте ещё раз позже.',
                    messageThreadId,
                );
                return;
            }
            throw error;
        }

        const destination = chat.type === 'private' ? 'Личный чат' : 'Общий чат';
        const details =
            audience === 'management'
                ? 'управленческие уведомления: нарушения, ростер и другие отчёты для руководства'
                : 'обычные отчёты и уведомления для игроков';

        await this.sendHtmlMessage(
            api,
            chatId,
            `Готово! ${destination} привязан к клану ${clanTag}.\n\n${destination} будет получать ${details}.`,
            messageThreadId,
        );
    }

    private async handleUnlinkCommand(
        api: Context['api'],
        chatId: number,
        userId: number,
        messageThreadId: number,
        chat: Chat,
        command: ClanSubscriptionCommand,
    ): Promise<void> {
        const audience = resolveAudience(chat.type);
        if (audience === null) {
            await this.sendHtmlMessage(
                api,
                chatId,
                'Этот тип Telegram-чата пока не поддерживается для отвязки.',
                messageThreadId,
            );
            return;
        }

        if (command.status === 'invalid_arguments') {
            await this.sendHtmlMessage(
                api,
                chatId,
                'Использование: /unlink #ТЕГ_КЛАНА\nНапример: /unlink #2PPLQ',
                messageThreadId,
            );
            return;
        }

        if (command.status === 'invalid_clan_tag') {
            await this.sendHtmlMessage(
                api,
                chatId,
                'Некорректный тег клана. Используйте формат #TAG или TAG.',
                messageThreadId,
            );
            return;
        }

        let canManage: boolean;
        try {
            canManage = await this.canManageCurrentChat(api, chatId, userId, chat.type, audience);
        } catch (error: unknown) {
            if (this.isCancelledError(error)) {
                return;
            }
            this.logger.error({ err: error, chatId }, 'Failed to check permissions for /unlink');
            await this.sendHtmlMessage(api, chatId, PERMISSION_CHECK_ERROR_TEXT, messageThreadId);
            return;
        }

        if (this.activeSignal?.aborted) {
            return;
        }

        if (!canManage) {
            await this.sendHtmlMessage(api, chatId, ONLY_ADMIN_TEXT, messageThreadId);
            return;
        }

        const { clanTag } = command;
        let unlinked: boolean;
        try {
            unlinked = this.unlinkClanFromChat(chatId, messageThreadId, clanTag, audience);
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger.error(
                    { err: error, chatId, clanTag },
                    'Failed to unlink clan from chat',
                );
                await this.sendHtmlMessage(
                    api,
                    chatId,
                    'Не удалось отвязать чат. Попробуйте ещё раз позже.',
                    messageThreadId,
                );
                return;
            }
            throw error;
        }

        if (!unlinked) {
            await this.sendHtmlMessage(
                api,
                chatId,
                `Этот чат не привязан к клану ${clanTag}.`,
                messageThreadId,
            );
            return;
        }

        const destination = chat.type === 'private' ? 'Личный чат' : 'Общий чат';
        await this.sendHtmlMessage(
            api,
            chatId,
            `Готово! ${destination} отвязан от клана ${clanTag}.`,
            messageThreadId,
        );
    }

    private async handleCallbackQuery(api: Context['api'], callbackQuery: unknown): Promise<void> {
        const context = parseCallbackContext(callbackQuery);
        if (context === null) {
            this.logger.warn('Ignoring invalid callback query without required message context');
            return;
        }

        const callbackData = parseKnownCallbackData(context.data);
        if (callbackData === null) {
            await this.safeAnswerCallbackQuery(api, context.queryId);
            this.logger.warn({ callbackData: context.data }, 'Ignoring invalid callback data');
            return;
        }

        if (callbackData.kind === 'clans:unlink') {
            await this.handleUnlinkCallback(api, context, callbackData.clanTag);
            return;
        }

        await this.safeAnswerCallbackQuery(api, context.queryId);

        if (this.activeSignal?.aborted) {
            return;
        }

        switch (callbackData.kind) {
            case 'menu:start':
                await this.handleMainMenuCallback(api, context);
                break;
            case 'help:main':
                await this.handleHelpCallback(api, context);
                break;
            case 'clans:link':
                await this.handleLinkInstructionsCallback(api, context);
                break;
            case 'clans:list':
                await this.handleMyClansCallback(api, context);
                break;
            case 'guides:townhalls':
                await this.handleTownHallListCallback(api, context);
                break;
            case 'guides:townhall':
                await this.handleStrategyListCallback(api, context, callbackData.townHall);
                break;
            case 'guides:strategy':
                await this.handleGuideListCallback(
                    api,
                    context,
                    callbackData.townHall,
                    callbackData.armyId,
                );
                break;
            case 'guides:guide':
                await this.handleVideoGuideCallback(
                    api,
                    context,
                    callbackData.townHall,
                    callbackData.guideId,
                );
                break;
        }
    }

    private async sendStartMenu(
        api: Context['api'],
        chatId: number,
        messageThreadId: number,
    ): Promise<void> {
        await this.sendHtmlMessage(
            api,
            chatId,
            START_MENU_TEXT,
            messageThreadId,
            makeStartMenuKeyboard(),
        );
    }

    private async handleMainMenuCallback(
        api: Context['api'],
        context: CallbackContext,
    ): Promise<void> {
        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            START_MENU_TEXT,
            makeStartMenuKeyboard(),
        );
    }

    private async handleHelpCallback(api: Context['api'], context: CallbackContext): Promise<void> {
        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            HELP_TEXT,
            makeHelpNavigationKeyboard(),
        );
    }

    private async handleLinkInstructionsCallback(
        api: Context['api'],
        context: CallbackContext,
    ): Promise<void> {
        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            LINK_INSTRUCTIONS_TEXT,
            makeLinkInstructionsKeyboard(),
        );
    }

    private async handleMyClansCallback(
        api: Context['api'],
        context: CallbackContext,
    ): Promise<void> {
        const audience = resolveAudience(context.chatType);
        if (audience === null) {
            await this.editHtmlMessage(
                api,
                context.chatId,
                context.messageId,
                'Этот тип Telegram-чата пока не поддерживается.',
                makeMyClansNavigationKeyboard(),
            );
            return;
        }

        let clanTags: string[];
        try {
            clanTags = this.subscriptionRepo.getClanTagsForChat(
                context.chatId,
                context.messageThreadId,
                audience,
            );
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger.error(
                    { err: error, chatId: context.chatId },
                    'Failed to load linked clans for chat',
                );
                await this.editHtmlMessage(
                    api,
                    context.chatId,
                    context.messageId,
                    'Не удалось загрузить список кланов. Попробуйте ещё раз позже.',
                    makeMyClansNavigationKeyboard(),
                );
                return;
            }
            throw error;
        }

        const message =
            clanTags.length === 0
                ? 'В этом чате пока нет подключённых кланов.\n\nЧтобы подключить клан, используйте:\n/link #ТЕГ_КЛАНА'
                : `Подключённые кланы:\n\n${clanTags.map((tag) => `• ${tag}\n`).join('')}`;

        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            message,
            makeMyClansNavigationKeyboard(),
        );
    }

    private async handleUnlinkCallback(
        api: Context['api'],
        context: CallbackContext,
        rawClanTag: string | null,
    ): Promise<void> {
        const audience = resolveAudience(context.chatType);
        if (audience === null) {
            await this.safeAnswerCallbackQuery(api, context.queryId);
            if (this.activeSignal?.aborted) {
                return;
            }
            await this.editHtmlMessage(
                api,
                context.chatId,
                context.messageId,
                'Этот тип Telegram-чата пока не поддерживается.',
                makeStartMenuKeyboard(),
            );
            return;
        }

        let canManage: boolean;
        try {
            canManage = await this.canManageCurrentChat(
                api,
                context.chatId,
                context.userId,
                context.chatType,
                audience,
            );
        } catch (error: unknown) {
            if (this.isCancelledError(error)) {
                return;
            }
            this.logger.error(
                { err: error, chatId: context.chatId },
                'Failed to check permissions for unlink callback',
            );
            await this.safeAnswerCallbackQuery(api, context.queryId, {
                text: PERMISSION_CHECK_ERROR_TEXT,
                show_alert: true,
            });
            return;
        }

        if (this.activeSignal?.aborted) {
            return;
        }

        if (!canManage) {
            await this.safeAnswerCallbackQuery(api, context.queryId, {
                text: ONLY_ADMIN_TEXT,
                show_alert: true,
            });
            return;
        }

        await this.safeAnswerCallbackQuery(api, context.queryId);

        if (this.activeSignal?.aborted) {
            return;
        }

        if (rawClanTag === null) {
            let clanTags: string[];
            try {
                clanTags = this.subscriptionRepo.getClanTagsForChat(
                    context.chatId,
                    context.messageThreadId,
                    audience,
                );
            } catch (error: unknown) {
                if (error instanceof DatabaseError) {
                    this.logger.error(
                        { err: error, chatId: context.chatId },
                        'Failed to load clans for unlink menu',
                    );
                    await this.editHtmlMessage(
                        api,
                        context.chatId,
                        context.messageId,
                        'Не удалось отключить клан. Попробуйте ещё раз позже.',
                        makeStartMenuKeyboard(),
                    );
                    return;
                }
                throw error;
            }

            const message =
                clanTags.length === 0
                    ? 'В этом чате нет подключённых кланов.'
                    : 'Выберите клан для отключения:';

            await this.editHtmlMessage(
                api,
                context.chatId,
                context.messageId,
                message,
                makeClanUnlinkKeyboard(clanTags),
            );
            return;
        }

        const clanTag = parseClanTag(rawClanTag);
        if (clanTag === null) {
            this.logger.warn({ rawClanTag }, 'Invalid clan tag in unlink callback');
            return;
        }

        let unlinked: boolean;
        try {
            unlinked = this.unlinkClanFromChat(
                context.chatId,
                context.messageThreadId,
                clanTag,
                audience,
            );
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger.error(
                    { err: error, chatId: context.chatId, clanTag },
                    'Failed to unlink clan via callback',
                );
                await this.editHtmlMessage(
                    api,
                    context.chatId,
                    context.messageId,
                    'Не удалось отключить клан. Попробуйте ещё раз позже.',
                    makeStartMenuKeyboard(),
                );
                return;
            }
            throw error;
        }

        const message = unlinked
            ? `Готово! Клан ${clanTag} отключён.`
            : `Этот чат не привязан к клану ${clanTag}.`;

        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            message,
            makeStartMenuKeyboard(),
        );
    }

    private async handleTownHallListCallback(
        api: Context['api'],
        context: CallbackContext,
    ): Promise<void> {
        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            'Выберите ратушу:',
            makeTownHallListKeyboard(),
        );
    }

    private async handleStrategyListCallback(
        api: Context['api'],
        context: CallbackContext,
        townHall: number,
    ): Promise<void> {
        const strategies = this.attackGuideCatalog.getStrategiesForTownHall(townHall);
        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            'Выберите стратегию:',
            makeStrategyListKeyboard(townHall, strategies),
        );
    }

    private async handleGuideListCallback(
        api: Context['api'],
        context: CallbackContext,
        townHall: number,
        armyId: string,
    ): Promise<void> {
        const guides = this.attackGuideCatalog.getGuidesForStrategy(townHall, armyId);
        if (guides.length === 0) {
            this.logger.warn({ townHall, armyId }, 'No guides found for strategy callback');
            return;
        }

        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            'Выберите гайд:',
            makeGuideListKeyboard(townHall, guides),
        );
    }

    private async handleVideoGuideCallback(
        api: Context['api'],
        context: CallbackContext,
        townHall: number,
        guideId: string,
    ): Promise<void> {
        const guide = this.attackGuideCatalog.findById(guideId);
        if (guide === null) {
            this.logger.warn({ townHall, guideId }, 'Guide not found for callback');
            return;
        }

        await this.sendHtmlMessage(
            api,
            context.chatId,
            `${guide.title}\n${guide.youtubeUrl}`,
            context.messageThreadId,
        );

        await this.sendHtmlMessage(
            api,
            context.chatId,
            'Хотите вернуться обратно? Выберите раздел:',
            context.messageThreadId,
            makeGuideNavigationKeyboard(townHall, guide.armyId, guide.armyTitle),
        );
    }
}
