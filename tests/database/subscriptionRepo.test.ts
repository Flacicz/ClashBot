import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseError, ValidationError } from '../../src/common/errors.js';
import {
    Database,
    MigratorManager,
    SubscriptionRepo,
    TransactionManager,
} from '../../src/database/index.js';
import {
    SUBSCRIPTION_PRESETS,
    SUBSCRIPTION_PRESET_CATEGORIES,
    resolvePresetForCategories,
} from '../../src/models/subscription.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');

function createMigratedDb(): Database {
    const db = new Database(':memory:');
    const txManager = new TransactionManager(db);
    const migrator = new MigratorManager(db, txManager);
    migrator.migrate(REAL_MIGRATIONS_PATH);
    return db;
}

function seedClan(db: Database, clanTag: string, name = 'Test Clan'): void {
    db.connection
        .prepare('INSERT INTO clans (tag, name, tracking_enabled) VALUES (?, ?, 1);')
        .run(clanTag, name);
}

function getTrackingEnabled(db: Database, clanTag: string): number | null {
    const row = db.connection
        .prepare<[string], { tracking_enabled: number }>(
            'SELECT tracking_enabled FROM clans WHERE tag = ?;',
        )
        .get(clanTag);
    return row?.tracking_enabled ?? null;
}

function telegramChatExists(db: Database, chatId: number, messageThreadId: number): boolean {
    const row = db.connection
        .prepare<[number, number], { found: number }>(
            'SELECT 1 AS found FROM telegram_chats WHERE chat_id = ? AND message_thread_id = ?;',
        )
        .get(chatId, messageThreadId);
    return row !== undefined;
}

