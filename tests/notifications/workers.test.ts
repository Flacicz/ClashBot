import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeClock } from '../../src/common/clock.js';
import { AbortError } from '../../src/common/errors.js';
import {
    ClansRepo,
    ClanType,
    ClanwarRepo,
    ClanwarsLeagueRepo,
    Database,
    DomainEventsRepo,
    MigratorManager,
    NotificationRepo,
    RaidRepo,
    RetryPolicy,
    SubscriptionRepo,
    TransactionManager,
    WarTypes,
} from '../../src/database/index.js';
import {
    DomainEventPayloadDeserializer,
    DomainEventPayloadSerializer,
    DomainEventRecorder,
    DomainEventWorker,
} from '../../src/domainEvents/index.js';
import { APPLICATION_EVENT_TYPES, type ApplicationEvent } from '../../src/events/index.js';
import { createLogger } from '../../src/logging/index.js';
import {
    DEFAULT_TELEGRAM_MAX_VISIBLE_LENGTH,
    NotificationService,
    NotificationWorker,
    TELEGRAM_HARD_MAX_VISIBLE_LENGTH,
    TelegramDeliveryError,
    TelegramGateway,
    countTelegramHtmlVisibleLength,
} from '../../src/notifications/index.js';
import { type LoopbackServer, startLoopbackServer } from '../api/helpers/loopbackServer.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');
const CLAN_TAG = '#2PPLQ';
const INITIAL_CLOCK_MS = 1_700_000_000_000;

interface DestinationRowState {
    readonly id: number;
    readonly status: string;
    readonly attempts: number;
    readonly next_attempt_at: number | null;
    readonly last_error: string | null;
}

interface NotificationRowState {
    readonly id: number;
    readonly status: string;
    readonly attempts: number;
    readonly next_attempt_at: number | null;
    readonly claimed_at: number | null;
    readonly last_error: string | null;
    readonly chat_id: number;
    readonly message_thread_id: number;
    readonly message_text: string;
}

function getDestinationStateByEventId(db: Database, eventId: string): DestinationRowState {
    const row = db.connection
        .prepare<[string], DestinationRowState>(
            `SELECT d.id, d.status, d.attempts, d.next_attempt_at, d.last_error
             FROM domain_event_destinations d
             JOIN domain_events e ON e.id = d.domain_event_id
             WHERE e.event_id = ?;`,
        )
        .get(eventId);
    if (row === undefined) {
        throw new Error(`Destination for event_id '${eventId}' not found`);
    }
    return row;
}

function getDestinationStateById(db: Database, destinationId: number): DestinationRowState {
    const row = db.connection
        .prepare<[number], DestinationRowState>(
            `SELECT id, status, attempts, next_attempt_at, last_error
             FROM domain_event_destinations
             WHERE id = ?;`,
        )
        .get(destinationId);
    if (row === undefined) {
        throw new Error(`Destination ${String(destinationId)} not found`);
    }
    return row;
}

function getNotificationState(db: Database, notificationId: number): NotificationRowState {
    const row = db.connection
        .prepare<[number], NotificationRowState>(
            `SELECT id, status, attempts, next_attempt_at, claimed_at, last_error, chat_id, message_thread_id, message_text
             FROM notifications
             WHERE id = ?;`,
        )
        .get(notificationId);
    if (row === undefined) {
        throw new Error(`Notification ${String(notificationId)} not found`);
    }
    return row;
}

async function flushMicrotasks(ticks = 150): Promise<void> {
    for (let i = 0; i < ticks; i += 1) {
        await Promise.resolve();
    }
}

