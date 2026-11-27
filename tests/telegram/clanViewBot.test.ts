import path from 'node:path';

import type { ApiResponse, Update, UserFromGetMe } from 'grammy/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeClock } from '../../src/common/clock.js';
import {
    CLAN_SIDES,
    ClansRepo,
    ClanwarRepo,
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
    CLAN_RELIABILITY_FORBIDDEN_TEXT,
    type ClanLookupApiClient,
    COMMAND_RATE_LIMIT_EXCEEDED_TEXT,
    CommandRateLimiter,
    MAX_CALLBACK_DATA_BYTES,
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

function assertAllCallbackDataWithinLimit(
    keyboard: { text: string; callback_data: string }[][],
): void {
    for (const row of keyboard) {
        for (const button of row) {
            expect(Buffer.byteLength(button.callback_data, 'utf8')).toBeLessThanOrEqual(
                MAX_CALLBACK_DATA_BYTES,
            );
        }
    }
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

function seedClanWithRoster(
    db: Database,
    clansRepo: ClansRepo,
    params: {
        clanTag: string;
        clanName: string;
        clanLevel?: number;
        membersCount?: number;
        isWarLogPublic?: boolean;
        warLeagueId?: number;
        snapshotAt?: number;
    },
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
        membersCount: params.membersCount ?? 3,
        clanLevel: params.clanLevel ?? 16,
        clanPoints: 25000,
        clanBuilderBasePoints: 12000,
        clanCapitalPoints: 4000,
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
        warLeagueId: params.warLeagueId ?? 48000014,
    });
    const ts = params.snapshotAt ?? BASE_NOW - 7 * 60;
    db.connection
        .prepare(`UPDATE clan_snapshots SET created_at = ? WHERE clan_tag = ?;`)
        .run(ts, params.clanTag);

    const players = [
        { tag: `${params.clanTag}_P1`, name: 'Лидер', clanTag: params.clanTag },
        { tag: `${params.clanTag}_P2`, name: 'Алекс', clanTag: params.clanTag },
        { tag: `${params.clanTag}_P3`, name: 'Алекс', clanTag: params.clanTag },
    ];
    clansRepo.savePlayers(players);
    clansRepo.saveMembershipChanges({ leftPlayers: [], joinedPlayers: players });
    clansRepo.savePlayerSnapshots([
        {
            playerTag: `${params.clanTag}_P1`,
            clanTag: params.clanTag,
            role: 'leader',
            townHallLevel: 17,
            expLevel: 240,
            clanRank: 1,
            leagueId: 0,
            builderBaseLeagueId: 0,
            trophies: 5500,
            builderBaseTrophies: 3000,
            donations: 1000,
            donationsReceived: 500,
        },
        {
            playerTag: `${params.clanTag}_P2`,
            clanTag: params.clanTag,
            role: 'coLeader',
            townHallLevel: 16,
            expLevel: 220,
            clanRank: 2,
            leagueId: 0,
            builderBaseLeagueId: 0,
            trophies: 5200,
            builderBaseTrophies: 2900,
            donations: 800,
            donationsReceived: 400,
        },
        {
            playerTag: `${params.clanTag}_P3`,
            clanTag: params.clanTag,
            role: 'member',
            townHallLevel: 15,
            expLevel: 190,
            clanRank: 3,
            leagueId: 0,
            builderBaseLeagueId: 0,
            trophies: 4800,
            builderBaseTrophies: 2500,
            donations: 300,
            donationsReceived: 300,
        },
    ]);
    db.connection
        .prepare(`UPDATE player_snapshots SET created_at = ? WHERE clan_tag = ?;`)
        .run(ts, params.clanTag);
}

