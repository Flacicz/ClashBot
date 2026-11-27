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
const ROUND_END_TIME = Date.UTC(2026, 10, 14, 18, 0, 0) / 1000;

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
            id: `cb-cwl-${String(updateSeq)}`,
            from: { id: params.userId ?? 555, is_bot: false, first_name: 'Player' },
            chat_instance: 'instance-cwl-1',
            data: params.data,
            message: {
                message_id: params.messageId ?? 2000,
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
        clanLevel: 14,
        clanPoints: 24000,
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

function seedCwlRound(
    clanwarRepo: ClanwarRepo,
    params: {
        clanTag: string;
        clanName: string;
        cwlSeasonId: number;
        roundNumber: number;
        state: 'inWar' | 'preparation' | 'warEnded';
        opponentTag?: string;
        opponentName?: string;
        homeStars?: number;
        opponentStars?: number;
        homeDestruction?: number;
        opponentDestruction?: number;
        attacksUsedCount?: number;
        lastObservedAt?: number;
    },
): void {
    const oppTag = params.opponentTag ?? `#OPP${String(params.roundNumber)}`;
    const attacksUsedCount = params.attacksUsedCount ?? 1;
    const members = [
        {
            clanTag: params.clanTag,
            playerTag: '#P1',
            playerName: 'Герой',
            townhallLevel: 16,
            mapPosition: 1,
        },
        {
            clanTag: params.clanTag,
            playerTag: '#P2',
            playerName: 'Алекс',
            townhallLevel: 15,
            mapPosition: 2,
        },
        {
            clanTag: params.clanTag,
            playerTag: '#P3',
            playerName: 'Алекс',
            townhallLevel: 15,
            mapPosition: 3,
        },
    ];

    const attacks = members.slice(0, attacksUsedCount).map((member, index) => ({
        attackerTag: member.playerTag,
        defenderTag: `#E${String(index + 1)}`,
        attackerClanTag: params.clanTag,
        defenderClanTag: oppTag,
        attackerPosition: member.mapPosition,
        defenderPosition: member.mapPosition,
        stars: 3,
        destructionPercentage: 100,
        orderNum: index + 1,
        duration: 110,
    }));

    const prepBase =
        params.state === 'warEnded'
            ? BASE_NOW - (8 - params.roundNumber) * 86_400
            : BASE_NOW - 24 * 3600;
    const startTime =
        params.state === 'warEnded'
            ? prepBase + 12 * 3600
            : params.state === 'preparation'
              ? ROUND_END_TIME
              : BASE_NOW - 18 * 3600;
    const endTime =
        params.state === 'warEnded'
            ? prepBase + 36 * 3600
            : params.state === 'preparation'
              ? ROUND_END_TIME + 24 * 3600
              : ROUND_END_TIME;

    clanwarRepo.saveCompleteClanwarData(
        {
            warUID: `${params.clanTag}_${params.clanTag}_${oppTag}_r${String(params.roundNumber)}`,
            clanTag: params.clanTag,
            state: params.state,
            warType: WAR_TYPES.cwl,
            teamSize: 3,
            attacksPerMember: 1,
            preparationStartTime: prepBase,
            startTime,
            endTime,
            seasonId: params.cwlSeasonId,
            roundNumber: params.roundNumber,
        },
        {
            home: {
                side: CLAN_SIDES.home,
                clanTag: params.clanTag,
                clanName: params.clanName,
                clanLevel: 14,
                attacksCount: attacks.length,
                stars: params.homeStars ?? attacks.length * 3,
                destructionPercentage: params.homeDestruction ?? 72.5,
            },
            opponent: {
                side: CLAN_SIDES.opponent,
                clanTag: oppTag,
                clanName: params.opponentName ?? `Соперник ${String(params.roundNumber)}`,
                clanLevel: 14,
                attacksCount: 2,
                stars: params.opponentStars ?? 5,
                destructionPercentage: params.opponentDestruction ?? 64.0,
            },
        },
        attacks,
        {
            home: members,
            opponent: [],
        },
        params.lastObservedAt ?? BASE_NOW - 7 * 60,
    );
}

describe('TelegramBotService /cwl view command and menu integration', () => {
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
        let nextMessageId = 2000;

        const service = new TelegramBotService({
            telegramToken: '123456:TEST_TOKEN',
            attackGuideCatalog: AttackGuideCatalog.fromJson({ guides: [] }),
            clansRepo,
            clanwarRepo,
            clanwarsLeagueRepo: cwlRepo,
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

    it('handles 0 connected clans for /cwl and /start inline button without calling CoC API or getChatMember', async () => {
        const h = createHarness();

        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -1001, chatType: 'supergroup', text: '/cwl' }),
        );
        await h.service.handleUpdate(
            makeCallbackUpdate({ chatId: -1001, chatType: 'supergroup', data: 'view:cwl' }),
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

    it('renders active CWL round with round gap (#43), duplicate nicks, refresh to all-used, back navigation, and topic isolation', async () => {
        const h = createHarness();

        // Even with private war log, /cwl must render normally
        seedClan(h.db, h.clansRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан ЛВК',
            isWarLogPublic: false,
        });
        const cwlSeasonId = h.cwlRepo.saveCompleteCWLData(
            { clanTag: '#2PPLQ', seasonId: '2026-11' },
            [
                {
                    clanTag: '#2PPLQ',
                    seasonId: '2026-11',
                    playerTag: '#P1',
                    playerName: 'Герой',
                    townhallLevel: 16,
                },
                {
                    clanTag: '#2PPLQ',
                    seasonId: '2026-11',
                    playerTag: '#P2',
                    playerName: 'Алекс',
                    townhallLevel: 15,
                },
                {
                    clanTag: '#2PPLQ',
                    seasonId: '2026-11',
                    playerTag: '#P3',
                    playerName: 'Алекс',
                    townhallLevel: 15,
                },
                {
                    clanTag: '#2PPLQ',
                    seasonId: '2026-11',
                    playerTag: '#BENCH',
                    playerName: 'Запасной',
                    townhallLevel: 14,
                },
            ],
        );

        // Round 1 victory, Round 2 skipped (#43), Round 3 draw, Round 4 active inWar
        seedCwlRound(h.clanwarRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан ЛВК',
            cwlSeasonId,
            roundNumber: 1,
            state: 'warEnded',
            homeStars: 38,
            opponentStars: 31,
        });
        seedCwlRound(h.clanwarRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан ЛВК',
            cwlSeasonId,
            roundNumber: 3,
            state: 'warEnded',
            homeStars: 32,
            opponentStars: 32,
            homeDestruction: 80.0,
            opponentDestruction: 80.0,
        });
        seedCwlRound(h.clanwarRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан ЛВК',
            cwlSeasonId,
            roundNumber: 4,
            state: 'inWar',
            homeStars: 3,
            opponentStars: 5,
            attacksUsedCount: 1,
            lastObservedAt: BASE_NOW - 7 * 60,
        });

        h.subscriptionRepo.saveTelegramChat(-100500, 10, 'Topic 10');
        h.subscriptionRepo.subscribeToChat(-100500, 10, '#2PPLQ', {
            preset: 'players',
            timezoneOffsetHours: 3,
        });

        // 1. Text /cwl in Topic 10
        await h.service.handleUpdate(
            makeMessageUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                text: '/cwl',
            }),
        );

        const sent = h.sentMessages();
        expect(sent).toHaveLength(1);
        expect(sent[0]?.message_thread_id).toBe(10);
        const firstText = String(sent[0]?.text);
        expect(firstText).toContain('🏆 <b>ЛВК 2026-11 · раунд 4/7: Клан ЛВК vs Соперник 4</b>');
        expect(firstText).toContain('Ещё не атаковали (2): Алекс (#P2), Алекс (#P3)');
        expect(firstText).not.toContain('Запасной');
        expect(firstText).toContain('✅ Отбились: 1');
        expect(firstText).toContain(
            '📊 Сезон (сыграно 2): победы 1 / поражения 0 / ничьи 1 · ⭐ 70',
        );
        expect(firstText).toContain('🔄 обновлено 7 мин назад');
        expect(getInlineKeyboard(sent[0])).toEqual([
            [{ text: '🔄 Обновить', callback_data: 'view:cwl:#2PPLQ:c' }],
        ]);

        // 2. Forum topic isolation: Topic 20 rejects /cwl #2PPLQ
        await h.service.handleUpdate(
            makeMessageUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 20,
                text: '/cwl #2PPLQ',
            }),
        );
        expect(String(h.sentMessages()[1]?.text)).toBe('Клан #2PPLQ не подключён в этом чате');
        expect(h.sentMessages()[1]?.message_thread_id).toBe(20);

        // 3. Inline menu entry `🏆 ЛВК` (`view:cwl`) -> Refresh + Back
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'view:cwl',
            }),
        );
        expect(getInlineKeyboard(h.editedMessages()[0])).toEqual([
            [
                { text: '🔄 Обновить', callback_data: 'view:cwl:#2PPLQ:m' },
                { text: '⬅️ Назад', callback_data: 'menu:start' },
            ],
        ]);

        // 4. All players finish attacks in SQLite -> click Refresh -> "все атаки использованы"
        h.clock.advance(10 * 60 * 1000);
        seedCwlRound(h.clanwarRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан ЛВК',
            cwlSeasonId,
            roundNumber: 4,
            state: 'inWar',
            homeStars: 9,
            opponentStars: 5,
            attacksUsedCount: 3,
            lastObservedAt: h.clock.nowEpochSeconds() - 2 * 60,
        });

        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'view:cwl:#2PPLQ:m',
            }),
        );
        const refreshedText = String(h.editedMessages()[1]?.text);
        expect(refreshedText).toContain('⭐ 9 : 5');
        expect(refreshedText).toContain('Атаки: 3/3');
        expect(refreshedText).not.toContain('Ещё не атаковали');
        expect(refreshedText).toContain('✅ Отбились: 3 — все атаки использованы');
        expect(refreshedText).toContain('🔄 обновлено 2 мин назад');

        // 5. Clicking Back returns to /start menu with both ⚔️ КВ and 🏆 ЛВК
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

    it('shows clan picker for >1 subscriptions, handles direct /cwl #TAG for preparation and off-season clans, and validates arguments', async () => {
        const h = createHarness();

        seedClan(h.db, h.clansRepo, { clanTag: '#2PPLQ', clanName: 'Клан А' });
        seedClan(h.db, h.clansRepo, {
            clanTag: '#999888',
            clanName: 'Клан Б',
            snapshotAt: BASE_NOW - 90 * 60, // Stale (>1h) off-season clan
        });

        const seasonA = h.cwlRepo.saveCWLSeason({ clanTag: '#2PPLQ', seasonId: '2026-11' });
        seedCwlRound(h.clanwarRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан А',
            cwlSeasonId: seasonA,
            roundNumber: 1,
            state: 'warEnded',
            homeStars: 30,
            opponentStars: 35,
        });
        seedCwlRound(h.clanwarRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан А',
            cwlSeasonId: seasonA,
            roundNumber: 2,
            state: 'preparation',
            lastObservedAt: BASE_NOW - 7 * 60,
        });

        h.subscriptionRepo.saveTelegramChat(-200, 0, 'Multi Chat');
        h.subscriptionRepo.subscribeToChat(-200, 0, '#2PPLQ', 'players');
        h.subscriptionRepo.subscribeToChat(-200, 0, '#999888', 'players');

        // /cwl without argument -> picker in command mode (no Back button)
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/cwl' }),
        );
        expect(String(h.sentMessages()[0]?.text)).toBe('Выберите клан для просмотра (ЛВК):');
        expect(getInlineKeyboard(h.sentMessages()[0])).toEqual([
            [{ text: 'Клан А (#2PPLQ)', callback_data: 'view:cwl:#2PPLQ:c' }],
            [{ text: 'Клан Б (#999888)', callback_data: 'view:cwl:#999888:c' }],
        ]);

        // Direct /cwl #2pplq -> preparation round + season summary
        await h.service.handleUpdate(
            makeMessageUpdate({
                chatId: -200,
                chatType: 'group',
                text: '/cwl@ClashTestBot #2pplq',
            }),
        );
        const prepText = String(h.sentMessages()[1]?.text);
        expect(prepText).toContain('ЛВК 2026-11 · раунд 2/7 (подготовка): Клан А vs Соперник 2');
        expect(prepText).toContain('Бой начнётся через 5 ч 12 мин');
        expect(prepText).toContain(
            '📊 Сезон (сыграно 1): победы 0 / поражения 1 / ничьи 0 · ⭐ 30',
        );
        expect(getInlineKeyboard(h.sentMessages()[1])).toEqual([
            [{ text: '🔄 Обновить', callback_data: 'view:cwl:#2PPLQ:c' }],
        ]);

        // Direct /cwl 999888 -> off-season with >1h stale warning
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/cwl 999888' }),
        );
        const offSeasonText = String(h.sentMessages()[2]?.text);
        expect(offSeasonText).toContain('🏆 <b>ЛВК: Клан Б</b>');
        expect(offSeasonText).toContain('ЛВК сейчас не идёт.');
        expect(offSeasonText).toContain('🔄 обновлено 1 ч 30 мин назад');
        expect(offSeasonText).toContain('⚠️ данные могли устареть — возможен сбой синхронизации');

        // Foreign tag, invalid tag, too many arguments
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/cwl #QQQ222' }),
        );
        expect(String(h.sentMessages()[3]?.text)).toBe('Клан #QQQ222 не подключён в этом чате');

        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/cwl #BAD!' }),
        );
        expect(String(h.sentMessages()[4]?.text)).toContain('Некорректный тег клана');

        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/cwl #2PPLQ extra' }),
        );
        expect(String(h.sentMessages()[5]?.text)).toContain('Использование: /cwl');

        // Menu entry `view:cwl` with >1 clans -> picker with Back button
        await h.service.handleUpdate(
            makeCallbackUpdate({ chatId: -200, chatType: 'group', data: 'view:cwl' }),
        );
        expect(getInlineKeyboard(h.editedMessages()[0])).toEqual([
            [{ text: 'Клан А (#2PPLQ)', callback_data: 'view:cwl:#2PPLQ:m' }],
            [{ text: 'Клан Б (#999888)', callback_data: 'view:cwl:#999888:m' }],
            [{ text: '⬅️ Назад', callback_data: 'menu:start' }],
        ]);

        expect(h.getCompleteClanDataSpy).not.toHaveBeenCalled();
    });

    it('enforces shared per-user rate limit on /cwl and shows alert when refreshing unlinked clan', async () => {
        const h = createHarness({ maxRateLimitRequests: 2 });

        seedClan(h.db, h.clansRepo, { clanTag: '#2PPLQ', clanName: 'Клан' });
        h.subscriptionRepo.saveTelegramChat(-300, 0, 'Rate Limit Chat');
        h.subscriptionRepo.subscribeToChat(-300, 0, '#2PPLQ', 'players');

        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -300, chatType: 'group', userId: 777, text: '/cwl' }),
        );
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -300,
                chatType: 'group',
                userId: 777,
                data: 'view:cwl:#2PPLQ:c',
            }),
        );
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -300,
                chatType: 'group',
                userId: 777,
                data: 'view:cwl:#2PPLQ:c',
            }),
        );

        expect(h.editedMessages()).toHaveLength(1);
        expect(h.answeredCallbacks()[1]).toMatchObject({
            text: COMMAND_RATE_LIMIT_EXCEEDED_TEXT,
            show_alert: true,
        });

        // Different user refreshing an unlinked clan gets alert without overwriting message
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -300,
                chatType: 'group',
                userId: 888,
                data: 'view:cwl:#999888:m',
            }),
        );
        expect(h.editedMessages()).toHaveLength(1);
        expect(h.answeredCallbacks()[2]).toMatchObject({
            text: 'Клан #999888 не подключён в этом чате',
            show_alert: true,
        });
        expect(h.getCompleteClanDataSpy).not.toHaveBeenCalled();
    });
});
