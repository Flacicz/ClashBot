import path from 'node:path';

import type { ApiResponse, Update, UserFromGetMe } from 'grammy/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeClock } from '../../src/common/clock.js';
import {
    CLAN_SIDES,
    ClansRepo,
    ClanwarRepo,
    ClanwarsLeagueRepo,
    Database,
    DomainEventsRepo,
    MigratorManager,
    NotificationRepo,
    SubscriptionRepo,
    TransactionManager,
    WAR_TYPES,
} from '../../src/database/index.js';
import { createLogger } from '../../src/logging/index.js';
import {
    AttackGuideCatalog,
    type ClanLookupApiClient,
    COMMAND_RATE_LIMIT_EXCEEDED_TEXT,
    CommandRateLimiter,
    PRIVATE_WAR_LOG_WARNING_TEXT,
    TelegramBotService,
} from '../../src/telegram/index.js';

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

// 2026-11-14 12:48:00 UTC = 2026-11-14 15:48:00 UTC+3
const BASE_NOW = Date.UTC(2026, 10, 14, 12, 48, 0) / 1000;
// 2026-11-14 18:00:00 UTC = 2026-11-14 21:00:00 UTC+3
const WAR_END_TIME = Date.UTC(2026, 10, 14, 18, 0, 0) / 1000;

interface RecordedCall {
    readonly method: string;
    readonly payload: Record<string, unknown>;
}

function getInlineKeyboard(
    payload: Record<string, unknown> | undefined,
): { text: string; callback_data: string }[][] {
    const markup = payload?.reply_markup as
        { inline_keyboard?: { text: string; callback_data: string }[][] } | undefined;
    return markup?.inline_keyboard ?? [];
}

let updateSeq = 1;

function makeMessageUpdate(params: {
    chatId: number;
    chatType: 'private' | 'group' | 'supergroup';
    text: string;
    userId?: number;
    messageThreadId?: number;
}): Update {
    updateSeq += 1;
    const chat =
        params.chatType === 'private'
            ? { id: params.chatId, type: 'private' as const, first_name: 'User' }
            : { id: params.chatId, type: params.chatType, title: 'Clan Chat' };

    return {
        update_id: updateSeq,
        message: {
            message_id: updateSeq * 10,
            date: BASE_NOW,
            chat,
            from: { id: params.userId ?? 555, is_bot: false, first_name: 'Player' },
            text: params.text,
            ...(params.messageThreadId !== undefined
                ? { message_thread_id: params.messageThreadId }
                : {}),
        },
    };
}

function makeCallbackUpdate(params: {
    chatId: number;
    chatType: 'private' | 'group' | 'supergroup' | 'channel';
    data: string;
    messageId?: number;
    userId?: number;
    messageThreadId?: number;
}): Update {
    updateSeq += 1;
    const chat =
        params.chatType === 'private'
            ? { id: params.chatId, type: 'private' as const, first_name: 'User' }
            : params.chatType === 'channel'
              ? { id: params.chatId, type: 'channel' as const, title: 'Channel' }
              : { id: params.chatId, type: params.chatType, title: 'Clan Chat' };

    return {
        update_id: updateSeq,
        callback_query: {
            id: `cb-${String(updateSeq)}`,
            from: { id: params.userId ?? 555, is_bot: false, first_name: 'Player' },
            chat_instance: 'instance-1',
            data: params.data,
            message: {
                message_id: params.messageId ?? 1000,
                date: BASE_NOW,
                chat,
                ...(params.messageThreadId !== undefined
                    ? { message_thread_id: params.messageThreadId }
                    : {}),
                text: 'previous',
            },
        },
    };
}