function seedOneCompletedWar(clanwarRepo: ClanwarRepo, clanTag: string): void {
    clanwarRepo.saveCompleteClanwarData(
        {
            warUID: `${clanTag}_${clanTag}_#OPP_1000`,
            clanTag,
            state: 'warEnded',
            warType: WAR_TYPES.regular,
            teamSize: 2,
            attacksPerMember: 2,
            preparationStartTime: BASE_NOW - 3 * 86_400,
            startTime: BASE_NOW - 2 * 86_400,
            endTime: BASE_NOW - 86_400,
            seasonId: null,
            roundNumber: null,
        },
        {
            home: {
                side: CLAN_SIDES.home,
                clanTag,
                clanName: 'Клан',
                clanLevel: 16,
                attacksCount: 4,
                stars: 6,
                destructionPercentage: 100,
            },
            opponent: {
                side: CLAN_SIDES.opponent,
                clanTag: '#OPP',
                clanName: 'Соперник',
                clanLevel: 15,
                attacksCount: 3,
                stars: 4,
                destructionPercentage: 80,
            },
        },
        [
            {
                attackerTag: `${clanTag}_P1`,
                defenderTag: '#O1',
                attackerClanTag: clanTag,
                defenderClanTag: '#OPP',
                attackerPosition: 1,
                defenderPosition: 1,
                stars: 3,
                destructionPercentage: 100,
                orderNum: 1,
                duration: 80,
            },
            {
                attackerTag: `${clanTag}_P1`,
                defenderTag: '#O2',
                attackerClanTag: clanTag,
                defenderClanTag: '#OPP',
                attackerPosition: 1,
                defenderPosition: 2,
                stars: 3,
                destructionPercentage: 100,
                orderNum: 2,
                duration: 85,
            },
            // #P2 attacks #O1 first instead of mirror #O2
            {
                attackerTag: `${clanTag}_P2`,
                defenderTag: '#O1',
                attackerClanTag: clanTag,
                defenderClanTag: '#OPP',
                attackerPosition: 2,
                defenderPosition: 1,
                stars: 2,
                destructionPercentage: 85,
                orderNum: 3,
                duration: 95,
            },
            {
                attackerTag: `${clanTag}_P2`,
                defenderTag: '#O2',
                attackerClanTag: clanTag,
                defenderClanTag: '#OPP',
                attackerPosition: 2,
                defenderPosition: 2,
                stars: 3,
                destructionPercentage: 100,
                orderNum: 4,
                duration: 100,
            },
        ],
        {
            home: [
                {
                    clanTag,
                    playerTag: `${clanTag}_P1`,
                    playerName: 'Лидер',
                    townhallLevel: 17,
                    mapPosition: 1,
                },
                {
                    clanTag,
                    playerTag: `${clanTag}_P2`,
                    playerName: 'Алекс',
                    townhallLevel: 16,
                    mapPosition: 2,
                },
            ],
            opponent: [
                {
                    clanTag: '#OPP',
                    playerTag: '#O1',
                    playerName: 'Opp1',
                    townhallLevel: 17,
                    mapPosition: 1,
                },
                {
                    clanTag: '#OPP',
                    playerTag: '#O2',
                    playerName: 'Opp2',
                    townhallLevel: 16,
                    mapPosition: 2,
                },
            ],
        },
        BASE_NOW - 86_400 + 300,
    );
}

