import { Bot, type BotConfig, type Context, GrammyError, HttpError } from 'grammy';
import type {
    BotCommand as GrammyBotCommand,
    Chat,
    ChatMemberUpdated,
    InlineKeyboardMarkup as GrammyInlineKeyboardMarkup,
    Message,
    Update,
} from 'grammy/types';

import { isCocApiError } from '../api/errors.js';
import type { ClashOfClansApi, CompleteClanData } from '../api/models.js';
import { SystemClock, type Clock } from '../common/clock.js';
import { DatabaseError, isAbortError, ValidationError } from '../common/errors.js';
import { escapeHtml } from '../common/formatUtils.js';
import { DEFAULT_MAX_TRACKED_CLANS } from '../config/configSchema.js';
import type {
    ClansRepo,
    ClanSubscriptionSummary,
    ClanwarRepo,
    ClanwarsLeagueRepo,
    DomainEventsRepo,
    NotificationRepo,
    RaidRepo,
    SubscriptionRecord,
    SubscriptionRepo,
    TransactionManager,
} from '../database/index.js';
import { createLogger, type Logger } from '../logging/logger.js';
import {
    getPresetCategories,
    toggleSubscriptionCategory,
    type SubscriptionPreset,
} from '../models/subscription.js';
import type { WakeableClanManager } from '../services/clanManager.js';
import {
    type DisableSubscriptionsResult,
    type TelegramDestinationLifecycle,
    TelegramSubscriptionLifecycle,
} from '../services/telegramSubscriptionLifecycle.js';
import type { AttackGuideCatalog } from './attackGuideCatalog.js';
import {
    type CallbackContext,
    type KnownCallbackData,
    parseCallbackContext,
    parseKnownCallbackData,
} from './callbackData.js';
import { CommandRateLimiter } from './commandRateLimiter.js';
import { type BotCommand, parseBotCommand } from './commands.js';
import {
    type InlineKeyboardMarkup,
    makeClanCardKeyboard,
    makeClanUnlinkConfirmKeyboard,
    makeClanUnlinkListKeyboard,
    makeGuideListKeyboard,
    makeGuideNavigationKeyboard,
    makeHelpNavigationKeyboard,
    makeLinkInstructionsKeyboard,
    makeMirrorRuleToggleButton,
    makeMyClansListKeyboard,
    makeMyClansNavigationKeyboard,
    makeStartMenuKeyboard,
    makeStrategyListKeyboard,
    makeSubscriptionSettingsEntryKeyboard,
    makeSubscriptionSettingsKeyboard,
    makeTimezoneAllSelectKeyboard,
    makeTimezoneQuickSelectKeyboard,
    makeTownHallListKeyboard,
    makeViewBackToMenuKeyboard,
    makeViewClanPickerKeyboard,
    makeViewResultKeyboard,
} from './keyboards.js';
import {
    COMMAND_RATE_LIMIT_EXCEEDED_TEXT,
    formatAlreadyLinkedText,
    formatClanNotFoundText,
    formatDestinationClanLimitText,
    formatInstanceClanLimitText,
    formatLinkedClanText,
    LINK_INVALID_ARGUMENTS_TEXT,
    LINK_INVALID_TAG_TEXT,
} from './linkOnboarding.js';
import {
    CLANS_PAGE_SIZE,
    formatClanCardText,
    formatMyClansListText,
    formatUnlinkConfirmText,
    formatUnlinkListText,
    formatUnlinkResultText,
    paginateItems,
    resolveClanTrackingStatus,
} from './myClans.js';
import { formatRaidView, loadRaidViewData } from './raidView.js';
import {
    formatSubscriptionSettingsText,
    formatTimezoneAllSelectText,
    formatTimezoneQuickSelectText,
    LAST_CATEGORY_ALERT_TEXT,
} from './subscriptionSettings.js';
import { isSupportedTelegramChatType, resolveDefaultPreset } from './validation.js';
import {
    formatViewClanNotSubscribedText,
    formatViewClanSelectText,
    formatViewInvalidArgumentsText,
    formatViewInvalidTagText,
    formatViewNoClansText,
    resolveViewClanSubscription,
    VIEW_LOAD_ERROR_TEXT,
    type ViewCommandName,
} from './viewCommon.js';
import { formatCwlView, loadCwlViewData } from './cwlView.js';
import { formatWarView, loadWarViewData } from './warView.js';

export const TELEGRAM_BOT_ALLOWED_UPDATES = [
    'message',
    'callback_query',
    'my_chat_member',
] as const;
export const DEFAULT_POLLING_TIMEOUT_SECONDS = 2;
export const DEFAULT_STOP_CONFIRMATION_TIMEOUT_MS = 2_000;
export const DEFAULT_MAX_CLANS_PER_DESTINATION = 5;

export const SUPERCELL_FAN_CONTENT_DISCLAIMER =
    'ClashBot — неофициальный фанатский проект, не связанный с Supercell и не одобренный ею. ' +
    'Подробнее: Supercell Fan Content Policy — https://supercell.com/en/fan-content-policy/';

export const TELEGRAM_BOT_COMMANDS: readonly GrammyBotCommand[] = [
    { command: 'start', description: 'Главное меню и гайды по атакам' },
    { command: 'war', description: 'Текущая война кланов: /war [#ТЕГ_КЛАНА]' },
    { command: 'cwl', description: 'Текущий сезон и раунд ЛВК: /cwl [#ТЕГ_КЛАНА]' },
    { command: 'raid', description: 'Текущий рейдовый уикенд: /raid [#ТЕГ_КЛАНА]' },
    { command: 'help', description: 'Справка по командам, правам и пресетам' },
    { command: 'link', description: 'Подключить клан: /link #ТЕГ_КЛАНА' },
    { command: 'unlink', description: 'Отключить клан: /unlink #ТЕГ_КЛАНА' },
];

export const TELEGRAM_BOT_DESCRIPTION =
    'ClashBot — бот для мониторинга кланов Clash of Clans: отчёты по КВ, ЛВК и рейдам, ' +
    'напоминания об атаках, контроль нарушений и гайды по атакам.\n\n' +
    SUPERCELL_FAN_CONTENT_DISCLAIMER;

export const TELEGRAM_BOT_SHORT_DESCRIPTION =
    'Мониторинг кланов Clash of Clans. Неофициальный фанатский проект, не связанный с Supercell и не одобренный ею.';

const GENERAL_CHAT_THREAD_ID = 0;

const START_MENU_TEXT = 'Добро пожаловать! Выберите раздел:';
const HELP_TEXT =
    '❓ Помощь\n\n' +
    '<b>Команды:</b>\n' +
    '/start — главное меню и гайды по атакам\n' +
    '/war [#ТЕГ_КЛАНА] — текущая обычная КВ из локальной базы\n' +
    '/cwl [#ТЕГ_КЛАНА] — текущий сезон и раунд ЛВК из локальной базы\n' +
    '/raid [#ТЕГ_КЛАНА] — текущий рейдовый уикенд из локальной базы\n' +
    '/help — эта справка\n' +
    '/link #ТЕГ_КЛАНА — подключить клан к чату или теме форума\n' +
    '/unlink #ТЕГ_КЛАНА — отключить клан\n\n' +
    'Кнопка «📋 Мои кланы» показывает подключённые кланы.\n\n' +
    '<b>Права:</b>\n' +
    'Команды просмотра (/war, /cwl, /raid) доступны любому участнику чата без прав администратора. ' +
    'В личном чате управлять подписками может владелец чата. В группе и супергруппе ' +
    'подключать и отключать кланы могут только администраторы и создатель группы; ' +
    'бот должен быть администратором группы.\n\n' +
    '<b>Пресеты подписки:</b>\n' +
    '• «Игроки» (по умолчанию для групп и тем) — итоги, напоминания и кадры\n' +
    '• «Руководство» (по умолчанию для личного чата) — дисциплина, аналитика и системные оповещения\n' +
    '• «Всё вместе» — все категории уведомлений\n\n' +
    SUPERCELL_FAN_CONTENT_DISCLAIMER;
