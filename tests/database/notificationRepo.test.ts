import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseError } from '../../src/common/errors.js';
import {
    ClansRepo,
    Database,
    DomainEventsRepo,
    MigratorManager,
    NotificationRepo,
    SubscriptionRepo,
    TransactionManager,
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

describe('NotificationRepo', () => {
    const openDatabases: Database[] = [];

    function setup(): {
        db: Database;
        clansRepo: ClansRepo;
        subscriptionRepo: SubscriptionRepo;
        domainEventsRepo: DomainEventsRepo;
        repo: NotificationRepo;
    } {
        const db = createMigratedDb();
        openDatabases.push(db);
        return {
            db,
            clansRepo: new ClansRepo(db),
            subscriptionRepo: new SubscriptionRepo(db),
            domainEventsRepo: new DomainEventsRepo(db),
            repo: new NotificationRepo(db),
        };
    }

    function createDestination(
        domainEventsRepo: DomainEventsRepo,
        eventId: string,
        subscriptionId: number,
        chatId = -1001,
        messageThreadId = 0,
    ): number {
        domainEventsRepo.appendEvent(
            {
                eventType: 'war_ended',
                eventId,
                payload: '{}',
                payloadVersion: 1,
                clanTag: '#CLAN1',
            },
            [
                {
                    chatId,
                    messageThreadId,
                    audience: 'players',
                    subscriptionId,
                },
            ],
        );
        const destinations = domainEventsRepo.getPendingDestinations(100);
        const match = destinations.find(
            (d) => d.eventId === eventId && d.subscriptionId === subscriptionId,
        );
        if (match === undefined) {
            throw new Error('Expected destination to be created');
        }
        return match.destinationId;
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('enqueues domain-event notifications idempotently and supports composite event types per destination', () => {
        const { domainEventsRepo, repo } = setup();
        const destId = createDestination(domainEventsRepo, '42', 10);

        expect(
            repo.enqueueDomainEventIfAbsent('War ended', destId, 'war_ended', '42', -1001, 0, 1, 1),
        ).toBe(true);
        // Duplicate for the same (destination, event_type, event_id, part_index) is ignored.
        expect(
            repo.enqueueDomainEventIfAbsent(
                'War ended duplicate',
                destId,
                'war_ended',
                '42',
                -1001,
                0,
                1,
                1,
            ),
        ).toBe(false);
        // Different composite event_type for the same destination is allowed.
        expect(
            repo.enqueueDomainEventIfAbsent(
                'War comparison',
                destId,
                'war_comparison',
                '42',
                -1001,
                0,
                1,
                1,
            ),
        ).toBe(true);

        const pending = repo.getPending(10);
        expect(pending).toHaveLength(2);
        expect(pending.map((n) => n.eventType)).toEqual(['war_ended', 'war_comparison']);
        expect(pending[0]).toMatchObject({
            eventType: 'war_ended',
            eventId: '42',
            chatId: -1001,
            messageThreadId: 0,
            messageText: 'War ended',
            attempts: 0,
        });
    });

    it('preserves legacy enqueueIfAbsent idempotency without colliding with durable destination rows', () => {
        const { domainEventsRepo, repo } = setup();
        const destId = createDestination(domainEventsRepo, '50', 10, -1001, 0);

        expect(repo.enqueueIfAbsent('Legacy text', 'war_ended', '50', -1001, 0)).toBe(true);
        expect(repo.enqueueIfAbsent('Legacy dup', 'war_ended', '50', -1001, 0)).toBe(false);

        // Durable destination row with the same event/chat/thread is independent of legacy row.
        expect(
            repo.enqueueDomainEventIfAbsent(
                'Durable text',
                destId,
                'war_ended',
                '50',
                -1001,
                0,
                1,
                1,
            ),
        ).toBe(true);

        expect(repo.getPending(10)).toHaveLength(2);
    });

    it('enforces claimForSending before reschedule, markAsSent and markAsFailed transitions', () => {
        const { db, domainEventsRepo, repo } = setup();
        const destId = createDestination(domainEventsRepo, '60', 10);

        repo.enqueueDomainEventIfAbsent('Msg 1', destId, 'war_ended', '60', -1001, 0, 1, 1);
        repo.enqueueDomainEventIfAbsent('Msg 2', destId, 'war_comparison', '60', -1001, 0, 1, 1);

        expect(repo.getPending(0)).toEqual([]);
        expect(repo.getPending(-1)).toEqual([]);

        const pending = repo.getPending(10);
        expect(pending).toHaveLength(2);
        const msg1 = mustExist(pending[0], 'msg1');
        const msg2 = mustExist(pending[1], 'msg2');
        expect(repo.isPending(msg1.id)).toBe(true);
        expect(repo.isPending(999_999)).toBe(false);

        // Completion methods MUST NOT update records still in 'pending' status.
        const futureTs = Math.floor(Date.now() / 1000) + 600;
        expect(repo.markAsSent(msg1.id)).toBe(false);
        expect(repo.reschedule(msg1.id, futureTs, 'not claimed')).toBe(false);
        expect(repo.markAsFailed(msg1.id, 'not claimed')).toBe(false);

        // Claim msg1 atomically; second claim fails while already 'sending'.
        expect(repo.claimForSending(msg1.id, 1_700_000_000)).toBe(true);
        expect(repo.claimForSending(msg1.id, 1_700_000_001)).toBe(false);
        expect(repo.isPending(msg1.id)).toBe(false);

        const claimedRow = db.connection
            .prepare<[number], { status: string; claimed_at: number | null }>(
                'SELECT status, claimed_at FROM notifications WHERE id = ?;',
            )
            .get(msg1.id);
        expect(claimedRow).toEqual({ status: 'sending', claimed_at: 1_700_000_000 });

        // Reschedule msg1 from 'sending' -> 'pending' into the future, clearing claimed_at.
        expect(repo.reschedule(msg1.id, futureTs, 'HTTP 429 retry_after=600')).toBe(true);
        expect(repo.isPending(msg1.id)).toBe(true);
        expect(repo.getPending(10).map((n) => n.id)).toEqual([msg2.id]);
        const rescheduledRow = db.connection
            .prepare<[number], { status: string; claimed_at: number | null }>(
                'SELECT status, claimed_at FROM notifications WHERE id = ?;',
            )
            .get(msg1.id);
        expect(rescheduledRow).toEqual({ status: 'pending', claimed_at: null });

        // Claim msg1 again and mark as sent: transitions only from 'sending'.
        expect(repo.claimForSending(msg1.id, 1_700_000_600)).toBe(true);
        expect(repo.markAsSent(msg1.id)).toBe(true);
        expect(repo.isPending(msg1.id)).toBe(false);
        expect(repo.claimForSending(msg1.id, 1_700_000_700)).toBe(false);
        expect(repo.markAsSent(msg1.id)).toBe(false);
        expect(repo.reschedule(msg1.id, 1, 'late error')).toBe(false);
        expect(repo.markAsFailed(msg1.id, 'late fatal')).toBe(false);

        const sentRow = db.connection
            .prepare<
                [number],
                {
                    status: string;
                    sent_at: number | null;
                    next_attempt_at: number | null;
                    claimed_at: number | null;
                    last_error: string | null;
                    attempts: number;
                }
            >(
                'SELECT status, sent_at, next_attempt_at, claimed_at, last_error, attempts FROM notifications WHERE id = ?;',
            )
            .get(msg1.id);
        expect(sentRow?.status).toBe('sent');
        expect(sentRow?.sent_at).not.toBeNull();
        expect(sentRow?.next_attempt_at).toBeNull();
        expect(sentRow?.claimed_at).toBeNull();
        expect(sentRow?.last_error).toBeNull();
        expect(sentRow?.attempts).toBe(1);

        // Claim msg2 and mark as failed.
        expect(repo.claimForSending(msg2.id, 1_700_000_000)).toBe(true);
        expect(repo.markAsFailed(msg2.id, 'HTTP 403 bot was kicked')).toBe(true);
        expect(repo.isPending(msg2.id)).toBe(false);
        expect(repo.markAsSent(msg2.id)).toBe(false);

        const failedRow = db.connection
            .prepare<
                [number],
                {
                    status: string;
                    sent_at: number | null;
                    next_attempt_at: number | null;
                    claimed_at: number | null;
                    last_error: string | null;
                    attempts: number;
                }
            >(
                'SELECT status, sent_at, next_attempt_at, claimed_at, last_error, attempts FROM notifications WHERE id = ?;',
            )
            .get(msg2.id);
        expect(failedRow).toEqual({
            status: 'failed',
            sent_at: null,
            next_attempt_at: null,
            claimed_at: null,
            last_error: 'HTTP 403 bot was kicked',
            attempts: 1,
        });
    });

    it('cancels only pending notifications for the target subscription without touching sending/sent rows and blocks claim afterwards', () => {
        const { db, domainEventsRepo, repo } = setup();
        const destSub10 = createDestination(domainEventsRepo, '70', 10);
        const destSub20 = createDestination(domainEventsRepo, '71', 20);

        repo.enqueueDomainEventIfAbsent(
            'Pending sub10',
            destSub10,
            'war_ended',
            '70',
            -1001,
            0,
            1,
            1,
        );
        repo.enqueueDomainEventIfAbsent(
            'Sent sub10',
            destSub10,
            'war_comparison',
            '70',
            -1001,
            0,
            1,
            1,
        );
        repo.enqueueDomainEventIfAbsent(
            'Sending sub10',
            destSub10,
            'war_violations',
            '70',
            -1001,
            0,
            1,
            1,
        );
        repo.enqueueDomainEventIfAbsent(
            'Pending sub20',
            destSub20,
            'war_ended',
            '71',
            -1001,
            0,
            1,
            1,
        );
        repo.enqueueIfAbsent('Legacy pending', 'war_ended', 'legacy-70', -1001, 0);

        const all = repo.getPending(10);
        const pendingSub10 = mustExist(
            all.find((n) => n.messageText === 'Pending sub10'),
            'pendingSub10',
        );
        const sentSub10 = mustExist(
            all.find((n) => n.messageText === 'Sent sub10'),
            'sentSub10',
        );
        const sendingSub10 = mustExist(
            all.find((n) => n.messageText === 'Sending sub10'),
            'sendingSub10',
        );
        const pendingSub20 = mustExist(
            all.find((n) => n.messageText === 'Pending sub20'),
            'pendingSub20',
        );
        const legacyPending = mustExist(
            all.find((n) => n.messageText === 'Legacy pending'),
            'legacyPending',
        );

        expect(repo.claimForSending(sentSub10.id, 1_700_000_000)).toBe(true);
        expect(repo.markAsSent(sentSub10.id)).toBe(true);
        expect(repo.claimForSending(sendingSub10.id, 1_700_000_000)).toBe(true);

        const cancelledCount = repo.cancelForSubscription(10);
        expect(cancelledCount).toBe(1);

        expect(repo.isPending(pendingSub10.id)).toBe(false);
        expect(repo.claimForSending(pendingSub10.id, 1_700_000_010)).toBe(false);
        expect(repo.markAsSent(pendingSub10.id)).toBe(false);
        // In-flight sending row can still complete via markAsSent
        expect(repo.markAsSent(sendingSub10.id)).toBe(true);
        expect(repo.isPending(pendingSub20.id)).toBe(true);
        expect(repo.isPending(legacyPending.id)).toBe(true);

        const statusOf = (id: number): string | undefined =>
            db.connection
                .prepare<[number], { status: string }>(
                    'SELECT status FROM notifications WHERE id = ?;',
                )
                .get(id)?.status;

        expect(statusOf(pendingSub10.id)).toBe('cancelled');
        expect(statusOf(sentSub10.id)).toBe('sent');
        expect(statusOf(sendingSub10.id)).toBe('sent');
        expect(statusOf(pendingSub20.id)).toBe('pending');
        expect(statusOf(legacyPending.id)).toBe('pending');
    });

    it('recovers sending notifications on startup and by TTL while checking active subscription generations', () => {
        const { db, clansRepo, subscriptionRepo, domainEventsRepo, repo } = setup();
        clansRepo.insertMinimalClan('#CLAN1');
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Active Chat');
        subscriptionRepo.saveTelegramChat(-1002, 0, 'Cancelled Chat');
        subscriptionRepo.subscribeToChat(-1001, 0, '#CLAN1', 'players');
        subscriptionRepo.subscribeToChat(-1002, 0, '#CLAN1', 'players');

        const activeSubId = mustExist(
            subscriptionRepo.getSubscriptionId(-1001, 0, '#CLAN1', 'players') ?? undefined,
            'activeSubId',
        );
        const oldSubId = mustExist(
            subscriptionRepo.getSubscriptionId(-1002, 0, '#CLAN1', 'players') ?? undefined,
            'oldSubId',
        );

        const activeDestId = createDestination(domainEventsRepo, 'rec-active', activeSubId, -1001);
        const cancelledDestId = createDestination(domainEventsRepo, 'rec-cancel', oldSubId, -1002);

        repo.enqueueDomainEventIfAbsent(
            'Active fresh',
            activeDestId,
            'war_ended',
            'rec-active',
            -1001,
            0,
        );
        repo.enqueueDomainEventIfAbsent(
            'Active stale',
            activeDestId,
            'war_comparison',
            'rec-active',
            -1001,
            0,
        );
        repo.enqueueDomainEventIfAbsent(
            'Cancelled stale',
            cancelledDestId,
            'war_ended',
            'rec-cancel',
            -1002,
            0,
        );
        repo.enqueueIfAbsent('Legacy stale', 'war_ended', 'rec-legacy', -1003, 0);

        const queued = repo.getPending(10);
        const activeFresh = mustExist(
            queued.find((n) => n.messageText === 'Active fresh'),
            'activeFresh',
        );
        const activeStale = mustExist(
            queued.find((n) => n.messageText === 'Active stale'),
            'activeStale',
        );
        const cancelledStale = mustExist(
            queued.find((n) => n.messageText === 'Cancelled stale'),
            'cancelledStale',
        );
        const legacyStale = mustExist(
            queued.find((n) => n.messageText === 'Legacy stale'),
            'legacyStale',
        );

        expect(repo.claimForSending(activeFresh.id, 1_700_000_050)).toBe(true);
        expect(repo.claimForSending(activeStale.id, 1_700_000_000)).toBe(true);
        expect(repo.claimForSending(cancelledStale.id, 1_700_000_000)).toBe(true);
        expect(repo.claimForSending(legacyStale.id, 1_700_000_000)).toBe(true);

        // Unlink chat -1002 and re-link it to create a new subscription generation
        subscriptionRepo.unsubscribeFromChat(-1002, 0, '#CLAN1', 'players');
        subscriptionRepo.saveTelegramChat(-1002, 0, 'Cancelled Chat');
        subscriptionRepo.subscribeToChat(-1002, 0, '#CLAN1', 'players');
        const newSubId = subscriptionRepo.getSubscriptionId(-1002, 0, '#CLAN1', 'players');
        expect(newSubId).not.toBeNull();
        expect(newSubId).not.toBe(oldSubId);

        // TTL cutoff = 1_700_000_000 (exact boundary): recovers stale rows, leaves activeFresh untouched
        const ttlRecovered = repo.recoverStaleSending(1_700_000_000);
        expect(ttlRecovered).toEqual({ requeued: 2, cancelled: 1 });

        const inspect = (id: number) =>
            db.connection
                .prepare<
                    [number],
                    { status: string; claimed_at: number | null; last_error: string | null }
                >('SELECT status, claimed_at, last_error FROM notifications WHERE id = ?;')
                .get(id);

        expect(inspect(activeFresh.id)).toEqual({
            status: 'sending',
            claimed_at: 1_700_000_050,
            last_error: null,
        });
        expect(inspect(activeStale.id)).toEqual({
            status: 'pending',
            claimed_at: null,
            last_error: null,
        });
        expect(inspect(legacyStale.id)).toEqual({
            status: 'pending',
            claimed_at: null,
            last_error: null,
        });
        // Old subscription generation MUST be cancelled even though chat -1002 was re-linked
        expect(inspect(cancelledStale.id)).toEqual({
            status: 'cancelled',
            claimed_at: null,
            last_error: 'subscription cancelled',
        });

        // Startup recovery recovers ALL remaining 'sending' rows regardless of claimed_at
        const startupRecovered = repo.recoverAllSending();
        expect(startupRecovered).toEqual({ requeued: 1, cancelled: 0 });
        expect(inspect(activeFresh.id)).toEqual({
            status: 'pending',
            claimed_at: null,
            last_error: null,
        });
    });

    it('throws DatabaseError on invalid foreign key or part_index constraint violations', () => {
        const { domainEventsRepo, repo } = setup();
        const destId = createDestination(domainEventsRepo, '80', 10);

        expect(() => {
            repo.enqueueDomainEventIfAbsent('Bad FK', 999_999, 'war_ended', '80', -1001, 0, 1, 1);
        }).toThrow(DatabaseError);

        expect(() => {
            repo.enqueueDomainEventIfAbsent('Bad part', destId, 'war_ended', '80', -1001, 0, 2, 1);
        }).toThrow(DatabaseError);
    });
});
