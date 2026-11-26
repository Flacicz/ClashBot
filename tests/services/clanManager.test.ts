import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CocApiError, parseRaidSeasonsResponse } from '../../src/api/index.js';
import { FakeClock } from '../../src/common/clock.js';
import { AbortError, DatabaseError } from '../../src/common/errors.js';
import {
    ClansRepo,
    Database,
    DomainEventsRepo,
    MigratorManager,
    RaidRepo,
    RetryPolicy,
    SubscriptionRepo,
    SYNC_SERVICE_NAMES,
    SyncOutageRepo,
    TransactionManager,
} from '../../src/database/index.js';
import { DomainEventPayloadSerializer, DomainEventRecorder } from '../../src/domainEvents/index.js';
import { APPLICATION_EVENT_TYPES } from '../../src/events/applicationEvents.js';
import type { Logger } from '../../src/logging/logger.js';
import {
    ClanInfoService,
    ClanManager,
    createSyncError,
    createSyncSuccess,
    DEFAULT_CLAN_LOAD_RETRY_DELAY_MS,
    DEFAULT_SYNC_CYCLE_INTERVAL_MS,
    DEFAULT_SYNC_RETRY_DELAY_MS,
    RaidService,
    type ClanInfoApiClient,
    type RaidApiClient,
    type SyncResult,
    type SyncService,
    type TrackedClansReader,
} from '../../src/services/index.js';
import { AttackGuideCatalog, TelegramBotService } from '../../src/telegram/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');

class CallbackSyncService implements SyncService {
    private readonly serviceName: string;
    private readonly handler: (clanTag: string, signal?: AbortSignal) => Promise<SyncResult>;

    constructor(
        serviceName: string,
        handler: (clanTag: string, signal?: AbortSignal) => Promise<SyncResult> | SyncResult,
    ) {
        this.serviceName = serviceName;
        this.handler = (clanTag, signal) => Promise.resolve(handler(clanTag, signal));
    }

    getServiceName(): string {
        return this.serviceName;
    }

    updateData(clanTag: string, signal?: AbortSignal): Promise<SyncResult> {
        return this.handler(clanTag, signal);
    }
}

interface OutageRow {
    readonly id: number;
    readonly clan_tag: string;
    readonly service_name: string;
    readonly failure_count: number;
    readonly recovered_at: number | null;
}

interface DomainEventRow {
    readonly id: number;
    readonly event_type: string;
    readonly event_id: string;
    readonly event_payload: string;
    readonly payload_version: number;
    readonly clan_tag: string;
}

interface DestinationRow {
    readonly id: number;
    readonly domain_event_id: number;
    readonly chat_id: number;
    readonly message_thread_id: number;
    readonly category: string;
    readonly status: string;
}

async function waitForCondition(predicate: () => boolean, maxTicks = 200): Promise<void> {
    for (let tick = 0; tick < maxTicks; tick += 1) {
        if (predicate()) {
            return;
        }
        await Promise.resolve();
    }
    throw new Error('Timed out waiting for asynchronous condition');
}

function createMockLogger(): {
    readonly logger: Logger;
    readonly info: ReturnType<typeof vi.fn>;
    readonly warn: ReturnType<typeof vi.fn>;
    readonly error: ReturnType<typeof vi.fn>;
    readonly debug: ReturnType<typeof vi.fn>;
} {
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const debug = vi.fn();
    const logger = {
        info,
        warn,
        error,
        debug,
    } as unknown as Logger;
    return { logger, info, warn, error, debug };
}

