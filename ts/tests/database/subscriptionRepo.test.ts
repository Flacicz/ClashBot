import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseError } from '../../src/common/errors.js';
import {
    Database,
    MigratorManager,
    SubscriptionRepo,
    TransactionManager,
} from '../../src/database/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../../src/database/migrations');

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

    it('manages subscriptions by audience, thread and clan with idempotent subscribeToChat', () => {
        const { db, repo } = setup();
        seedClan(db, '#CLAN1');
        seedClan(db, '#CLAN2');

        repo.saveTelegramChat(-1001, 0, 'Group General');
        repo.saveTelegramChat(-1001, 77, 'Group Topic');
        repo.saveTelegramChat(555, 0, 'Leader PM');

        repo.subscribeToChat(-1001, 0, '#CLAN1', 'players');
        const firstSubId = repo.getSubscriptionId(-1001, 0, '#CLAN1', 'players');
        expect(firstSubId).not.toBeNull();

        // Repeated subscribeToChat is idempotent and preserves subscription_id.
        repo.subscribeToChat(-1001, 0, '#CLAN1', 'players');
        expect(repo.getSubscriptionId(-1001, 0, '#CLAN1', 'players')).toBe(firstSubId);

        repo.subscribeToChat(-1001, 77, '#CLAN1', 'players');
        repo.subscribeToChat(555, 0, '#CLAN1', 'management');
        repo.subscribeToChat(-1001, 0, '#CLAN2', 'players');

        expect(repo.hasSubscription(-1001, 0, '#CLAN1', 'players')).toBe(true);
        expect(repo.hasSubscription(-1001, 0, '#CLAN1', 'management')).toBe(false);
        expect(repo.hasSubscriptionsForChat(-1001, 0)).toBe(true);
        expect(repo.hasSubscriptionsForChat(99999, 0)).toBe(false);
        expect(repo.hasSubscriptionsForClan('#CLAN1')).toBe(true);
        expect(repo.hasSubscriptionsForClan('#UNKNOWN')).toBe(false);

        expect(repo.getDestinationsForClan('#CLAN1', 'players')).toEqual([
            { chatId: -1001, messageThreadId: 0 },
            { chatId: -1001, messageThreadId: 77 },
        ]);
        expect(repo.getDestinationsForClan('#CLAN1', 'management')).toEqual([
            { chatId: 555, messageThreadId: 0 },
        ]);

        const subDestinations = repo.getSubscriptionDestinationsForClan('#CLAN1', 'players');
        expect(subDestinations).toHaveLength(2);
        expect(subDestinations[0]).toEqual({
            subscriptionId: firstSubId,
            chatId: -1001,
            messageThreadId: 0,
        });

        expect(repo.getClanTagsForChat(-1001, 0, 'players')).toEqual(['#CLAN1', '#CLAN2']);
        expect(repo.getClanTagsForChat(-1001, 0, 'management')).toEqual([]);
    });

    it('creates a new subscription_id generation on re-subscribe after unsubscribe', () => {
        const { db, repo } = setup();
        seedClan(db, '#CLAN1');
        repo.saveTelegramChat(100, 0, 'Private Chat');

        repo.subscribeToChat(100, 0, '#CLAN1', 'management');
        const gen1 = repo.getSubscriptionId(100, 0, '#CLAN1', 'management');
        expect(gen1).not.toBeNull();

        expect(repo.unsubscribeFromChat(100, 0, '#CLAN1', 'management')).toBe(true);
        expect(repo.getSubscriptionId(100, 0, '#CLAN1', 'management')).toBeNull();

        // Re-link requires recreating the destination since last subscription removed it.
        repo.saveTelegramChat(100, 0, 'Private Chat');
        repo.subscribeToChat(100, 0, '#CLAN1', 'management');
        const gen2 = repo.getSubscriptionId(100, 0, '#CLAN1', 'management');

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

        repo.subscribeToChat(-200, 0, '#CLAN1', 'players');
        repo.subscribeToChat(-200, 0, '#CLAN2', 'players');
        repo.subscribeToChat(300, 0, '#CLAN1', 'management');

        // Unsubscribing #CLAN1 from -200 leaves -200 with #CLAN2 and #CLAN1 with 300.
        expect(repo.unsubscribeFromChat(-200, 0, '#CLAN1', 'players')).toBe(true);
        expect(telegramChatExists(db, -200, 0)).toBe(true);
        expect(getTrackingEnabled(db, '#CLAN1')).toBe(1);

        // Unsubscribing #CLAN1 from 300 is the last subscription for BOTH 300 and #CLAN1.
        expect(repo.unsubscribeFromChat(300, 0, '#CLAN1', 'management')).toBe(true);
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
        expect(repo.unsubscribeFromChat(300, 0, '#CLAN1', 'management')).toBe(false);
    });

    it('throws DatabaseError on foreign key violations when subscribing to missing clan or destination', () => {
        const { db, repo } = setup();
        seedClan(db, '#CLAN1');

        expect(() => {
            repo.subscribeToChat(999, 0, '#CLAN1', 'players');
        }).toThrow(DatabaseError);

        repo.saveTelegramChat(999, 0, 'Existing Chat');
        expect(() => {
            repo.subscribeToChat(999, 0, '#MISSING', 'players');
        }).toThrow(DatabaseError);
    });
});
