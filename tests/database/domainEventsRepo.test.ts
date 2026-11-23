import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    Database,
    DomainEventsRepo,
    MigratorManager,
    NotificationRepo,
    TransactionManager,
    type DomainEventDestinationRecord,
    type DomainEventRecord,
} from '../../src/database/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');

function createMigratedDb(): Database {
    const db = new Database(':memory:');
    const txManager = new TransactionManager(db);
    const migrator = new MigratorManager(db, txManager);
    migrator.migrate(REAL_MIGRATIONS_PATH);
    return db;
}

function mustExist<T>(value: T | undefined, label: string): T {
    if (value === undefined) {
        throw new Error(`Expected ${label} to be defined`);
    }
    return value;
}

function makeEvent(overrides: Partial<DomainEventRecord> = {}): DomainEventRecord {
    return {
        eventType: 'war_ended',
        eventId: '42',
        payload: JSON.stringify({ war_id: 42 }),
        payloadVersion: 1,
        clanTag: '#CLAN1',
        ...overrides,
    };
}

function makeDestination(
    overrides: Partial<DomainEventDestinationRecord> = {},
): DomainEventDestinationRecord {
    return {
        chatId: -1001,
        messageThreadId: 0,
        audience: 'players',
        subscriptionId: 10,
        ...overrides,
    };
}

