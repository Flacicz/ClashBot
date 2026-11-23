import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    ClansRepo,
    Database,
    DomainEventsRepo,
    MigratorManager,
    SubscriptionRepo,
    TransactionManager,
} from '../../src/database/index.js';
import { DomainEventPayloadSerializer, DomainEventRecorder } from '../../src/domainEvents/index.js';
import type { ApplicationEvent } from '../../src/events/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');
const CLAN_TAG = '#2PPLQ';

describe('DomainEventRecorder', () => {
    const openDatabases: Database[] = [];

    function setup(): {
        db: Database;
        txManager: TransactionManager;
        clansRepo: ClansRepo;
        subscriptionRepo: SubscriptionRepo;
        domainEventsRepo: DomainEventsRepo;
        recorder: DomainEventRecorder;
    } {
        const db = new Database(':memory:');
        openDatabases.push(db);
        const txManager = new TransactionManager(db);
        const migrator = new MigratorManager(db, txManager);
        migrator.migrate(REAL_MIGRATIONS_PATH);

        const clansRepo = new ClansRepo(db);
        const subscriptionRepo = new SubscriptionRepo(db);
        const domainEventsRepo = new DomainEventsRepo(db);
        const serializer = new DomainEventPayloadSerializer();
        const recorder = new DomainEventRecorder(serializer, subscriptionRepo, domainEventsRepo);

        return {
            db,
            txManager,
            clansRepo,
            subscriptionRepo,
            domainEventsRepo,
            recorder,
        };
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('records events with active subscription snapshots filtered by event audience and preserves subscription_id and thread id', () => {
        const { txManager, clansRepo, subscriptionRepo, domainEventsRepo, recorder } = setup();

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players General');
        subscriptionRepo.saveTelegramChat(-1001, 77, 'Players Topic');
        subscriptionRepo.saveTelegramChat(5001, 0, 'Management PM');

        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        subscriptionRepo.subscribeToChat(-1001, 77, CLAN_TAG, 'players');
        subscriptionRepo.subscribeToChat(5001, 0, CLAN_TAG, 'management');

        const playersGeneralSubId = subscriptionRepo.getSubscriptionId(
            -1001,
            0,
            CLAN_TAG,
            'players',
        );
        const playersTopicSubId = subscriptionRepo.getSubscriptionId(
            -1001,
            77,
            CLAN_TAG,
            'players',
        );
        const managementSubId = subscriptionRepo.getSubscriptionId(5001, 0, CLAN_TAG, 'management');

        expect(playersGeneralSubId).not.toBeNull();
        expect(playersTopicSubId).not.toBeNull();
        expect(managementSubId).not.toBeNull();

        const events: ApplicationEvent[] = [
            {
                type: 'PlayerJoinedClanEvent',
                clanTag: CLAN_TAG,
                playerTag: '#P1',
                playerName: 'Alice',
                membershipId: 10,
            },
            {
                type: 'SyncFailureEvent',
                clanTag: CLAN_TAG,
                serviceName: 'ClanInfoService',
                errorMsg: 'timeout',
                attempts: 3,
                outageId: 20,
            },
            {
                type: 'war_ended',
                clanTag: CLAN_TAG,
                warReference: {
                    clanTag: CLAN_TAG,
                    warId: 30,
                    homeClanId: 31,
                    opponentClanId: 32,
                },
            },
        ];

        txManager.retryInTransaction(() => {
            recorder.recordAll(events);
        });

        const pending = domainEventsRepo.getPendingDestinations(50);
        // PlayerJoinedClanEvent -> 2 players destinations
        // SyncFailureEvent -> 1 management destination
        // war_ended -> 2 players + 1 management = 3 destinations
        expect(pending).toHaveLength(6);

        const joinedDests = pending.filter((d) => d.eventType === 'PlayerJoinedClanEvent');
        expect(joinedDests).toHaveLength(2);
        expect(
            joinedDests.map((d) => ({
                chatId: d.chatId,
                messageThreadId: d.messageThreadId,
                audience: d.audience,
                subscriptionId: d.subscriptionId,
            })),
        ).toEqual([
            {
                chatId: -1001,
                messageThreadId: 0,
                audience: 'players',
                subscriptionId: playersGeneralSubId,
            },
            {
                chatId: -1001,
                messageThreadId: 77,
                audience: 'players',
                subscriptionId: playersTopicSubId,
            },
        ]);

        const failureDests = pending.filter((d) => d.eventType === 'SyncFailureEvent');
        expect(failureDests).toHaveLength(1);
        expect(failureDests[0]).toMatchObject({
            eventId: '20',
            chatId: 5001,
            messageThreadId: 0,
            audience: 'management',
            subscriptionId: managementSubId,
        });

        const warEndedDests = pending.filter((d) => d.eventType === 'war_ended');
        expect(warEndedDests).toHaveLength(3);
    });

    it('is idempotent for duplicate events and does not retroactively deliver to subscriptions added later', () => {
        const { db, txManager, clansRepo, subscriptionRepo, domainEventsRepo, recorder } = setup();

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Initial Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');

        const event: ApplicationEvent = {
            type: 'PlayerJoinedClanEvent',
            clanTag: CLAN_TAG,
            playerTag: '#P1',
            playerName: 'Alice',
            membershipId: 100,
        };

        txManager.retryInTransaction(() => {
            recorder.recordAll([event]);
        });

        // Add another subscription after the event was recorded
        subscriptionRepo.saveTelegramChat(-2002, 0, 'Late Players');
        subscriptionRepo.subscribeToChat(-2002, 0, CLAN_TAG, 'players');

        // Re-recording the exact same event must be a no-op (idempotent)
        txManager.retryInTransaction(() => {
            recorder.recordAll([event]);
        });

        const pending = domainEventsRepo.getPendingDestinations(50);
        expect(pending).toHaveLength(1);
        expect(pending[0]?.chatId).toBe(-1001);

        const eventCountRow = db.connection
            .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM domain_events;')
            .get();
        expect(eventCountRow?.count).toBe(1);
    });

    it('captures the new subscription_id generation after unlink and re-link', () => {
        const { txManager, clansRepo, subscriptionRepo, domainEventsRepo, recorder } = setup();

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        const firstSubId = subscriptionRepo.getSubscriptionId(-1001, 0, CLAN_TAG, 'players');

        txManager.retryInTransaction(() => {
            recorder.recordAll([
                {
                    type: 'PlayerJoinedClanEvent',
                    clanTag: CLAN_TAG,
                    playerTag: '#P1',
                    playerName: 'Alice',
                    membershipId: 1,
                },
            ]);
        });

        subscriptionRepo.unsubscribeFromChat(-1001, 0, CLAN_TAG, 'players');
        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        const secondSubId = subscriptionRepo.getSubscriptionId(-1001, 0, CLAN_TAG, 'players');

        expect(secondSubId).not.toBeNull();
        expect(secondSubId).not.toBe(firstSubId);

        txManager.retryInTransaction(() => {
            recorder.recordAll([
                {
                    type: 'PlayerJoinedClanEvent',
                    clanTag: CLAN_TAG,
                    playerTag: '#P2',
                    playerName: 'Bob',
                    membershipId: 2,
                },
            ]);
        });

        const pending = domainEventsRepo.getPendingDestinations(50);
        expect(pending).toHaveLength(2);
        expect(pending[0]?.subscriptionId).toBe(firstSubId);
        expect(pending[1]?.subscriptionId).toBe(secondSubId);
    });

    it('rolls back domain events and destinations atomically when the enclosing transaction fails', () => {
        const { db, txManager, clansRepo, subscriptionRepo, domainEventsRepo, recorder } = setup();

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');

        expect(() => {
            txManager.retryInTransaction(() => {
                recorder.recordAll([
                    {
                        type: 'PlayerJoinedClanEvent',
                        clanTag: CLAN_TAG,
                        playerTag: '#P1',
                        playerName: 'Alice',
                        membershipId: 99,
                    },
                ]);
                throw new Error('simulated failure after recordAll');
            });
        }).toThrow('simulated failure after recordAll');

        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(0);
        const eventCountRow = db.connection
            .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM domain_events;')
            .get();
        expect(eventCountRow?.count).toBe(0);
    });
});