const UNKNOWN_COMMAND_TEXT = 'Не знаю такой команды, см. /help';
const LINK_INSTRUCTIONS_TEXT =
    'Чтобы подключить клан, отправьте команду:\n\n' +
    '/link #ТЕГ_КЛАНА\n\n' +
    'Например:\n' +
    '/link #2PPLQ';
const ONLY_ADMIN_TEXT = 'Только администратор группы может управлять подключениями кланов.';
const ONLY_OWNER_TEXT = 'Только владелец чата может управлять подключениями кланов.';
const CARD_LOAD_ERROR_TEXT = 'Не удалось загрузить карточку клана. Попробуйте ещё раз позже.';
const UNLINK_LOAD_ERROR_TEXT =
    'Не удалось загрузить данные для отключения. Попробуйте ещё раз позже.';
const SETTINGS_ONLY_ADMIN_TEXT = 'Только администратор группы может изменять настройки подписки.';
const SETTINGS_ONLY_OWNER_TEXT = 'Только владелец чата может изменять настройки подписки.';
const SETTINGS_LOAD_ERROR_TEXT = 'Не удалось загрузить настройки. Попробуйте ещё раз позже.';
const SETTINGS_UPDATE_ERROR_TEXT = 'Не удалось обновить настройки. Попробуйте ещё раз позже.';
const PERMISSION_CHECK_ERROR_TEXT =
    'Не удалось проверить права пользователя. Попробуйте ещё раз позже.';

export type ClanLookupApiClient = Pick<ClashOfClansApi, 'getCompleteClanData'>;

export interface TelegramBotServiceDependencies {
    readonly telegramToken: string;
    readonly attackGuideCatalog: AttackGuideCatalog;
    readonly clansRepo: ClansRepo;
    readonly clanwarRepo?: ClanwarRepo;
    readonly clanwarsLeagueRepo?: ClanwarsLeagueRepo;
    readonly raidRepo?: RaidRepo;
    readonly subscriptionRepo: SubscriptionRepo;
    readonly domainEventsRepo: DomainEventsRepo;
    readonly notificationRepo?: NotificationRepo;
    readonly transactionManager: TransactionManager;
    readonly destinationLifecycle?: TelegramDestinationLifecycle;
    readonly cocApiClient?: ClanLookupApiClient;
    readonly clanManager?: WakeableClanManager;
    readonly clock?: Clock;
    readonly maxClansPerDestination?: number;
    readonly maxTrackedClans?: number;
    readonly commandRateLimiter?: CommandRateLimiter;
    readonly logger?: Logger;
    readonly botConfig?: BotConfig<Context>;
    readonly pollingTimeoutSeconds?: number;
    readonly stopConfirmationTimeoutMs?: number;
}

type GrammyAbortSignal = Parameters<Context['api']['getChatMember']>[2];
type ClanSubscriptionCommand = Extract<BotCommand, { readonly kind: 'link' | 'unlink' }>;
type ViewBotCommand = Extract<BotCommand, { readonly kind: 'view' }>;
type ViewCallbackData = Extract<KnownCallbackData, { readonly kind: 'view:open' | 'view:clan' }>;
type UnlinkCallbackData = Extract<
    KnownCallbackData,
    {
        readonly kind:
            | 'clans:unlink'
            | 'clans:unlink_list'
            | 'clans:unlink_ask'
            | 'clans:unlink_confirm'
            | 'clans:unlink_cancel';
    }
>;
interface UnlinkClanResult {
    readonly unlinked: boolean;
    readonly clanName: string | null;
}
type SettingsCallbackData = Extract<
    KnownCallbackData,
    {
        readonly kind:
            | 'settings:open'
            | 'settings:preset'
            | 'settings:category'
            | 'settings:mirror'
            | 'settings:tz'
            | 'settings:tzall'
            | 'settings:tzset';
    }
>;
type SettingsActionOutcome =
    | { readonly status: 'not_found' }
    | { readonly status: 'last_category' }
    | {
          readonly status: 'ready';
          readonly subscription: SubscriptionRecord;
          readonly clanName: string | null;
      };
type ClanLookupOutcome =
    | { readonly status: 'found'; readonly data: CompleteClanData }
    | { readonly status: 'not_found' }
    | { readonly status: 'unavailable' }
    | { readonly status: 'aborted' };
type LinkPrecheckOutcome =
    | { readonly status: 'proceed' }
    | {
          readonly status: 'already_linked';
          readonly subscription: SubscriptionRecord;
          readonly clanName: string;
      }
    | { readonly status: 'destination_limit_reached' }
    | { readonly status: 'instance_limit_reached' };
type LinkClanOutcome =
    | {
          readonly status: 'already_linked';
          readonly subscription: SubscriptionRecord;
          readonly clanName: string;
      }
    | { readonly status: 'destination_limit_reached' }
    | { readonly status: 'instance_limit_reached' }
    | {
          readonly status: 'linked_new_clan' | 'linked_existing_clan';
          readonly clanName: string;
      };

function assertPositiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new ValidationError(
            `TelegramBotService ${name} must be a positive integer, got ${String(value)}`,
            { context: { [name]: value } },
        );
    }
    return value;
}