describe('TelegramBotService /clan command and inline view flow', () => {
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

    it('handles 0 connected clans for both /clan command and /start inline menu without calling CoC API or getChatMember', async () => {
        const h = createHarness();

        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -1001, chatType: 'supergroup', text: '/clan' }),
        );
        await h.service.handleUpdate(
            makeCallbackUpdate({ chatId: -1001, chatType: 'supergroup', data: 'view:clan' }),
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

    it('hides Reliability button and rejects direct reliability callback when discipline category is disabled', async () => {
        const h = createHarness();

        seedClanWithRoster(h.db, h.clansRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан Игроков',
            clanLevel: 18,
            membersCount: 3,
            warLeagueId: 48000015,
        });
        seedOneCompletedWar(h.clanwarRepo, '#2PPLQ');

        // Players preset -> discipline is FALSE
        h.subscriptionRepo.saveTelegramChat(-100500, 10, 'Players Topic');
        h.subscriptionRepo.subscribeToChat(-100500, 10, '#2PPLQ', {
            preset: 'players',
            timezoneOffsetHours: 3,
            mirrorRuleEnabled: false,
        });

        // 1. /clan shows card WITHOUT Reliability button (only Roster + Refresh)
        await h.service.handleUpdate(
            makeMessageUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                text: '/clan',
            }),
        );

        const sent = h.sentMessages();
        expect(sent).toHaveLength(1);
        expect(sent[0]?.message_thread_id).toBe(10);
        const cardText = String(sent[0]?.text);
        expect(cardText).toContain('🛡 <b>Клан Игроков</b> (#2PPLQ)');
        expect(cardText).toContain('Уровень клана: 18');
        expect(cardText).toContain('Лига ЛВК: Лига мастеров I');
        expect(cardText).toContain('Участники: 3/50');
        expect(cardText).toContain('Журнал войн: открыт');
        expect(cardText).toContain('<b>Настройки в этом чате:</b>');
        expect(cardText).toContain('Пресет: Игроки');
        expect(cardText).toContain('Категории: Итоги и сравнения, Напоминания, Кадры');
        expect(cardText).toContain('Часовой пояс: UTC+3');
        expect(cardText).toContain('Первая атака не по зеркалу: выкл');
        expect(cardText).toContain('🔄 обновлено 7 мин назад');

        const cardKb = getInlineKeyboard(sent[0]);
        assertAllCallbackDataWithinLimit(cardKb);
        expect(cardKb).toEqual([
            [{ text: '👥 Состав', callback_data: 'view:clan_roster:#2PPLQ:c' }],
            [{ text: '🔄 Обновить', callback_data: 'view:clan:#2PPLQ:c' }],
        ]);

        // 2. Direct forged callback `view:clan_reliability:#2PPLQ:c` MUST be rejected server-side with alert and NO editMessageText
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'view:clan_reliability:#2PPLQ:c',
            }),
        );
        expect(h.editedMessages()).toHaveLength(0);
        expect(h.answeredCallbacks()).toHaveLength(1);
        expect(h.answeredCallbacks()[0]).toMatchObject({
            text: CLAN_RELIABILITY_FORBIDDEN_TEXT,
            show_alert: true,
        });

        // 3. Roster button `👥 Состав` IS available to everyone, with Refresh + Back to Clan Card
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'view:clan_roster:#2PPLQ:c',
            }),
        );
        expect(h.editedMessages()).toHaveLength(1);
        const rosterText = String(h.editedMessages()[0]?.text);
        expect(rosterText).toContain('👥 <b>Состав: Клан Игроков</b> (3/50)');
        expect(rosterText).toContain('Глава (1): Лидер TH17');
        expect(rosterText).toContain('Соруководители (1): Алекс (#2PPLQ_P2) TH16');
        expect(rosterText).toContain('Участники (1): Алекс (#2PPLQ_P3) TH15');
        const rosterKb = getInlineKeyboard(h.editedMessages()[0]);
        assertAllCallbackDataWithinLimit(rosterKb);
        expect(rosterKb).toEqual([
            [
                { text: '🔄 Обновить', callback_data: 'view:clan_roster:#2PPLQ:c' },
                { text: '⬅️ Назад', callback_data: 'view:clan:#2PPLQ:c' },
            ],
        ]);

        // 4. Back from roster returns to clan card
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'view:clan:#2PPLQ:c',
            }),
        );
        expect(h.editedMessages()).toHaveLength(2);
        expect(String(h.editedMessages()[1]?.text)).toContain('🛡 <b>Клан Игроков</b> (#2PPLQ)');
        expect(getInlineKeyboard(h.editedMessages()[1])).toEqual(cardKb);

        expect(h.getCompleteClanDataSpy).not.toHaveBeenCalled();
        expect(h.calls.some((c) => c.method === 'getChatMember')).toBe(false);
    });

    it('shows Reliability button when discipline is enabled, respects mirror_rule_enabled, supports menu navigation and topic isolation', async () => {
        const h = createHarness();

        seedClanWithRoster(h.db, h.clansRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан Офицеров',
            clanLevel: 20,
            membersCount: 3,
            warLeagueId: 48000018,
        });
        seedOneCompletedWar(h.clanwarRepo, '#2PPLQ');

        // Topic 10: management preset with mirror_rule_enabled = true
        h.subscriptionRepo.saveTelegramChat(-100500, 10, 'Officers Topic');
        h.subscriptionRepo.subscribeToChat(-100500, 10, '#2PPLQ', {
            preset: 'management',
            mirrorRuleEnabled: true,
            timezoneOffsetHours: 5,
        });

        // Topic 20: same chat, different topic -> players preset (discipline = false)
        h.subscriptionRepo.saveTelegramChat(-100500, 20, 'General Topic');
        h.subscriptionRepo.subscribeToChat(-100500, 20, '#2PPLQ', {
            preset: 'players',
            mirrorRuleEnabled: false,
            timezoneOffsetHours: 3,
        });

        // 1. Open from /start menu (`view:clan`) in Topic 10 -> shows Reliability button + Back to menu
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'view:clan',
            }),
        );
        const cardKb = getInlineKeyboard(h.editedMessages()[0]);
        assertAllCallbackDataWithinLimit(cardKb);
        expect(cardKb).toEqual([
            [{ text: '👥 Состав', callback_data: 'view:clan_roster:#2PPLQ:m' }],
            [{ text: '📊 Надёжность состава', callback_data: 'view:clan_reliability:#2PPLQ:m' }],
            [
                { text: '🔄 Обновить', callback_data: 'view:clan:#2PPLQ:m' },
                { text: '⬅️ Назад', callback_data: 'menu:start' },
            ],
        ]);

        // 2. Click `📊 Надёжность состава` in Topic 10 -> mirrorRuleEnabled = true puts #P2 in "ТРЕБУЮТ ВНИМАНИЯ"
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'view:clan_reliability:#2PPLQ:m',
            }),
        );
        const relMirrorOnText = String(h.editedMessages()[1]?.text);
        expect(relMirrorOnText).toContain('📋 <b>НАДЁЖНОСТЬ СОСТАВА</b>');
        expect(relMirrorOnText).toContain('⚠️ <b>ТРЕБУЮТ ВНИМАНИЯ</b>');
        expect(relMirrorOnText).toContain('не по зеркалу 1');
        expect(relMirrorOnText).toContain('🔄 обновлено 7 мин назад');
        expect(getInlineKeyboard(h.editedMessages()[1])).toEqual([
            [
                { text: '🔄 Обновить', callback_data: 'view:clan_reliability:#2PPLQ:m' },
                { text: '⬅️ Назад', callback_data: 'view:clan:#2PPLQ:m' },
            ],
        ]);

        // 3. Disable mirror rule in SQLite and click Refresh -> #P2 moves to "СТАБИЛЬНЫЕ"
        h.subscriptionRepo.updateSubscriptionMirrorRule(-100500, 10, '#2PPLQ', false);
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'view:clan_reliability:#2PPLQ:m',
            }),
        );
        const relMirrorOffText = String(h.editedMessages()[2]?.text);
        expect(relMirrorOffText).toContain('✅ Стабильные: 2');
        expect(relMirrorOffText).not.toContain('ТРЕБУЮТ ВНИМАНИЯ');
        expect(relMirrorOffText).not.toContain('не по зеркалу');

        // 4. Topic isolation: Topic 20 cannot call reliability callback (discipline = false there)
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 20,
                data: 'view:clan_reliability:#2PPLQ:m',
            }),
        );
        expect(h.editedMessages()).toHaveLength(3);
        expect(h.answeredCallbacks()[3]).toMatchObject({
            text: CLAN_RELIABILITY_FORBIDDEN_TEXT,
            show_alert: true,
        });

        // 5. Topic 30 (no subscription at all) rejects `/clan #2PPLQ`
        await h.service.handleUpdate(
            makeMessageUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 30,
                text: '/clan #2PPLQ',
            }),
        );
        expect(String(h.sentMessages()[0]?.text)).toBe('Клан #2PPLQ не подключён в этом чате');
        expect(h.sentMessages()[0]?.message_thread_id).toBe(30);

        // 6. Clicking Back from reliability -> clan card -> menu:start shows all 4 view buttons
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'menu:start',
            }),
        );
        expect(getInlineKeyboard(h.editedMessages()[3])[0]).toEqual([
            { text: '⚔️ КВ', callback_data: 'view:war' },
            { text: '🏆 ЛВК', callback_data: 'view:cwl' },
            { text: '🏰 Рейд', callback_data: 'view:raid' },
            { text: '🛡 Клан', callback_data: 'view:clan' },
        ]);

        expect(h.getCompleteClanDataSpy).not.toHaveBeenCalled();
        expect(h.calls.some((c) => c.method === 'getChatMember')).toBe(false);
    });

    it('shows clan picker for >1 clans, supports /clan #TAG, /help mentions /clan, and validates arguments', async () => {
        const h = createHarness();

        seedClanWithRoster(h.db, h.clansRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан А',
            isWarLogPublic: true,
        });
        seedClanWithRoster(h.db, h.clansRepo, {
            clanTag: '#PYLQGRJCUV0289P',
            clanName: 'Клан Б',
            isWarLogPublic: false,
        });

        h.subscriptionRepo.saveTelegramChat(-200, 0, 'Multi Chat');
        h.subscriptionRepo.subscribeToChat(-200, 0, '#2PPLQ', 'players');
        h.subscriptionRepo.subscribeToChat(-200, 0, '#PYLQGRJCUV0289P', 'all');

        // /clan without arg -> picker
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/clan' }),
        );
        expect(String(h.sentMessages()[0]?.text)).toContain('Выберите клан для просмотра (Клан):');
        const pickerKb = getInlineKeyboard(h.sentMessages()[0]);
        assertAllCallbackDataWithinLimit(pickerKb);
        expect(pickerKb).toEqual([
            [{ text: 'Клан А (#2PPLQ)', callback_data: 'view:clan:#2PPLQ:c' }],
            [{ text: 'Клан Б (#PYLQGRJCUV0289P)', callback_data: 'view:clan:#PYLQGRJCUV0289P:c' }],
        ]);

        // Direct /clan with max-length tag (lowercase, no #) -> card with private war log warning + Reliability button (preset 'all')
        await h.service.handleUpdate(
            makeMessageUpdate({
                chatId: -200,
                chatType: 'group',
                text: '/clan@ClashTestBot pylqgrjcuv0289p',
            }),
        );
        const clanBText = String(h.sentMessages()[1]?.text);
        expect(clanBText).toContain('🛡 <b>Клан Б</b> (#PYLQGRJCUV0289P)');
        expect(clanBText).toContain('Журнал войн: закрыт');
        expect(clanBText).toContain('Журнал войн клана закрыт');
        expect(clanBText).toContain('Пресет: Всё вместе');
        const clanBKb = getInlineKeyboard(h.sentMessages()[1]);
        assertAllCallbackDataWithinLimit(clanBKb);
        expect(clanBKb).toEqual([
            [{ text: '👥 Состав', callback_data: 'view:clan_roster:#PYLQGRJCUV0289P:c' }],
            [
                {
                    text: '📊 Надёжность состава',
                    callback_data: 'view:clan_reliability:#PYLQGRJCUV0289P:c',
                },
            ],
            [{ text: '🔄 Обновить', callback_data: 'view:clan:#PYLQGRJCUV0289P:c' }],
        ]);

        // Foreign tag, invalid tag, extra args
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/clan #QQQ222' }),
        );
        expect(String(h.sentMessages()[2]?.text)).toBe('Клан #QQQ222 не подключён в этом чате');

        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/clan #BAD!' }),
        );
        expect(String(h.sentMessages()[3]?.text)).toContain('Некорректный тег клана');

        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/clan #2PPLQ extra' }),
        );
        expect(String(h.sentMessages()[4]?.text)).toContain('Использование: /clan');

        // /help lists /clan
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/help' }),
        );
        const helpText = String(h.sentMessages()[5]?.text);
        expect(helpText).toContain('/clan [#ТЕГ_КЛАНА]');
        expect(helpText).toContain('(/war, /cwl, /raid, /clan)');

        // Menu picker has Back button
        await h.service.handleUpdate(
            makeCallbackUpdate({ chatId: -200, chatType: 'group', data: 'view:clan' }),
        );
        expect(getInlineKeyboard(h.editedMessages()[0])).toEqual([
            [{ text: 'Клан А (#2PPLQ)', callback_data: 'view:clan:#2PPLQ:m' }],
            [{ text: 'Клан Б (#PYLQGRJCUV0289P)', callback_data: 'view:clan:#PYLQGRJCUV0289P:m' }],
            [{ text: '⬅️ Назад', callback_data: 'menu:start' }],
        ]);

        expect(h.getCompleteClanDataSpy).not.toHaveBeenCalled();
    });

    it('enforces shared per-user rate limit across /clan and clan sub-screen callbacks', async () => {
        const h = createHarness({ maxRateLimitRequests: 2 });

        seedClanWithRoster(h.db, h.clansRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            snapshotAt: BASE_NOW - 75 * 60,
        });
        h.subscriptionRepo.saveTelegramChat(-300, 0, 'Rate Limit Chat');
        h.subscriptionRepo.subscribeToChat(-300, 0, '#2PPLQ', 'management');

        // 1. /clan allowed -> stale warning (>1h)
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -300, chatType: 'group', userId: 777, text: '/clan' }),
        );
        expect(String(h.sentMessages()[0]?.text)).toContain(
            '⚠️ данные могли устареть — возможен сбой синхронизации',
        );

        // 2. Roster callback allowed
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -300,
                chatType: 'group',
                userId: 777,
                data: 'view:clan_roster:#2PPLQ:c',
            }),
        );
        expect(h.editedMessages()).toHaveLength(1);

        // 3. Third request blocked by rate limit (alert, no edit)
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -300,
                chatType: 'group',
                userId: 777,
                data: 'view:clan_reliability:#2PPLQ:c',
            }),
        );
        expect(h.editedMessages()).toHaveLength(1);
        expect(h.answeredCallbacks()[1]).toMatchObject({
            text: COMMAND_RATE_LIMIT_EXCEEDED_TEXT,
            show_alert: true,
        });

        expect(h.getCompleteClanDataSpy).not.toHaveBeenCalled();
    });
});
