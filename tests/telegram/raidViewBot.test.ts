import path from 'node:path';

import type { ApiResponse, Update, UserFromGetMe } from 'grammy/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeClock } from '../../src/common/clock.js';
import {
    ClansRepo,
    Database,
    DomainEventsRepo,
    MigratorManager,
    NotificationRepo,
    RaidRepo,
    SubscriptionRepo,
    TransactionManager,
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
const RAID_START_TIME = Date.UTC(2026, 10, 13, 4, 0, 0) / 1000;
const RAID_END_TIME = Date.UTC(2026, 10, 16, 4, 0, 0) / 1000;

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

function insertMembership(
    db: Database,
    clanTag: string,
    playerTag: string,
    joinedAt: number,
    leftAt: number | null = null,
): void {
    db.connection
        .prepare(
            'INSERT INTO clan_memberships (clan_tag, player_tag, joined_at, left_at) VALUES (?, ?, ?, ?)',
        )
        .run(clanTag, playerTag, joinedAt, leftAt);
}

describe('TelegramBotService /raid command and inline view flow', () => {
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
        const raidRepo = new RaidRepo(db);
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
            raidRepo,
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
            raidRepo,
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

    it('handles 0 connected clans for both /raid command and /start inline menu without calling CoC API or getChatMember', async () => {
        const h = createHarness();

        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -1001, chatType: 'supergroup', text: '/raid' }),
        );
        await h.service.handleUpdate(
            makeCallbackUpdate({ chatId: -1001, chatType: 'supergroup', data: 'view:raid' }),
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

    it('renders active raid with bonus attack (5/6), duplicate nicknames, cohort filter, refresh, back, and topic isolation', async () => {
        const h = createHarness();

        seedClan(h.db, h.clansRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан Один',
            isWarLogPublic: false, // private war log must not block /raid
        });
        h.clansRepo.savePlayers([
            { tag: '#P1', name: 'Герой', clanTag: '#2PPLQ' },
            { tag: '#P2', name: 'Алекс', clanTag: '#2PPLQ' },
            { tag: '#P3', name: 'Алекс', clanTag: '#2PPLQ' },
            { tag: '#P4', name: 'Бонусник', clanTag: '#2PPLQ' },
            { tag: '#LATE', name: 'Поздний', clanTag: '#2PPLQ' },
        ]);
        insertMembership(h.db, '#2PPLQ', '#P1', RAID_START_TIME - 3600, null);
        insertMembership(h.db, '#2PPLQ', '#P2', RAID_START_TIME - 3600, null);
        insertMembership(h.db, '#2PPLQ', '#P3', RAID_START_TIME - 3600, null);
        insertMembership(h.db, '#2PPLQ', '#P4', RAID_START_TIME, null);
        insertMembership(h.db, '#2PPLQ', '#LATE', RAID_START_TIME + 60, null);

        h.raidRepo.saveCompleteRaidData(
            {
                clanTag: '#2PPLQ',
                startTime: RAID_START_TIME,
                endTime: RAID_END_TIME,
                state: 'ongoing',
                totalLoot: 88_500,
                raidsCompleted: 6,
                totalAttacks: 14,
                enemyDistrictsDestroyed: 21,
                offensiveReward: 900,
                defensiveReward: 200,
            },
            [
                { playerTag: '#P1', attacksCount: 6, bonusAttack: 1, totalLoot: 30_000 },
                { playerTag: '#P2', attacksCount: 3, bonusAttack: 1, totalLoot: 18_000 },
                { playerTag: '#P4', attacksCount: 5, bonusAttack: 1, totalLoot: 24_500 },
                { playerTag: '#LATE', attacksCount: 0, bonusAttack: 0, totalLoot: 0 },
            ],
            BASE_NOW - 7 * 60,
        );

        h.subscriptionRepo.saveTelegramChat(-100500, 10, 'Topic 10');
        h.subscriptionRepo.subscribeToChat(-100500, 10, '#2PPLQ', {
            preset: 'players',
            timezoneOffsetHours: 3,
        });

        // 1. Text /raid in Topic 10 -> new message with Refresh only
        await h.service.handleUpdate(
            makeMessageUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                text: '/raid',
            }),
        );

        const sent = h.sentMessages();
        expect(sent).toHaveLength(1);
        expect(sent[0]?.message_thread_id).toBe(10);
        const firstText = String(sent[0]?.text);
        expect(firstText).toContain('🏰 <b>Рейд: Клан Один</b>');
        expect(firstText).toContain('💰 88 500 золота · 🏘 Разрушено районов: 21');
        expect(firstText).toContain('⏳ осталось 1 д 15 ч 12 мин (до 16.11.2026 07:00 UTC+3)');
        expect(firstText).toContain('Атаки: 14/23');
        expect(firstText).toContain('Без атак (1): Алекс (#P3)');
        expect(firstText).toContain('Не все атаки (2): Алекс (#P2) 3/6, Бонусник 5/6');
        expect(firstText).toContain('✅ Отбились: 1');
        expect(firstText).not.toContain('Поздний');
        expect(firstText).toContain('🔄 обновлено 7 мин назад');
        expect(getInlineKeyboard(sent[0])).toEqual([
            [{ text: '🔄 Обновить', callback_data: 'view:raid:#2PPLQ:c' }],
        ]);

        // 2. Forum topic isolation: Topic 20 rejects /raid #2PPLQ
        await h.service.handleUpdate(
            makeMessageUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 20,
                text: '/raid #2PPLQ',
            }),
        );
        expect(String(h.sentMessages()[1]?.text)).toBe('Клан #2PPLQ не подключён в этом чате');
        expect(h.sentMessages()[1]?.message_thread_id).toBe(20);

        // 3. Inline menu entry `🏰 Рейд` -> edits message with Refresh + Back
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'view:raid',
            }),
        );
        expect(getInlineKeyboard(h.editedMessages()[0])).toEqual([
            [
                { text: '🔄 Обновить', callback_data: 'view:raid:#2PPLQ:m' },
                { text: '⬅️ Назад', callback_data: 'menu:start' },
            ],
        ]);

        // 4. Advance SQLite raid state (all finish attacks) + clock and click Refresh -> updates in place
        h.clock.advance(10 * 60 * 1000);
        h.raidRepo.saveCompleteRaidData(
            {
                clanTag: '#2PPLQ',
                startTime: RAID_START_TIME,
                endTime: RAID_END_TIME,
                state: 'ongoing',
                totalLoot: 130_000,
                raidsCompleted: 9,
                totalAttacks: 23,
                enemyDistrictsDestroyed: 35,
                offensiveReward: 1100,
                defensiveReward: 250,
            },
            [
                { playerTag: '#P1', attacksCount: 6, bonusAttack: 1, totalLoot: 30_000 },
                { playerTag: '#P2', attacksCount: 6, bonusAttack: 1, totalLoot: 32_000 },
                { playerTag: '#P3', attacksCount: 5, bonusAttack: 0, totalLoot: 28_000 },
                { playerTag: '#P4', attacksCount: 6, bonusAttack: 1, totalLoot: 40_000 },
            ],
            h.clock.nowEpochSeconds() - 2 * 60,
        );

        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -100500,
                chatType: 'supergroup',
                messageThreadId: 10,
                data: 'view:raid:#2PPLQ:m',
            }),
        );
        const refreshedText = String(h.editedMessages()[1]?.text);
        expect(refreshedText).toContain('💰 130 000 золота · 🏘 Разрушено районов: 35');
        expect(refreshedText).toContain('Атаки: 23/23');
        expect(refreshedText).toContain('✅ Отбились: 4 — все атаки использованы');
        expect(refreshedText).not.toContain('Без атак');
        expect(refreshedText).not.toContain('Не все атаки');
        expect(refreshedText).toContain('🔄 обновлено 2 мин назад');

        // 5. Clicking Back returns to /start menu with both ⚔️ КВ and 🏰 Рейд
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
            { text: '🛡 Клан', callback_data: 'view:clan' },
        ]);

        expect(h.getCompleteClanDataSpy).not.toHaveBeenCalled();
        expect(h.calls.some((c) => c.method === 'getChatMember')).toBe(false);
    });

    it('shows clan picker for >1 clans, handles /raid #TAG (with/without past raid), and validates arguments', async () => {
        const h = createHarness();

        seedClan(h.db, h.clansRepo, { clanTag: '#2PPLQ', clanName: 'Клан А' });
        seedClan(h.db, h.clansRepo, { clanTag: '#999888', clanName: 'Клан Б' });

        // Completed raid only for #2PPLQ; #999888 has no raid history
        h.raidRepo.saveCompleteRaidData(
            {
                clanTag: '#2PPLQ',
                startTime: Date.UTC(2026, 10, 6, 4, 0, 0) / 1000,
                endTime: Date.UTC(2026, 10, 9, 4, 0, 0) / 1000,
                state: 'ended',
                totalLoot: 112_000,
                raidsCompleted: 7,
                totalAttacks: 150,
                enemyDistrictsDestroyed: 31,
                offensiveReward: 1100,
                defensiveReward: 250,
            },
            [],
            Date.UTC(2026, 10, 9, 4, 5, 0) / 1000,
        );

        h.subscriptionRepo.saveTelegramChat(-200, 0, 'Multi Chat');
        h.subscriptionRepo.subscribeToChat(-200, 0, '#2PPLQ', 'players');
        h.subscriptionRepo.subscribeToChat(-200, 0, '#999888', 'players');

        // /raid without argument -> picker in command mode (no Back button)
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/raid' }),
        );
        expect(String(h.sentMessages()[0]?.text)).toContain('Выберите клан для просмотра (Рейд):');
        expect(getInlineKeyboard(h.sentMessages()[0])).toEqual([
            [{ text: 'Клан А (#2PPLQ)', callback_data: 'view:raid:#2PPLQ:c' }],
            [{ text: 'Клан Б (#999888)', callback_data: 'view:raid:#999888:c' }],
        ]);

        // Direct /raid 2pplq -> no active raid + past raid summary
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/raid 2pplq' }),
        );
        const clanAText = String(h.sentMessages()[1]?.text);
        expect(clanAText).toContain('Рейдовый уикенд не идёт.');
        expect(clanAText).toContain(
            'Прошлый рейд: 💰 112 000 золота · 🏘 Разрушено районов: 31 · 09.11.2026',
        );
        expect(getInlineKeyboard(h.sentMessages()[1])).toEqual([
            [{ text: '🔄 Обновить', callback_data: 'view:raid:#2PPLQ:c' }],
        ]);

        // Direct /raid@ClashTestBot #999888 -> no active raid and no past history
        await h.service.handleUpdate(
            makeMessageUpdate({
                chatId: -200,
                chatType: 'group',
                text: '/raid@ClashTestBot #999888',
            }),
        );
        const clanBText = String(h.sentMessages()[2]?.text);
        expect(clanBText).toContain('Рейдовый уикенд не идёт.');
        expect(clanBText).not.toContain('Прошлый рейд:');

        // Foreign tag, invalid tag, too many args
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/raid #QQQ222' }),
        );
        expect(String(h.sentMessages()[3]?.text)).toBe('Клан #QQQ222 не подключён в этом чате');

        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/raid #BAD!' }),
        );
        expect(String(h.sentMessages()[4]?.text)).toContain('Некорректный тег клана');

        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -200, chatType: 'group', text: '/raid #2PPLQ extra' }),
        );
        expect(String(h.sentMessages()[5]?.text)).toContain('Использование: /raid');

        // Menu entry `view:raid` with >1 clans -> picker with Back button
        await h.service.handleUpdate(
            makeCallbackUpdate({ chatId: -200, chatType: 'group', data: 'view:raid' }),
        );
        expect(getInlineKeyboard(h.editedMessages()[0])).toEqual([
            [{ text: 'Клан А (#2PPLQ)', callback_data: 'view:raid:#2PPLQ:m' }],
            [{ text: 'Клан Б (#999888)', callback_data: 'view:raid:#999888:m' }],
            [{ text: '⬅️ Назад', callback_data: 'menu:start' }],
        ]);

        expect(h.getCompleteClanDataSpy).not.toHaveBeenCalled();
    });

    it('enforces shared per-user rate limit and stale data warning (>1h) end-to-end via /raid', async () => {
        const h = createHarness({ maxRateLimitRequests: 2 });

        seedClan(h.db, h.clansRepo, {
            clanTag: '#2PPLQ',
            clanName: 'Клан',
            snapshotAt: BASE_NOW - 75 * 60,
        });
        h.subscriptionRepo.saveTelegramChat(-300, 0, 'Rate Limit Chat');
        h.subscriptionRepo.subscribeToChat(-300, 0, '#2PPLQ', 'players');

        // 1. Allowed -> shows stale warning (>1h)
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -300, chatType: 'group', userId: 777, text: '/raid' }),
        );
        const firstText = String(h.sentMessages()[0]?.text);
        expect(firstText).toContain('Рейдовый уикенд не идёт.');
        expect(firstText).toContain('🔄 обновлено 1 ч 15 мин назад');
        expect(firstText).toContain('⚠️ данные могли устареть — возможен сбой синхронизации');

        // 2. Allowed callback refresh
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -300,
                chatType: 'group',
                userId: 777,
                data: 'view:raid:#2PPLQ:c',
            }),
        );

        // 3. Blocked command
        await h.service.handleUpdate(
            makeMessageUpdate({ chatId: -300, chatType: 'group', userId: 777, text: '/raid' }),
        );
        expect(String(h.sentMessages()[1]?.text)).toBe(COMMAND_RATE_LIMIT_EXCEEDED_TEXT);

        // 4. Blocked callback (personal alert, no editMessageText)
        await h.service.handleUpdate(
            makeCallbackUpdate({
                chatId: -300,
                chatType: 'group',
                userId: 777,
                data: 'view:raid:#2PPLQ:c',
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