function seedClan(
    db: Database,
    clansRepo: ClansRepo,
    params: { clanTag: string; clanName: string; isWarLogPublic?: boolean; snapshotAt?: number },
): void {
    clansRepo.saveClan({
        tag: params.clanTag,
        name: params.clanName,
        description: '',
        locationId: 0,
        locationName: '',
        chatLanguageId: 0,
        chatLanguage: '',
        isFamilyFriendly: false,
    });
    clansRepo.saveClanSnapshot({
        clanTag: params.clanTag,
        type: 'open',
        membersCount: 25,
        clanLevel: 12,
        clanPoints: 20000,
        clanBuilderBasePoints: 10000,
        clanCapitalPoints: 5000,
        capitalHallLevel: 8,
        capitalLeagueId: 0,
        requiredTrophies: 0,
        requiredBuilderBaseTrophies: 0,
        requiredTownhallLevel: 1,
        warFrequency: 'always',
        isWarLogPublic: params.isWarLogPublic ?? true,
        warWinStreak: 2,
        warWins: 40,
        warTies: 1,
        warLosses: 10,
        warLeagueId: 0,
    });
    db.connection
        .prepare(`UPDATE clan_snapshots SET created_at = ? WHERE clan_tag = ?;`)
        .run(params.snapshotAt ?? BASE_NOW - 7 * 60, params.clanTag);
}

function seedActiveRegularWar(
    clanwarRepo: ClanwarRepo,
    params: {
        clanTag: string;
        clanName: string;
        opponentTag?: string;
        opponentName?: string;
        state?: 'inWar' | 'preparation';
        lastObservedAt?: number;
        homeStars?: number;
        opponentStars?: number;
        attacksCount?: number;
    },
): void {
    const oppTag = params.opponentTag ?? '#OPP1';
    const state = params.state ?? 'inWar';
    const attacksCount = params.attacksCount ?? 2;

    const attacks =
        attacksCount >= 2
            ? [
                  {
                      attackerTag: '#P1',
                      defenderTag: '#E1',
                      attackerClanTag: params.clanTag,
                      defenderClanTag: oppTag,
                      attackerPosition: 1,
                      defenderPosition: 1,
                      stars: 3,
                      destructionPercentage: 100,
                      orderNum: 1,
                      duration: 120,
                  },
                  {
                      attackerTag: '#P1',
                      defenderTag: '#E2',
                      attackerClanTag: params.clanTag,
                      defenderClanTag: oppTag,
                      attackerPosition: 1,
                      defenderPosition: 2,
                      stars: 3,
                      destructionPercentage: 100,
                      orderNum: 2,
                      duration: 110,
                  },
                  ...(attacksCount >= 3
                      ? [
                            {
                                attackerTag: '#P2',
                                defenderTag: '#E3',
                                attackerClanTag: params.clanTag,
                                defenderClanTag: oppTag,
                                attackerPosition: 2,
                                defenderPosition: 3,
                                stars: 2,
                                destructionPercentage: 78,
                                orderNum: 3,
                                duration: 130,
                            },
                        ]
                      : []),
              ]
            : [];

    clanwarRepo.saveCompleteClanwarData(
        {
            warUID: `${params.clanTag}_${params.clanTag}_${oppTag}_1000`,
            clanTag: params.clanTag,
            state,
            warType: WAR_TYPES.regular,
            teamSize: 3,
            attacksPerMember: 2,
            preparationStartTime: BASE_NOW - 24 * 3600,
            startTime: state === 'preparation' ? WAR_END_TIME : BASE_NOW - 18 * 3600,
            endTime: state === 'preparation' ? WAR_END_TIME + 24 * 3600 : WAR_END_TIME,
            seasonId: null,
            roundNumber: null,
        },
        {
            home: {
                side: CLAN_SIDES.home,
                clanTag: params.clanTag,
                clanName: params.clanName,
                clanLevel: 12,
                attacksCount: attacks.length,
                stars: params.homeStars ?? 6,
                destructionPercentage: 78.4,
            },
            opponent: {
                side: CLAN_SIDES.opponent,
                clanTag: oppTag,
                clanName: params.opponentName ?? 'Соперник',
                clanLevel: 11,
                attacksCount: 2,
                stars: params.opponentStars ?? 5,
                destructionPercentage: 70.1,
            },
        },
        attacks,
        {
            home: [
                {
                    playerTag: '#P1',
                    clanTag: params.clanTag,
                    playerName: 'Герой',
                    townhallLevel: 16,
                    mapPosition: 1,
                },
                {
                    playerTag: '#P2',
                    clanTag: params.clanTag,
                    playerName: 'Алекс',
                    townhallLevel: 15,
                    mapPosition: 2,
                },
                {
                    playerTag: '#P3',
                    clanTag: params.clanTag,
                    playerName: 'Алекс',
                    townhallLevel: 15,
                    mapPosition: 3,
                },
            ],
            opponent: [],
        },
        params.lastObservedAt ?? BASE_NOW - 7 * 60,
    );
}