describe('SubscriptionRepo', () => {
    const openDatabases: Database[] = [];

    function setup(): { db: Database; repo: SubscriptionRepo } {
        const db = createMigratedDb();
        openDatabases.push(db);
        return { db, repo: new SubscriptionRepo(db) };
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('saves, updates and deletes Telegram destinations including forum topics', () => {
        const { db, repo } = setup();

        repo.saveTelegramChat(-100123456, 0, 'General Chat');
        repo.saveTelegramChat(-100123456, 42, 'War Topic');
        repo.saveTelegramChat(-100123456, 0, 'Updated General Chat');

        expect(telegramChatExists(db, -100123456, 0)).toBe(true);
        expect(telegramChatExists(db, -100123456, 42)).toBe(true);

        const titleRow = db.connection
            .prepare<[number, number], { title: string }>(
                'SELECT title FROM telegram_chats WHERE chat_id = ? AND message_thread_id = ?;',
            )
            .get(-100123456, 0);
        expect(titleRow?.title).toBe('Updated General Chat');

        repo.deleteTelegramChat(-100123456, 42);
        expect(telegramChatExists(db, -100123456, 42)).toBe(false);
        expect(telegramChatExists(db, -100123456, 0)).toBe(true);
    });

    it('manages subscriptions by preset, categories, thread and clan with idempotent subscribeToChat', () => {
        const { db, repo } = setup();
        seedClan(db, '#CLAN1');
        seedClan(db, '#CLAN2');

        repo.saveTelegramChat(-1001, 0, 'Group General');
        repo.saveTelegramChat(-1001, 77, 'Group Topic');
        repo.saveTelegramChat(555, 0, 'Leader PM');
        repo.saveTelegramChat(-1009, 0, 'All-in-one Group');

        repo.subscribeToChat(-1001, 0, '#CLAN1', SUBSCRIPTION_PRESETS.players);
        const firstSubId = repo.getSubscriptionId(-1001, 0, '#CLAN1');
        expect(firstSubId).not.toBeNull();

        // Repeated subscribeToChat is idempotent and preserves subscription_id and existing categories.
        repo.subscribeToChat(-1001, 0, '#CLAN1', SUBSCRIPTION_PRESETS.management);
        expect(repo.getSubscriptionId(-1001, 0, '#CLAN1')).toBe(firstSubId);
        expect(repo.getSubscription(-1001, 0, '#CLAN1')).toEqual({
            subscriptionId: firstSubId,
            clanTag: '#CLAN1',
            chatId: -1001,
            messageThreadId: 0,
            categories: SUBSCRIPTION_PRESET_CATEGORIES.players,
            mirrorRuleEnabled: false,
            timezoneOffsetHours: 3,
        });

        repo.subscribeToChat(-1001, 77, '#CLAN1', SUBSCRIPTION_PRESETS.players);
        repo.subscribeToChat(555, 0, '#CLAN1', SUBSCRIPTION_PRESETS.management);
        repo.subscribeToChat(-1009, 0, '#CLAN1', SUBSCRIPTION_PRESETS.all);
        repo.subscribeToChat(-1001, 0, '#CLAN2', SUBSCRIPTION_PRESETS.players);

        expect(repo.hasSubscription(-1001, 0, '#CLAN1')).toBe(true);
        expect(repo.hasSubscription(-1001, 0, '#UNKNOWN')).toBe(false);
        expect(repo.hasSubscriptionsForChat(-1001, 0)).toBe(true);
        expect(repo.hasSubscriptionsForChat(99999, 0)).toBe(false);
        expect(repo.hasSubscriptionsForClan('#CLAN1')).toBe(true);
        expect(repo.hasSubscriptionsForClan('#UNKNOWN')).toBe(false);

        expect(repo.getDestinationsForClan('#CLAN1', 'summaries')).toEqual([
            { chatId: -1001, messageThreadId: 0 },
            { chatId: -1001, messageThreadId: 77 },
            { chatId: -1009, messageThreadId: 0 },
        ]);
        expect(repo.getDestinationsForClan('#CLAN1', 'discipline')).toEqual([
            { chatId: 555, messageThreadId: 0 },
            { chatId: -1009, messageThreadId: 0 },
        ]);
        expect(repo.getDestinationsForClan('#CLAN1', 'system')).toEqual([
            { chatId: 555, messageThreadId: 0 },
            { chatId: -1009, messageThreadId: 0 },
        ]);

        const subDestinations = repo.getSubscriptionDestinationsForClan('#CLAN1', 'roster');
        expect(subDestinations).toHaveLength(3);
        expect(subDestinations[0]).toEqual({
            subscriptionId: firstSubId,
            chatId: -1001,
            messageThreadId: 0,
        });

        expect(repo.getClanTagsForChat(-1001, 0)).toEqual(['#CLAN1', '#CLAN2']);
        expect(repo.getClanTagsForChat(555, 0)).toEqual(['#CLAN1']);
        expect(repo.getSubscriptionById(firstSubId ?? -1)?.clanTag).toBe('#CLAN1');
        expect(repo.getSubscriptionById(999_999)).toBeNull();
    });

    it('enforces non-empty categories invariant and timezone bounds on create and update', () => {
        const { db, repo } = setup();
        seedClan(db, '#CLAN1');
        repo.saveTelegramChat(-1001, 0, 'Group');

        const emptyCategories = {
            summaries: false,
            reminders: false,
            roster: false,
            discipline: false,
            system: false,
        };

        expect(() => {
            repo.subscribeToChat(-1001, 0, '#CLAN1', { categories: emptyCategories });
        }).toThrow(ValidationError);

        expect(() => {
            repo.subscribeToChat(-1001, 0, '#CLAN1', {
                preset: SUBSCRIPTION_PRESETS.players,
                timezoneOffsetHours: -13,
            });
        }).toThrow(ValidationError);

        expect(() => {
            repo.subscribeToChat(-1001, 0, '#CLAN1', {
                preset: SUBSCRIPTION_PRESETS.players,
                timezoneOffsetHours: 15,
            });
        }).toThrow(ValidationError);

        expect(() => {
            repo.subscribeToChat(-1001, 0, '#CLAN1', {
                preset: SUBSCRIPTION_PRESETS.players,
                timezoneOffsetHours: 3.5,
            });
        }).toThrow(ValidationError);

        // Create valid subscription and update settings
        repo.subscribeToChat(-1001, 0, '#CLAN1', SUBSCRIPTION_PRESETS.players);

        expect(() => {
            repo.updateSubscriptionCategories(-1001, 0, '#CLAN1', emptyCategories);
        }).toThrow(ValidationError);

        const customCategories = {
            summaries: true,
            reminders: false,
            roster: false,
            discipline: true,
            system: false,
        };
        expect(resolvePresetForCategories(customCategories)).toBeNull();
        expect(repo.updateSubscriptionCategories(-1001, 0, '#CLAN1', customCategories)).toBe(true);
        expect(repo.updateSubscriptionMirrorRule(-1001, 0, '#CLAN1', true)).toBe(true);
        expect(repo.updateSubscriptionTimezone(-1001, 0, '#CLAN1', -12)).toBe(true);
        expect(repo.updateSubscriptionTimezone(-1001, 0, '#CLAN1', 14)).toBe(true);

        expect(() => {
            repo.updateSubscriptionTimezone(-1001, 0, '#CLAN1', 15);
        }).toThrow(ValidationError);

        expect(repo.getSubscription(-1001, 0, '#CLAN1')).toMatchObject({
            categories: customCategories,
            mirrorRuleEnabled: true,
            timezoneOffsetHours: 14,
        });

        // Schema-level CHECK constraint also rejects 0 enabled categories directly in SQLite
        expect(() => {
            db.connection
                .prepare(
                    `UPDATE clan_subscriptions
                     SET notify_summaries = 0, notify_reminders = 0, notify_roster = 0, notify_discipline = 0, notify_system = 0
                     WHERE chat_id = -1001;`,
                )
                .run();
        }).toThrow();
    });

    it('creates a new subscription_id generation on re-subscribe after unsubscribe', () => {
        const { db, repo } = setup();
        seedClan(db, '#CLAN1');
        repo.saveTelegramChat(100, 0, 'Private Chat');

        repo.subscribeToChat(100, 0, '#CLAN1', SUBSCRIPTION_PRESETS.management);
        const gen1 = repo.getSubscriptionId(100, 0, '#CLAN1');
        expect(gen1).not.toBeNull();

        expect(repo.unsubscribeFromChat(100, 0, '#CLAN1')).toBe(true);
        expect(repo.getSubscriptionId(100, 0, '#CLAN1')).toBeNull();

        // Re-link requires recreating the destination since last subscription removed it.
        repo.saveTelegramChat(100, 0, 'Private Chat');
        repo.subscribeToChat(100, 0, '#CLAN1', SUBSCRIPTION_PRESETS.management);
        const gen2 = repo.getSubscriptionId(100, 0, '#CLAN1');

        expect(gen2).not.toBeNull();
        expect(gen2).toBeGreaterThan(gen1 ?? 0);
    });

    it('deletes destination only on its last subscription and disables clan tracking without losing history on clan last subscription', () => {
        const { db, repo } = setup();
        seedClan(db, '#CLAN1');
        seedClan(db, '#CLAN2');
        db.connection
            .prepare('INSERT INTO players (tag, name, clan_tag) VALUES (?, ?, ?);')
            .run('#P1', 'Alice', '#CLAN1');

        repo.saveTelegramChat(-200, 0, 'Shared Group');
        repo.saveTelegramChat(300, 0, 'Leader PM');

        repo.subscribeToChat(-200, 0, '#CLAN1', SUBSCRIPTION_PRESETS.players);
        repo.subscribeToChat(-200, 0, '#CLAN2', SUBSCRIPTION_PRESETS.players);
        repo.subscribeToChat(300, 0, '#CLAN1', SUBSCRIPTION_PRESETS.management);

        // Unsubscribing #CLAN1 from -200 leaves -200 with #CLAN2 and #CLAN1 with 300.
        expect(repo.unsubscribeFromChat(-200, 0, '#CLAN1')).toBe(true);
        expect(telegramChatExists(db, -200, 0)).toBe(true);
        expect(getTrackingEnabled(db, '#CLAN1')).toBe(1);

        // Unsubscribing #CLAN1 from 300 is the last subscription for BOTH 300 and #CLAN1.
        expect(repo.unsubscribeFromChat(300, 0, '#CLAN1')).toBe(true);
        expect(telegramChatExists(db, 300, 0)).toBe(false);
        expect(getTrackingEnabled(db, '#CLAN1')).toBe(0);

        // Clan and player history remain intact.
        const player = db.connection
            .prepare<[string], { name: string; clan_tag: string }>(
                'SELECT name, clan_tag FROM players WHERE tag = ?;',
            )
            .get('#P1');
        expect(player).toEqual({ name: 'Alice', clan_tag: '#CLAN1' });

        // Second unsubscribe on already-removed subscription is a safe no-op.
        expect(repo.unsubscribeFromChat(300, 0, '#CLAN1')).toBe(false);
    });

    it('throws DatabaseError on foreign key violations when subscribing to missing clan or destination', () => {
        const { db, repo } = setup();
        seedClan(db, '#CLAN1');

        expect(() => {
            repo.subscribeToChat(999, 0, '#CLAN1', SUBSCRIPTION_PRESETS.players);
        }).toThrow(DatabaseError);

        repo.saveTelegramChat(999, 0, 'Existing Chat');
        expect(() => {
            repo.subscribeToChat(999, 0, '#MISSING', SUBSCRIPTION_PRESETS.players);
        }).toThrow(DatabaseError);
    });

    it('loads subscriptions by destination or chat and atomically migrates chat_id preserving subscription_id, settings, and deduplicating overlaps', () => {
        const { db, repo } = setup();
        seedClan(db, '#CLAN1');
        seedClan(db, '#CLAN2');

        repo.saveTelegramChat(-500, 0, 'Legacy Group');
        repo.saveTelegramChat(-500, 12, 'Legacy Topic');
        repo.subscribeToChat(-500, 0, '#CLAN1', {
            categories: {
                summaries: true,
                reminders: false,
                roster: false,
                discipline: true,
                system: true,
            },
            mirrorRuleEnabled: true,
            timezoneOffsetHours: 5,
        });
        repo.subscribeToChat(-500, 0, '#CLAN2', SUBSCRIPTION_PRESETS.players);
        repo.subscribeToChat(-500, 12, '#CLAN1', SUBSCRIPTION_PRESETS.all);

        const sub1 = repo.getSubscriptionId(-500, 0, '#CLAN1');
        const sub2 = repo.getSubscriptionId(-500, 0, '#CLAN2');
        const sub3 = repo.getSubscriptionId(-500, 12, '#CLAN1');
        expect(sub1).not.toBeNull();
        expect(sub2).not.toBeNull();
        expect(sub3).not.toBeNull();

        expect(repo.getSubscriptionsForDestination(-500, 0).map((s) => s.subscriptionId)).toEqual([
            sub1,
            sub2,
        ]);
        expect(repo.getSubscriptionsForChat(-500).map((s) => s.subscriptionId)).toEqual([
            sub1,
            sub2,
            sub3,
        ]);

        // Pre-seed overlapping subscription for #CLAN2 in target supergroup -1005000001
        repo.saveTelegramChat(-1005000001, 0, 'Target Supergroup');
        repo.subscribeToChat(-1005000001, 0, '#CLAN2', SUBSCRIPTION_PRESETS.management);
        const targetSub2 = repo.getSubscriptionId(-1005000001, 0, '#CLAN2');

        const result = repo.migrateChat(-500, -1005000001);
        expect(result).toEqual({
            migratedChats: 2,
            migratedSubscriptions: 2,
            duplicateSubscriptionIds: [sub2],
        });

        expect(telegramChatExists(db, -500, 0)).toBe(false);
        expect(telegramChatExists(db, -500, 12)).toBe(false);
        expect(telegramChatExists(db, -1005000001, 0)).toBe(true);
        expect(telegramChatExists(db, -1005000001, 12)).toBe(true);

        // Migrated subscriptions keep their original subscription_id and custom settings; target overlap keeps its own
        expect(repo.getSubscription(-1005000001, 0, '#CLAN1')).toEqual({
            subscriptionId: sub1,
            clanTag: '#CLAN1',
            chatId: -1005000001,
            messageThreadId: 0,
            categories: {
                summaries: true,
                reminders: false,
                roster: false,
                discipline: true,
                system: true,
            },
            mirrorRuleEnabled: true,
            timezoneOffsetHours: 5,
        });
        expect(repo.getSubscriptionId(-1005000001, 0, '#CLAN2')).toBe(targetSub2);
        expect(repo.getSubscriptionId(-1005000001, 12, '#CLAN1')).toBe(sub3);
        expect(repo.getSubscriptionsForChat(-500)).toEqual([]);

        // Existing target title is preserved when newTitle is omitted; missing thread copies old title
        const titles = db.connection
            .prepare<[number], { message_thread_id: number; title: string }>(
                'SELECT message_thread_id, title FROM telegram_chats WHERE chat_id = ? ORDER BY message_thread_id;',
            )
            .all(-1005000001);
        expect(titles).toEqual([
            { message_thread_id: 0, title: 'Target Supergroup' },
            { message_thread_id: 12, title: 'Legacy Topic' },
        ]);

        // Self-migration and repeated migration are idempotent no-ops
        expect(repo.migrateChat(-1005000001, -1005000001)).toEqual({
            migratedChats: 0,
            migratedSubscriptions: 0,
            duplicateSubscriptionIds: [],
        });
        expect(repo.migrateChat(-500, -1005000001)).toEqual({
            migratedChats: 0,
            migratedSubscriptions: 0,
            duplicateSubscriptionIds: [],
        });
    });

    it('loads clan subscription summaries with latest snapshot war log flag, open sync outage status and topic isolation', () => {
        const { db, repo } = setup();
        seedClan(db, '#CLAN1', 'Pending synchronization');
        seedClan(db, '#CLAN2', 'Public War Clan');
        seedClan(db, '#CLAN3', 'Private War Clan');
        seedClan(db, '#CLAN4', 'Outage Clan');

        // #CLAN2: older private snapshot followed by newer public snapshot -> latest is public (1)
        db.connection
            .prepare(
                `INSERT INTO clan_snapshots (clan_tag, type, is_war_log_public, created_at)
                 VALUES (?, 'open', ?, 1700000000);`,
            )
            .run('#CLAN2', 0);
        db.connection
            .prepare(
                `INSERT INTO clan_snapshots (clan_tag, type, is_war_log_public, created_at)
                 VALUES (?, 'open', ?, 1700000000);`,
            )
            .run('#CLAN2', 1);

        // #CLAN3: latest snapshot has private war log (0), plus a recovered outage (should NOT count as active)
        db.connection
            .prepare(
                `INSERT INTO clan_snapshots (clan_tag, type, is_war_log_public)
                 VALUES (?, 'inviteOnly', 0);`,
            )
            .run('#CLAN3');
        db.connection
            .prepare(
                `INSERT INTO sync_outages (clan_tag, service_name, failure_count, started_at, recovered_at)
                 VALUES (?, 'ClanInfoService', 3, 1700000000, 1700000900);`,
            )
            .run('#CLAN3');

        // #CLAN4: has snapshot AND an open sync outage (recovered_at IS NULL)
        db.connection
            .prepare(
                `INSERT INTO clan_snapshots (clan_tag, type, is_war_log_public)
                 VALUES (?, 'open', 1);`,
            )
            .run('#CLAN4');
        db.connection
            .prepare(
                `INSERT INTO sync_outages (clan_tag, service_name, failure_count, started_at, recovered_at)
                 VALUES (?, 'ClanwarService', 2, 1700000000, NULL);`,
            )
            .run('#CLAN4');

        repo.saveTelegramChat(-700, 11, 'Topic 11');
        repo.saveTelegramChat(-700, 22, 'Topic 22');
        repo.subscribeToChat(-700, 11, '#CLAN1', SUBSCRIPTION_PRESETS.players);
        repo.subscribeToChat(-700, 11, '#CLAN2', SUBSCRIPTION_PRESETS.management);
        repo.subscribeToChat(-700, 11, '#CLAN3', SUBSCRIPTION_PRESETS.all);
        repo.subscribeToChat(-700, 11, '#CLAN4', {
            categories: {
                summaries: true,
                reminders: false,
                roster: false,
                discipline: false,
                system: false,
            },
        });
        repo.subscribeToChat(-700, 22, '#CLAN2', SUBSCRIPTION_PRESETS.players);

        const topic11 = repo.getSubscriptionSummariesForDestination(-700, 11);
        expect(topic11).toHaveLength(4);
        expect(topic11.map((item) => item.clanTag)).toEqual([
            '#CLAN1',
            '#CLAN2',
            '#CLAN3',
            '#CLAN4',
        ]);
        expect(topic11[0]).toMatchObject({
            clanTag: '#CLAN1',
            clanName: 'Pending synchronization',
            hasSnapshot: false,
            isWarLogPublic: null,
            hasActiveSyncOutage: false,
        });
        expect(topic11[1]).toMatchObject({
            clanTag: '#CLAN2',
            clanName: 'Public War Clan',
            hasSnapshot: true,
            isWarLogPublic: true,
            hasActiveSyncOutage: false,
        });
        expect(topic11[2]).toMatchObject({
            clanTag: '#CLAN3',
            clanName: 'Private War Clan',
            hasSnapshot: true,
            isWarLogPublic: false,
            hasActiveSyncOutage: false,
        });
        expect(topic11[3]).toMatchObject({
            clanTag: '#CLAN4',
            clanName: 'Outage Clan',
            hasSnapshot: true,
            isWarLogPublic: true,
            hasActiveSyncOutage: true,
        });

        const topic22 = repo.getSubscriptionSummariesForDestination(-700, 22);
        expect(topic22).toHaveLength(1);
        expect(topic22[0]?.clanTag).toBe('#CLAN2');

        expect(repo.getSubscriptionSummary(-700, 11, '#CLAN3')).toEqual(topic11[2]);
        expect(repo.getSubscriptionSummary(-700, 22, '#CLAN3')).toBeNull();
        expect(repo.getSubscriptionSummariesForDestination(-700, 99)).toEqual([]);
    });
});