describe('ClanManager', () => {
    const openDatabases: Database[] = [];

    afterEach(() => {
        while (openDatabases.length > 0) {
            const db = openDatabases.pop();
            db?.close();
        }
    });

    function createTestContext() {
        const db = new Database(':memory:');
        openDatabases.push(db);

        const transactionManager = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactionManager);
        migrator.migrate(REAL_MIGRATIONS_PATH);

        const clansRepo = new ClansRepo(db);
        const syncOutageRepo = new SyncOutageRepo(db);
        const subscriptionRepo = new SubscriptionRepo(db);
        const domainEventsRepo = new DomainEventsRepo(db);
        const serializer = new DomainEventPayloadSerializer();
        const recorder = new DomainEventRecorder(serializer, subscriptionRepo, domainEventsRepo);

        const seedTrackedClan = (
            clanTag: string,
            options: { managementChatId?: number; playersChatId?: number } = {},
        ): void => {
            clansRepo.insertMinimalClan(clanTag);
            if (options.managementChatId !== undefined) {
                subscriptionRepo.saveTelegramChat(options.managementChatId, 0, 'private');
                subscriptionRepo.subscribeToChat(
                    options.managementChatId,
                    0,
                    clanTag,
                    'management',
                );
            }
            if (options.playersChatId !== undefined) {
                subscriptionRepo.saveTelegramChat(options.playersChatId, 0, 'group');
                subscriptionRepo.subscribeToChat(options.playersChatId, 0, clanTag, 'players');
            }
        };

        const getOutages = (): OutageRow[] =>
            db.connection
                .prepare<[], OutageRow>(
                    'SELECT id, clan_tag, service_name, failure_count, recovered_at FROM sync_outages ORDER BY id ASC;',
                )
                .all();

        const getDomainEvents = (): DomainEventRow[] =>
            db.connection
                .prepare<[], DomainEventRow>(
                    'SELECT id, event_type, event_id, event_payload, payload_version, clan_tag FROM domain_events ORDER BY id ASC;',
                )
                .all();

        const getDestinations = (): DestinationRow[] =>
            db.connection
                .prepare<[], DestinationRow>(
                    'SELECT id, domain_event_id, chat_id, message_thread_id, category, status FROM domain_event_destinations ORDER BY id ASC;',
                )
                .all();

        return {
            db,
            transactionManager,
            clansRepo,
            syncOutageRepo,
            subscriptionRepo,
            domainEventsRepo,
            recorder,
            seedTrackedClan,
            getOutages,
            getDomainEvents,
            getDestinations,
        };
    }

    it('validates interval options in constructor', () => {
        const ctx = createTestContext();

        expect(
            () =>
                new ClanManager(
                    [],
                    ctx.clansRepo,
                    ctx.syncOutageRepo,
                    ctx.transactionManager,
                    ctx.recorder,
                    { cycleIntervalMs: -1 },
                ),
        ).toThrow(RangeError);

        expect(
            () =>
                new ClanManager(
                    [],
                    ctx.clansRepo,
                    ctx.syncOutageRepo,
                    ctx.transactionManager,
                    ctx.recorder,
                    { clanLoadRetryDelayMs: Number.NaN },
                ),
        ).toThrow(RangeError);
    });

    it('runs a full synchronization cycle sequentially across tracked clans and services and sleeps 15 minutes', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });
        ctx.seedTrackedClan('#CLAN2', { managementChatId: 2002 });
        ctx.clansRepo.insertMinimalClan('#UNTRACKED');
        ctx.clansRepo.disableTracking('#UNTRACKED');

        const clock = new FakeClock(1_000_000);
        const calls: string[] = [];

        const services: SyncService[] = SYNC_SERVICE_NAMES.map(
            (serviceName) =>
                new CallbackSyncService(serviceName, (tag) => {
                    calls.push(`${tag}:${serviceName}`);
                    return createSyncSuccess(serviceName, tag);
                }),
        );

        const manager = new ClanManager(
            services,
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        await waitForCondition(() => clock.pendingSleepCount() === 1);

        expect(calls).toEqual([
            '#CLAN1:ClanInfoService',
            '#CLAN1:ClanwarService',
            '#CLAN1:ClanwarLeagueService',
            '#CLAN1:RaidService',
            '#CLAN2:ClanInfoService',
            '#CLAN2:ClanwarService',
            '#CLAN2:ClanwarLeagueService',
            '#CLAN2:RaidService',
        ]);
        expect(ctx.getOutages()).toHaveLength(0);
        expect(ctx.getDomainEvents()).toHaveLength(0);

        // Should still be sleeping 1 ms before 15 minutes elapse
        clock.advance(DEFAULT_SYNC_CYCLE_INTERVAL_MS - 1);
        await Promise.resolve();
        expect(calls).toHaveLength(8);

        // Add a new tracked clan before the second cycle starts
        ctx.seedTrackedClan('#CLAN3', { managementChatId: 2003 });
        clock.advance(1);
        await waitForCondition(() => calls.length === 20 && clock.pendingSleepCount() === 1);

        expect(calls.slice(8)).toContain('#CLAN3:ClanInfoService');
        expect(calls.slice(8)).toContain('#CLAN3:RaidService');

        controller.abort();
        await runPromise;
    });

    it('recovers on the 2nd attempt after a 2-second pause without opening a sync outage', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });

        const clock = new FakeClock(5_000);
        const attemptTimestamps: number[] = [];

        const service = new CallbackSyncService('ClanwarService', (tag) => {
            attemptTimestamps.push(clock.nowMs());
            if (attemptTimestamps.length === 1) {
                return createSyncError('ClanwarService', tag, 'temporary 503');
            }
            return createSyncSuccess('ClanwarService', tag);
        });

        const manager = new ClanManager(
            [service],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        await waitForCondition(
            () => attemptTimestamps.length === 1 && clock.pendingSleepCount() === 1,
        );
        expect(ctx.getOutages()).toHaveLength(0);

        // Advance 2 seconds for retry
        clock.advance(DEFAULT_SYNC_RETRY_DELAY_MS);
        await waitForCondition(
            () => attemptTimestamps.length === 2 && clock.pendingSleepCount() === 1,
        );

        expect(attemptTimestamps).toEqual([5_000, 5_000 + DEFAULT_SYNC_RETRY_DELAY_MS]);
        expect(ctx.getOutages()).toHaveLength(0);
        expect(ctx.getDomainEvents()).toHaveLength(0);

        controller.abort();
        await runPromise;
    });

    it('opens a sync outage after 3 failed attempts with 2-second pauses and continues processing other services and clans without duplicate failure events', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001, playersChatId: 1001 });
        ctx.seedTrackedClan('#CLAN2', { managementChatId: 2002 });

        const clock = new FakeClock(10_000);
        const failingTimestamps: number[] = [];
        const otherCalls: string[] = [];

        const failingService = new CallbackSyncService('ClanInfoService', (tag) => {
            if (tag === '#CLAN1') {
                failingTimestamps.push(clock.nowMs());
                return createSyncError('ClanInfoService', tag, 'CoC API 503');
            }
            otherCalls.push(`ClanInfoService:${tag}`);
            return createSyncSuccess('ClanInfoService', tag);
        });

        const healthyService = new CallbackSyncService('RaidService', (tag) => {
            otherCalls.push(`RaidService:${tag}`);
            return createSyncSuccess('RaidService', tag);
        });

        const manager = new ClanManager(
            [failingService, healthyService],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        // Attempt 1 fails -> waiting 2s
        await waitForCondition(
            () => failingTimestamps.length === 1 && clock.pendingSleepCount() === 1,
        );
        clock.advance(DEFAULT_SYNC_RETRY_DELAY_MS);

        // Attempt 2 fails -> waiting 2s
        await waitForCondition(
            () => failingTimestamps.length === 2 && clock.pendingSleepCount() === 1,
        );
        clock.advance(DEFAULT_SYNC_RETRY_DELAY_MS);

        // Attempt 3 fails -> outage recorded, remaining services/clans run, cycle finishes and sleeps 15m
        await waitForCondition(
            () =>
                failingTimestamps.length === 3 &&
                otherCalls.length === 3 &&
                clock.pendingSleepCount() === 1,
        );

        expect(failingTimestamps).toEqual([
            10_000,
            10_000 + DEFAULT_SYNC_RETRY_DELAY_MS,
            10_000 + DEFAULT_SYNC_RETRY_DELAY_MS * 2,
        ]);
        expect(otherCalls).toEqual([
            'RaidService:#CLAN1',
            'ClanInfoService:#CLAN2',
            'RaidService:#CLAN2',
        ]);

        const outagesAfterCycle1 = ctx.getOutages();
        expect(outagesAfterCycle1).toHaveLength(1);
        const firstOutage = outagesAfterCycle1[0];
        expect(firstOutage).toBeDefined();
        expect(firstOutage?.clan_tag).toBe('#CLAN1');
        expect(firstOutage?.service_name).toBe('ClanInfoService');
        expect(firstOutage?.failure_count).toBe(1);
        expect(firstOutage?.recovered_at).toBeNull();

        const eventsAfterCycle1 = ctx.getDomainEvents();
        expect(eventsAfterCycle1).toHaveLength(1);
        expect(eventsAfterCycle1[0]).toMatchObject({
            event_type: APPLICATION_EVENT_TYPES.syncFailure,
            event_id: String(firstOutage?.id),
            payload_version: 1,
            clan_tag: '#CLAN1',
        });
        expect(JSON.parse(eventsAfterCycle1[0]?.event_payload ?? '{}')).toEqual({
            service_name: 'ClanInfoService',
            error_message: 'CoC API 503',
            attempts: 1,
            outage_id: firstOutage?.id,
        });

        // Only subscriptions with 'system' category (management preset) receive SyncFailureEvent, not players preset
        const destinationsAfterCycle1 = ctx.getDestinations();
        expect(destinationsAfterCycle1).toHaveLength(1);
        expect(destinationsAfterCycle1[0]).toMatchObject({
            chat_id: 2001,
            message_thread_id: 0,
            category: 'system',
            status: 'pending',
        });

        // Cycle 2: fails again -> increments failure_count on the same outage without duplicating SyncFailureEvent
        clock.advance(DEFAULT_SYNC_CYCLE_INTERVAL_MS);
        await waitForCondition(
            () => failingTimestamps.length === 4 && clock.pendingSleepCount() === 1,
        );
        clock.advance(DEFAULT_SYNC_RETRY_DELAY_MS);
        await waitForCondition(
            () => failingTimestamps.length === 5 && clock.pendingSleepCount() === 1,
        );
        clock.advance(DEFAULT_SYNC_RETRY_DELAY_MS);
        await waitForCondition(
            () =>
                failingTimestamps.length === 6 &&
                otherCalls.length === 6 &&
                clock.pendingSleepCount() === 1,
        );

        const outagesAfterCycle2 = ctx.getOutages();
        expect(outagesAfterCycle2).toHaveLength(1);
        expect(outagesAfterCycle2[0]?.id).toBe(firstOutage?.id);
        expect(outagesAfterCycle2[0]?.failure_count).toBe(2);
        expect(outagesAfterCycle2[0]?.recovered_at).toBeNull();

        expect(ctx.getDomainEvents()).toHaveLength(1);
        expect(ctx.getDestinations()).toHaveLength(1);

        controller.abort();
        await runPromise;
    });

    it('closes outage and records one SyncRecoveryEvent on recovery, then creates a new outage ID on a later failure', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });

        const clock = new FakeClock(20_000);
        let shouldFail = true;
        let callCount = 0;

        const service = new CallbackSyncService('ClanwarLeagueService', (tag) => {
            callCount += 1;
            if (shouldFail) {
                return createSyncError('ClanwarLeagueService', tag, 'gateway timeout');
            }
            return createSyncSuccess('ClanwarLeagueService', tag);
        });

        const manager = new ClanManager(
            [service],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            {
                clock,
                retryPolicy: new RetryPolicy({ maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 }),
            },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        // Cycle 1: fails -> opens outage #1
        await waitForCondition(() => callCount === 1 && clock.pendingSleepCount() === 1);
        const firstOutageId = ctx.syncOutageRepo.getOpenOutageId('#CLAN1', 'ClanwarLeagueService');
        expect(firstOutageId).not.toBeNull();

        // Cycle 2: succeeds -> recovers outage #1 and writes SyncRecoveryEvent
        shouldFail = false;
        clock.advance(DEFAULT_SYNC_CYCLE_INTERVAL_MS);
        await waitForCondition(() => callCount === 2 && clock.pendingSleepCount() === 1);

        expect(ctx.syncOutageRepo.getOpenOutageId('#CLAN1', 'ClanwarLeagueService')).toBeNull();
        const outagesAfterRecovery = ctx.getOutages();
        expect(outagesAfterRecovery).toHaveLength(1);
        expect(outagesAfterRecovery[0]?.recovered_at).not.toBeNull();

        const eventsAfterRecovery = ctx.getDomainEvents();
        expect(eventsAfterRecovery).toHaveLength(2);
        expect(eventsAfterRecovery[1]).toMatchObject({
            event_type: APPLICATION_EVENT_TYPES.syncRecovery,
            event_id: String(firstOutageId),
            payload_version: 1,
            clan_tag: '#CLAN1',
        });
        expect(JSON.parse(eventsAfterRecovery[1]?.event_payload ?? '{}')).toEqual({
            service_name: 'ClanwarLeagueService',
            outage_id: firstOutageId,
        });

        // Cycle 3: succeeds again -> idempotent, no additional recovery event
        clock.advance(DEFAULT_SYNC_CYCLE_INTERVAL_MS);
        await waitForCondition(() => callCount === 3 && clock.pendingSleepCount() === 1);
        expect(ctx.getDomainEvents()).toHaveLength(2);

        // Cycle 4: fails again -> opens a NEW outage with a NEW id and records a new SyncFailureEvent
        shouldFail = true;
        clock.advance(DEFAULT_SYNC_CYCLE_INTERVAL_MS);
        await waitForCondition(() => callCount === 4 && clock.pendingSleepCount() === 1);

        const secondOutageId = ctx.syncOutageRepo.getOpenOutageId('#CLAN1', 'ClanwarLeagueService');
        expect(secondOutageId).not.toBeNull();
        expect(secondOutageId).not.toBe(firstOutageId);

        const allOutages = ctx.getOutages();
        expect(allOutages).toHaveLength(2);
        expect(allOutages[1]?.id).toBe(secondOutageId);
        expect(allOutages[1]?.failure_count).toBe(1);
        expect(allOutages[1]?.recovered_at).toBeNull();

        const allEvents = ctx.getDomainEvents();
        expect(allEvents).toHaveLength(3);
        expect(allEvents[2]).toMatchObject({
            event_type: APPLICATION_EVENT_TYPES.syncFailure,
            event_id: String(secondOutageId),
            clan_tag: '#CLAN1',
        });

        controller.abort();
        await runPromise;
    });

    it('logs DatabaseError when loading tracked clans fails and retries after 30 seconds', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });

        const clock = new FakeClock(30_000);
        const { logger, error } = createMockLogger();

        let loadAttempts = 0;
        const flakyClansRepo: TrackedClansReader = {
            getTrackedClans: () => {
                loadAttempts += 1;
                if (loadAttempts === 1) {
                    throw new DatabaseError('database is locked', { sqliteCode: 'SQLITE_BUSY' });
                }
                return ctx.clansRepo.getTrackedClans();
            },
        };

        const syncedClans: string[] = [];
        const service = new CallbackSyncService('ClanInfoService', (tag) => {
            syncedClans.push(tag);
            return createSyncSuccess('ClanInfoService', tag);
        });

        const manager = new ClanManager(
            [service],
            flakyClansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock, logger },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        await waitForCondition(() => loadAttempts === 1 && clock.pendingSleepCount() === 1);
        expect(error).toHaveBeenCalledTimes(1);
        expect(syncedClans).toEqual([]);

        // Still waiting 1 ms before 30s elapse
        clock.advance(DEFAULT_CLAN_LOAD_RETRY_DELAY_MS - 1);
        await Promise.resolve();
        expect(loadAttempts).toBe(1);

        // At 30s, retries loading tracked clans and succeeds
        clock.advance(1);
        await waitForCondition(() => syncedClans.length === 1 && clock.pendingSleepCount() === 1);
        expect(loadAttempts).toBe(2);
        expect(syncedClans).toEqual(['#CLAN1']);

        controller.abort();
        await runPromise;
    });

    it('stops immediately between services and clans when AbortSignal fires', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });
        ctx.seedTrackedClan('#CLAN2', { managementChatId: 2002 });

        const clock = new FakeClock(40_000);
        const controller = new AbortController();
        const calls: string[] = [];

        const firstService = new CallbackSyncService('ClanInfoService', (tag) => {
            calls.push(`ClanInfoService:${tag}`);
            controller.abort();
            return createSyncSuccess('ClanInfoService', tag);
        });
        const secondService = new CallbackSyncService('ClanwarService', (tag) => {
            calls.push(`ClanwarService:${tag}`);
            return createSyncSuccess('ClanwarService', tag);
        });

        const manager = new ClanManager(
            [firstService, secondService],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        await manager.syncAll(controller.signal);

        expect(calls).toEqual(['ClanInfoService:#CLAN1']);
        expect(ctx.getOutages()).toHaveLength(0);
        expect(ctx.getDomainEvents()).toHaveLength(0);
    });

    it('aborts during retry wait without recording a false sync outage', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });

        const clock = new FakeClock(50_000);
        let attempts = 0;

        const failingService = new CallbackSyncService('RaidService', (tag) => {
            attempts += 1;
            return createSyncError('RaidService', tag, 'transient failure');
        });

        const manager = new ClanManager(
            [failingService],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        await waitForCondition(() => attempts === 1 && clock.pendingSleepCount() === 1);

        controller.abort();
        await runPromise;

        expect(attempts).toBe(1);
        expect(ctx.syncOutageRepo.getOpenOutageId('#CLAN1', 'RaidService')).toBeNull();
        expect(ctx.getOutages()).toHaveLength(0);
        expect(ctx.getDomainEvents()).toHaveLength(0);
    });

    it('aborts an in-flight service call without recording a false sync outage', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });

        const clock = new FakeClock(60_000);
        let started = false;

        const slowService = new CallbackSyncService('ClanwarService', (_tag, signal) => {
            started = true;
            return new Promise<SyncResult>((_resolve, reject) => {
                if (signal?.aborted) {
                    reject(new AbortError('Aborted'));
                    return;
                }
                signal?.addEventListener(
                    'abort',
                    () => {
                        reject(new AbortError('In-flight request aborted'));
                    },
                    { once: true },
                );
            });
        });

        const manager = new ClanManager(
            [slowService],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        await waitForCondition(() => started);

        controller.abort();
        await runPromise;

        expect(ctx.getOutages()).toHaveLength(0);
        expect(ctx.getDomainEvents()).toHaveLength(0);
    });

    it('returns immediately when AbortSignal is already aborted before syncAll starts', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });

        const clock = new FakeClock(70_000);
        const getTrackedClans = vi.fn(() => ctx.clansRepo.getTrackedClans());
        const serviceFn = vi.fn((tag: string) => createSyncSuccess('ClanInfoService', tag));

        const manager = new ClanManager(
            [new CallbackSyncService('ClanInfoService', serviceFn)],
            { getTrackedClans },
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        const controller = new AbortController();
        controller.abort();

        await manager.syncAll(controller.signal);

        expect(getTrackedClans).not.toHaveBeenCalled();
        expect(serviceFn).not.toHaveBeenCalled();
        expect(ctx.getOutages()).toHaveLength(0);
    });

    it('logs unexpected non-abort exceptions from a service and continues processing remaining services', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });

        const clock = new FakeClock(80_000);
        const { logger, error } = createMockLogger();
        const completed: string[] = [];

        const throwingService = new CallbackSyncService('ClanInfoService', () => {
            throw new Error('unexpected crash');
        });
        const healthyService = new CallbackSyncService('ClanwarService', (tag) => {
            completed.push(tag);
            return createSyncSuccess('ClanwarService', tag);
        });

        const manager = new ClanManager(
            [throwingService, healthyService],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock, logger },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        await waitForCondition(() => completed.length === 1 && clock.pendingSleepCount() === 1);

        expect(error).toHaveBeenCalledTimes(1);
        expect(completed).toEqual(['#CLAN1']);
        expect(ctx.getOutages()).toHaveLength(0);

        controller.abort();
        await runPromise;
    });

    it('does not record a false sync outage if a service returns error after AbortSignal has fired', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });

        const clock = new FakeClock(90_000);
        const controller = new AbortController();

        const service = new CallbackSyncService('ClanInfoService', (tag) => {
            controller.abort();
            return createSyncError('ClanInfoService', tag, 'aborted request wrapped as error');
        });

        const manager = new ClanManager(
            [service],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        await manager.syncAll(controller.signal);

        expect(ctx.getOutages()).toHaveLength(0);
        expect(ctx.getDomainEvents()).toHaveLength(0);
    });

    it('aborts immediately during the 30-second retry wait after a tracked clans load failure', async () => {
        const ctx = createTestContext();
        const clock = new FakeClock(100_000);
        let loadAttempts = 0;

        const failingClansRepo: TrackedClansReader = {
            getTrackedClans: () => {
                loadAttempts += 1;
                throw new DatabaseError('sqlite busy', { sqliteCode: 'SQLITE_BUSY' });
            },
        };

        const manager = new ClanManager(
            [],
            failingClansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        await waitForCondition(() => loadAttempts === 1 && clock.pendingSleepCount() === 1);

        controller.abort();
        await runPromise;

        expect(loadAttempts).toBe(1);
    });

    it('rolls back sync_outages atomically if DomainEventRecorder fails inside handleSyncFailure', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });

        const clock = new FakeClock(110_000);
        const { logger, error } = createMockLogger();

        const failingRecorder = {
            recordAll: () => {
                throw new DatabaseError('simulated domain_events write failure');
            },
        } as unknown as DomainEventRecorder;

        const failingService = new CallbackSyncService('ClanInfoService', (tag) =>
            createSyncError('ClanInfoService', tag, 'api down'),
        );
        const healthyCalls: string[] = [];
        const healthyService = new CallbackSyncService('RaidService', (tag) => {
            healthyCalls.push(tag);
            return createSyncSuccess('RaidService', tag);
        });

        const manager = new ClanManager(
            [failingService, healthyService],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            failingRecorder,
            {
                clock,
                logger,
                retryPolicy: new RetryPolicy({ maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 }),
            },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        await waitForCondition(() => healthyCalls.length === 1 && clock.pendingSleepCount() === 1);

        expect(ctx.getOutages()).toHaveLength(0);
        expect(ctx.getDomainEvents()).toHaveLength(0);
        expect(healthyCalls).toEqual(['#CLAN1']);
        expect(error).toHaveBeenCalled();

        controller.abort();
        await runPromise;
    });

    it('does not retry or open sync_outages for absent raid responses (items: [], scheduled, 404), but opens outage on 5xx, network, and invalid_schema', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });

        const clock = new FakeClock(120_000);
        const raidRepo = new RaidRepo(ctx.db);
        const endpoint = '/clans/%23CLAN1/capitalraidseasons?limit=1';

        type ApiOutcome =
            | { readonly kind: 'raw'; readonly body: unknown }
            | { readonly kind: 'null' }
            | { readonly kind: 'error'; readonly error: Error };

        let currentOutcome: ApiOutcome = { kind: 'raw', body: { items: [] } };
        let apiCalls = 0;

        const apiClient: RaidApiClient = {
            getCompleteRaidData(clanTag: string) {
                apiCalls += 1;
                if (currentOutcome.kind === 'error') {
                    return Promise.reject(currentOutcome.error);
                }
                if (currentOutcome.kind === 'null') {
                    return Promise.resolve(null);
                }
                try {
                    return Promise.resolve(
                        parseRaidSeasonsResponse(currentOutcome.body, clanTag, endpoint),
                    );
                } catch (err: unknown) {
                    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
                }
            },
        };

        const raidService = new RaidService(
            ctx.clansRepo,
            raidRepo,
            apiClient,
            ctx.transactionManager,
            ctx.recorder,
            clock,
        );

        const manager = new ClanManager(
            [raidService],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        // Cycle 1: items: [] -> 1 API call (no retry), no outage
        await waitForCondition(() => apiCalls === 1 && clock.pendingSleepCount() === 1);
        expect(ctx.getOutages()).toHaveLength(0);
        expect(ctx.getDomainEvents()).toHaveLength(0);

        // Cycle 2: state === 'scheduled' -> 1 API call (no retry), no outage
        currentOutcome = { kind: 'raw', body: { items: [{ state: 'scheduled' }] } };
        clock.advance(DEFAULT_SYNC_CYCLE_INTERVAL_MS);
        await waitForCondition(() => apiCalls === 2 && clock.pendingSleepCount() === 1);
        expect(ctx.getOutages()).toHaveLength(0);
        expect(ctx.getDomainEvents()).toHaveLength(0);

        // Cycle 3: 404 (null) -> 1 API call (no retry), no outage
        currentOutcome = { kind: 'null' };
        clock.advance(DEFAULT_SYNC_CYCLE_INTERVAL_MS);
        await waitForCondition(() => apiCalls === 3 && clock.pendingSleepCount() === 1);
        expect(ctx.getOutages()).toHaveLength(0);
        expect(ctx.getDomainEvents()).toHaveLength(0);

        // Cycle 4: HTTP 503 -> 3 attempts (2 retries), opens RaidService outage + SyncFailureEvent
        currentOutcome = {
            kind: 'error',
            error: new CocApiError('HTTP 503', {
                kind: 'server_error',
                statusCode: 503,
                retryable: true,
                endpoint,
            }),
        };
        clock.advance(DEFAULT_SYNC_CYCLE_INTERVAL_MS);
        await waitForCondition(() => apiCalls === 4 && clock.pendingSleepCount() === 1);
        clock.advance(DEFAULT_SYNC_RETRY_DELAY_MS);
        await waitForCondition(() => apiCalls === 5 && clock.pendingSleepCount() === 1);
        clock.advance(DEFAULT_SYNC_RETRY_DELAY_MS);
        await waitForCondition(() => apiCalls === 6 && clock.pendingSleepCount() === 1);

        const outagesAfter503 = ctx.getOutages();
        expect(outagesAfter503).toHaveLength(1);
        expect(outagesAfter503[0]).toMatchObject({
            clan_tag: '#CLAN1',
            service_name: 'RaidService',
            failure_count: 1,
            recovered_at: null,
        });
        expect(ctx.getDomainEvents()).toHaveLength(1);
        expect(ctx.getDomainEvents()[0]?.event_type).toBe(APPLICATION_EVENT_TYPES.syncFailure);

        // Cycle 5: recovers cleanly when raid data is normally absent (items: [])
        currentOutcome = { kind: 'raw', body: { items: [] } };
        clock.advance(DEFAULT_SYNC_CYCLE_INTERVAL_MS);
        await waitForCondition(() => apiCalls === 7 && clock.pendingSleepCount() === 1);

        expect(ctx.syncOutageRepo.getOpenOutageId('#CLAN1', 'RaidService')).toBeNull();
        expect(ctx.getOutages()[0]?.recovered_at).not.toBeNull();
        expect(ctx.getDomainEvents()).toHaveLength(2);
        expect(ctx.getDomainEvents()[1]?.event_type).toBe(APPLICATION_EVENT_TYPES.syncRecovery);

        // Cycle 6: invalid_schema ({ items: [{ state: 'ongoing' }] } without members) -> 3 attempts, opens new outage
        currentOutcome = { kind: 'raw', body: { items: [{ state: 'ongoing' }] } };
        clock.advance(DEFAULT_SYNC_CYCLE_INTERVAL_MS);
        await waitForCondition(() => apiCalls === 8 && clock.pendingSleepCount() === 1);
        clock.advance(DEFAULT_SYNC_RETRY_DELAY_MS);
        await waitForCondition(() => apiCalls === 9 && clock.pendingSleepCount() === 1);
        clock.advance(DEFAULT_SYNC_RETRY_DELAY_MS);
        await waitForCondition(() => apiCalls === 10 && clock.pendingSleepCount() === 1);

        const outagesAfterInvalidSchema = ctx.getOutages();
        expect(outagesAfterInvalidSchema).toHaveLength(2);
        expect(outagesAfterInvalidSchema[1]).toMatchObject({
            clan_tag: '#CLAN1',
            service_name: 'RaidService',
            failure_count: 1,
            recovered_at: null,
        });
        expect(ctx.getDomainEvents()).toHaveLength(3);
        expect(ctx.getDomainEvents()[2]?.event_type).toBe(APPLICATION_EVENT_TYPES.syncFailure);

        controller.abort();
        await runPromise;
    });

    it('keeps next_due schedule without accumulating drift from sync processing duration', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });
        ctx.seedTrackedClan('#CLAN2', { managementChatId: 2002 });

        const startMs = 1_000_000;
        const clock = new FakeClock(startMs);
        const clan1DurationMs = 2 * 60 * 1000;
        const clan2DurationMs = 3 * 60 * 1000;
        const totalCycleDurationMs = clan1DurationMs + clan2DurationMs;
        const events: { readonly clanTag: string; readonly startedAtMs: number }[] = [];

        const service = new CallbackSyncService('ClanInfoService', async (tag, signal) => {
            events.push({ clanTag: tag, startedAtMs: clock.nowMs() });
            const durationMs = tag === '#CLAN1' ? clan1DurationMs : clan2DurationMs;
            await clock.sleep(durationMs, signal);
            return createSyncSuccess('ClanInfoService', tag);
        });

        const manager = new ClanManager(
            [service],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        // Cycle 1: #CLAN1 starts at t0 (2m), #CLAN2 starts at t0 + 2m (3m), finishes at t0 + 5m
        await waitForCondition(() => events.length === 1 && clock.pendingSleepCount() === 1);
        clock.advance(clan1DurationMs);
        await waitForCondition(() => events.length === 2 && clock.pendingSleepCount() === 1);
        clock.advance(clan2DurationMs);
        await waitForCondition(() => clock.pendingSleepCount() === 1);

        expect(events).toEqual([
            { clanTag: '#CLAN1', startedAtMs: startMs },
            { clanTag: '#CLAN2', startedAtMs: startMs + clan1DurationMs },
        ]);

        // Remaining wait is 15m - 5m = 10m; 1ms before t0 + 15m nothing has started yet
        const remainingToCycle2 = DEFAULT_SYNC_CYCLE_INTERVAL_MS - totalCycleDurationMs;
        clock.advance(remainingToCycle2 - 1);
        await Promise.resolve();
        expect(events).toHaveLength(2);

        // At exact t0 + 15m, Cycle 2 starts with zero drift
        clock.advance(1);
        await waitForCondition(() => events.length === 3 && clock.pendingSleepCount() === 1);
        clock.advance(clan1DurationMs);
        await waitForCondition(() => events.length === 4 && clock.pendingSleepCount() === 1);
        clock.advance(clan2DurationMs);
        await waitForCondition(() => clock.pendingSleepCount() === 1);

        expect(events.slice(2)).toEqual([
            { clanTag: '#CLAN1', startedAtMs: startMs + DEFAULT_SYNC_CYCLE_INTERVAL_MS },
            {
                clanTag: '#CLAN2',
                startedAtMs: startMs + DEFAULT_SYNC_CYCLE_INTERVAL_MS + clan1DurationMs,
            },
        ]);

        // Cycle 3 starts at exact t0 + 30m (no accumulated drift across multiple cycles)
        clock.advance(remainingToCycle2);
        await waitForCondition(() => events.length === 5 && clock.pendingSleepCount() === 1);
        expect(events[4]).toEqual({
            clanTag: '#CLAN1',
            startedAtMs: startMs + DEFAULT_SYNC_CYCLE_INTERVAL_MS * 2,
        });

        controller.abort();
        await runPromise;
    });

    it('skips missed intervals on cycle overrun without triggering a catch-up storm', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });

        const startMs = 2_000_000;
        const clock = new FakeClock(startMs);
        const overrunDurationMs = DEFAULT_SYNC_CYCLE_INTERVAL_MS + 60_000; // 16m > 15m
        const startTimestamps: number[] = [];

        const service = new CallbackSyncService('ClanInfoService', async (tag, signal) => {
            startTimestamps.push(clock.nowMs());
            if (startTimestamps.length === 1) {
                await clock.sleep(overrunDurationMs, signal);
            }
            return createSyncSuccess('ClanInfoService', tag);
        });

        const manager = new ClanManager(
            [service],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        await waitForCondition(
            () => startTimestamps.length === 1 && clock.pendingSleepCount() === 1,
        );
        clock.advance(overrunDurationMs);
        await waitForCondition(() => clock.pendingSleepCount() === 1);

        // No immediate catch-up storm at t0 + 16m
        expect(startTimestamps).toEqual([startMs]);

        // Next due is aligned to t0 + 30m (14m remaining)
        const remainingToAlignedSlot = DEFAULT_SYNC_CYCLE_INTERVAL_MS - 60_000;
        clock.advance(remainingToAlignedSlot - 1);
        await Promise.resolve();
        expect(startTimestamps).toHaveLength(1);

        clock.advance(1);
        await waitForCondition(
            () => startTimestamps.length === 2 && clock.pendingSleepCount() === 1,
        );
        expect(startTimestamps).toEqual([startMs, startMs + DEFAULT_SYNC_CYCLE_INTERVAL_MS * 2]);

        controller.abort();
        await runPromise;
    });

    it('wakes immediately on notify() to sync a newly tracked clan without re-syncing already scheduled clans', async () => {
        const ctx = createTestContext();
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });

        const startMs = 3_000_000;
        const clock = new FakeClock(startMs);
        const syncLog: { readonly clanTag: string; readonly atMs: number }[] = [];

        const service = new CallbackSyncService('ClanInfoService', (tag) => {
            syncLog.push({ clanTag: tag, atMs: clock.nowMs() });
            return createSyncSuccess('ClanInfoService', tag);
        });

        const manager = new ClanManager(
            [service],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        await waitForCondition(() => syncLog.length === 1 && clock.pendingSleepCount() === 1);
        expect(syncLog).toEqual([{ clanTag: '#CLAN1', atMs: startMs }]);

        // 5 minutes later, a new clan is linked and notify() is called
        const linkDelayMs = 5 * 60 * 1000;
        clock.advance(linkDelayMs);
        ctx.seedTrackedClan('#CLAN2', { managementChatId: 2002 });
        manager.notify();

        await waitForCondition(() => syncLog.length === 2 && clock.pendingSleepCount() === 1);
        expect(syncLog).toEqual([
            { clanTag: '#CLAN1', atMs: startMs },
            { clanTag: '#CLAN2', atMs: startMs + linkDelayMs },
        ]);

        // Calling notify() again without new clans does not trigger spurious re-syncs
        clock.advance(60_000);
        manager.notify();
        await waitForCondition(() => clock.pendingSleepCount() === 1);
        expect(syncLog).toHaveLength(2);

        // At t0 + 15m, only #CLAN1 is due
        clock.advance(DEFAULT_SYNC_CYCLE_INTERVAL_MS - linkDelayMs - 60_000);
        await waitForCondition(() => syncLog.length === 3 && clock.pendingSleepCount() === 1);
        expect(syncLog[2]).toEqual({
            clanTag: '#CLAN1',
            atMs: startMs + DEFAULT_SYNC_CYCLE_INTERVAL_MS,
        });

        // At t0 + 20m (linkTime + 15m), only #CLAN2 is due
        clock.advance(linkDelayMs);
        await waitForCondition(() => syncLog.length === 4 && clock.pendingSleepCount() === 1);
        expect(syncLog[3]).toEqual({
            clanTag: '#CLAN2',
            atMs: startMs + linkDelayMs + DEFAULT_SYNC_CYCLE_INTERVAL_MS,
        });

        controller.abort();
        await runPromise;
    });

    it('wakes immediately from empty tracked clans state and prioritizes a newly linked clan arriving mid-cycle', async () => {
        const ctx = createTestContext();

        const startMs = 4_000_000;
        const clock = new FakeClock(startMs);
        const order: { readonly clanTag: string; readonly atMs: number }[] = [];
        let slowFirstClan = false;

        const service = new CallbackSyncService('ClanInfoService', async (tag, signal) => {
            order.push({ clanTag: tag, atMs: clock.nowMs() });
            if (slowFirstClan && tag === '#CLAN1') {
                slowFirstClan = false;
                await clock.sleep(10_000, signal);
            }
            return createSyncSuccess('ClanInfoService', tag);
        });

        const manager = new ClanManager(
            [service],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        // Starts with 0 tracked clans and sleeps
        await waitForCondition(() => clock.pendingSleepCount() === 1);
        expect(order).toEqual([]);

        // 30s later, #CLAN1 and #CLAN2 are added and manager is notified
        clock.advance(30_000);
        ctx.seedTrackedClan('#CLAN1', { managementChatId: 2001 });
        ctx.seedTrackedClan('#CLAN2', { managementChatId: 2002 });
        slowFirstClan = true;
        manager.notify();

        // While #CLAN1 is mid-sync (sleeping 10s), #CLAN3 is linked and notified
        await waitForCondition(() => order.length === 1 && clock.pendingSleepCount() === 1);
        ctx.seedTrackedClan('#CLAN3', { managementChatId: 2003 });
        manager.notify();

        // Once #CLAN1 finishes, #CLAN3 runs immediately before #CLAN2
        clock.advance(10_000);
        await waitForCondition(() => order.length === 3 && clock.pendingSleepCount() === 1);

        expect(order).toEqual([
            { clanTag: '#CLAN1', atMs: startMs + 30_000 },
            { clanTag: '#CLAN3', atMs: startMs + 40_000 },
            { clanTag: '#CLAN2', atMs: startMs + 40_000 },
        ]);

        // Unlink #CLAN1, advance to its next due slot so it is pruned, then re-link and verify immediate sync
        ctx.clansRepo.disableTracking('#CLAN1');
        clock.advance(DEFAULT_SYNC_CYCLE_INTERVAL_MS - 10_000);
        await waitForCondition(() => order.length === 4 && clock.pendingSleepCount() === 1);
        expect(order[3]).toEqual({
            clanTag: '#CLAN2',
            atMs: startMs + 30_000 + DEFAULT_SYNC_CYCLE_INTERVAL_MS,
        });

        clock.advance(60_000);
        ctx.clansRepo.insertMinimalClan('#CLAN1');
        manager.notify();
        await waitForCondition(() => order.length === 6 && clock.pendingSleepCount() === 1);
        expect(order.slice(4)).toEqual([
            { clanTag: '#CLAN1', atMs: startMs + 90_000 + DEFAULT_SYNC_CYCLE_INTERVAL_MS },
            { clanTag: '#CLAN3', atMs: startMs + 90_000 + DEFAULT_SYNC_CYCLE_INTERVAL_MS },
        ]);

        controller.abort();
        await runPromise;
    });

    it('runs immediate initial synchronization via TelegramBotService /link without waiting 15 minutes', async () => {
        const ctx = createTestContext();
        const startMs = 5_000_000;
        const clock = new FakeClock(startMs);
        const syncedTags: { readonly clanTag: string; readonly atMs: number }[] = [];

        const apiClient: ClanInfoApiClient = {
            getCompleteClanData(clanTag: string) {
                syncedTags.push({ clanTag, atMs: clock.nowMs() });
                return Promise.resolve({
                    clan: {
                        tag: clanTag,
                        name: 'Synced Immediately',
                        description: 'Fresh clan',
                        locationId: 1,
                        locationName: 'Intl',
                        chatLanguageId: 1,
                        chatLanguage: 'RU',
                        isFamilyFriendly: true,
                    },
                    clanSnapshot: {
                        clanTag,
                        type: 'open',
                        membersCount: 0,
                        clanLevel: 12,
                        clanPoints: 25000,
                        clanBuilderBasePoints: 10000,
                        clanCapitalPoints: 5000,
                        capitalHallLevel: 8,
                        capitalLeagueId: 85000000,
                        requiredTrophies: 0,
                        requiredBuilderBaseTrophies: 0,
                        requiredTownhallLevel: 1,
                        warFrequency: 'always',
                        isWarLogPublic: true,
                        warWinStreak: 3,
                        warWins: 100,
                        warTies: 2,
                        warLosses: 10,
                        warLeagueId: 48000000,
                    },
                    players: [],
                    playerSnapshots: [],
                });
            },
        };

        const clanInfoService = new ClanInfoService(
            ctx.clansRepo,
            apiClient,
            ctx.transactionManager,
            ctx.recorder,
        );

        const manager = new ClanManager(
            [clanInfoService],
            ctx.clansRepo,
            ctx.syncOutageRepo,
            ctx.transactionManager,
            ctx.recorder,
            { clock },
        );

        const botService = new TelegramBotService({
            telegramToken: 'test-token',
            attackGuideCatalog: AttackGuideCatalog.fromJson({ guides: [] }),
            clansRepo: ctx.clansRepo,
            subscriptionRepo: ctx.subscriptionRepo,
            domainEventsRepo: ctx.domainEventsRepo,
            transactionManager: ctx.transactionManager,
            clanManager: manager,
            botConfig: {
                botInfo: {
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
                },
            },
        });

        botService.bot.api.config.use((_prev, method, payload) => {
            expect(ctx.db.connection.inTransaction).toBe(false);
            if (method === 'sendMessage') {
                const payloadRecord = payload as Record<string, unknown>;
                return Promise.resolve({
                    ok: true,
                    result: {
                        message_id: 1,
                        date: 1_700_000_000,
                        chat: { id: Number(payloadRecord.chat_id), type: 'private' },
                        text: typeof payloadRecord.text === 'string' ? payloadRecord.text : '',
                    },
                } as never);
            }
            return Promise.reject(new Error(`Unexpected method: ${method}`));
        });

        const controller = new AbortController();
        const runPromise = manager.syncAll(controller.signal);

        // Manager is sleeping with 0 tracked clans; advance 2 minutes
        await waitForCondition(() => clock.pendingSleepCount() === 1);
        clock.advance(2 * 60 * 1000);

        // User sends /link #2PPLQ -> manager wakes immediately without advancing FakeClock
        await botService.handleUpdate({
            update_id: 1,
            message: {
                message_id: 1,
                date: 1_700_000_000,
                chat: { id: 7001, type: 'private', first_name: 'Leader' },
                from: { id: 7001, is_bot: false, first_name: 'Leader' },
                text: '/link #2PPLQ',
            },
        } as never);

        await waitForCondition(() => syncedTags.length === 1 && clock.pendingSleepCount() === 1);

        expect(syncedTags).toEqual([{ clanTag: '#2PPLQ', atMs: startMs + 2 * 60 * 1000 }]);
        expect(ctx.clansRepo.getClanNameByTag('#2PPLQ')).toBe('Synced Immediately');

        controller.abort();
        await runPromise;
    });
});