describe('TelegramBotService view infrastructure and /war command', () => {
    const openDbs: Database[] = [];

    afterEach(() => {
        while (openDbs.length > 0) {
            openDbs.pop()?.close();
        }
    });

    function createHarness(options?: { maxRateLimitRequests?: number }) {
        const db = new Database(':memory:');
        openDbs.push(db);
        const transactionManager = new TransactionManager(db);
        new MigratorManager(db, transactionManager).migrate(REAL_MIGRATIONS_PATH);

        const clansRepo = new ClansRepo(db);
        const clanwarRepo = new ClanwarRepo(db);
        const cwlRepo = new ClanwarsLeagueRepo(db);
        const subscriptionRepo = new SubscriptionRepo(db);
        const domainEventsRepo = new DomainEventsRepo(db);
        const notificationRepo = new NotificationRepo(db);
        const clock = new FakeClock(BASE_NOW * 1000);
        const getCompleteClanDataSpy = vi
            .fn()
            .mockRejectedValue(new Error('CoC API must not be called'));
        const cocApiClient: ClanLookupApiClient = {
            getCompleteClanData: getCompleteClanDataSpy,
        };

        const calls: RecordedCall[] = [];
        let nextMessageId = 1000;

        const service = new TelegramBotService({
            telegramToken: '123456:TEST_TOKEN',
            attackGuideCatalog: AttackGuideCatalog.fromJson({ guides: [] }),
            clansRepo,
            clanwarRepo,
            subscriptionRepo,
            domainEventsRepo,
            notificationRepo,
            transactionManager,
            cocApiClient,
            clock,
            commandRateLimiter: new CommandRateLimiter({
                maxRequests: options?.maxRateLimitRequests ?? 50,
                windowMs: 60_000,
                clock,
            }),
            logger: createLogger({ level: 'silent' }),
            botConfig: { botInfo: TEST_BOT_INFO },
        });

        service.bot.api.config.use((_prev, method, payload) => {
            expect(db.connection.inTransaction).toBe(false);
            const record = { ...(payload as Record<string, unknown>) };
            calls.push({ method, payload: record });

            if (method === 'sendMessage') {
                const messageId = nextMessageId;
                nextMessageId += 1;
                return Promise.resolve({
                    ok: true,
                    result: {
                        message_id: messageId,
                        date: BASE_NOW,
                        chat: { id: Number(record.chat_id), type: 'group' },
                        text: typeof record.text === 'string' ? record.text : '',
                    },
                } as ApiResponse<never>);
            }

            if (method === 'editMessageText' || method === 'answerCallbackQuery') {
                return Promise.resolve({ ok: true, result: true } as ApiResponse<never>);
            }

            return Promise.reject(new Error(`Unexpected Telegram API call: ${method}`));
        });

        return {
            db,
            clansRepo,
            clanwarRepo,
            cwlRepo,
            subscriptionRepo,
            clock,
            service,
            calls,
            getCompleteClanDataSpy,
            sentMessages: () =>
                calls.filter((c) => c.method === 'sendMessage').map((c) => c.payload),
            editedMessages: () =>
                calls.filter((c) => c.method === 'editMessageText').map((c) => c.payload),
            answeredCallbacks: () =>
                calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.payload),
        };
    }

    it('handles 0 connected clans for both /war command and /start inline menu without calling CoC API or getChatMember', async () => {
        const h = createHarness();

        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -1001, chatType: 'supergroup', text: '/war' }),
        );
        await h.service.handleUpdate(
            makeCallbackUpdate({ chatId: -1001, chatType: 'supergroup', data: 'view:war' }),
        );

        const sent = h.sentMessages();
        expect(sent).toHaveLength(1);
        expect(String(sent[0]?.text)).toContain('/link #ТЕГ_КЛАНА');
        expect(getInlineKeyboard(sent[0])).toEqual([]);

        const edited = h.editedMessages();
        expect(edited).toHaveLength(1);
        expect(String(edited[0]?.text)).toContain('/link #ТЕГ_КЛАНА');
        expect(getInlineKeyboard(edited[0])).toEqual([
            [{ text: '⬅️ Назад', callback_data: 'menu:start' }],
        ]);

        expect(h.getCompleteClanDataSpy).not.toHaveBeenCalled();
        expect(h.calls.some((c) => c.method === 'getChatMember')).toBe(false);
    });

    it('responds immediately for 1 connected clan, supports refresh and back navigation, and isolates forum topics', async () => {
        const h = createHarness();

        seedClan(h.db, h.clansRepo, { clanTag: '#2PPLQ', clanName: 'Клан Один' });
        seedActiveRegularWar(h.clanwarRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан Один',
            homeStars: 6,
            attacksCount: 2,
        });

        h.subscriptionRepo.saveTelegramChat(-100500, 10, 'Topic 10');
        h.subscriptionRepo.subscribeToChat(-100500, 10, '#2PPLQ', {
            preset: 'players',
            timezoneOffsetHours: 3,
        });

        // 1. Text /war in Topic 10 -> new message with Refresh only (no Back)
        await h.service.handleUpdate(
            makeMessageUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                text: '/war',
            }),
        );

        const sent = h.sentMessages();
        expect(sent).toHaveLength(1);
        expect(sent[0]?.message_thread_id).toBe(10);
        const firstText = String(sent[0]?.text);
        expect(firstText).toContain('⚔️ <b>КВ: Клан Один vs Соперник</b>');
        expect(firstText).toContain('Без атак (2): Алекс (#P2), Алекс (#P3)');
        expect(firstText).toContain('✅ Отбились: 1');
        expect(firstText).toContain('🔄 обновлено 7 мин назад');
        expect(getInlineKeyboard(sent[0])).toEqual([
            [{ text: '🔄 Обновить', callback_data: 'view:war:#2PPLQ:c' }],
        ]);

        // 2. Forum topic isolation: Topic 20 has 0 subscriptions and rejects /war #2PPLQ
        await h.service.handleUpdate(
            makeMessageUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 20,
                text: '/war #2PPLQ',
            }),
        );
        expect(String(h.sentMessages()[1]?.text)).toBe('Клан #2PPLQ не подключён в этом чате');
        expect(h.sentMessages()[1]?.message_thread_id).toBe(20);

        // 3. Inline menu entry `⚔️ КВ` -> edits message with Refresh + Back
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'view:war',
            }),
        );
        expect(getInlineKeyboard(h.editedMessages()[0])).toEqual([
            [
                { text: '🔄 Обновить', callback_data: 'view:war:#2PPLQ:m' },
                { text: '⬅️ Назад', callback_data: 'menu:start' },
            ],
        ]);

        // 4. Advance SQLite war state + clock and click Refresh -> updates in place with fresh data
        h.clock.advance(10 * 60 * 1000);
        seedActiveRegularWar(h.clanwarRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан Один',
            homeStars: 8,
            attacksCount: 3,
            lastObservedAt: h.clock.nowEpochSeconds() - 2 * 60,
        });

        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'view:war:#2PPLQ:m',
            }),
        );
        const refreshedText = String(h.editedMessages()[1]?.text);
        expect(refreshedText).toContain('⭐ 8 : 5');
        expect(refreshedText).toContain('Без атак (1): Алекс (#P3)');
        expect(refreshedText).toContain('1 из 2 (1): Алекс (#P2)');
        expect(refreshedText).toContain('🔄 обновлено 2 мин назад');
        expect(getInlineKeyboard(h.editedMessages()[1])).toEqual([
            [
                { text: '🔄 Обновить', callback_data: 'view:war:#2PPLQ:m' },
                { text: '⬅️ Назад', callback_data: 'menu:start' },
            ],
        ]);

        // 5. Clicking Back returns to /start menu with ⚔️ КВ button
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'menu:start',
            }),
        );
        expect(String(h.editedMessages()[2]?.text)).toContain('Добро пожаловать');
        expect(getInlineKeyboard(h.editedMessages()[2])[0]).toEqual([
            { text: '⚔️ КВ', callback_data: 'view:war' },
            { text: '🏆 ЛВК', callback_data: 'view:cwl' },
            { text: '🏰 Рейд', callback_data: 'view:raid' },
        ]);

        expect(h.getCompleteClanDataSpy).not.toHaveBeenCalled();
        expect(h.calls.some((c) => c.method === 'getChatMember')).toBe(false);
    });

    it('shows clan picker for >1 clans, handles direct /war #TAG for subscribed and foreign tags, and validates arguments', async () => {
        const h = createHarness();

        seedClan(h.db, h.clansRepo, { clanTag: '#2PPLQ', clanName: 'Клан А' });
        seedClan(h.db, h.clansRepo, {
            clanTag: '#999888',
            clanName: 'Клан Б',
            isWarLogPublic: false,
        });
        seedActiveRegularWar(h.clanwarRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан А',
            state: 'preparation',
        });

        h.subscriptionRepo.saveTelegramChat(-200, 0, 'Multi Chat');
        h.subscriptionRepo.subscribeToChat(-200, 0, '#2PPLQ', 'players');
        h.subscriptionRepo.subscribeToChat(-200, 0, '#999888', 'players');

        // /war without argument -> picker in command mode (no Back button)
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/war' }),
        );
        expect(String(h.sentMessages()[0]?.text)).toContain('Выберите клан');
        expect(getInlineKeyboard(h.sentMessages()[0])).toEqual([
            [{ text: 'Клан А (#2PPLQ)', callback_data: 'view:war:#2PPLQ:c' }],
            [{ text: 'Клан Б (#999888)', callback_data: 'view:war:#999888:c' }],
        ]);

        // Direct /war #999888 -> immediate private war log response with Refresh button
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/war 999888' }),
        );
        expect(String(h.sentMessages()[1]?.text)).toContain(PRIVATE_WAR_LOG_WARNING_TEXT);
        expect(getInlineKeyboard(h.sentMessages()[1])).toEqual([
            [{ text: '🔄 Обновить', callback_data: 'view:war:#999888:c' }],
        ]);

        // Direct /war #2PPLQ -> immediate preparation response
        await h.service.handleUpdate(
            makeMessageUpdate({
                chatId: -200,
                chatType: 'group',
                text: '/war@ClashTestBot #2pplq',
            }),
        );
        expect(String(h.sentMessages()[2]?.text)).toContain('КВ (подготовка)');
        expect(String(h.sentMessages()[2]?.text)).toContain('Бой начнётся через 5 ч 12 мин');

        // Foreign unsubscribed tag
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/war #QQQ222' }),
        );
        expect(String(h.sentMessages()[3]?.text)).toBe('Клан #QQQ222 не подключён в этом чате');

        // Invalid tag and too many arguments
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/war #INVALID!' }),
        );
        expect(String(h.sentMessages()[4]?.text)).toContain('Некорректный тег клана');

        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/war #2PPLQ extra' }),
        );
        expect(String(h.sentMessages()[5]?.text)).toContain('Использование: /war');

        // Menu entry `view:war` with >1 clans -> picker with Back button
        await h.service.handleUpdate(
            makeCallbackUpdate({ chatId: -200, chatType: 'group', data: 'view:war' }),
        );
        expect(getInlineKeyboard(h.editedMessages()[0])).toEqual([
            [{ text: 'Клан А (#2PPLQ)', callback_data: 'view:war:#2PPLQ:m' }],
            [{ text: 'Клан Б (#999888)', callback_data: 'view:war:#999888:m' }],
            [{ text: '⬅️ Назад', callback_data: 'menu:start' }],
        ]);

        expect(h.getCompleteClanDataSpy).not.toHaveBeenCalled();
    });

    it('enforces shared per-user rate limit across /war commands and view callbacks without overwriting shared messages', async () => {
        const h = createHarness({ maxRateLimitRequests: 2 });

        seedClan(h.db, h.clansRepo, { clanTag: '#2PPLQ', clanName: 'Клан' });
        h.subscriptionRepo.saveTelegramChat(-300, 0, 'Rate Limit Chat');
        h.subscriptionRepo.subscribeToChat(-300, 0, '#2PPLQ', 'players');

        // Request 1: /war (allowed)
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -300, chatType: 'group', userId: 777, text: '/war' }),
        );
        // Request 2: Refresh callback (allowed)
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -300,
                chatType: 'group',
                userId: 777,
                data: 'view:war:#2PPLQ:c',
            }),
        );
        // Request 3: /war text (blocked)
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -300, chatType: 'group', userId: 777, text: '/war' }),
        );
        // Request 4: Refresh callback (blocked with personal alert, no editMessageText)
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -300,
                chatType: 'group',
                userId: 777,
                data: 'view:war:#2PPLQ:c',
            }),
        );

        expect(String(h.sentMessages()[1]?.text)).toBe(COMMAND_RATE_LIMIT_EXCEEDED_TEXT);
        expect(h.editedMessages()).toHaveLength(1);
        expect(h.answeredCallbacks()[1]).toMatchObject({
            text: COMMAND_RATE_LIMIT_EXCEEDED_TEXT,
            show_alert: true,
        });

        // Different user in the same chat is unaffected
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -300, chatType: 'group', userId: 888, text: '/war' }),
        );
        expect(String(h.sentMessages()[2]?.text)).toContain('Сейчас клан не в КВ.');
    });

    it('shows alert without overwriting message when refreshing a clan that was unlinked', async () => {
        const h = createHarness();

        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -400,
                chatType: 'group',
                data: 'view:war:#2PPLQ:m',
            }),
        );

        expect(h.editedMessages()).toHaveLength(0);
        expect(h.answeredCallbacks()[0]).toMatchObject({
            text: 'Клан #2PPLQ не подключён в этом чате',
            show_alert: true,
        });
    });

    it('renders active CWL state and stale warning (>1h) end-to-end via /war', async () => {
        const h = createHarness();

        seedClan(h.db, h.clansRepo, { clanTag: '#2PPLQ', clanName: 'Клан ЛВК' });
        const seasonId = h.cwlRepo.saveCWLSeason({ clanTag: '#2PPLQ', seasonId: '2026-11' });
        h.clanwarRepo.saveCompleteClanwarData(
            {
                warUID: '#2PPLQ_#2PPLQ_#CWL9_500',
                clanTag: '#2PPLQ',
                state: 'inWar',
                warType: WAR_TYPES.cwl,
                teamSize: 15,
                attacksPerMember: 1,
                preparationStartTime: BASE_NOW - 24 * 3600,
                startTime: BASE_NOW - 2 * 3600,
                endTime: BASE_NOW + 22 * 3600,
                seasonId,
                roundNumber: 1,
            },
            {
                home: {
                    side: CLAN_SIDES.home,
                    clanTag: '#2PPLQ',
                    clanName: 'Клан ЛВК',
                    clanLevel: 12,
                    attacksCount: 0,
                    stars: 0,
                    destructionPercentage: 0,
                },
                opponent: {
                    side: CLAN_SIDES.opponent,
                    clanTag: '#CWL9',
                    clanName: 'Соперник ЛВК',
                    clanLevel: 12,
                    attacksCount: 0,
                    stars: 0,
                    destructionPercentage: 0,
                },
            },
            [],
            { home: [], opponent: [] },
            BASE_NOW - 75 * 60,
        );

        h.subscriptionRepo.saveTelegramChat(-500, 0, 'CWL Chat');
        h.subscriptionRepo.subscribeToChat(-500, 0, '#2PPLQ', 'players');

        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -500, chatType: 'group', text: '/war' }),
        );

        const text = String(h.sentMessages()[0]?.text);
        expect(text).toContain('Сейчас идёт ЛВК — см. /cwl');
        expect(text).toContain('🔄 обновлено 1 ч 15 мин назад');
        expect(text).toContain('⚠️ данные могли устареть — возможен сбой синхронизации');
        expect(h.getCompleteClanDataSpy).not.toHaveBeenCalled();
    });
});