describe('DomainEventWorker & NotificationWorker integration', () => {
    const openDatabases: Database[] = [];
    const openServers: LoopbackServer[] = [];

    function createHarness() {
        const db = new Database(':memory:');
        openDatabases.push(db);
        const tx = new TransactionManager(db);
        new MigratorManager(db, tx).migrate(REAL_MIGRATIONS_PATH);

        const clock = new FakeClock(INITIAL_CLOCK_MS);
        const clansRepo = new ClansRepo(db);
        const clanwarRepo = new ClanwarRepo(db);
        const clanwarsLeagueRepo = new ClanwarsLeagueRepo(db);
        const raidRepo = new RaidRepo(db);
        const subscriptionRepo = new SubscriptionRepo(db);
        const domainEventsRepo = new DomainEventsRepo(db);
        const notificationRepo = new NotificationRepo(db);
        const serializer = new DomainEventPayloadSerializer();
        const deserializer = new DomainEventPayloadDeserializer();
        const recorder = new DomainEventRecorder(serializer, subscriptionRepo, domainEventsRepo);

        clansRepo.insertMinimalClan(CLAN_TAG);
        db.connection.prepare("UPDATE clans SET name = 'Alpha Clan' WHERE tag = ?;").run(CLAN_TAG);

        const sentMessages: {
            readonly chatId: number;
            readonly text: string;
            readonly messageThreadId: number;
        }[] = [];

        let sendResponder:
            | ((
                  chatId: number,
                  text: string,
                  messageThreadId: number,
                  signal?: AbortSignal,
              ) => Promise<void>)
            | undefined;

        const fakeGateway: TelegramGateway = {
            async sendMessage(chatId, text, messageThreadId = 0, signal) {
                // Invariant: external HTTP calls must never happen inside an open SQLite transaction
                expect(db.connection.inTransaction).toBe(false);

                if (signal?.aborted) {
                    throw new AbortError('Telegram send aborted');
                }

                if (sendResponder !== undefined) {
                    await sendResponder(chatId, text, messageThreadId, signal);
                    return;
                }

                sentMessages.push({ chatId, text, messageThreadId });
            },
        };

        const logger = createLogger({ level: 'silent' });
        const notificationWorker = new NotificationWorker({
            notificationRepo,
            telegramGateway: fakeGateway,
            clock,
            logger,
        });

        const notificationService = new NotificationService({
            notificationRepo,
            clansRepo,
            clanwarRepo,
            clanwarsLeagueRepo,
            raidRepo,
            subscriptionRepo,
            transactionManager: tx,
            notificationWorker,
            logger,
        });

        const domainEventWorker = new DomainEventWorker({
            domainEventsRepo,
            deserializer,
            notificationService,
            notificationWorker,
            transactionManager: tx,
            clock,
            logger,
        });

        return {
            db,
            tx,
            clock,
            clansRepo,
            clanwarRepo,
            subscriptionRepo,
            domainEventsRepo,
            notificationRepo,
            recorder,
            deserializer,
            notificationService,
            notificationWorker,
            domainEventWorker,
            fakeGateway,
            sentMessages,
            setSendResponder(
                fn: (
                    chatId: number,
                    text: string,
                    messageThreadId: number,
                    signal?: AbortSignal,
                ) => Promise<void>,
            ) {
                sendResponder = fn;
            },
        };
    }

    afterEach(async () => {
        while (openServers.length > 0) {
            await openServers.pop()?.close();
        }
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('materializes committed domain events, wakes NotificationWorker immediately after commit, delivers to Telegram, and is idempotent on restart', async () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 7, 'Players Topic');
        h.subscriptionRepo.subscribeToChat(-1001, 7, CLAN_TAG, 'players');

        const controller = new AbortController();
        const notificationRun = h.notificationWorker.run(controller.signal);
        const domainRun = h.domainEventWorker.run(controller.signal);

        // Both workers did their initial poll and are now parked on FakeClock
        await flushMicrotasks();
        expect(h.sentMessages).toHaveLength(0);

        // Commit a domain event and wake DomainEventWorker WITHOUT advancing FakeClock
        h.tx.retryInTransaction(() => {
            h.recorder.recordAll([
                {
                    type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                    clanTag: CLAN_TAG,
                    playerTag: '#P1',
                    playerName: 'Alice',
                    membershipId: 44,
                },
            ]);
        });
        h.domainEventWorker.notify();

        await flushMicrotasks();

        // DomainEventWorker materialized the destination AND woke NotificationWorker immediately
        expect(getDestinationStateByEventId(h.db, '44').status).toBe('materialized');
        expect(h.sentMessages).toHaveLength(1);
        expect(h.sentMessages[0]?.chatId).toBe(-1001);
        expect(h.sentMessages[0]?.messageThreadId).toBe(7);
        expect(h.sentMessages[0]?.text).toContain('Alice');

        const notifRow = h.db.connection
            .prepare<[string], { id: number; status: string }>(
                'SELECT id, status FROM notifications WHERE event_id = ?;',
            )
            .get('44');
        expect(notifRow?.status).toBe('sent');

        controller.abort();
        await Promise.all([domainRun, notificationRun]);

        // Re-running workers after restart does not duplicate materialization or delivery
        h.domainEventWorker.processPending();
        await h.notificationWorker.processPending();
        expect(h.sentMessages).toHaveLength(1);
    });

    it('rechecks isDestinationPending inside transaction and skips destinations cancelled by /unlink after batch load', () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 0, 'Chat 1');
        h.subscriptionRepo.saveTelegramChat(-1002, 0, 'Chat 2');
        h.subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        h.subscriptionRepo.subscribeToChat(-1002, 0, CLAN_TAG, 'players');

        const sub2Id = h.subscriptionRepo.getSubscriptionId(-1002, 0, CLAN_TAG, 'players');
        expect(sub2Id).not.toBeNull();

        h.tx.retryInTransaction(() => {
            h.recorder.recordAll([
                {
                    type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                    clanTag: CLAN_TAG,
                    playerTag: '#P1',
                    playerName: 'Alice',
                    membershipId: 51,
                },
            ]);
        });

        const pendingBefore = h.domainEventsRepo.getPendingDestinations(10);
        expect(pendingBefore).toHaveLength(2);
        const firstDest = pendingBefore[0];
        const secondDest = pendingBefore[1];
        expect(firstDest).toBeDefined();
        expect(secondDest).toBeDefined();
        const dest1Id = firstDest?.destinationId ?? 0;
        const dest2Id = secondDest?.destinationId ?? 0;
        const secondSubId = secondDest?.subscriptionId ?? 0;

        let materializerCalls = 0;
        const customWorker = new DomainEventWorker({
            domainEventsRepo: h.domainEventsRepo,
            deserializer: h.deserializer,
            materializer: {
                materialize(event, destination) {
                    materializerCalls += 1;
                    h.notificationService.materialize(event, destination);
                },
            },
            notificationWorker: h.notificationWorker,
            transactionManager: h.tx,
            clock: h.clock,
        });

        // Wrap getPendingDestinations so that right after the batch of 2 is loaded, the 2nd destination's subscription is cancelled via /unlink
        const origGetPending = h.domainEventsRepo.getPendingDestinations.bind(h.domainEventsRepo);
        vi.spyOn(h.domainEventsRepo, 'getPendingDestinations').mockImplementationOnce(
            (limit, now) => {
                const batch = origGetPending(limit, now);
                h.tx.retryInTransaction(() => {
                    h.domainEventsRepo.cancelForSubscription(secondSubId);
                });
                return batch;
            },
        );

        customWorker.processPending();

        expect(materializerCalls).toBe(1);
        expect(getDestinationStateById(h.db, dest1Id).status).toBe('materialized');
        expect(getDestinationStateById(h.db, dest2Id).status).toBe('cancelled');

        const queuedNotifications = h.notificationRepo.getPending(10, h.clock.nowEpochSeconds());
        expect(queuedNotifications).toHaveLength(1);
        expect(queuedNotifications[0]?.chatId).toBe(firstDest?.chatId);
    });

    it('rolls back notification and destination status atomically when enqueue or markMaterialized fails, then succeeds on retry', () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 7, 'Players');
        h.subscriptionRepo.subscribeToChat(-1001, 7, CLAN_TAG, 'players');

        h.tx.retryInTransaction(() => {
            h.recorder.recordAll([
                {
                    type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                    clanTag: CLAN_TAG,
                    playerTag: '#P1',
                    playerName: 'Alice',
                    membershipId: 61,
                },
            ]);
        });

        // Trigger that aborts when domain_event_destinations.status is updated to 'materialized'
        // (after NotificationService has already inserted into notifications inside the same transaction!)
        h.db.exec(`
            CREATE TRIGGER reject_materialized
            BEFORE UPDATE OF status ON domain_event_destinations
            WHEN NEW.status = 'materialized'
            BEGIN
                SELECT RAISE(ABORT, 'simulated markMaterialized failure');
            END;
        `);

        h.domainEventWorker.processPending();

        // Both the notification row AND the materialized status must be rolled back!
        const failedDest = getDestinationStateByEventId(h.db, '61');
        expect(failedDest.status).toBe('pending');
        expect(failedDest.attempts).toBe(1);
        expect(failedDest.next_attempt_at).toBe(h.clock.nowEpochSeconds() + 1);
        expect(failedDest.last_error).toContain('simulated markMaterialized failure');
        expect(h.notificationRepo.getPending(10, h.clock.nowEpochSeconds())).toHaveLength(0);

        // Drop the trigger; before backoff expires, destination is not picked up
        h.db.exec('DROP TRIGGER reject_materialized;');
        h.domainEventWorker.processPending();
        expect(getDestinationStateByEventId(h.db, '61').status).toBe('pending');

        // Advance FakeClock by 1 second so next_attempt_at is reached
        h.clock.advance(1_000);
        h.domainEventWorker.processPending();

        const recoveredDest = getDestinationStateByEventId(h.db, '61');
        expect(recoveredDest.status).toBe('materialized');
        expect(recoveredDest.attempts).toBe(1);
        expect(recoveredDest.next_attempt_at).toBeNull();
        expect(recoveredDest.last_error).toBeNull();

        const pendingNotifs = h.notificationRepo.getPending(10, h.clock.nowEpochSeconds());
        expect(pendingNotifs).toHaveLength(1);
        expect(pendingNotifs[0]?.chatId).toBe(-1001);
        expect(pendingNotifs[0]?.messageThreadId).toBe(7);
    });

    it('isolates a failing destination from subsequent destinations and logs an alert after 5 failures while keeping destination pending', () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        h.subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        const subId = h.subscriptionRepo.getSubscriptionId(-1001, 0, CLAN_TAG, 'players') ?? 1;

        // Append a malformed event payload followed by a valid event
        h.domainEventsRepo.appendEvent(
            {
                eventType: APPLICATION_EVENT_TYPES.playerJoinedClan,
                eventId: 'bad-payload',
                payload: '{}',
                payloadVersion: 1,
                clanTag: CLAN_TAG,
            },
            [
                {
                    chatId: -1001,
                    messageThreadId: 0,
                    audience: 'players',
                    subscriptionId: subId,
                },
            ],
        );
        h.recorder.recordAll([
            {
                type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                clanTag: CLAN_TAG,
                playerTag: '#P2',
                playerName: 'Bob',
                membershipId: 72,
            },
        ]);

        const warnSpy = vi.fn();
        const errorSpy = vi.fn();
        const mockLogger = {
            info: vi.fn(),
            warn: warnSpy,
            error: errorSpy,
            debug: vi.fn(),
            fatal: vi.fn(),
            trace: vi.fn(),
            child: () => mockLogger,
        };

        const worker = new DomainEventWorker(
            h.domainEventsRepo,
            h.deserializer,
            h.notificationService,
            h.notificationWorker,
            h.tx,
            {
                clock: h.clock,
                logger: mockLogger as unknown as ReturnType<typeof createLogger>,
            },
        );

        // Attempt 1: bad-payload fails (delay = 1s), event 72 succeeds in the same batch!
        worker.processPending();
        expect(getDestinationStateByEventId(h.db, '72').status).toBe('materialized');
        expect(h.notificationRepo.getPending(10, h.clock.nowEpochSeconds())).toHaveLength(1);

        let badState = getDestinationStateByEventId(h.db, 'bad-payload');
        expect(badState.status).toBe('pending');
        expect(badState.attempts).toBe(1);
        expect(badState.next_attempt_at).toBe(h.clock.nowEpochSeconds() + 1);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledTimes(0);

        // Attempts 2, 3, 4, 5 with exponential backoff (1s, 2s, 4s, 8s, 16s)
        const expectedDelaysSeconds = [1, 2, 4, 8, 16];
        for (let attempt = 2; attempt <= 5; attempt += 1) {
            const prevDelay = expectedDelaysSeconds[attempt - 2] ?? 1;
            h.clock.advance(prevDelay * 1_000);
            worker.processPending();

            badState = getDestinationStateByEventId(h.db, 'bad-payload');
            expect(badState.status).toBe('pending');
            expect(badState.attempts).toBe(attempt);
            const expectedNextDelay = expectedDelaysSeconds[attempt - 1] ?? 16;
            expect(badState.next_attempt_at).toBe(h.clock.nowEpochSeconds() + expectedNextDelay);
        }

        // Attempts 1..4 logged warn (4 times); Attempt 5 logged error alert (1 time)
        expect(warnSpy).toHaveBeenCalledTimes(4);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(String(errorSpy.mock.calls[0]?.[1])).toContain('reached the retry alert threshold');

        // Attempt 6 continues retrying with 32s backoff and keeps status = 'pending'
        h.clock.advance(16_000);
        worker.processPending();
        badState = getDestinationStateByEventId(h.db, 'bad-payload');
        expect(badState.status).toBe('pending');
        expect(badState.attempts).toBe(6);
        expect(badState.next_attempt_at).toBe(h.clock.nowEpochSeconds() + 32);
        expect(errorSpy).toHaveBeenCalledTimes(2);
    });

    it('rechecks NotificationRepo.isPending immediately before HTTP send and skips notifications cancelled by /unlink mid-batch', async () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 0, 'Chat 1');
        h.subscriptionRepo.saveTelegramChat(-1002, 0, 'Chat 2');
        h.subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        h.subscriptionRepo.subscribeToChat(-1002, 0, CLAN_TAG, 'players');

        const sub2Id = h.subscriptionRepo.getSubscriptionId(-1002, 0, CLAN_TAG, 'players');
        expect(sub2Id).not.toBeNull();

        h.tx.retryInTransaction(() => {
            h.recorder.recordAll([
                {
                    type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                    clanTag: CLAN_TAG,
                    playerTag: '#P1',
                    playerName: 'Alice',
                    membershipId: 81,
                },
            ]);
        });

        h.domainEventWorker.processPending();
        const pendingNotifs = h.notificationRepo.getPending(10, h.clock.nowEpochSeconds());
        expect(pendingNotifs).toHaveLength(2);
        const firstNotif = pendingNotifs[0];
        const secondNotif = pendingNotifs[1];
        const notif1Id = firstNotif?.id ?? 0;
        const notif2Id = secondNotif?.id ?? 0;
        const secondChatId = secondNotif?.chatId ?? 0;
        const secondSubId = h.subscriptionRepo.getSubscriptionId(
            secondChatId,
            0,
            CLAN_TAG,
            'players',
        );
        expect(secondSubId).not.toBeNull();

        // When notification 1 is sent over HTTP, the 2nd notification's subscription is unlinked before notification 2 starts
        h.setSendResponder(async (chatId, text, messageThreadId) => {
            expect(h.db.connection.inTransaction).toBe(false);
            h.sentMessages.push({ chatId, text, messageThreadId });
            if (chatId === firstNotif?.chatId && secondSubId !== null) {
                h.tx.retryInTransaction(() => {
                    h.domainEventsRepo.cancelForSubscription(secondSubId);
                });
            }
            await Promise.resolve();
        });

        await h.notificationWorker.processPending();

        expect(h.sentMessages).toHaveLength(1);
        expect(h.sentMessages[0]?.chatId).toBe(firstNotif?.chatId);
        expect(getNotificationState(h.db, notif1Id).status).toBe('sent');
        expect(getNotificationState(h.db, notif2Id).status).toBe('cancelled');
    });

    it('immediately reschedules HTTP 429 with retry_after in SQLite without blocking other chats in the batch, then delivers after retry_after', async () => {
        const h = createHarness();
        h.notificationRepo.enqueueIfAbsent('Msg Chat A', 'war_ended', '91', -1001, 0);
        h.notificationRepo.enqueueIfAbsent('Msg Chat B', 'war_ended', '92', -1002, 5);

        const initial = h.notificationRepo.getPending(10, h.clock.nowEpochSeconds());
        expect(initial).toHaveLength(2);
        const idA = initial[0]?.id ?? 0;
        const idB = initial[1]?.id ?? 0;

        let chatAAttempts = 0;
        h.setSendResponder(async (chatId, text, messageThreadId) => {
            await Promise.resolve();
            if (chatId === -1001) {
                chatAAttempts += 1;
                if (chatAAttempts === 1) {
                    throw new TelegramDeliveryError('Too Many Requests: retry after 60', {
                        kind: 'rate_limit',
                        statusCode: 429,
                        retryable: true,
                        retryAfterSeconds: 60,
                    });
                }
            }
            h.sentMessages.push({ chatId, text, messageThreadId });
        });

        await h.notificationWorker.processPending();

        // Chat B was delivered immediately without head-of-line blocking!
        expect(h.sentMessages).toEqual([{ chatId: -1002, text: 'Msg Chat B', messageThreadId: 5 }]);
        expect(getNotificationState(h.db, idB).status).toBe('sent');

        // Chat A is rescheduled for now + 60s
        const stateA = getNotificationState(h.db, idA);
        expect(stateA.status).toBe('pending');
        expect(stateA.attempts).toBe(1);
        expect(stateA.next_attempt_at).toBe(h.clock.nowEpochSeconds() + 60);
        expect(stateA.last_error).toContain('retry after 60');

        // Advancing FakeClock by 30s is not enough to trigger retry
        h.clock.advance(30_000);
        await h.notificationWorker.processPending();
        expect(chatAAttempts).toBe(1);
        expect(h.sentMessages).toHaveLength(1);

        // Advancing FakeClock by the remaining 30s (total 60s) delivers Chat A
        h.clock.advance(30_000);
        await h.notificationWorker.processPending();
        expect(chatAAttempts).toBe(2);
        expect(h.sentMessages).toHaveLength(2);
        const deliveredA = getNotificationState(h.db, idA);
        expect(deliveredA.status).toBe('sent');
        expect(deliveredA.attempts).toBe(1);
        expect(deliveredA.next_attempt_at).toBeNull();
        expect(deliveredA.last_error).toBeNull();
    });

    it('reschedules transient 500 errors with exponential backoff and marks failed after exhausting maxAttempts (4), while marking permanent 400/403 failed immediately', async () => {
        const h = createHarness();
        h.notificationRepo.enqueueIfAbsent('Permanent 403', 'war_ended', 'p-403', -2001, 0);
        h.notificationRepo.enqueueIfAbsent('Permanent 400', 'war_ended', 'p-400', -2002, 0);
        h.notificationRepo.enqueueIfAbsent('Transient 500', 'war_ended', 't-500', -2003, 0);

        const initial = h.notificationRepo.getPending(10, h.clock.nowEpochSeconds());
        const id403 = initial.find((n) => n.eventId === 'p-403')?.id ?? 0;
        const id400 = initial.find((n) => n.eventId === 'p-400')?.id ?? 0;
        const id500 = initial.find((n) => n.eventId === 't-500')?.id ?? 0;

        h.setSendResponder(async (chatId) => {
            await Promise.resolve();
            if (chatId === -2001) {
                throw new TelegramDeliveryError('Forbidden: bot was blocked by the user', {
                    kind: 'permanent',
                    statusCode: 403,
                    retryable: false,
                });
            }
            if (chatId === -2002) {
                throw new TelegramDeliveryError('Bad Request: chat not found', {
                    kind: 'permanent',
                    statusCode: 400,
                    retryable: false,
                });
            }
            throw new TelegramDeliveryError('Internal Server Error', {
                kind: 'transient',
                statusCode: 500,
                retryable: true,
            });
        });

        // Attempt 1
        await h.notificationWorker.processPending();

        // 403 and 400 are immediately marked failed on attempt 1
        const state403 = getNotificationState(h.db, id403);
        expect(state403.status).toBe('failed');
        expect(state403.attempts).toBe(1);
        expect(state403.next_attempt_at).toBeNull();
        expect(state403.last_error).toContain('Forbidden');

        const state400 = getNotificationState(h.db, id400);
        expect(state400.status).toBe('failed');
        expect(state400.attempts).toBe(1);
        expect(state400.next_attempt_at).toBeNull();
        expect(state400.last_error).toContain('Bad Request');

        // 500 is rescheduled (attempt 1: delay 500ms -> 1s)
        let state500 = getNotificationState(h.db, id500);
        expect(state500.status).toBe('pending');
        expect(state500.attempts).toBe(1);
        expect(state500.next_attempt_at).toBe(h.clock.nowEpochSeconds() + 1);

        // Attempt 2 (delay 1000ms -> 1s)
        h.clock.advance(1_000);
        await h.notificationWorker.processPending();
        state500 = getNotificationState(h.db, id500);
        expect(state500.status).toBe('pending');
        expect(state500.attempts).toBe(2);
        expect(state500.next_attempt_at).toBe(h.clock.nowEpochSeconds() + 1);

        // Attempt 3 (delay 2000ms -> 2s)
        h.clock.advance(1_000);
        await h.notificationWorker.processPending();
        state500 = getNotificationState(h.db, id500);
        expect(state500.status).toBe('pending');
        expect(state500.attempts).toBe(3);
        expect(state500.next_attempt_at).toBe(h.clock.nowEpochSeconds() + 2);

        // Attempt 4 (maxAttempts = 4 exhausted -> transitions to 'failed')
        h.clock.advance(2_000);
        await h.notificationWorker.processPending();
        state500 = getNotificationState(h.db, id500);
        expect(state500.status).toBe('failed');
        expect(state500.attempts).toBe(4);
        expect(state500.next_attempt_at).toBeNull();
        expect(state500.last_error).toContain('Internal Server Error');
    });

    it('retries delivery after claim TTL when markAsSent fails after a successful Telegram send (at-least-once crash gap)', async () => {
        const h = createHarness();
        h.notificationRepo.enqueueIfAbsent('Crash gap msg', 'war_ended', 'crash-1', -1001, 7);
        const notifId = h.notificationRepo.getPending(10, h.clock.nowEpochSeconds())[0]?.id ?? 0;

        h.db.exec(`
            CREATE TRIGGER reject_sent
            BEFORE UPDATE OF status ON notifications
            WHEN NEW.status = 'sent'
            BEGIN
                SELECT RAISE(ABORT, 'simulated crash before markAsSent');
            END;
        `);

        await h.notificationWorker.processPending();
        expect(h.sentMessages).toHaveLength(1);
        const stuckState = getNotificationState(h.db, notifId);
        expect(stuckState.status).toBe('sending');
        expect(stuckState.claimed_at).toBe(h.clock.nowEpochSeconds());

        h.db.exec('DROP TRIGGER reject_sent;');

        // Before default 60s TTL elapses, the in-flight 'sending' record is not picked up again
        h.clock.advance(59_000);
        await h.notificationWorker.processPending();
        expect(h.sentMessages).toHaveLength(1);
        expect(getNotificationState(h.db, notifId).status).toBe('sending');

        // Once 60s TTL elapses, TTL recovery returns it to 'pending' and re-delivers (at-least-once)
        h.clock.advance(1_000);
        await h.notificationWorker.processPending();
        expect(h.sentMessages).toHaveLength(2);
        const sentState = getNotificationState(h.db, notifId);
        expect(sentState.status).toBe('sent');
        expect(sentState.claimed_at).toBeNull();
    });

    it('stops NotificationWorker mid-batch on AbortSignal during an active loopback HTTP request without burning attempts, and delivers remaining items after restart', async () => {
        const h = createHarness();
        const ids: number[] = [];
        for (let i = 1; i <= 5; i += 1) {
            h.notificationRepo.enqueueIfAbsent(
                `Batch message ${String(i)}`,
                'war_ended',
                `batch-${String(i)}`,
                -1001,
                0,
            );
        }
        for (const item of h.notificationRepo.getPending(10, h.clock.nowEpochSeconds())) {
            ids.push(item.id);
        }
        expect(ids).toHaveLength(5);

        let resolveSecondRequestStarted!: () => void;
        const secondRequestStarted = new Promise<void>((resolve) => {
            resolveSecondRequestStarted = resolve;
        });

        let requestCount = 0;
        const firstServer = await startLoopbackServer((_req, res) => {
            requestCount += 1;
            if (requestCount === 1) {
                res.statusCode = 200;
                res.setHeader('content-type', 'application/json');
                res.end(
                    JSON.stringify({
                        ok: true,
                        result: {
                            message_id: 1,
                            date: 1_700_000_000,
                            chat: { id: -1001, type: 'supergroup' },
                            text: 'Batch message 1',
                        },
                    }),
                );
                return;
            }

            resolveSecondRequestStarted();
            // Hold 2nd HTTP request open until client aborts
        });
        openServers.push(firstServer);

        const firstGateway = new TelegramGateway('test-token', {
            apiRoot: firstServer.baseUrl,
        });
        const firstWorker = new NotificationWorker(h.notificationRepo, firstGateway, {
            clock: h.clock,
            retryPolicy: new RetryPolicy({ maxAttempts: 1 }),
        });

        const controller = new AbortController();
        const runPromise = firstWorker.run(controller.signal);

        await secondRequestStarted;
        const stopStart = Date.now();
        controller.abort();
        await runPromise;
        expect(Date.now() - stopStart).toBeLessThan(1_500);

        // Message 1 is sent; Messages 2..5 remain pending with attempts = 0 and last_error = null!
        expect(getNotificationState(h.db, ids[0] ?? 0).status).toBe('sent');
        for (let i = 1; i < ids.length; i += 1) {
            const state = getNotificationState(h.db, ids[i] ?? 0);
            expect(state.status).toBe('pending');
            expect(state.attempts).toBe(0);
            expect(state.last_error).toBeNull();
        }

        // Restart worker against a healthy server: delivers remaining 4 notifications
        let secondServerRequests = 0;
        const secondServer = await startLoopbackServer((_req, res) => {
            secondServerRequests += 1;
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(
                JSON.stringify({
                    ok: true,
                    result: {
                        message_id: secondServerRequests + 1,
                        date: 1_700_000_000,
                        chat: { id: -1001, type: 'supergroup' },
                        text: 'ok',
                    },
                }),
            );
        });
        openServers.push(secondServer);

        const secondGateway = new TelegramGateway('test-token', {
            apiRoot: secondServer.baseUrl,
        });
        const secondWorker = new NotificationWorker(h.notificationRepo, secondGateway, {
            clock: h.clock,
            retryPolicy: new RetryPolicy({ maxAttempts: 1 }),
        });

        await secondWorker.processPending();
        expect(secondServerRequests).toBe(4);
        for (const id of ids) {
            expect(getNotificationState(h.db, id).status).toBe('sent');
        }
    });

    it('stops DomainEventWorker mid-batch on requestStop without burning attempts on remaining destinations', () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        h.subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');

        const events: ApplicationEvent[] = [];
        for (let i = 101; i <= 105; i += 1) {
            events.push({
                type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                clanTag: CLAN_TAG,
                playerTag: `#P${String(i)}`,
                playerName: `Player ${String(i)}`,
                membershipId: i,
            });
        }
        h.tx.retryInTransaction(() => {
            h.recorder.recordAll(events);
        });

        const worker = new DomainEventWorker({
            domainEventsRepo: h.domainEventsRepo,
            deserializer: h.deserializer,
            notificationService: h.notificationService,
            notificationWorker: {
                notify() {
                    worker.requestStop();
                },
            },
            transactionManager: h.tx,
            clock: h.clock,
        });

        worker.processPending();

        expect(getDestinationStateByEventId(h.db, '101').status).toBe('materialized');
        for (let i = 102; i <= 105; i += 1) {
            const state = getDestinationStateByEventId(h.db, String(i));
            expect(state.status).toBe('pending');
            expect(state.attempts).toBe(0);
            expect(state.last_error).toBeNull();
        }
        expect(h.notificationRepo.getPending(10, h.clock.nowEpochSeconds())).toHaveLength(1);

        // Restarting with a new DomainEventWorker materializes the remaining 4 destinations
        h.domainEventWorker.processPending();
        for (let i = 101; i <= 105; i += 1) {
            expect(getDestinationStateByEventId(h.db, String(i)).status).toBe('materialized');
        }
        expect(h.notificationRepo.getPending(10, h.clock.nowEpochSeconds())).toHaveLength(5);
    });

    it('processes batches of up to 100 destinations, polls on 1-second FakeClock intervals, uses max(backoff, now + retry_after), and validates constructor options', async () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        h.subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');

        // Constructor validation
        expect(
            () =>
                new DomainEventWorker({
                    domainEventsRepo: h.domainEventsRepo,
                    transactionManager: h.tx,
                }),
        ).toThrow(/materializer/);
        expect(
            () =>
                new DomainEventWorker({
                    domainEventsRepo: h.domainEventsRepo,
                    transactionManager: h.tx,
                    notificationService: h.notificationService,
                    pollIntervalMs: 0,
                }),
        ).toThrow(RangeError);
        expect(
            () =>
                new NotificationWorker({
                    notificationRepo: h.notificationRepo,
                    telegramGateway: h.fakeGateway,
                    batchSize: -1,
                }),
        ).toThrow(RangeError);
        expect(
            () =>
                new NotificationWorker({
                    notificationRepo: h.notificationRepo,
                    telegramGateway: h.fakeGateway,
                    claimTtlSeconds: 0,
                }),
        ).toThrow(RangeError);

        // Verify max(backoff, now + retry_after) when backoff > retry_after vs retry_after > backoff
        // On attempt 3, backoff is 2000ms (2s). With retry_after = 1s, max(2s, 1s) = 2s.
        expect(h.notificationWorker.nextAttemptAt(3, 1)).toBe(h.clock.nowEpochSeconds() + 2);
        // With retry_after = 45s, max(2s, 45s) = 45s.
        expect(h.notificationWorker.nextAttemptAt(3, 45)).toBe(h.clock.nowEpochSeconds() + 45);

        // Start both workers and let initial poll run
        const domainRun = h.domainEventWorker.run();
        const notificationRun = h.notificationWorker.run();
        await flushMicrotasks();

        // Insert 105 events WITHOUT calling domainEventWorker.notify()
        const events: ApplicationEvent[] = [];
        for (let i = 1; i <= 105; i += 1) {
            events.push({
                type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                clanTag: CLAN_TAG,
                playerTag: `#P${String(i)}`,
                playerName: `Player ${String(i)}`,
                membershipId: 1000 + i,
            });
        }
        h.tx.retryInTransaction(() => {
            h.recorder.recordAll(events);
        });

        // Before 1s poll interval elapses, nothing is processed
        h.clock.advance(500);
        await flushMicrotasks();
        expect(h.sentMessages).toHaveLength(0);

        // At 1000ms (1s poll interval), DomainEventWorker processes batch of 100 and wakes NotificationWorker
        h.clock.advance(500);
        await flushMicrotasks();
        expect(h.sentMessages).toHaveLength(100);
        expect(
            h.domainEventsRepo.getPendingDestinations(100, h.clock.nowEpochSeconds()),
        ).toHaveLength(5);

        // At next 1000ms poll interval, the remaining 5 are materialized and delivered
        h.clock.advance(1_000);
        await flushMicrotasks();
        expect(h.sentMessages).toHaveLength(105);
        expect(
            h.domainEventsRepo.getPendingDestinations(100, h.clock.nowEpochSeconds()),
        ).toHaveLength(0);

        // Stop both workers via requestStop()
        h.domainEventWorker.requestStop();
        h.notificationWorker.requestStop();
        expect(h.domainEventWorker.isStopRequested()).toBe(true);
        expect(h.notificationWorker.isStopRequested()).toBe(true);
        await Promise.all([domainRun, notificationRun]);
    });

    it('delivers multi-part notifications in strict 1->2->3 order when part 1 suffers a transient failure without blocking other chats', async () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 0, 'Report Chat');
        h.subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'management');
        const subId = h.subscriptionRepo.getSubscriptionId(-1001, 0, CLAN_TAG, 'management') ?? 1;

        h.domainEventsRepo.appendEvent(
            {
                eventType: 'war_ended',
                eventId: 'multi-transient',
                payload: '{}',
                payloadVersion: 1,
                clanTag: CLAN_TAG,
            },
            [{ chatId: -1001, messageThreadId: 0, audience: 'management', subscriptionId: subId }],
        );
        const destId = h.domainEventsRepo.getPendingDestinations(10)[0]?.destinationId ?? 0;

        h.notificationRepo.enqueueDomainEventIfAbsent(
            'Report Part 1/3',
            destId,
            'war_roster_reliability',
            'multi-transient',
            -1001,
            0,
            1,
            3,
        );
        h.notificationRepo.enqueueDomainEventIfAbsent(
            'Report Part 2/3',
            destId,
            'war_roster_reliability',
            'multi-transient',
            -1001,
            0,
            2,
            3,
        );
        h.notificationRepo.enqueueDomainEventIfAbsent(
            'Report Part 3/3',
            destId,
            'war_roster_reliability',
            'multi-transient',
            -1001,
            0,
            3,
            3,
        );
        h.notificationRepo.enqueueIfAbsent('Other Chat Msg', 'war_ended', 'other-chat', -2002, 0);

        let part1Attempts = 0;
        h.setSendResponder(async (chatId, text, messageThreadId) => {
            await Promise.resolve();
            if (text === 'Report Part 1/3') {
                part1Attempts += 1;
                if (part1Attempts === 1) {
                    throw new TelegramDeliveryError('HTTP 500 Temporary Error', {
                        kind: 'transient',
                        statusCode: 500,
                        retryable: true,
                    });
                }
            }
            h.sentMessages.push({ chatId, text, messageThreadId });
        });

        // First cycle: Part 1 fails transiently -> Parts 2 & 3 MUST wait; other chat still delivers!
        await h.notificationWorker.processPending();
        expect(h.sentMessages).toEqual([
            { chatId: -2002, text: 'Other Chat Msg', messageThreadId: 0 },
        ]);

        const statesAfterFirstAttempt = h.db.connection
            .prepare<[number], { part_index: number; status: string; attempts: number }>(
                `SELECT part_index, status, attempts
                 FROM notifications
                 WHERE domain_event_destination_id = ?
                 ORDER BY part_index;`,
            )
            .all(destId);
        expect(statesAfterFirstAttempt).toEqual([
            { part_index: 1, status: 'pending', attempts: 1 },
            { part_index: 2, status: 'pending', attempts: 0 },
            { part_index: 3, status: 'pending', attempts: 0 },
        ]);

        // Before backoff elapses, nothing is sent
        await h.notificationWorker.processPending();
        expect(h.sentMessages).toHaveLength(1);

        // After 1s backoff, Part 1 succeeds and unlocks Part 2 -> Part 3 in strict order
        h.clock.advance(1_000);
        await h.notificationWorker.processPending();

        expect(h.sentMessages.map((m) => m.text)).toEqual([
            'Other Chat Msg',
            'Report Part 1/3',
            'Report Part 2/3',
            'Report Part 3/3',
        ]);

        const finalStates = h.db.connection
            .prepare<[number], { part_index: number; status: string }>(
                `SELECT part_index, status
                 FROM notifications
                 WHERE domain_event_destination_id = ?
                 ORDER BY part_index;`,
            )
            .all(destId);
        expect(finalStates).toEqual([
            { part_index: 1, status: 'sent' },
            { part_index: 2, status: 'sent' },
            { part_index: 3, status: 'sent' },
        ]);
    });

    it('cascades failed status to remaining pending parts on permanent error or exhausted retries of part 1', async () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 0, 'Permanent Chat');
        h.subscriptionRepo.saveTelegramChat(-1002, 0, 'Exhausted Chat');
        h.subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'management');
        h.subscriptionRepo.subscribeToChat(-1002, 0, CLAN_TAG, 'management');
        const sub1 = h.subscriptionRepo.getSubscriptionId(-1001, 0, CLAN_TAG, 'management') ?? 1;
        const sub2 = h.subscriptionRepo.getSubscriptionId(-1002, 0, CLAN_TAG, 'management') ?? 2;

        h.domainEventsRepo.appendEvent(
            {
                eventType: 'war_ended',
                eventId: 'multi-fail',
                payload: '{}',
                payloadVersion: 1,
                clanTag: CLAN_TAG,
            },
            [
                { chatId: -1001, messageThreadId: 0, audience: 'management', subscriptionId: sub1 },
                { chatId: -1002, messageThreadId: 0, audience: 'management', subscriptionId: sub2 },
            ],
        );
        const dests = h.domainEventsRepo.getPendingDestinations(10);
        const destPerm = dests.find((d) => d.chatId === -1001)?.destinationId ?? 0;
        const destExhaust = dests.find((d) => d.chatId === -1002)?.destinationId ?? 0;

        for (let part = 1; part <= 3; part += 1) {
            h.notificationRepo.enqueueDomainEventIfAbsent(
                `Perm Part ${String(part)}/3`,
                destPerm,
                'war_roster_reliability',
                'multi-fail',
                -1001,
                0,
                part,
                3,
            );
            h.notificationRepo.enqueueDomainEventIfAbsent(
                `Exhaust Part ${String(part)}/3`,
                destExhaust,
                'war_roster_reliability',
                'multi-fail',
                -1002,
                0,
                part,
                3,
            );
        }

        const attemptedTexts: string[] = [];
        h.setSendResponder(async (chatId, text) => {
            await Promise.resolve();
            attemptedTexts.push(text);
            if (chatId === -1001) {
                throw new TelegramDeliveryError('Bad Request: chat not found', {
                    kind: 'permanent',
                    statusCode: 400,
                    retryable: false,
                });
            }
            throw new TelegramDeliveryError('Internal Server Error', {
                kind: 'transient',
                statusCode: 500,
                retryable: true,
            });
        });

        // Attempt 1: permanent chat fails immediately and cascades parts 2..3; exhausted chat retries
        await h.notificationWorker.processPending();

        const permStates = h.db.connection
            .prepare<[number], { part_index: number; status: string; attempts: number }>(
                `SELECT part_index, status, attempts
                 FROM notifications
                 WHERE domain_event_destination_id = ?
                 ORDER BY part_index;`,
            )
            .all(destPerm);
        expect(permStates).toEqual([
            { part_index: 1, status: 'failed', attempts: 1 },
            { part_index: 2, status: 'failed', attempts: 0 },
            { part_index: 3, status: 'failed', attempts: 0 },
        ]);

        // Attempts 2, 3, 4 for exhausted chat (delays 1s, 1s, 2s)
        h.clock.advance(1_000);
        await h.notificationWorker.processPending();
        h.clock.advance(1_000);
        await h.notificationWorker.processPending();
        h.clock.advance(2_000);
        await h.notificationWorker.processPending();

        const exhaustStates = h.db.connection
            .prepare<[number], { part_index: number; status: string; attempts: number }>(
                `SELECT part_index, status, attempts
                 FROM notifications
                 WHERE domain_event_destination_id = ?
                 ORDER BY part_index;`,
            )
            .all(destExhaust);
        expect(exhaustStates).toEqual([
            { part_index: 1, status: 'failed', attempts: 4 },
            { part_index: 2, status: 'failed', attempts: 0 },
            { part_index: 3, status: 'failed', attempts: 0 },
        ]);

        // Parts 2 and 3 were NEVER attempted for either destination; zero pending orphans remain
        expect(attemptedTexts.every((text) => text.includes('Part 1/3'))).toBe(true);
        expect(h.notificationRepo.getPending(10, h.clock.nowEpochSeconds())).toHaveLength(0);
    });

    it('recovers remaining parts independently without re-sending already sent earlier parts', async () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 0, 'Recovery Chat');
        h.subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'management');
        const subId = h.subscriptionRepo.getSubscriptionId(-1001, 0, CLAN_TAG, 'management') ?? 1;

        h.domainEventsRepo.appendEvent(
            {
                eventType: 'war_ended',
                eventId: 'multi-recovery',
                payload: '{}',
                payloadVersion: 1,
                clanTag: CLAN_TAG,
            },
            [{ chatId: -1001, messageThreadId: 0, audience: 'management', subscriptionId: subId }],
        );
        const destId = h.domainEventsRepo.getPendingDestinations(10)[0]?.destinationId ?? 0;

        for (let part = 1; part <= 3; part += 1) {
            h.notificationRepo.enqueueDomainEventIfAbsent(
                `Recovery Part ${String(part)}/3`,
                destId,
                'war_roster_reliability',
                'multi-recovery',
                -1001,
                0,
                part,
                3,
            );
        }

        let part2Attempts = 0;
        h.setSendResponder(async (chatId, text, messageThreadId) => {
            await Promise.resolve();
            if (text === 'Recovery Part 2/3') {
                part2Attempts += 1;
                if (part2Attempts === 1) {
                    throw new TelegramDeliveryError('HTTP 502 Bad Gateway', {
                        kind: 'transient',
                        statusCode: 502,
                        retryable: true,
                    });
                }
            }
            h.sentMessages.push({ chatId, text, messageThreadId });
        });

        // Cycle 1: Part 1 succeeds, Part 2 fails transiently, Part 3 waits
        await h.notificationWorker.processPending();
        expect(h.sentMessages.map((m) => m.text)).toEqual(['Recovery Part 1/3']);

        // Simulate restart with a fresh NotificationWorker instance after backoff
        h.clock.advance(1_000);
        const restartedWorker = new NotificationWorker({
            notificationRepo: h.notificationRepo,
            telegramGateway: h.fakeGateway,
            clock: h.clock,
            logger: createLogger({ level: 'silent' }),
        });

        await restartedWorker.processPending();

        // Part 1 is NOT re-sent; Parts 2 and 3 recover and deliver in order
        expect(h.sentMessages.map((m) => m.text)).toEqual([
            'Recovery Part 1/3',
            'Recovery Part 2/3',
            'Recovery Part 3/3',
        ]);
    });

    it('materializes and delivers an end-to-end 50-player war roster report across multiple Telegram messages in order', async () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(5001, 0, 'Leader Private');
        h.subscriptionRepo.subscribeToChat(5001, 0, CLAN_TAG, 'management');

        const players = Array.from({ length: 50 }, (_, index) => {
            const num = String(index + 1).padStart(2, '0');
            return {
                tag: `#E2E${num}`,
                name: `🏆 Игрок_${num}_<Супер & Клан> 《Боец 🔥》`,
                clanTag: CLAN_TAG,
            };
        });
        h.clansRepo.savePlayers(players);
        const insertMembership = h.db.connection.prepare<[string, string, number]>(
            'INSERT INTO clan_memberships (clan_tag, player_tag, joined_at, left_at) VALUES (?, ?, ?, NULL);',
        );
        for (const player of players) {
            insertMembership.run(CLAN_TAG, player.tag, 1_600_000_000);
        }

        const warRef = h.clanwarRepo.saveCompleteClanwarData(
            {
                warUID: 'e2e-war-50',
                clanTag: CLAN_TAG,
                state: 'warEnded',
                warType: WarTypes.Regular,
                teamSize: 50,
                attacksPerMember: 2,
                preparationStartTime: 1_700_100_000,
                startTime: 1_700_186_400,
                endTime: 1_700_272_800,
                seasonId: null,
                roundNumber: null,
            },
            {
                home: {
                    side: ClanType.Home,
                    clanTag: CLAN_TAG,
                    clanName: 'Alpha Clan',
                    clanLevel: 15,
                    attacksCount: 50,
                    stars: 120,
                    destructionPercentage: 90.0,
                },
                opponent: {
                    side: ClanType.Opponent,
                    clanTag: '#E2EOPP',
                    clanName: 'Enemy 50',
                    clanLevel: 15,
                    attacksCount: 50,
                    stars: 100,
                    destructionPercentage: 75.0,
                },
            },
            players.slice(0, 25).map((player, index) => ({
                attackerTag: player.tag,
                defenderTag: `#E2EE${String(index + 1).padStart(2, '0')}`,
                attackerClanTag: CLAN_TAG,
                defenderClanTag: '#E2EOPP',
                attackerPosition: index + 1,
                defenderPosition: index + 1,
                orderNum: index + 1,
                stars: 3,
                destructionPercentage: 100.0,
                duration: 120,
            })),
            {
                home: players.map((player, index) => ({
                    clanTag: CLAN_TAG,
                    playerTag: player.tag,
                    playerName: player.name,
                    townhallLevel: 16,
                    mapPosition: index + 1,
                })),
                opponent: players.map((_, index) => ({
                    clanTag: '#E2EOPP',
                    playerTag: `#E2EE${String(index + 1).padStart(2, '0')}`,
                    playerName: `Enemy ${String(index + 1)}`,
                    townhallLevel: 16,
                    mapPosition: index + 1,
                })),
            },
        );

        h.tx.retryInTransaction(() => {
            h.recorder.recordAll([
                {
                    type: APPLICATION_EVENT_TYPES.warEnded,
                    clanTag: CLAN_TAG,
                    warReference: warRef,
                },
            ]);
        });

        h.domainEventWorker.processPending();
        await h.notificationWorker.processPending();

        // Expect war_violations (1+ parts) and war_roster_reliability (2+ parts), all <= 3900 <= 4096 visible chars
        const rosterMessages = h.sentMessages.filter(
            (m) => m.text.includes('НАДЁЖНОСТЬ СОСТАВА') || m.text.includes('Игрок_'),
        );
        expect(rosterMessages.length).toBeGreaterThanOrEqual(2);
        for (const msg of h.sentMessages) {
            const visibleLen = countTelegramHtmlVisibleLength(msg.text);
            expect(visibleLen).toBeLessThanOrEqual(DEFAULT_TELEGRAM_MAX_VISIBLE_LENGTH);
            expect(visibleLen).toBeLessThanOrEqual(TELEGRAM_HARD_MAX_VISIBLE_LENGTH);
        }

        // Verify all 50 players were delivered in the roster messages
        const combinedRoster = rosterMessages.map((m) => m.text).join('\n');
        for (let i = 1; i <= 50; i += 1) {
            expect(combinedRoster).toContain(`Игрок_${String(i).padStart(2, '0')}_`);
        }
    });

    it('coordinates multi-part ordering with sending claim TTL recovery and /unlink cancellation of subsequent parts', async () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-3001, 0, 'Stale Multi Chat');
        h.subscriptionRepo.saveTelegramChat(-3002, 0, 'Unlink Multi Chat');
        h.subscriptionRepo.subscribeToChat(-3001, 0, CLAN_TAG, 'management');
        h.subscriptionRepo.subscribeToChat(-3002, 0, CLAN_TAG, 'management');
        const subStale =
            h.subscriptionRepo.getSubscriptionId(-3001, 0, CLAN_TAG, 'management') ?? 0;
        const subUnlink =
            h.subscriptionRepo.getSubscriptionId(-3002, 0, CLAN_TAG, 'management') ?? 0;

        h.domainEventsRepo.appendEvent(
            {
                eventType: 'war_ended',
                eventId: 'multi-claim-coord',
                payload: '{}',
                payloadVersion: 1,
                clanTag: CLAN_TAG,
            },
            [
                {
                    chatId: -3001,
                    messageThreadId: 0,
                    audience: 'management',
                    subscriptionId: subStale,
                },
                {
                    chatId: -3002,
                    messageThreadId: 0,
                    audience: 'management',
                    subscriptionId: subUnlink,
                },
            ],
        );
        const dests = h.domainEventsRepo.getPendingDestinations(10);
        const destStale = dests.find((d) => d.chatId === -3001)?.destinationId ?? 0;
        const destUnlink = dests.find((d) => d.chatId === -3002)?.destinationId ?? 0;

        for (let part = 1; part <= 3; part += 1) {
            h.notificationRepo.enqueueDomainEventIfAbsent(
                `Stale Part ${String(part)}/3`,
                destStale,
                'war_roster_reliability',
                'multi-claim-coord',
                -3001,
                0,
                part,
                3,
            );
            h.notificationRepo.enqueueDomainEventIfAbsent(
                `Unlink Part ${String(part)}/3`,
                destUnlink,
                'war_roster_reliability',
                'multi-claim-coord',
                -3002,
                0,
                part,
                3,
            );
        }

        // Simulate stale in-flight 'sending' claim on destStale part 1
        const stalePart1 = h.notificationRepo
            .getPending(10, h.clock.nowEpochSeconds())
            .find((n) => n.chatId === -3001);
        expect(stalePart1?.partIndex).toBe(1);
        expect(
            h.notificationRepo.claimForSending(stalePart1?.id ?? 0, h.clock.nowEpochSeconds()),
        ).toBe(true);

        // While destUnlink part 1 is in-flight, /unlink cancels pending parts 2 & 3; part 1 finishes
        h.setSendResponder(async (chatId, text, messageThreadId) => {
            if (chatId === -3002 && text === 'Unlink Part 1/3') {
                h.tx.retryInTransaction(() => {
                    h.domainEventsRepo.cancelForSubscription(subUnlink);
                    h.subscriptionRepo.unsubscribeFromChat(-3002, 0, CLAN_TAG, 'management');
                });
            }
            h.sentMessages.push({ chatId, text, messageThreadId });
            await Promise.resolve();
        });

        // At T0 + 59s (before 60s TTL): destStale parts 2 & 3 MUST remain blocked by sending part 1;
        // destUnlink part 1 finishes, parts 2 & 3 are cancelled and never sent!
        h.clock.advance(59_000);
        await h.notificationWorker.processPending();

        expect(h.sentMessages).toEqual([
            { chatId: -3002, text: 'Unlink Part 1/3', messageThreadId: 0 },
        ]);

        const unlinkStates = h.db.connection
            .prepare<[number], { part_index: number; status: string; claimed_at: number | null }>(
                `SELECT part_index, status, claimed_at
                 FROM notifications
                 WHERE domain_event_destination_id = ?
                 ORDER BY part_index;`,
            )
            .all(destUnlink);
        expect(unlinkStates).toEqual([
            { part_index: 1, status: 'sent', claimed_at: null },
            { part_index: 2, status: 'cancelled', claimed_at: null },
            { part_index: 3, status: 'cancelled', claimed_at: null },
        ]);

        // At T0 + 60s (TTL reached): destStale part 1 recovers from 'sending' -> delivers 1 -> 2 -> 3 in order
        h.clock.advance(1_000);
        await h.notificationWorker.processPending();

        expect(h.sentMessages.map((m) => m.text)).toEqual([
            'Unlink Part 1/3',
            'Stale Part 1/3',
            'Stale Part 2/3',
            'Stale Part 3/3',
        ]);
    });

    it('handles deterministic /unlink race before and after claim in DomainEventWorker and rolls back claim if materialize fails', async () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 0, 'Chat 1');
        h.subscriptionRepo.saveTelegramChat(-1002, 0, 'Chat 2');
        h.subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        h.subscriptionRepo.subscribeToChat(-1002, 0, CLAN_TAG, 'players');

        const sub1Id = h.subscriptionRepo.getSubscriptionId(-1001, 0, CLAN_TAG, 'players');
        const sub2Id = h.subscriptionRepo.getSubscriptionId(-1002, 0, CLAN_TAG, 'players');
        expect(sub1Id).not.toBeNull();
        expect(sub2Id).not.toBeNull();

        h.tx.retryInTransaction(() => {
            h.recorder.recordAll([
                {
                    type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                    clanTag: CLAN_TAG,
                    playerTag: '#P1',
                    playerName: 'Alice',
                    membershipId: 201,
                },
            ]);
        });

        // Case 1: materialize fails AFTER conditional markMaterialized claim inside the same transaction -> rollback!
        let failOnce = true;
        const failingWorker = new DomainEventWorker({
            domainEventsRepo: h.domainEventsRepo,
            deserializer: h.deserializer,
            materializer: {
                materialize(event, destination) {
                    if (failOnce && destination.chatId === -1001) {
                        failOnce = false;
                        throw new Error('transient formatter failure after claim');
                    }
                    h.notificationService.materialize(event, destination);
                },
            },
            notificationWorker: h.notificationWorker,
            transactionManager: h.tx,
            clock: h.clock,
        });

        failingWorker.processPending();

        const destRowsAfterFail = h.db.connection
            .prepare<[], { id: number; chat_id: number; status: string; attempts: number }>(
                'SELECT id, chat_id, status, attempts FROM domain_event_destinations ORDER BY chat_id;',
            )
            .all();
        const destChat1 = destRowsAfterFail.find((r) => r.chat_id === -1001);
        const destChat2 = destRowsAfterFail.find((r) => r.chat_id === -1002);
        // Chat 1 rolled back to 'pending' and rescheduled; Chat 2 materialized cleanly
        expect(destChat1?.status).toBe('pending');
        expect(destChat1?.attempts).toBe(1);
        expect(destChat2?.status).toBe('materialized');

        // Case 2: DomainEventWorker already materialized Chat 2, then /unlink runs BEFORE NotificationWorker claims -> cancelled, never sent!
        h.tx.retryInTransaction(() => {
            h.domainEventsRepo.cancelForSubscription(sub2Id ?? 0);
            h.subscriptionRepo.unsubscribeFromChat(-1002, 0, CLAN_TAG, 'players');
        });

        await h.notificationWorker.processPending();
        expect(h.sentMessages).toHaveLength(0);

        const chat2Notif = h.db.connection
            .prepare<[], { status: string; last_error: string | null }>(
                'SELECT status, last_error FROM notifications WHERE chat_id = -1002;',
            )
            .get();
        expect(chat2Notif).toEqual({ status: 'cancelled', last_error: 'subscription cancelled' });

        // Case 3: Retry Chat 1 succeeds after backoff and delivers to active subscription
        h.clock.advance(1_000);
        failingWorker.processPending();
        await h.notificationWorker.processPending();
        expect(h.sentMessages).toHaveLength(1);
        expect(h.sentMessages[0]?.chatId).toBe(-1001);
    });

    it('allows in-flight claimed notification to finish on success after /unlink, but cancels retry on transient failure and blocks unclaimed pending notifications', async () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 0, 'In-flight Success');
        h.subscriptionRepo.saveTelegramChat(-1002, 0, 'In-flight Transient Fail');
        h.subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        h.subscriptionRepo.subscribeToChat(-1002, 0, CLAN_TAG, 'players');

        const sub1Id = h.subscriptionRepo.getSubscriptionId(-1001, 0, CLAN_TAG, 'players') ?? 0;
        const sub2Id = h.subscriptionRepo.getSubscriptionId(-1002, 0, CLAN_TAG, 'players') ?? 0;

        // Two events for sub1 (first will be claimed in-flight, second stays pending until /unlink cancels it)
        // and one event for sub2 (claimed in-flight, /unlink runs during HTTP, then HTTP fails transiently)
        h.tx.retryInTransaction(() => {
            h.recorder.recordAll([
                {
                    type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                    clanTag: CLAN_TAG,
                    playerTag: '#P1',
                    playerName: 'First',
                    membershipId: 301,
                },
                {
                    type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                    clanTag: CLAN_TAG,
                    playerTag: '#P2',
                    playerName: 'Second',
                    membershipId: 302,
                },
            ]);
        });

        h.domainEventWorker.processPending();
        const queued = h.notificationRepo.getPending(10, h.clock.nowEpochSeconds());
        expect(queued).toHaveLength(4);

        const sub1First = queued.find((n) => n.chatId === -1001 && n.eventId === '301');
        const sub1Second = queued.find((n) => n.chatId === -1001 && n.eventId === '302');
        const sub2First = queued.find((n) => n.chatId === -1002 && n.eventId === '301');
        const sub2Second = queued.find((n) => n.chatId === -1002 && n.eventId === '302');
        expect(sub1First).toBeDefined();
        expect(sub1Second).toBeDefined();
        expect(sub2First).toBeDefined();
        expect(sub2Second).toBeDefined();

        h.setSendResponder(async (chatId, text, messageThreadId) => {
            expect(h.db.connection.inTransaction).toBe(false);
            if (chatId === -1001) {
                // Verify notification was already atomically claimed as 'sending' before HTTP started
                const state = getNotificationState(h.db, sub1First?.id ?? 0);
                expect(state.status).toBe('sending');
                expect(state.claimed_at).toBe(h.clock.nowEpochSeconds());

                // /unlink wins while sub1First is in-flight -> cancels sub1Second (pending), leaves sub1First ('sending')
                h.tx.retryInTransaction(() => {
                    h.domainEventsRepo.cancelForSubscription(sub1Id);
                    h.subscriptionRepo.unsubscribeFromChat(-1001, 0, CLAN_TAG, 'players');
                });
                h.sentMessages.push({ chatId, text, messageThreadId });
                await Promise.resolve();
                return;
            }

            if (chatId === -1002) {
                // /unlink wins while sub2First is in-flight, THEN Telegram responds with transient 500
                h.tx.retryInTransaction(() => {
                    h.domainEventsRepo.cancelForSubscription(sub2Id);
                    h.subscriptionRepo.unsubscribeFromChat(-1002, 0, CLAN_TAG, 'players');
                });
                await Promise.resolve();
                throw new TelegramDeliveryError('Internal Server Error', {
                    kind: 'transient',
                    statusCode: 500,
                    retryable: true,
                });
            }
        });

        await h.notificationWorker.processPending();

        // sub1First was in-flight and succeeded -> 'sent'; sub1Second was cancelled before claim -> never sent
        expect(h.sentMessages).toHaveLength(1);
        expect(h.sentMessages[0]?.chatId).toBe(-1001);
        expect(getNotificationState(h.db, sub1First?.id ?? 0).status).toBe('sent');
        expect(getNotificationState(h.db, sub1First?.id ?? 0).claimed_at).toBeNull();
        expect(getNotificationState(h.db, sub1Second?.id ?? 0).status).toBe('cancelled');

        // sub2First failed transiently after /unlink -> MUST be cancelled (no new retry attempt scheduled!)
        expect(getNotificationState(h.db, sub2First?.id ?? 0).status).toBe('cancelled');
        expect(getNotificationState(h.db, sub2First?.id ?? 0).claimed_at).toBeNull();
        expect(getNotificationState(h.db, sub2Second?.id ?? 0).status).toBe('cancelled');

        // Advancing clock and running worker again MUST NOT send any new requests
        h.clock.advance(120_000);
        await h.notificationWorker.processPending();
        expect(h.sentMessages).toHaveLength(1);
    });

    it('recovers stuck sending notifications on worker startup (active -> pending & delivered, cancelled -> cancelled) before TTL expires', async () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 0, 'Active Chat');
        h.subscriptionRepo.saveTelegramChat(-1002, 0, 'Unlinked Chat');
        h.subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        h.subscriptionRepo.subscribeToChat(-1002, 0, CLAN_TAG, 'players');

        const unlinkedSubId =
            h.subscriptionRepo.getSubscriptionId(-1002, 0, CLAN_TAG, 'players') ?? 0;

        h.tx.retryInTransaction(() => {
            h.recorder.recordAll([
                {
                    type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                    clanTag: CLAN_TAG,
                    playerTag: '#P1',
                    playerName: 'CrashVictim',
                    membershipId: 401,
                },
            ]);
        });
        h.domainEventWorker.processPending();

        const queued = h.notificationRepo.getPending(10, h.clock.nowEpochSeconds());
        const activeNotif = queued.find((n) => n.chatId === -1001);
        const unlinkedNotif = queued.find((n) => n.chatId === -1002);
        expect(activeNotif).toBeDefined();
        expect(unlinkedNotif).toBeDefined();

        // Simulate crash mid-flight: both notifications are claimed as 'sending' right now (0s elapsed, well under 60s TTL)
        const now = h.clock.nowEpochSeconds();
        expect(h.notificationRepo.claimForSending(activeNotif?.id ?? 0, now)).toBe(true);
        expect(h.notificationRepo.claimForSending(unlinkedNotif?.id ?? 0, now)).toBe(true);

        // Chat -1002 unlinked before restart
        h.tx.retryInTransaction(() => {
            h.domainEventsRepo.cancelForSubscription(unlinkedSubId);
            h.subscriptionRepo.unsubscribeFromChat(-1002, 0, CLAN_TAG, 'players');
        });

        // Start a brand-new NotificationWorker only 5 seconds later (before 60s TTL!)
        h.clock.advance(5_000);
        const restartedWorker = new NotificationWorker({
            notificationRepo: h.notificationRepo,
            telegramGateway: h.fakeGateway,
            clock: h.clock,
        });

        const controller = new AbortController();
        const runPromise = restartedWorker.run(controller.signal);
        await flushMicrotasks();
        controller.abort();
        await runPromise;

        // Active notification was recovered on startup and delivered; unlinked notification was cancelled and never sent
        expect(h.sentMessages).toHaveLength(1);
        expect(h.sentMessages[0]?.chatId).toBe(-1001);
        expect(getNotificationState(h.db, activeNotif?.id ?? 0).status).toBe('sent');
        expect(getNotificationState(h.db, activeNotif?.id ?? 0).claimed_at).toBeNull();
        expect(getNotificationState(h.db, unlinkedNotif?.id ?? 0).status).toBe('cancelled');
        expect(getNotificationState(h.db, unlinkedNotif?.id ?? 0).claimed_at).toBeNull();
        expect(getNotificationState(h.db, unlinkedNotif?.id ?? 0).last_error).toBe(
            'subscription cancelled',
        );
    });

    it('recovers stuck sending notifications by 60s TTL (and custom claimTtlSeconds) while enforcing subscription generation isolation', async () => {
        const h = createHarness();
        h.subscriptionRepo.saveTelegramChat(-1001, 0, 'Active Chat');
        h.subscriptionRepo.saveTelegramChat(-1002, 0, 'Relinked Chat');
        h.subscriptionRepo.saveTelegramChat(-1003, 5, 'Other Topic');
        h.subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        h.subscriptionRepo.subscribeToChat(-1002, 0, CLAN_TAG, 'players');
        h.subscriptionRepo.subscribeToChat(-1003, 5, CLAN_TAG, 'players');

        const relinkedOldSubId =
            h.subscriptionRepo.getSubscriptionId(-1002, 0, CLAN_TAG, 'players') ?? 0;

        h.tx.retryInTransaction(() => {
            h.recorder.recordAll([
                {
                    type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                    clanTag: CLAN_TAG,
                    playerTag: '#P1',
                    playerName: 'GenOne',
                    membershipId: 501,
                },
            ]);
        });
        h.domainEventWorker.processPending();

        const queued = h.notificationRepo.getPending(10, h.clock.nowEpochSeconds());
        const activeNotif = queued.find((n) => n.chatId === -1001);
        const relinkedOldNotif = queued.find((n) => n.chatId === -1002);
        const otherTopicNotif = queued.find((n) => n.chatId === -1003);
        expect(activeNotif).toBeDefined();
        expect(relinkedOldNotif).toBeDefined();
        expect(otherTopicNotif).toBeDefined();

        // Mark all three as stuck 'sending' at T0
        const claimedAt = h.clock.nowEpochSeconds();
        expect(h.notificationRepo.claimForSending(activeNotif?.id ?? 0, claimedAt)).toBe(true);
        expect(h.notificationRepo.claimForSending(relinkedOldNotif?.id ?? 0, claimedAt)).toBe(true);
        expect(h.notificationRepo.claimForSending(otherTopicNotif?.id ?? 0, claimedAt)).toBe(true);

        // /unlink -> /link on chat -1002 creates a NEW subscription generation (sub2 != relinkedOldSubId)
        h.tx.retryInTransaction(() => {
            h.domainEventsRepo.cancelForSubscription(relinkedOldSubId);
            h.subscriptionRepo.unsubscribeFromChat(-1002, 0, CLAN_TAG, 'players');
            h.subscriptionRepo.saveTelegramChat(-1002, 0, 'Relinked Chat');
            h.subscriptionRepo.subscribeToChat(-1002, 0, CLAN_TAG, 'players');
        });
        const relinkedNewSubId =
            h.subscriptionRepo.getSubscriptionId(-1002, 0, CLAN_TAG, 'players') ?? 0;
        expect(relinkedNewSubId).not.toBe(relinkedOldSubId);

        // Record a new event for the NEW subscription generation
        h.tx.retryInTransaction(() => {
            h.recorder.recordAll([
                {
                    type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                    clanTag: CLAN_TAG,
                    playerTag: '#P2',
                    playerName: 'GenTwo',
                    membershipId: 502,
                },
            ]);
        });
        h.domainEventWorker.processPending();

        // At T0 + 59s (1s before default 60s TTL): GenTwo delivers immediately, while GenOne stuck rows remain 'sending'
        h.clock.advance(59_000);
        await h.notificationWorker.processPending();
        expect(h.sentMessages.filter((m) => m.text.includes('GenTwo'))).toHaveLength(3);
        expect(h.sentMessages.filter((m) => m.text.includes('GenOne'))).toHaveLength(0);
        expect(getNotificationState(h.db, activeNotif?.id ?? 0).status).toBe('sending');
        expect(getNotificationState(h.db, relinkedOldNotif?.id ?? 0).status).toBe('sending');
        expect(getNotificationState(h.db, otherTopicNotif?.id ?? 0).status).toBe('sending');

        // At T0 + 60s (exact TTL boundary): active & otherTopic recover and deliver; relinkedOldNotif cancels despite new generation!
        h.clock.advance(1_000);
        await h.notificationWorker.processPending();

        const genOneSent = h.sentMessages.filter((m) => m.text.includes('GenOne'));
        expect(genOneSent.map((m) => m.chatId).sort((a, b) => a - b)).toEqual([-1003, -1001]);
        expect(getNotificationState(h.db, activeNotif?.id ?? 0).status).toBe('sent');
        expect(getNotificationState(h.db, otherTopicNotif?.id ?? 0).status).toBe('sent');
        expect(getNotificationState(h.db, relinkedOldNotif?.id ?? 0).status).toBe('cancelled');
        expect(getNotificationState(h.db, relinkedOldNotif?.id ?? 0).claimed_at).toBeNull();
        expect(getNotificationState(h.db, relinkedOldNotif?.id ?? 0).last_error).toBe(
            'subscription cancelled',
        );

        // Verify custom claimTtlSeconds option (e.g., 15s) works independently of default 60s
        h.notificationRepo.enqueueIfAbsent('Custom TTL msg', 'war_ended', 'custom-ttl-1', -1001, 0);
        const customNotifId =
            h.notificationRepo.getPending(10, h.clock.nowEpochSeconds())[0]?.id ?? 0;
        expect(h.notificationRepo.claimForSending(customNotifId, h.clock.nowEpochSeconds())).toBe(
            true,
        );

        const customTtlWorker = new NotificationWorker({
            notificationRepo: h.notificationRepo,
            telegramGateway: h.fakeGateway,
            clock: h.clock,
            claimTtlSeconds: 15,
        });

        h.clock.advance(14_000);
        await customTtlWorker.processPending();
        expect(getNotificationState(h.db, customNotifId).status).toBe('sending');

        h.clock.advance(1_000);
        await customTtlWorker.processPending();
        expect(getNotificationState(h.db, customNotifId).status).toBe('sent');
    });
});