describe('DomainEventsRepo', () => {
    const openDatabases: Database[] = [];

    function setup(): {
        db: Database;
        txManager: TransactionManager;
        repo: DomainEventsRepo;
        notificationRepo: NotificationRepo;
    } {
        const db = createMigratedDb();
        openDatabases.push(db);
        return {
            db,
            txManager: new TransactionManager(db),
            repo: new DomainEventsRepo(db),
            notificationRepo: new NotificationRepo(db),
        };
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('appends a domain event with destination snapshot and ignores duplicate event keys without adding new destinations', () => {
        const { db, repo } = setup();
        const event = makeEvent();

        const firstId = repo.appendEvent(event, [
            makeDestination({
                chatId: -1001,
                messageThreadId: 0,
                audience: 'players',
                subscriptionId: 1,
            }),
            makeDestination({
                chatId: 500,
                messageThreadId: 0,
                audience: 'management',
                subscriptionId: 2,
            }),
            // Duplicate destination in the same call should be ignored.
            makeDestination({
                chatId: -1001,
                messageThreadId: 0,
                audience: 'players',
                subscriptionId: 1,
            }),
        ]);
        expect(firstId).not.toBeNull();

        // Repeated appendEvent with the same (clan_tag, event_type, event_id) must NOT add new destinations.
        const duplicateId = repo.appendEvent(event, [
            makeDestination({
                chatId: -9999,
                messageThreadId: 5,
                audience: 'players',
                subscriptionId: 99,
            }),
        ]);
        expect(duplicateId).toBeNull();

        const pending = repo.getPendingDestinations(100);
        expect(pending).toHaveLength(2);
        expect(pending.map((item) => item.subscriptionId)).toEqual([1, 2]);
        expect(pending[0]).toMatchObject({
            domainEventId: firstId,
            eventType: 'war_ended',
            eventId: '42',
            payload: JSON.stringify({ war_id: 42 }),
            payloadVersion: 1,
            clanTag: '#CLAN1',
            chatId: -1001,
            messageThreadId: 0,
            audience: 'players',
            subscriptionId: 1,
            attempts: 0,
        });

        const totalEvents = db.connection
            .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM domain_events;')
            .get();
        expect(totalEvents?.count).toBe(1);
    });

    it('persists a domain event with an empty destination snapshot', () => {
        const { db, repo } = setup();

        const eventId = repo.appendEvent(makeEvent({ eventId: 'empty-dest' }), []);
        expect(eventId).not.toBeNull();
        expect(repo.getPendingDestinations(100)).toEqual([]);

        const totalEvents = db.connection
            .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM domain_events;')
            .get();
        expect(totalEvents?.count).toBe(1);
    });

    it('respects batch limit, non-positive limit, next_attempt_at schedule and pending recheck', () => {
        const { repo } = setup();

        for (let i = 1; i <= 5; i += 1) {
            repo.appendEvent(makeEvent({ eventId: String(i) }), [
                makeDestination({ subscriptionId: i }),
            ]);
        }

        expect(repo.getPendingDestinations(0)).toEqual([]);
        expect(repo.getPendingDestinations(-5)).toEqual([]);

        const batch = repo.getPendingDestinations(3);
        expect(batch).toHaveLength(3);
        expect(batch.map((d) => d.eventId)).toEqual(['1', '2', '3']);

        const firstDest = mustExist(batch[0], 'first pending destination');
        expect(repo.isDestinationPending(firstDest.destinationId)).toBe(true);
        expect(repo.isDestinationPending(999_999)).toBe(false);

        // Reschedule into the far future: excluded from getPendingDestinations, still pending.
        const futureTs = Math.floor(Date.now() / 1000) + 3600;
        expect(
            repo.reschedule(firstDest.destinationId, futureTs, 'temporary formatter error'),
        ).toBe(true);
        expect(repo.isDestinationPending(firstDest.destinationId)).toBe(true);
        expect(repo.getPendingDestinations(10).map((d) => d.eventId)).toEqual(['2', '3', '4', '5']);

        // Reschedule into the past: eligible again with incremented attempts.
        expect(repo.reschedule(firstDest.destinationId, 1, 'retry now')).toBe(true);
        const reloaded = repo
            .getPendingDestinations(10)
            .find((d) => d.destinationId === firstDest.destinationId);
        expect(reloaded?.attempts).toBe(2);
    });

    it('marks pending destination as materialized and prevents transitions on non-pending destinations', () => {
        const { db, repo } = setup();

        repo.appendEvent(makeEvent(), [makeDestination({ subscriptionId: 10 })]);
        const dest = mustExist(repo.getPendingDestinations(10)[0], 'pending destination');

        expect(repo.markMaterialized(dest.destinationId)).toBe(true);
        expect(repo.isDestinationPending(dest.destinationId)).toBe(false);
        expect(repo.getPendingDestinations(10)).toEqual([]);

        // Subsequent markMaterialized or reschedule on materialized destination is a no-op.
        expect(repo.markMaterialized(dest.destinationId)).toBe(false);
        expect(repo.reschedule(dest.destinationId, 1, 'late error')).toBe(false);

        const row = db.connection
            .prepare<
                [number],
                {
                    status: string;
                    materialized_at: number | null;
                    next_attempt_at: number | null;
                    last_error: string | null;
                }
            >(
                'SELECT status, materialized_at, next_attempt_at, last_error FROM domain_event_destinations WHERE id = ?;',
            )
            .get(dest.destinationId);
        expect(row?.status).toBe('materialized');
        expect(row?.materialized_at).not.toBeNull();
        expect(row?.next_attempt_at).toBeNull();
        expect(row?.last_error).toBeNull();
    });

    it('cancels pending destinations and pending notifications for a subscription without affecting sent notifications or other generations', () => {
        const { db, repo, notificationRepo } = setup();

        // Event 1: subscription 10 (pending destination, not yet materialized) and subscription 20 (new generation).
        repo.appendEvent(makeEvent({ eventId: '101' }), [
            makeDestination({ subscriptionId: 10 }),
            makeDestination({ subscriptionId: 20 }),
        ]);

        // Event 2: subscription 10 (already materialized into one pending and one sent notification).
        repo.appendEvent(makeEvent({ eventId: '102' }), [makeDestination({ subscriptionId: 10 })]);

        const pending = repo.getPendingDestinations(10);
        const ev1Sub10 = mustExist(
            pending.find((d) => d.eventId === '101' && d.subscriptionId === 10),
            'ev1Sub10',
        );
        const ev1Sub20 = mustExist(
            pending.find((d) => d.eventId === '101' && d.subscriptionId === 20),
            'ev1Sub20',
        );
        const ev2Sub10 = mustExist(
            pending.find((d) => d.eventId === '102' && d.subscriptionId === 10),
            'ev2Sub10',
        );

        // Materialize ev2Sub10 into two notifications: one becomes sent, one stays pending.
        notificationRepo.enqueueDomainEventIfAbsent(
            'War summary',
            ev2Sub10.destinationId,
            'war_ended',
            '102',
            -1001,
            0,
            1,
            1,
        );
        notificationRepo.enqueueDomainEventIfAbsent(
            'War comparison',
            ev2Sub10.destinationId,
            'war_comparison',
            '102',
            -1001,
            0,
            1,
            1,
        );
        repo.markMaterialized(ev2Sub10.destinationId);

        const pendingNotifs = notificationRepo.getPending(10);
        const summaryNotif = mustExist(
            pendingNotifs.find((n) => n.eventType === 'war_ended'),
            'summaryNotif',
        );
        const comparisonNotif = mustExist(
            pendingNotifs.find((n) => n.eventType === 'war_comparison'),
            'comparisonNotif',
        );
        notificationRepo.markAsSent(summaryNotif.id);

        // Cancel subscription 10 (/unlink).
        repo.cancelForSubscription(10);

        // ev1Sub10 destination is cancelled; ev1Sub20 remains pending; ev2Sub10 stays materialized.
        expect(repo.isDestinationPending(ev1Sub10.destinationId)).toBe(false);
        expect(repo.isDestinationPending(ev1Sub20.destinationId)).toBe(true);

        const destStatuses = db.connection
            .prepare<
                [],
                {
                    id: number;
                    status: string;
                    cancelled_at: number | null;
                    last_error: string | null;
                }
            >(
                'SELECT id, status, cancelled_at, last_error FROM domain_event_destinations ORDER BY id;',
            )
            .all();
        const ev1Sub10Row = destStatuses.find((r) => r.id === ev1Sub10.destinationId);
        const ev2Sub10Row = destStatuses.find((r) => r.id === ev2Sub10.destinationId);
        expect(ev1Sub10Row?.status).toBe('cancelled');
        expect(ev1Sub10Row?.cancelled_at).not.toBeNull();
        expect(ev1Sub10Row?.last_error).toBe('subscription cancelled');
        expect(ev2Sub10Row?.status).toBe('materialized');

        // Pending notification for sub 10 is cancelled; already-sent notification stays sent!
        const notifRows = db.connection
            .prepare<[], { id: number; status: string; last_error: string | null }>(
                'SELECT id, status, last_error FROM notifications ORDER BY id;',
            )
            .all();
        expect(notifRows.find((n) => n.id === summaryNotif.id)?.status).toBe('sent');
        expect(notifRows.find((n) => n.id === comparisonNotif.id)).toEqual({
            id: comparisonNotif.id,
            status: 'cancelled',
            last_error: 'subscription cancelled',
        });
    });

    it('rolls back domain event and destinations atomically when surrounding transaction fails', () => {
        const { db, txManager, repo } = setup();

        expect(() => {
            txManager.retryInTransaction(() => {
                repo.appendEvent(makeEvent({ eventId: 'rolled-back' }), [
                    makeDestination({ subscriptionId: 1 }),
                ]);
                throw new Error('simulated failure');
            });
        }).toThrow('simulated failure');

        const eventCount = db.connection
            .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM domain_events;')
            .get();
        const destCount = db.connection
            .prepare<[], { count: number }>(
                'SELECT COUNT(*) AS count FROM domain_event_destinations;',
            )
            .get();
        expect(eventCount?.count).toBe(0);
        expect(destCount?.count).toBe(0);
    });
});
