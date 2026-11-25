import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CocApiError, type CompleteRaidData } from '../../src/api/index.js';
import { FakeClock } from '../../src/common/clock.js';
import { AbortError } from '../../src/common/errors.js';
import {
    ClansRepo,
    ClanwarRepo,
    ClanwarsLeagueRepo,
    Database,
    DomainEventsRepo,
    MigratorManager,
    NotificationRepo,
    RaidRepo,
    SubscriptionRepo,
    TransactionManager,
} from '../../src/database/index.js';
import {
    DomainEventPayloadDeserializer,
    DomainEventPayloadSerializer,
    DomainEventRecorder,
    DomainEventWorker,
} from '../../src/domainEvents/index.js';
import {
    APPLICATION_EVENT_TYPES,
    RAID_REMINDER_KINDS,
} from '../../src/events/applicationEvents.js';
import { NotificationService } from '../../src/notifications/index.js';
import { RaidService, SECONDS_PER_HOUR, type RaidApiClient } from '../../src/services/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');
const CLAN_TAG = '#2PPLQ';

interface RaidDataSpec {
    readonly clanTag?: string;
    readonly startTime?: number;
    readonly endTime?: number;
    readonly state?: string;
    readonly totalLoot?: number;
    readonly raidsCompleted?: number;
    readonly participants?: CompleteRaidData['playerRaidSnapshots'];
}

function makeRaidData(spec: RaidDataSpec = {}): CompleteRaidData {
    return {
        clanRaid: {
            clanTag: spec.clanTag ?? CLAN_TAG,
            startTime: spec.startTime ?? 1_000,
            endTime: spec.endTime ?? 2_000,
            state: spec.state ?? 'ended',
            totalLoot: spec.totalLoot ?? 1_500,
            raidsCompleted: spec.raidsCompleted ?? 6,
            totalAttacks: 8,
            enemyDistrictsDestroyed: 3,
            offensiveReward: 120,
            defensiveReward: 60,
        },
        playerRaidSnapshots: spec.participants ?? [
            {
                playerTag: '#P1',
                attacksCount: 5,
                bonusAttack: 1,
                totalLoot: 1_000,
            },
            {
                playerTag: '#P2',
                attacksCount: 3,
                bonusAttack: 0,
                totalLoot: 500,
            },
        ],
    };
}

class FakeRaidApiClient implements RaidApiClient {
    raidData: CompleteRaidData | null = null;
    errorToThrow: Error | null = null;
    onGetCompleteRaidData?: (clanTag: string, signal?: AbortSignal) => void;

    getCompleteRaidData(clanTag: string, signal?: AbortSignal): Promise<CompleteRaidData | null> {
        this.onGetCompleteRaidData?.(clanTag, signal);
        if (this.errorToThrow !== null) {
            return Promise.reject(this.errorToThrow);
        }
        return Promise.resolve(this.raidData);
    }
}