function isMessageNotModifiedError(error: unknown): boolean {
    return (
        error instanceof GrammyError &&
        error.error_code === 400 &&
        error.description.toLowerCase().includes('message is not modified')
    );
}

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
    private readonly clanwarRepo?: ClanwarRepo;
    private readonly clanwarsLeagueRepo?: ClanwarsLeagueRepo;
    private readonly raidRepo?: RaidRepo;
    private readonly subscriptionRepo: SubscriptionRepo;
    private readonly domainEventsRepo: DomainEventsRepo;
    private readonly transactionManager: TransactionManager;
    private readonly destinationLifecycle?: TelegramDestinationLifecycle;
    private readonly cocApiClient?: ClanLookupApiClient;
    private readonly clanManager?: WakeableClanManager;
    private readonly clock: Clock;
    private readonly maxClansPerDestination: number;
    private readonly maxTrackedClans: number;
    private readonly commandRateLimiter: CommandRateLimiter;
    private readonly logger: Logger;
    private readonly pollingTimeoutSeconds: number;
    private readonly stopConfirmationTimeoutMs: number;
    private activeSignal: AbortSignal | undefined;

    constructor(deps: TelegramBotServiceDependencies) {
        this.attackGuideCatalog = deps.attackGuideCatalog;
        this.clansRepo = deps.clansRepo;
        if (deps.clanwarRepo !== undefined) {
            this.clanwarRepo = deps.clanwarRepo;
        }
        if (deps.clanwarsLeagueRepo !== undefined) {
            this.clanwarsLeagueRepo = deps.clanwarsLeagueRepo;
        }
        if (deps.raidRepo !== undefined) {
            this.raidRepo = deps.raidRepo;
        }
        this.subscriptionRepo = deps.subscriptionRepo;
        this.domainEventsRepo = deps.domainEventsRepo;
        this.transactionManager = deps.transactionManager;
        if (deps.destinationLifecycle !== undefined) {
            this.destinationLifecycle = deps.destinationLifecycle;
        } else if (deps.notificationRepo !== undefined) {
            this.destinationLifecycle = new TelegramSubscriptionLifecycle({
                transactionManager: deps.transactionManager,
                clansRepo: deps.clansRepo,
                subscriptionRepo: deps.subscriptionRepo,
                domainEventsRepo: deps.domainEventsRepo,
                notificationRepo: deps.notificationRepo,
            });
        }
        if (deps.cocApiClient !== undefined) {
            this.cocApiClient = deps.cocApiClient;
        }
        if (deps.clanManager !== undefined) {
            this.clanManager = deps.clanManager;
        }
        this.clock = deps.clock ?? new SystemClock();
        this.maxClansPerDestination = assertPositiveInteger(
            deps.maxClansPerDestination ?? DEFAULT_MAX_CLANS_PER_DESTINATION,
            'maxClansPerDestination',
        );
        this.maxTrackedClans = assertPositiveInteger(
            deps.maxTrackedClans ?? DEFAULT_MAX_TRACKED_CLANS,
            'maxTrackedClans',
        );
        this.commandRateLimiter =
            deps.commandRateLimiter ?? new CommandRateLimiter({ clock: this.clock });
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
            await this.syncBotMetadata(signal);
            if (signal?.aborted) {
                return;
            }

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

    private async syncBotMetadata(signal?: AbortSignal): Promise<void> {
        const metadataTasks: readonly {
            readonly method: 'setMyCommands' | 'setMyDescription' | 'setMyShortDescription';
            readonly run: () => Promise<unknown>;
        }[] = [
            {
                method: 'setMyCommands',
                run: () =>
                    this.bot.api.setMyCommands(
                        [...TELEGRAM_BOT_COMMANDS],
                        undefined,
                        toGrammyAbortSignal(signal),
                    ),
            },
            {
                method: 'setMyDescription',
                run: () =>
                    this.bot.api.setMyDescription(
                        TELEGRAM_BOT_DESCRIPTION,
                        undefined,
                        toGrammyAbortSignal(signal),
                    ),
            },
            {
                method: 'setMyShortDescription',
                run: () =>
                    this.bot.api.setMyShortDescription(
                        TELEGRAM_BOT_SHORT_DESCRIPTION,
                        undefined,
                        toGrammyAbortSignal(signal),
                    ),
            },
        ];

        for (const task of metadataTasks) {
            if (signal?.aborted) {
                return;
            }
            try {
                await task.run();
            } catch (error: unknown) {
                if (signal?.aborted || this.isCancelledError(error)) {
                    return;
                }
                this.logger.warn(
                    { err: error, method: task.method },
                    'Failed to sync Telegram bot metadata on startup',
                );
            }
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

        this.bot.on('my_chat_member', (ctx) => {
            if (this.activeSignal?.aborted) {
                return;
            }
            this.handleMyChatMember(ctx.myChatMember);
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

        try {
            await api.editMessageText(
                chatId,
                messageId,
                text,
                other,
                toGrammyAbortSignal(this.activeSignal),
            );
        } catch (error: unknown) {
            if (isMessageNotModifiedError(error)) {
                return;
            }
            throw error;
        }
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
        const migration = this.extractChatMigration(message);
        if (migration !== null) {
            this.handleChatMigration(migration.oldChatId, migration.newChatId, migration.newTitle);
            return;
        }

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

        if (command.kind === 'help') {
            await this.sendHelpMessage(api, chatId, messageThreadId);
            return;
        }

        if (command.kind === 'unknown') {
            if (message.chat.type === 'private') {
                await this.sendHtmlMessage(api, chatId, UNKNOWN_COMMAND_TEXT, messageThreadId);
            }
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

        const rateLimit = this.commandRateLimiter.consume(userId);
        if (!rateLimit.allowed) {
            this.logger.info(
                {
                    chatId,
                    messageThreadId,
                    userId,
                    command: command.kind,
                    retryAfterMs: rateLimit.retryAfterMs,
                },
                'Rejected Telegram command due to per-user rate limit',
            );
            await this.sendHtmlMessage(
                api,
                chatId,
                COMMAND_RATE_LIMIT_EXCEEDED_TEXT,
                messageThreadId,
            );
            return;
        }

        if (command.kind === 'view') {
            await this.handleViewCommand(api, chatId, messageThreadId, message.chat.type, command);
            return;
        }

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

    private extractChatMigration(message: Message): {
        readonly oldChatId: number;
        readonly newChatId: number;
        readonly newTitle?: string;
    } | null {
        const chatTitle =
            'title' in message.chat &&
            typeof message.chat.title === 'string' &&
            message.chat.title.length > 0
                ? message.chat.title
                : undefined;

        if (
            'migrate_to_chat_id' in message &&
            typeof message.migrate_to_chat_id === 'number' &&
            Number.isSafeInteger(message.migrate_to_chat_id) &&
            message.migrate_to_chat_id !== 0 &&
            message.migrate_to_chat_id !== message.chat.id
        ) {
            return {
                oldChatId: message.chat.id,
                newChatId: message.migrate_to_chat_id,
                ...(chatTitle !== undefined ? { newTitle: chatTitle } : {}),
            };
        }

        if (
            'migrate_from_chat_id' in message &&
            typeof message.migrate_from_chat_id === 'number' &&
            Number.isSafeInteger(message.migrate_from_chat_id) &&
            message.migrate_from_chat_id !== 0 &&
            message.migrate_from_chat_id !== message.chat.id
        ) {
            return {
                oldChatId: message.migrate_from_chat_id,
                newChatId: message.chat.id,
                ...(chatTitle !== undefined ? { newTitle: chatTitle } : {}),
            };
        }

        return null;
    }

    private handleChatMigration(oldChatId: number, newChatId: number, newTitle?: string): void {
        try {
            if (this.destinationLifecycle !== undefined) {
                const result = this.destinationLifecycle.migrateChat(
                    oldChatId,
                    newChatId,
                    newTitle,
                );
                if (
                    result.migratedChats > 0 ||
                    result.migratedSubscriptions > 0 ||
                    result.deduplicatedSubscriptions > 0 ||
                    result.migratedDestinations > 0 ||
                    result.migratedNotifications > 0
                ) {
                    this.logger.info(
                        {
                            oldChatId,
                            newChatId,
                            migratedChats: result.migratedChats,
                            migratedSubscriptions: result.migratedSubscriptions,
                            deduplicatedSubscriptions: result.deduplicatedSubscriptions,
                            migratedDestinations: result.migratedDestinations,
                            migratedNotifications: result.migratedNotifications,
                        },
                        'Migrated Telegram chat subscriptions and queues after group upgrade',
                    );
                }
                return;
            }

            const result = this.transactionManager.retryInTransaction(() => {
                const subResult = this.subscriptionRepo.migrateChat(oldChatId, newChatId, newTitle);
                for (const dupSubId of subResult.duplicateSubscriptionIds) {
                    this.domainEventsRepo.cancelForSubscription(dupSubId);
                }
                const migratedDestinations = this.domainEventsRepo.migratePendingChatId(
                    oldChatId,
                    newChatId,
                );
                return { subResult, migratedDestinations };
            });

            if (
                result.subResult.migratedChats > 0 ||
                result.subResult.migratedSubscriptions > 0 ||
                result.subResult.duplicateSubscriptionIds.length > 0 ||
                result.migratedDestinations > 0
            ) {
                this.logger.warn(
                    {
                        oldChatId,
                        newChatId,
                        migratedChats: result.subResult.migratedChats,
                        migratedSubscriptions: result.subResult.migratedSubscriptions,
                        deduplicatedSubscriptions: result.subResult.duplicateSubscriptionIds.length,
                        migratedDestinations: result.migratedDestinations,
                    },
                    'Migrated Telegram chat without notificationRepo; pending notifications were not updated',
                );
            }
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger.error(
                    { err: error, oldChatId, newChatId },
                    'Failed to migrate Telegram chat after group upgrade',
                );
                return;
            }
            throw error;
        }
    }

    private handleMyChatMember(update: ChatMemberUpdated): void {
        const newMember = update.new_chat_member;
        const isUnavailable =
            newMember.status === 'kicked' ||
            newMember.status === 'left' ||
            (newMember.status === 'restricted' && !newMember.can_send_messages);

        if (!isUnavailable) {
            return;
        }

        const chatId = update.chat.id;
        let result: DisableSubscriptionsResult;
        try {
            if (this.destinationLifecycle !== undefined) {
                result = this.destinationLifecycle.disableChat(chatId);
            } else {
                result = this.disableChatSubscriptionsFallback(chatId);
            }
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger.error(
                    {
                        err: error,
                        chatId,
                        oldStatus: update.old_chat_member.status,
                        newStatus: newMember.status,
                    },
                    'Failed to disable Telegram subscriptions after my_chat_member update',
                );
                return;
            }
            throw error;
        }

        if (result.disabledSubscriptionIds.length > 0) {
            this.logger.warn(
                {
                    chatId,
                    chatType: update.chat.type,
                    oldStatus: update.old_chat_member.status,
                    newStatus: newMember.status,
                    disabledSubscriptionIds: result.disabledSubscriptionIds,
                    disabledClanTags: result.disabledClanTags,
                    untrackedClanTags: result.untrackedClanTags,
                },
                'Automatically disabled Telegram subscriptions after my_chat_member update',
            );
        }
    }

    private disableChatSubscriptionsFallback(chatId: number): DisableSubscriptionsResult {
        return this.transactionManager.retryInTransaction(() => {
            const subscriptions = this.subscriptionRepo.getSubscriptionsForChat(chatId);
            if (subscriptions.length === 0) {
                return {
                    disabledSubscriptionIds: [],
                    disabledClanTags: [],
                    untrackedClanTags: [],
                };
            }

            const disabledSubscriptionIds: number[] = [];
            const disabledClanTags = new Set<string>();
            const untrackedClanTags = new Set<string>();

            for (const subscription of subscriptions) {
                this.domainEventsRepo.cancelForSubscription(subscription.subscriptionId);
                const removed = this.subscriptionRepo.unsubscribeFromChat(
                    subscription.chatId,
                    subscription.messageThreadId,
                    subscription.clanTag,
                );
                if (!removed) {
                    continue;
                }

                disabledSubscriptionIds.push(subscription.subscriptionId);
                disabledClanTags.add(subscription.clanTag);

                if (
                    !this.subscriptionRepo.hasSubscriptionsForChat(
                        subscription.chatId,
                        subscription.messageThreadId,
                    )
                ) {
                    this.subscriptionRepo.deleteTelegramChat(
                        subscription.chatId,
                        subscription.messageThreadId,
                    );
                }

                if (!this.subscriptionRepo.hasSubscriptionsForClan(subscription.clanTag)) {
                    this.clansRepo.disableTracking(subscription.clanTag);
                    untrackedClanTags.add(subscription.clanTag);
                }
            }

            return {
                disabledSubscriptionIds,
                disabledClanTags: [...disabledClanTags],
                untrackedClanTags: [...untrackedClanTags],
            };
        });
    }

    private async canManageCurrentChat(
        api: Context['api'],
        chatId: number,
        userId: number,
        chatType: string,
    ): Promise<boolean> {
        if (chatType === 'private') {
            return chatId === userId;
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

    private async lookupClanForLink(clanTag: string): Promise<ClanLookupOutcome> {
        if (this.cocApiClient === undefined) {
            return { status: 'unavailable' };
        }

        try {
            const data = await this.cocApiClient.getCompleteClanData(clanTag, this.activeSignal);
            if (this.activeSignal?.aborted) {
                return { status: 'aborted' };
            }
            if (data === null) {
                return { status: 'not_found' };
            }
            return { status: 'found', data };
        } catch (error: unknown) {
            if (this.isCancelledError(error)) {
                return { status: 'aborted' };
            }
            if (isCocApiError(error) && (error.kind === 'not_found' || error.statusCode === 404)) {
                return { status: 'not_found' };
            }

            this.logger.warn(
                { err: error, clanTag },
                'CoC API lookup failed during /link; falling back to deferred synchronization',
            );
            return { status: 'unavailable' };
        }
    }

    private evaluateLinkPrecheck(
        chatId: number,
        messageThreadId: number,
        clanTag: string,
    ): LinkPrecheckOutcome {
        const existing = this.subscriptionRepo.getSubscription(chatId, messageThreadId, clanTag);
        if (existing !== null) {
            return {
                status: 'already_linked',
                subscription: existing,
                clanName: this.clansRepo.getClanNameByTag(clanTag),
            };
        }

        if (
            this.subscriptionRepo.countSubscriptionsForDestination(chatId, messageThreadId) >=
            this.maxClansPerDestination
        ) {
            return { status: 'destination_limit_reached' };
        }

        if (
            !this.clansRepo.isClanTracked(clanTag) &&
            this.clansRepo.countTrackedClans() >= this.maxTrackedClans
        ) {
            return { status: 'instance_limit_reached' };
        }

        return { status: 'proceed' };
    }

    private linkClanToChat(
        chatId: number,
        messageThreadId: number,
        title: string,
        clanTag: string,
        preset: SubscriptionPreset,
        clanData: CompleteClanData | null,
    ): LinkClanOutcome {
        return this.transactionManager.retryInTransaction((): LinkClanOutcome => {
            const precheck = this.evaluateLinkPrecheck(chatId, messageThreadId, clanTag);
            if (precheck.status !== 'proceed') {
                return precheck;
            }

            const alreadyTrackedByOtherChats =
                this.subscriptionRepo.hasSubscriptionsForClan(clanTag);

            if (clanData !== null) {
                this.clansRepo.saveClan({ ...clanData.clan, tag: clanTag });
                this.clansRepo.enableTracking(clanTag);
                this.clansRepo.saveClanSnapshot({ ...clanData.clanSnapshot, clanTag });
            } else {
                this.clansRepo.insertMinimalClan(clanTag);
            }

            this.subscriptionRepo.saveTelegramChat(chatId, messageThreadId, title);
            this.subscriptionRepo.subscribeToChat(chatId, messageThreadId, clanTag, preset);

            return {
                status: alreadyTrackedByOtherChats ? 'linked_existing_clan' : 'linked_new_clan',
                clanName: this.clansRepo.getClanNameByTag(clanTag),
            };
        });
    }

    private unlinkClanFromChatWithName(
        chatId: number,
        messageThreadId: number,
        clanTag: string,
    ): UnlinkClanResult {
        return this.transactionManager.retryInTransaction(() => {
            const subscriptionId = this.subscriptionRepo.getSubscriptionId(
                chatId,
                messageThreadId,
                clanTag,
            );
            if (subscriptionId === null) {
                return { unlinked: false, clanName: null };
            }

            const clanName = this.clansRepo.getClanNameByTag(clanTag);
            this.domainEventsRepo.cancelForSubscription(subscriptionId);
            this.subscriptionRepo.unsubscribeFromChat(chatId, messageThreadId, clanTag);

            if (!this.subscriptionRepo.hasSubscriptionsForChat(chatId, messageThreadId)) {
                this.subscriptionRepo.deleteTelegramChat(chatId, messageThreadId);
            }

            if (!this.subscriptionRepo.hasSubscriptionsForClan(clanTag)) {
                this.clansRepo.disableTracking(clanTag);
            }

            return { unlinked: true, clanName };
        });
    }

    private unlinkClanFromChat(chatId: number, messageThreadId: number, clanTag: string): boolean {
        return this.unlinkClanFromChatWithName(chatId, messageThreadId, clanTag).unlinked;
    }

    private async handleLinkCommand(
        api: Context['api'],
        chatId: number,
        userId: number,
        messageThreadId: number,
        chat: Chat,
        command: ClanSubscriptionCommand,
    ): Promise<void> {
        const defaultPreset = resolveDefaultPreset(chat.type);
        if (defaultPreset === null) {
            await this.sendHtmlMessage(
                api,
                chatId,
                'Этот тип Telegram-чата пока не поддерживается для привязки.',
                messageThreadId,
            );
            return;
        }

        if (command.status === 'invalid_arguments') {
            await this.sendHtmlMessage(api, chatId, LINK_INVALID_ARGUMENTS_TEXT, messageThreadId);
            return;
        }

        if (command.status === 'invalid_clan_tag') {
            await this.sendHtmlMessage(api, chatId, LINK_INVALID_TAG_TEXT, messageThreadId);
            return;
        }

        let canManage: boolean;
        try {
            canManage = await this.canManageCurrentChat(api, chatId, userId, chat.type);
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

        let precheck: LinkPrecheckOutcome;
        try {
            precheck = this.evaluateLinkPrecheck(chatId, messageThreadId, clanTag);
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger.error(
                    { err: error, chatId, clanTag },
                    'Failed to check existing subscription or limits for /link',
                );
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

        if (precheck.status === 'already_linked') {
            await this.sendHtmlMessage(
                api,
                chatId,
                formatAlreadyLinkedText({
                    clanTag,
                    clanName: precheck.clanName,
                    categories: precheck.subscription.categories,
                    chatType: chat.type,
                    messageThreadId,
                }),
                messageThreadId,
                makeSubscriptionSettingsEntryKeyboard(clanTag),
            );
            return;
        }

        if (precheck.status === 'destination_limit_reached') {
            this.logger.info(
                {
                    chatId,
                    messageThreadId,
                    userId,
                    clanTag,
                    maxClansPerDestination: this.maxClansPerDestination,
                },
                'Rejected /link because Telegram destination reached clan limit',
            );
            await this.sendHtmlMessage(
                api,
                chatId,
                formatDestinationClanLimitText(this.maxClansPerDestination, messageThreadId),
                messageThreadId,
            );
            return;
        }

        if (precheck.status === 'instance_limit_reached') {
            this.logger.info(
                {
                    chatId,
                    messageThreadId,
                    userId,
                    clanTag,
                    maxTrackedClans: this.maxTrackedClans,
                },
                'Rejected /link because instance reached tracked clans limit',
            );
            await this.sendHtmlMessage(
                api,
                chatId,
                formatInstanceClanLimitText(this.maxTrackedClans),
                messageThreadId,
            );
            return;
        }

        const lookup = await this.lookupClanForLink(clanTag);
        if (lookup.status === 'aborted' || this.activeSignal?.aborted) {
            return;
        }

        if (lookup.status === 'not_found') {
            await this.sendHtmlMessage(
                api,
                chatId,
                formatClanNotFoundText(clanTag),
                messageThreadId,
            );
            return;
        }

        const clanData = lookup.status === 'found' ? lookup.data : null;

        let linkOutcome: LinkClanOutcome;
        try {
            linkOutcome = this.linkClanToChat(
                chatId,
                messageThreadId,
                title,
                clanTag,
                defaultPreset,
                clanData,
            );
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

        if (linkOutcome.status === 'already_linked') {
            await this.sendHtmlMessage(
                api,
                chatId,
                formatAlreadyLinkedText({
                    clanTag,
                    clanName: linkOutcome.clanName,
                    categories: linkOutcome.subscription.categories,
                    chatType: chat.type,
                    messageThreadId,
                }),
                messageThreadId,
                makeSubscriptionSettingsEntryKeyboard(clanTag),
            );
            return;
        }

        if (linkOutcome.status === 'destination_limit_reached') {
            this.logger.info(
                {
                    chatId,
                    messageThreadId,
                    userId,
                    clanTag,
                    maxClansPerDestination: this.maxClansPerDestination,
                },
                'Rejected /link in transaction because Telegram destination reached clan limit',
            );
            await this.sendHtmlMessage(
                api,
                chatId,
                formatDestinationClanLimitText(this.maxClansPerDestination, messageThreadId),
                messageThreadId,
            );
            return;
        }

        if (linkOutcome.status === 'instance_limit_reached') {
            this.logger.info(
                {
                    chatId,
                    messageThreadId,
                    userId,
                    clanTag,
                    maxTrackedClans: this.maxTrackedClans,
                },
                'Rejected /link in transaction because instance reached tracked clans limit',
            );
            await this.sendHtmlMessage(
                api,
                chatId,
                formatInstanceClanLimitText(this.maxTrackedClans),
                messageThreadId,
            );
            return;
        }

        this.clanManager?.notify();

        const responseText = formatLinkedClanText({
            clanTag,
            clanName: linkOutcome.clanName,
            ...(clanData !== null
                ? {
                      membersCount: clanData.clanSnapshot.membersCount,
                      isWarLogPublic: clanData.clanSnapshot.isWarLogPublic,
                  }
                : {}),
            preset: defaultPreset,
            alreadyTrackedByOtherChats: linkOutcome.status === 'linked_existing_clan',
            syncDeferred: lookup.status === 'unavailable',
            chatType: chat.type,
            messageThreadId,
        });

        await this.sendHtmlMessage(
            api,
            chatId,
            responseText,
            messageThreadId,
            makeSubscriptionSettingsEntryKeyboard(clanTag),
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
        if (!isSupportedTelegramChatType(chat.type)) {
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
            canManage = await this.canManageCurrentChat(api, chatId, userId, chat.type);
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
            unlinked = this.unlinkClanFromChat(chatId, messageThreadId, clanTag);
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

    private renderViewText(view: ViewCommandName, subscription: ClanSubscriptionSummary): string {
        const renderers: Readonly<
            Record<ViewCommandName, (target: ClanSubscriptionSummary) => string>
        > = {
            war: (target) => {
                if (this.clanwarRepo === undefined) {
                    throw new DatabaseError(
                        '[TelegramBotService] ClanwarRepo is required for /war view',
                        { context: { clanTag: target.clanTag, view } },
                    );
                }
                const nowEpochSeconds = this.clock.nowEpochSeconds();
                const warViewData = loadWarViewData(
                    {
                        clanwarRepo: this.clanwarRepo,
                        clansRepo: this.clansRepo,
                    },
                    target,
                    nowEpochSeconds,
                );
                return formatWarView(warViewData, nowEpochSeconds);
            },
            cwl: (target) => {
                if (this.clanwarRepo === undefined || this.clanwarsLeagueRepo === undefined) {
                    throw new DatabaseError(
                        '[TelegramBotService] ClanwarRepo and ClanwarsLeagueRepo are required for /cwl view',
                        { context: { clanTag: target.clanTag, view } },
                    );
                }
                const nowEpochSeconds = this.clock.nowEpochSeconds();
                const cwlViewData = loadCwlViewData(
                    {
                        clanwarRepo: this.clanwarRepo,
                        clanwarsLeagueRepo: this.clanwarsLeagueRepo,
                        clansRepo: this.clansRepo,
                    },
                    target,
                    nowEpochSeconds,
                );
                return formatCwlView(cwlViewData, nowEpochSeconds);
            },
            raid: (target) => {
                if (this.raidRepo === undefined) {
                    throw new DatabaseError(
                        '[TelegramBotService] RaidRepo is required for /raid view',
                        { context: { clanTag: target.clanTag, view } },
                    );
                }
                const nowEpochSeconds = this.clock.nowEpochSeconds();
                const raidViewData = loadRaidViewData(
                    {
                        raidRepo: this.raidRepo,
                        clansRepo: this.clansRepo,
                    },
                    target,
                    nowEpochSeconds,
                );
                return formatRaidView(raidViewData, nowEpochSeconds);
            },
        };

        return renderers[view](subscription);
    }

    private async handleViewCommand(
        api: Context['api'],
        chatId: number,
        messageThreadId: number,
        chatType: string,
        command: ViewBotCommand,
    ): Promise<void> {
        if (!isSupportedTelegramChatType(chatType)) {
            await this.sendHtmlMessage(
                api,
                chatId,
                'Этот тип Telegram-чата пока не поддерживается.',
                messageThreadId,
            );
            return;
        }

        if (command.status === 'invalid_arguments') {
            await this.sendHtmlMessage(
                api,
                chatId,
                formatViewInvalidArgumentsText(command.view),
                messageThreadId,
            );
            return;
        }

        if (command.status === 'invalid_clan_tag') {
            await this.sendHtmlMessage(
                api,
                chatId,
                formatViewInvalidTagText(command.view),
                messageThreadId,
            );
            return;
        }

        let subscriptions: ClanSubscriptionSummary[];
        try {
            subscriptions = this.subscriptionRepo.getSubscriptionSummariesForDestination(
                chatId,
                messageThreadId,
            );
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger.error(
                    { err: error, chatId, messageThreadId, view: command.view },
                    'Failed to load subscriptions for view command',
                );
                await this.sendHtmlMessage(api, chatId, VIEW_LOAD_ERROR_TEXT, messageThreadId);
                return;
            }
            throw error;
        }

        const resolution = resolveViewClanSubscription(subscriptions, command.clanTag);

        if (resolution.status === 'no_clans') {
            await this.sendHtmlMessage(api, chatId, formatViewNoClansText(), messageThreadId);
            return;
        }

        if (resolution.status === 'not_subscribed') {
            await this.sendHtmlMessage(
                api,
                chatId,
                formatViewClanNotSubscribedText(resolution.clanTag),
                messageThreadId,
            );
            return;
        }

        if (resolution.status === 'select_clan') {
            await this.sendHtmlMessage(
                api,
                chatId,
                formatViewClanSelectText(command.view),
                messageThreadId,
                makeViewClanPickerKeyboard(command.view, resolution.subscriptions, 'command'),
            );
            return;
        }

        let text: string;
        try {
            text = this.renderViewText(command.view, resolution.subscription);
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger.error(
                    {
                        err: error,
                        chatId,
                        messageThreadId,
                        clanTag: resolution.subscription.clanTag,
                        view: command.view,
                    },
                    'Failed to render SQLite view for command',
                );
                await this.sendHtmlMessage(api, chatId, VIEW_LOAD_ERROR_TEXT, messageThreadId);
                return;
            }
            throw error;
        }

        await this.sendHtmlMessage(
            api,
            chatId,
            text,
            messageThreadId,
            makeViewResultKeyboard(command.view, resolution.subscription.clanTag, 'command'),
        );
    }

    private async handleViewCallback(
        api: Context['api'],
        context: CallbackContext,
        callbackData: ViewCallbackData,
    ): Promise<void> {
        if (!isSupportedTelegramChatType(context.chatType)) {
            await this.safeAnswerCallbackQuery(api, context.queryId, {
                text: 'Этот тип Telegram-чата пока не поддерживается.',
                show_alert: true,
            });
            return;
        }

        const rateLimit = this.commandRateLimiter.consume(context.userId);
        if (!rateLimit.allowed) {
            this.logger.info(
                {
                    chatId: context.chatId,
                    messageThreadId: context.messageThreadId,
                    userId: context.userId,
                    callbackKind: callbackData.kind,
                    view: callbackData.view,
                    retryAfterMs: rateLimit.retryAfterMs,
                },
                'Rejected Telegram view callback due to per-user rate limit',
            );
            await this.safeAnswerCallbackQuery(api, context.queryId, {
                text: COMMAND_RATE_LIMIT_EXCEEDED_TEXT,
                show_alert: true,
            });
            return;
        }

        if (callbackData.kind === 'view:open') {
            let subscriptions: ClanSubscriptionSummary[];
            try {
                subscriptions = this.subscriptionRepo.getSubscriptionSummariesForDestination(
                    context.chatId,
                    context.messageThreadId,
                );
            } catch (error: unknown) {
                if (error instanceof DatabaseError) {
                    this.logger.error(
                        {
                            err: error,
                            chatId: context.chatId,
                            messageThreadId: context.messageThreadId,
                            view: callbackData.view,
                        },
                        'Failed to load subscriptions for view callback',
                    );
                    await this.safeAnswerCallbackQuery(api, context.queryId, {
                        text: VIEW_LOAD_ERROR_TEXT,
                        show_alert: true,
                    });
                    return;
                }
                throw error;
            }

            const resolution = resolveViewClanSubscription(subscriptions, null);

            if (resolution.status === 'no_clans') {
                await this.safeAnswerCallbackQuery(api, context.queryId);
                if (this.activeSignal?.aborted) {
                    return;
                }
                await this.editHtmlMessage(
                    api,
                    context.chatId,
                    context.messageId,
                    formatViewNoClansText(),
                    makeViewBackToMenuKeyboard(),
                );
                return;
            }

            if (resolution.status === 'select_clan') {
                await this.safeAnswerCallbackQuery(api, context.queryId);
                if (this.activeSignal?.aborted) {
                    return;
                }
                await this.editHtmlMessage(
                    api,
                    context.chatId,
                    context.messageId,
                    formatViewClanSelectText(callbackData.view),
                    makeViewClanPickerKeyboard(callbackData.view, resolution.subscriptions, 'menu'),
                );
                return;
            }

            if (resolution.status !== 'ready') {
                return;
            }

            let text: string;
            try {
                text = this.renderViewText(callbackData.view, resolution.subscription);
            } catch (error: unknown) {
                if (error instanceof DatabaseError) {
                    this.logger.error(
                        {
                            err: error,
                            chatId: context.chatId,
                            messageThreadId: context.messageThreadId,
                            clanTag: resolution.subscription.clanTag,
                            view: callbackData.view,
                        },
                        'Failed to render SQLite view for menu callback',
                    );
                    await this.safeAnswerCallbackQuery(api, context.queryId, {
                        text: VIEW_LOAD_ERROR_TEXT,
                        show_alert: true,
                    });
                    return;
                }
                throw error;
            }

            await this.safeAnswerCallbackQuery(api, context.queryId);
            if (this.activeSignal?.aborted) {
                return;
            }
            await this.editHtmlMessage(
                api,
                context.chatId,
                context.messageId,
                text,
                makeViewResultKeyboard(callbackData.view, resolution.subscription.clanTag, 'menu'),
            );
            return;
        }

        let subscription: ClanSubscriptionSummary | null;
        try {
            subscription = this.subscriptionRepo.getSubscriptionSummary(
                context.chatId,
                context.messageThreadId,
                callbackData.clanTag,
            );
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger.error(
                    {
                        err: error,
                        chatId: context.chatId,
                        messageThreadId: context.messageThreadId,
                        clanTag: callbackData.clanTag,
                        view: callbackData.view,
                    },
                    'Failed to load subscription for view clan callback',
                );
                await this.safeAnswerCallbackQuery(api, context.queryId, {
                    text: VIEW_LOAD_ERROR_TEXT,
                    show_alert: true,
                });
                return;
            }
            throw error;
        }

        if (subscription === null) {
            await this.safeAnswerCallbackQuery(api, context.queryId, {
                text: formatViewClanNotSubscribedText(callbackData.clanTag),
                show_alert: true,
            });
            return;
        }

        let text: string;
        try {
            text = this.renderViewText(callbackData.view, subscription);
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger.error(
                    {
                        err: error,
                        chatId: context.chatId,
                        messageThreadId: context.messageThreadId,
                        clanTag: subscription.clanTag,
                        view: callbackData.view,
                    },
                    'Failed to render SQLite view for clan callback',
                );
                await this.safeAnswerCallbackQuery(api, context.queryId, {
                    text: VIEW_LOAD_ERROR_TEXT,
                    show_alert: true,
                });
                return;
            }
            throw error;
        }

        await this.safeAnswerCallbackQuery(api, context.queryId);
        if (this.activeSignal?.aborted) {
            return;
        }
        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            text,
            makeViewResultKeyboard(callbackData.view, subscription.clanTag, callbackData.source),
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

        if (callbackData.kind === 'view:open' || callbackData.kind === 'view:clan') {
            await this.handleViewCallback(api, context, callbackData);
            return;
        }

        if (callbackData.kind === 'clans:card') {
            await this.handleClanCardCallback(
                api,
                context,
                callbackData.clanTag,
                callbackData.page,
            );
            return;
        }

        if (
            callbackData.kind === 'clans:unlink' ||
            callbackData.kind === 'clans:unlink_list' ||
            callbackData.kind === 'clans:unlink_ask' ||
            callbackData.kind === 'clans:unlink_confirm' ||
            callbackData.kind === 'clans:unlink_cancel'
        ) {
            await this.handleUnlinkCallback(api, context, callbackData);
            return;
        }

        if (
            callbackData.kind === 'settings:open' ||
            callbackData.kind === 'settings:preset' ||
            callbackData.kind === 'settings:category' ||
            callbackData.kind === 'settings:mirror' ||
            callbackData.kind === 'settings:tz' ||
            callbackData.kind === 'settings:tzall' ||
            callbackData.kind === 'settings:tzset'
        ) {
            await this.handleSettingsCallback(api, context, callbackData);
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
                await this.handleMyClansCallback(api, context, callbackData.page);
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

    private async sendHelpMessage(
        api: Context['api'],
        chatId: number,
        messageThreadId: number,
    ): Promise<void> {
        await this.sendHtmlMessage(
            api,
            chatId,
            HELP_TEXT,
            messageThreadId,
            makeHelpNavigationKeyboard(),
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
        page = 1,
    ): Promise<void> {
        if (!isSupportedTelegramChatType(context.chatType)) {
            await this.editHtmlMessage(
                api,
                context.chatId,
                context.messageId,
                'Этот тип Telegram-чата пока не поддерживается.',
                makeMyClansNavigationKeyboard(),
            );
            return;
        }

        let summaries: ClanSubscriptionSummary[];
        try {
            summaries = this.subscriptionRepo.getSubscriptionSummariesForDestination(
                context.chatId,
                context.messageThreadId,
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

        const pageSlice = paginateItems(summaries, page, CLANS_PAGE_SIZE);
        const keyboardSlice = {
            ...pageSlice,
            items: pageSlice.items.map((item) => ({
                clanTag: item.clanTag,
                clanName: item.clanName,
                status: resolveClanTrackingStatus(item),
            })),
        };

        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            formatMyClansListText(pageSlice),
            makeMyClansListKeyboard(keyboardSlice),
        );
    }

    private async handleClanCardCallback(
        api: Context['api'],
        context: CallbackContext,
        clanTag: string,
        page: number,
    ): Promise<void> {
        if (!isSupportedTelegramChatType(context.chatType)) {
            await this.safeAnswerCallbackQuery(api, context.queryId, {
                text: 'Этот тип Telegram-чата пока не поддерживается.',
                show_alert: true,
            });
            return;
        }

        let summary: ClanSubscriptionSummary | null;
        try {
            summary = this.subscriptionRepo.getSubscriptionSummary(
                context.chatId,
                context.messageThreadId,
                clanTag,
            );
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger.error(
                    { err: error, chatId: context.chatId, clanTag },
                    'Failed to load clan card',
                );
                await this.safeAnswerCallbackQuery(api, context.queryId, {
                    text: CARD_LOAD_ERROR_TEXT,
                    show_alert: true,
                });
                return;
            }
            throw error;
        }

        if (summary === null) {
            await this.safeAnswerCallbackQuery(api, context.queryId, {
                text: `Этот чат не привязан к клану ${clanTag}.`,
                show_alert: true,
            });
            return;
        }

        await this.safeAnswerCallbackQuery(api, context.queryId);

        if (this.activeSignal?.aborted) {
            return;
        }

        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            formatClanCardText(summary),
            makeClanCardKeyboard(summary.clanTag, page),
        );
    }

    private async renderUnlinkList(
        api: Context['api'],
        context: CallbackContext,
        page: number,
    ): Promise<void> {
        let summaries: ClanSubscriptionSummary[];
        try {
            summaries = this.subscriptionRepo.getSubscriptionSummariesForDestination(
                context.chatId,
                context.messageThreadId,
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

        const pageSlice = paginateItems(summaries, page, CLANS_PAGE_SIZE);
        const keyboardSlice = {
            ...pageSlice,
            items: pageSlice.items.map((item) => ({
                clanTag: item.clanTag,
                clanName: item.clanName,
            })),
        };

        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            formatUnlinkListText(pageSlice),
            makeClanUnlinkListKeyboard(keyboardSlice),
        );
    }

    private async handleUnlinkCallback(
        api: Context['api'],
        context: CallbackContext,
        callbackData: UnlinkCallbackData,
    ): Promise<void> {
        if (!isSupportedTelegramChatType(context.chatType)) {
            if (callbackData.kind === 'clans:unlink' && callbackData.clanTag === null) {
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
            await this.safeAnswerCallbackQuery(api, context.queryId, {
                text: 'Этот тип Telegram-чата пока не поддерживается.',
                show_alert: true,
            });
            return;
        }

        let canManage: boolean;
        try {
            canManage = await this.canManageCurrentChat(
                api,
                context.chatId,
                context.userId,
                context.chatType,
            );
        } catch (error: unknown) {
            if (this.isCancelledError(error)) {
                return;
            }
            this.logger.error(
                { err: error, chatId: context.chatId, kind: callbackData.kind },
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
                text: context.chatType === 'private' ? ONLY_OWNER_TEXT : ONLY_ADMIN_TEXT,
                show_alert: true,
            });
            return;
        }

        if (
            callbackData.kind === 'clans:unlink_list' ||
            (callbackData.kind === 'clans:unlink' && callbackData.clanTag === null)
        ) {
            await this.safeAnswerCallbackQuery(api, context.queryId);
            if (this.activeSignal?.aborted) {
                return;
            }
            const page = callbackData.kind === 'clans:unlink_list' ? callbackData.page : 1;
            await this.renderUnlinkList(api, context, page);
            return;
        }

        if (callbackData.kind === 'clans:unlink' || callbackData.kind === 'clans:unlink_ask') {
            const clanTag = callbackData.clanTag;
            if (clanTag === null) {
                return;
            }
            const source =
                callbackData.kind === 'clans:unlink_ask' ? callbackData.source : 'unlink';
            const page = callbackData.kind === 'clans:unlink_ask' ? callbackData.page : 1;

            let summary: ClanSubscriptionSummary | null;
            try {
                summary = this.subscriptionRepo.getSubscriptionSummary(
                    context.chatId,
                    context.messageThreadId,
                    clanTag,
                );
            } catch (error: unknown) {
                if (error instanceof DatabaseError) {
                    this.logger.error(
                        { err: error, chatId: context.chatId, clanTag },
                        'Failed to load subscription for unlink confirmation',
                    );
                    await this.safeAnswerCallbackQuery(api, context.queryId, {
                        text: UNLINK_LOAD_ERROR_TEXT,
                        show_alert: true,
                    });
                    return;
                }
                throw error;
            }

            if (summary === null) {
                await this.safeAnswerCallbackQuery(api, context.queryId, {
                    text: `Этот чат не привязан к клану ${clanTag}.`,
                    show_alert: true,
                });
                return;
            }

            await this.safeAnswerCallbackQuery(api, context.queryId);
            if (this.activeSignal?.aborted) {
                return;
            }

            await this.editHtmlMessage(
                api,
                context.chatId,
                context.messageId,
                formatUnlinkConfirmText(
                    summary.clanTag,
                    summary.clanName,
                    context.chatType,
                    context.messageThreadId,
                ),
                makeClanUnlinkConfirmKeyboard(summary.clanTag, source, page),
            );
            return;
        }

        if (callbackData.kind === 'clans:unlink_cancel') {
            await this.safeAnswerCallbackQuery(api, context.queryId);
            if (this.activeSignal?.aborted) {
                return;
            }

            if (callbackData.source === 'unlink') {
                await this.renderUnlinkList(api, context, callbackData.page);
                return;
            }

            let summary: ClanSubscriptionSummary | null;
            try {
                summary = this.subscriptionRepo.getSubscriptionSummary(
                    context.chatId,
                    context.messageThreadId,
                    callbackData.clanTag,
                );
            } catch (error: unknown) {
                if (error instanceof DatabaseError) {
                    this.logger.error(
                        { err: error, chatId: context.chatId, clanTag: callbackData.clanTag },
                        'Failed to reload clan card after unlink cancel',
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

            if (summary !== null) {
                await this.editHtmlMessage(
                    api,
                    context.chatId,
                    context.messageId,
                    formatClanCardText(summary),
                    makeClanCardKeyboard(summary.clanTag, callbackData.page),
                );
                return;
            }

            await this.handleMyClansCallback(api, context, callbackData.page);
            return;
        }

        await this.safeAnswerCallbackQuery(api, context.queryId);
        if (this.activeSignal?.aborted) {
            return;
        }

        const { clanTag } = callbackData;
        let result: UnlinkClanResult;
        try {
            result = this.unlinkClanFromChatWithName(
                context.chatId,
                context.messageThreadId,
                clanTag,
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

        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            formatUnlinkResultText(clanTag, result.clanName, result.unlinked),
            makeStartMenuKeyboard(),
        );
    }

    private buildSubscriptionSettingsScreen(
        subscription: SubscriptionRecord,
        clanName: string | null,
    ): { readonly text: string; readonly keyboard: InlineKeyboardMarkup } {
        return {
            text: formatSubscriptionSettingsText({
                clanTag: subscription.clanTag,
                clanName,
                categories: subscription.categories,
                mirrorRuleEnabled: subscription.mirrorRuleEnabled,
                timezoneOffsetHours: subscription.timezoneOffsetHours,
            }),
            keyboard: makeSubscriptionSettingsKeyboard(
                subscription.clanTag,
                subscription.categories,
                {
                    extraRows: [
                        [
                            makeMirrorRuleToggleButton(
                                subscription.clanTag,
                                subscription.mirrorRuleEnabled,
                            ),
                        ],
                    ],
                    timezoneOffsetHours: subscription.timezoneOffsetHours,
                },
            ),
        };
    }

    private buildTimezoneQuickSelectScreen(
        subscription: SubscriptionRecord,
        clanName: string | null,
    ): { readonly text: string; readonly keyboard: InlineKeyboardMarkup } {
        return {
            text: formatTimezoneQuickSelectText({
                clanTag: subscription.clanTag,
                clanName,
                timezoneOffsetHours: subscription.timezoneOffsetHours,
            }),
            keyboard: makeTimezoneQuickSelectKeyboard(
                subscription.clanTag,
                subscription.timezoneOffsetHours,
            ),
        };
    }

    private buildTimezoneAllSelectScreen(
        subscription: SubscriptionRecord,
        clanName: string | null,
    ): { readonly text: string; readonly keyboard: InlineKeyboardMarkup } {
        return {
            text: formatTimezoneAllSelectText({
                clanTag: subscription.clanTag,
                clanName,
                timezoneOffsetHours: subscription.timezoneOffsetHours,
            }),
            keyboard: makeTimezoneAllSelectKeyboard(
                subscription.clanTag,
                subscription.timezoneOffsetHours,
            ),
        };
    }

    private applySettingsCallbackAction(
        chatId: number,
        messageThreadId: number,
        callbackData: SettingsCallbackData,
    ): SettingsActionOutcome {
        if (
            callbackData.kind === 'settings:open' ||
            callbackData.kind === 'settings:tz' ||
            callbackData.kind === 'settings:tzall'
        ) {
            const subscription = this.subscriptionRepo.getSubscription(
                chatId,
                messageThreadId,
                callbackData.clanTag,
            );
            if (subscription === null) {
                return { status: 'not_found' };
            }

            const clanName = this.clansRepo.getClanNameByTag(callbackData.clanTag);
            return { status: 'ready', subscription, clanName };
        }

        if (callbackData.kind === 'settings:tzset') {
            return this.transactionManager.retryInTransaction((): SettingsActionOutcome => {
                const subscription = this.subscriptionRepo.getSubscription(
                    chatId,
                    messageThreadId,
                    callbackData.clanTag,
                );
                if (subscription === null) {
                    return { status: 'not_found' };
                }

                const updated = this.subscriptionRepo.updateSubscriptionTimezone(
                    chatId,
                    messageThreadId,
                    callbackData.clanTag,
                    callbackData.timezoneOffsetHours,
                );
                if (!updated) {
                    return { status: 'not_found' };
                }

                const clanName = this.clansRepo.getClanNameByTag(callbackData.clanTag);
                return {
                    status: 'ready',
                    subscription: {
                        ...subscription,
                        timezoneOffsetHours: callbackData.timezoneOffsetHours,
                    },
                    clanName,
                };
            });
        }

        return this.transactionManager.retryInTransaction((): SettingsActionOutcome => {
            const subscription = this.subscriptionRepo.getSubscription(
                chatId,
                messageThreadId,
                callbackData.clanTag,
            );
            if (subscription === null) {
                return { status: 'not_found' };
            }

            if (callbackData.kind === 'settings:mirror') {
                const nextMirrorRuleEnabled = !subscription.mirrorRuleEnabled;
                const updated = this.subscriptionRepo.updateSubscriptionMirrorRule(
                    chatId,
                    messageThreadId,
                    callbackData.clanTag,
                    nextMirrorRuleEnabled,
                );
                if (!updated) {
                    return { status: 'not_found' };
                }

                const clanName = this.clansRepo.getClanNameByTag(callbackData.clanTag);
                return {
                    status: 'ready',
                    subscription: {
                        ...subscription,
                        mirrorRuleEnabled: nextMirrorRuleEnabled,
                    },
                    clanName,
                };
            }

            const nextCategories =
                callbackData.kind === 'settings:preset'
                    ? getPresetCategories(callbackData.preset)
                    : toggleSubscriptionCategory(subscription.categories, callbackData.category);

            if (nextCategories === null) {
                return { status: 'last_category' };
            }

            const updated = this.subscriptionRepo.updateSubscriptionCategories(
                chatId,
                messageThreadId,
                callbackData.clanTag,
                nextCategories,
            );
            if (!updated) {
                return { status: 'not_found' };
            }

            const clanName = this.clansRepo.getClanNameByTag(callbackData.clanTag);
            return {
                status: 'ready',
                subscription: {
                    ...subscription,
                    categories: nextCategories,
                },
                clanName,
            };
        });
    }

    private async handleSettingsCallback(
        api: Context['api'],
        context: CallbackContext,
        callbackData: SettingsCallbackData,
    ): Promise<void> {
        if (!isSupportedTelegramChatType(context.chatType)) {
            await this.safeAnswerCallbackQuery(api, context.queryId, {
                text: 'Этот тип Telegram-чата пока не поддерживается.',
                show_alert: true,
            });
            return;
        }

        let canManage: boolean;
        try {
            canManage = await this.canManageCurrentChat(
                api,
                context.chatId,
                context.userId,
                context.chatType,
            );
        } catch (error: unknown) {
            if (this.isCancelledError(error)) {
                return;
            }
            this.logger.error(
                { err: error, chatId: context.chatId, kind: callbackData.kind },
                'Failed to check permissions for settings callback',
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
                text:
                    context.chatType === 'private'
                        ? SETTINGS_ONLY_OWNER_TEXT
                        : SETTINGS_ONLY_ADMIN_TEXT,
                show_alert: true,
            });
            return;
        }

        let outcome: SettingsActionOutcome;
        try {
            outcome = this.applySettingsCallbackAction(
                context.chatId,
                context.messageThreadId,
                callbackData,
            );
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger.error(
                    {
                        err: error,
                        chatId: context.chatId,
                        messageThreadId: context.messageThreadId,
                        clanTag: callbackData.clanTag,
                        kind: callbackData.kind,
                    },
                    'Failed to process subscription settings callback',
                );
                const isReadOnlySettingsAction =
                    callbackData.kind === 'settings:open' ||
                    callbackData.kind === 'settings:tz' ||
                    callbackData.kind === 'settings:tzall';
                await this.safeAnswerCallbackQuery(api, context.queryId, {
                    text: isReadOnlySettingsAction
                        ? SETTINGS_LOAD_ERROR_TEXT
                        : SETTINGS_UPDATE_ERROR_TEXT,
                    show_alert: true,
                });
                return;
            }
            throw error;
        }

        if (outcome.status === 'not_found') {
            await this.safeAnswerCallbackQuery(api, context.queryId, {
                text: `Этот чат не привязан к клану ${callbackData.clanTag}.`,
                show_alert: true,
            });
            return;
        }

        if (outcome.status === 'last_category') {
            await this.safeAnswerCallbackQuery(api, context.queryId, {
                text: LAST_CATEGORY_ALERT_TEXT,
                show_alert: true,
            });
            return;
        }

        await this.safeAnswerCallbackQuery(api, context.queryId);

        if (this.activeSignal?.aborted) {
            return;
        }

        const screen =
            callbackData.kind === 'settings:tz'
                ? this.buildTimezoneQuickSelectScreen(outcome.subscription, outcome.clanName)
                : callbackData.kind === 'settings:tzall'
                  ? this.buildTimezoneAllSelectScreen(outcome.subscription, outcome.clanName)
                  : this.buildSubscriptionSettingsScreen(outcome.subscription, outcome.clanName);
        await this.editHtmlMessage(
            api,
            context.chatId,
            context.messageId,
            screen.text,
            screen.keyboard,
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
        const guide = this.attackGuideCatalog.findById(guideId, townHall);
        if (guide === null) {
            this.logger.warn(
                { townHall, guideId },
                'Guide not found or not available for town hall callback',
            );
            return;
        }

        await this.sendHtmlMessage(
            api,
            context.chatId,
            `${escapeHtml(guide.title)}\n${escapeHtml(guide.youtubeUrl)}`,
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