function tableRowCount(db: Database, tableName: string): number {
    const row = db.connection
        .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${tableName};`)
        .get();
    return row?.count ?? 0;
}

describe('RaidService', () => {
    const openDatabases: Database[] = [];

    function setup(initialEpochSeconds = 1_700_000_000): {
        db: Database;
        clock: FakeClock;
        clansRepo: ClansRepo;
        raidRepo: RaidRepo;
        subscriptionRepo: SubscriptionRepo;
        domainEventsRepo: DomainEventsRepo;
        apiClient: FakeRaidApiClient;
        service: RaidService;
    } {
        const db = new Database(':memory:');
        openDatabases.push(db);
        const txManager = new TransactionManager(db);
        const migrator = new MigratorManager(db, txManager);
        migrator.migrate(REAL_MIGRATIONS_PATH);

        const clansRepo = new ClansRepo(db);
        const raidRepo = new RaidRepo(db);
        const subscriptionRepo = new SubscriptionRepo(db);
        const domainEventsRepo = new DomainEventsRepo(db);
        const serializer = new DomainEventPayloadSerializer();
        const recorder = new DomainEventRecorder(serializer, subscriptionRepo, domainEventsRepo);
        const apiClient = new FakeRaidApiClient();
        const clock = new FakeClock(initialEpochSeconds * 1000);
        const service = new RaidService(clansRepo, raidRepo, apiClient, txManager, recorder, clock);

        return {
            db,
            clock,
            clansRepo,
            raidRepo,
            subscriptionRepo,
            domainEventsRepo,
            apiClient,
            service,
        };
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('returns the exact historical service name', () => {
        const { service } = setup();
        expect(service.getServiceName()).toBe('RaidService');
    });

    it('ensures missing players exist, saves raid and snapshots, and records raids_ended outside API transaction', async () => {
        const { db, clansRepo, raidRepo, subscriptionRepo, domainEventsRepo, apiClient, service } =
            setup(10_000);

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.saveTelegramChat(5001, 0, 'Management');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        subscriptionRepo.subscribeToChat(5001, 0, CLAN_TAG, 'management');
        const playersSubId = subscriptionRepo.getSubscriptionId(-1001, 0, CLAN_TAG, 'players');
        const managementSubId = subscriptionRepo.getSubscriptionId(5001, 0, CLAN_TAG, 'management');

        let wasInTransactionDuringApiCall = true;
        apiClient.onGetCompleteRaidData = () => {
            wasInTransactionDuringApiCall = db.connection.inTransaction;
        };
        apiClient.raidData = makeRaidData();

        const result = await service.updateData(CLAN_TAG);

        expect(wasInTransactionDuringApiCall).toBe(false);
        expect(result.successFlag).toBe(true);
        expect(result.serviceName).toBe('RaidService');
        expect(result.clanTag).toBe(CLAN_TAG);
        expect(result.events).toHaveLength(1);

        const endedEvent = result.events[0];
        if (endedEvent?.type !== APPLICATION_EVENT_TYPES.raidsEnded) {
            throw new Error('Expected RaidsEndedEvent');
        }

        const stats = raidRepo.getRaidStats(endedEvent.raidReference);
        expect(stats).toEqual({
            totalLoot: 1_500,
            raidsCompleted: 6,
            totalAttacks: 8,
            enemyDistrictsDestroyed: 3,
            offensiveReward: 120,
            defensiveReward: 60,
        });

        const bestMembers = raidRepo.getBestRaidMembers(endedEvent.raidReference);
        expect(bestMembers).toHaveLength(2);
        expect(bestMembers[0]).toMatchObject({
            playerTag: '#P1',
            totalLoot: 1_000,
            attacksCount: 5,
            bonusAttacks: 1,
        });
        expect(bestMembers[1]).toMatchObject({
            playerTag: '#P2',
            totalLoot: 500,
        });

        expect(tableRowCount(db, 'players')).toBe(2);

        const pending = domainEventsRepo.getPendingDestinations(50);
        expect(pending).toHaveLength(2);
        expect(pending).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    eventType: 'raids_ended',
                    eventId: String(endedEvent.raidReference.raidId),
                    payloadVersion: 1,
                    chatId: -1001,
                    audience: 'players',
                    subscriptionId: playersSubId,
                }),
                expect.objectContaining({
                    eventType: 'raids_ended',
                    eventId: String(endedEvent.raidReference.raidId),
                    payloadVersion: 1,
                    chatId: 5001,
                    audience: 'management',
                    subscriptionId: managementSubId,
                }),
            ]),
        );
    });

    it('treats absent raid (null) as successful empty SyncResult without modifying DB, including repeated runs', async () => {
        const { db, clansRepo, apiClient, service } = setup();
        clansRepo.insertMinimalClan(CLAN_TAG);
        apiClient.raidData = null;

        const first = await service.updateData(CLAN_TAG);
        const second = await service.updateData(CLAN_TAG);

        for (const result of [first, second]) {
            expect(result.successFlag).toBe(true);
            expect(result.serviceName).toBe('RaidService');
            expect(result.clanTag).toBe(CLAN_TAG);
            expect(result.events).toHaveLength(0);
            expect(result.errorMsg).toBe('');
        }
        expect(tableRowCount(db, 'clan_raids')).toBe(0);
        expect(tableRowCount(db, 'player_raid_snapshots')).toBe(0);
        expect(tableRowCount(db, 'domain_events')).toBe(0);
    });

    it('returns SyncResult error on API failure (5xx, network, invalid_schema) and rethrows AbortError on cancellation', async () => {
        const { db, clansRepo, apiClient, service } = setup();
        clansRepo.insertMinimalClan(CLAN_TAG);

        for (const error of [
            new CocApiError('HTTP 503', {
                kind: 'server_error',
                statusCode: 503,
                retryable: true,
                endpoint: '/clans/%232PPLQ/capitalraidseasons?limit=1',
            }),
            new CocApiError('Network error: ECONNRESET', {
                kind: 'network',
                retryable: true,
                endpoint: '/clans/%232PPLQ/capitalraidseasons?limit=1',
            }),
            new CocApiError('Invalid capital raid seasons response', {
                kind: 'invalid_schema',
                retryable: false,
                endpoint: '/clans/%232PPLQ/capitalraidseasons?limit=1',
            }),
        ]) {
            apiClient.errorToThrow = error;
            const errorResult = await service.updateData(CLAN_TAG);
            expect(errorResult.successFlag).toBe(false);
            expect(errorResult.errorMsg).toContain(error.message);
            expect(errorResult.events).toHaveLength(0);
        }

        apiClient.errorToThrow = new AbortError('Raid sync aborted');
        await expect(service.updateData(CLAN_TAG)).rejects.toBeInstanceOf(AbortError);

        apiClient.errorToThrow = null;
        apiClient.raidData = makeRaidData();
        const controller = new AbortController();
        controller.abort();
        await expect(service.updateData(CLAN_TAG, controller.signal)).rejects.toBeInstanceOf(
            AbortError,
        );

        expect(tableRowCount(db, 'clan_raids')).toBe(0);
    });

    it('records all 5 raid reminder checkpoints via FakeClock for players only and deduplicates across repeated runs', async () => {
        const startTime = 1_700_100_000;
        const endTime = startTime + 72 * SECONDS_PER_HOUR;

        const {
            db,
            clock,
            clansRepo,
            raidRepo,
            subscriptionRepo,
            domainEventsRepo,
            apiClient,
            service,
        } = setup(startTime - 10);

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.saveTelegramChat(5001, 0, 'Management');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        subscriptionRepo.subscribeToChat(5001, 0, CLAN_TAG, 'management');

        const baseSpec: RaidDataSpec = {
            startTime,
            endTime,
            state: 'ongoing',
            totalLoot: 100,
            raidsCompleted: 1,
            participants: [{ playerTag: '#P1', attacksCount: 1, bonusAttack: 0, totalLoot: 100 }],
        };

        // Before startTime -> 0 reminders
        apiClient.raidData = makeRaidData(baseSpec);
        const beforeStart = await service.updateData(CLAN_TAG);
        expect(beforeStart.successFlag).toBe(true);
        expect(beforeStart.events).toHaveLength(0);
        expect(tableRowCount(db, 'domain_events')).toBe(0);

        // 1. startTime -> started
        clock.setNow(startTime * 1000);
        const started = await service.updateData(CLAN_TAG);
        expect(started.successFlag).toBe(true);
        expect(started.events).toHaveLength(1);
        const firstReminder = started.events[0];
        if (firstReminder?.type !== APPLICATION_EVENT_TYPES.raidReminder) {
            throw new Error('Expected RaidReminderEvent');
        }
        const raidId = firstReminder.raidReference.raidId;
        expect(firstReminder.kind).toBe(RAID_REMINDER_KINDS.started);

        // Repeat in same window -> idempotent
        await service.updateData(CLAN_TAG);
        expect(tableRowCount(db, 'domain_events')).toBe(1);

        // 2. 48h left
        clock.setNow((endTime - 48 * SECONDS_PER_HOUR) * 1000);
        await service.updateData(CLAN_TAG);
        expect(tableRowCount(db, 'domain_events')).toBe(2);

        // 3. 24h left
        clock.setNow((endTime - 24 * SECONDS_PER_HOUR) * 1000);
        await service.updateData(CLAN_TAG);
        expect(tableRowCount(db, 'domain_events')).toBe(3);

        // 4. 6h left
        clock.setNow((endTime - 6 * SECONDS_PER_HOUR) * 1000);
        await service.updateData(CLAN_TAG);
        expect(tableRowCount(db, 'domain_events')).toBe(4);

        // 5. 1h left (twice to verify idempotency)
        clock.setNow((endTime - SECONDS_PER_HOUR) * 1000);
        const oneHour = await service.updateData(CLAN_TAG);
        await service.updateData(CLAN_TAG);
        expect(oneHour.events.map((e) => (e.type === 'raid_reminder' ? e.kind : e.type))).toEqual([
            RAID_REMINDER_KINDS.oneHourLeft,
        ]);
        expect(tableRowCount(db, 'domain_events')).toBe(5);

        const pendingReminders = domainEventsRepo.getPendingDestinations(50);
        expect(pendingReminders).toHaveLength(5);
        expect(pendingReminders.map((d) => d.eventId)).toEqual([
            `${String(raidId)}:started`,
            `${String(raidId)}:forty_eight_hours_left`,
            `${String(raidId)}:twenty_four_hours_left`,
            `${String(raidId)}:six_hours_left`,
            `${String(raidId)}:one_hour_left`,
        ]);
        for (const dest of pendingReminders) {
            expect(dest.eventType).toBe('raid_reminder');
            expect(dest.audience).toBe('players');
            expect(dest.chatId).toBe(-1001);
        }

        // 6. Ended: upserts stats, records raids_ended once (players + management)
        clock.setNow(endTime * 1000);
        apiClient.raidData = makeRaidData({
            ...baseSpec,
            state: 'ended',
            totalLoot: 2_000,
            raidsCompleted: 5,
        });
        const endedFirst = await service.updateData(CLAN_TAG);
        const endedSecond = await service.updateData(CLAN_TAG);
        expect(endedFirst.successFlag).toBe(true);
        expect(endedSecond.successFlag).toBe(true);
        expect(endedFirst.events).toHaveLength(1);
        expect(endedFirst.events[0]?.type).toBe(APPLICATION_EVENT_TYPES.raidsEnded);

        expect(tableRowCount(db, 'clan_raids')).toBe(1);
        expect(tableRowCount(db, 'player_raid_snapshots')).toBe(1);
        expect(raidRepo.getRaidStats({ raidId })).toMatchObject({
            totalLoot: 2_000,
            raidsCompleted: 5,
        });
        expect(tableRowCount(db, 'domain_events')).toBe(6);
        // 5 players-only reminders + 2 destinations (players + management) for raids_ended = 7
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(7);
    });

    it('rolls back minimal players, raid, snapshots, and domain events atomically on failure, then succeeds on retry', async () => {
        const { db, clansRepo, subscriptionRepo, domainEventsRepo, apiClient, service } =
            setup(10_000);

        // 1. Missing clan FK fails raid insert -> rolls back insertMinimal(player) too!
        apiClient.raidData = makeRaidData({ clanTag: '#MISSING' });
        const fkFailed = await service.updateData(CLAN_TAG);
        expect(fkFailed.successFlag).toBe(false);
        expect(fkFailed.events).toHaveLength(0);
        expect(fkFailed.errorMsg.length).toBeGreaterThan(0);
        expect(tableRowCount(db, 'clan_raids')).toBe(0);
        expect(tableRowCount(db, 'player_raid_snapshots')).toBe(0);
        expect(tableRowCount(db, 'players')).toBe(0);
        expect(tableRowCount(db, 'domain_events')).toBe(0);

        // 2. Domain event insert failure rolls back players + raid + snapshots atomically
        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        apiClient.raidData = makeRaidData({ clanTag: CLAN_TAG });

        db.connection.exec(`
            CREATE TEMP TRIGGER reject_raid_domain_event
            BEFORE INSERT ON domain_events
            BEGIN
                SELECT RAISE(ABORT, 'simulated raid event failure');
            END;
        `);

        const eventFailed = await service.updateData(CLAN_TAG);
        expect(eventFailed.successFlag).toBe(false);
        expect(eventFailed.events).toHaveLength(0);
        expect(tableRowCount(db, 'players')).toBe(0);
        expect(tableRowCount(db, 'clan_raids')).toBe(0);
        expect(tableRowCount(db, 'player_raid_snapshots')).toBe(0);
        expect(tableRowCount(db, 'domain_events')).toBe(0);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(0);

        db.connection.exec('DROP TRIGGER reject_raid_domain_event;');

        const recovered = await service.updateData(CLAN_TAG);
        expect(recovered.successFlag).toBe(true);
        expect(recovered.events).toHaveLength(1);
        expect(tableRowCount(db, 'players')).toBe(2);
        expect(tableRowCount(db, 'clan_raids')).toBe(1);
        expect(tableRowCount(db, 'player_raid_snapshots')).toBe(2);
        expect(tableRowCount(db, 'domain_events')).toBe(1);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(1);
    });

    it('emits only the newest reminder on late raid sync start and skips earlier checkpoints without sending', async () => {
        const startTime = 1_700_100_000;
        const endTime = startTime + 72 * SECONDS_PER_HOUR;
        // Late sync start: 25 minutes before raid ends
        const { db, clock, clansRepo, subscriptionRepo, domainEventsRepo, apiClient, service } =
            setup(endTime - 25 * 60);

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');

        apiClient.raidData = makeRaidData({
            startTime,
            endTime,
            state: 'ongoing',
        });

        const first = await service.updateData(CLAN_TAG);
        expect(first.successFlag).toBe(true);
        expect(first.events).toHaveLength(1);
        const activeReminder = first.events[0];
        if (activeReminder?.type !== APPLICATION_EVENT_TYPES.raidReminder) {
            throw new Error('Expected RaidReminderEvent');
        }
        const raidId = activeReminder.raidReference.raidId;
        expect(activeReminder.kind).toBe(RAID_REMINDER_KINDS.oneHourLeft);
        expect(activeReminder.remainingSeconds).toBe(25 * 60);

        // All 5 checkpoints recorded in domain_events (4 skipped + 1 active),
        // but only the newest open checkpoint has a pending destination
        expect(tableRowCount(db, 'domain_events')).toBe(5);
        const pending = domainEventsRepo.getPendingDestinations(50);
        expect(pending).toHaveLength(1);
        expect(pending[0]?.eventId).toBe(`${String(raidId)}:${RAID_REMINDER_KINDS.oneHourLeft}`);

        // Repeat sync 10 minutes later -> still no extra destinations or re-emitted skipped points
        clock.setNow((endTime - 15 * 60) * 1000);
        const repeat = await service.updateData(CLAN_TAG);
        expect(repeat.successFlag).toBe(true);
        expect(tableRowCount(db, 'domain_events')).toBe(5);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(1);
    });

    it('skips missed raid checkpoints after downtime recovery and renders actual remaining time', async () => {
        const startTime = 1_700_100_000;
        const endTime = startTime + 72 * SECONDS_PER_HOUR;
        const {
            db,
            clock,
            clansRepo,
            raidRepo,
            subscriptionRepo,
            domainEventsRepo,
            apiClient,
            service,
        } = setup(startTime + 5 * 60);

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');

        apiClient.raidData = makeRaidData({
            startTime,
            endTime,
            state: 'ongoing',
        });

        // 1. On-time start reminder
        const started = await service.updateData(CLAN_TAG);
        expect(started.events).toHaveLength(1);
        const startedEvent = started.events[0];
        if (startedEvent?.type !== APPLICATION_EVENT_TYPES.raidReminder) {
            throw new Error('Expected started RaidReminderEvent');
        }
        const raidId = startedEvent.raidReference.raidId;
        expect(startedEvent.kind).toBe(RAID_REMINDER_KINDS.started);

        // 2. Outage across 48h and 24h windows; recovery at 3h 45m left (inside 6h window)
        clock.setNow((endTime - 3 * SECONDS_PER_HOUR - 45 * 60) * 1000);
        const recovered = await service.updateData(CLAN_TAG);
        expect(recovered.successFlag).toBe(true);
        expect(recovered.events).toHaveLength(1);
        expect(recovered.events[0]).toMatchObject({
            type: APPLICATION_EVENT_TYPES.raidReminder,
            kind: RAID_REMINDER_KINDS.sixHoursLeft,
            remainingSeconds: 3 * SECONDS_PER_HOUR + 45 * 60,
        });

        // Repeat sync after recovery -> idempotent
        await service.updateData(CLAN_TAG);

        // 4 rows in domain_events (started, 48h skipped, 24h skipped, 6h active)
        expect(tableRowCount(db, 'domain_events')).toBe(4);
        const pending = domainEventsRepo.getPendingDestinations(50);
        expect(pending.map((d) => d.eventId)).toEqual([
            `${String(raidId)}:${RAID_REMINDER_KINDS.started}`,
            `${String(raidId)}:${RAID_REMINDER_KINDS.sixHoursLeft}`,
        ]);

        // Materialize pending reminders and verify actual remaining time in notification text
        const txManager = new TransactionManager(db);
        const notificationRepo = new NotificationRepo(db);
        const notificationService = new NotificationService({
            notificationRepo,
            clansRepo,
            clanwarRepo: new ClanwarRepo(db),
            clanwarsLeagueRepo: new ClanwarsLeagueRepo(db),
            raidRepo,
        });
        const worker = new DomainEventWorker({
            domainEventsRepo,
            transactionManager: txManager,
            deserializer: new DomainEventPayloadDeserializer(),
            materializer: notificationService,
            clock,
        });
        worker.processPending();

        // At 3h 45m left, the earlier `started` reminder is superseded (expires at -48h), so only `six_hours_left` is deliverable
        const notifications = notificationRepo.getPending(10, clock.nowEpochSeconds());
        expect(notifications).toHaveLength(1);
        expect(notifications[0]?.eventId).toBe(
            `${String(raidId)}:${RAID_REMINDER_KINDS.sixHoursLeft}`,
        );
        expect(notifications[0]?.messageText).toContain(
            'До окончания рейдовых выходных осталось 3 часа 45 минут',
        );
    });
});
