import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    CocApiError,
    type CompleteClanwarData,
    WAR_TYPES,
    parseCurrentWarResponse,
} from '../../src/api/index.js';
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
    WAR_REMINDER_KINDS,
    WAR_REMINDER_WAR_KINDS,
} from '../../src/events/applicationEvents.js';
import { NotificationService } from '../../src/notifications/index.js';
import {
    ClanwarService,
    SECONDS_PER_HOUR,
    type ClanwarApiClient,
} from '../../src/services/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');
const CLAN_TAG = '#2PPLQ';
const OPPONENT_TAG = '#OPP1';

interface WarDataSpec {
    readonly clanTag?: string;
    readonly opponentTag?: string;
    readonly warUID?: string;
    readonly state?: string;
    readonly warType?: CompleteClanwarData['clanwar']['warType'];
    readonly preparationStartTime?: number;
    readonly startTime?: number;
    readonly endTime?: number;
    readonly withDetails?: boolean;
}

function makeClanwarData(spec: WarDataSpec = {}): CompleteClanwarData {
    const clanTag = spec.clanTag ?? CLAN_TAG;
    const opponentTag = spec.opponentTag ?? OPPONENT_TAG;
    const withDetails = spec.withDetails ?? true;

    return {
        clanwar: {
            warUID: spec.warUID ?? 'war-integration-1',
            clanTag,
            state: spec.state ?? 'warEnded',
            warType: spec.warType ?? WAR_TYPES.regular,
            teamSize: withDetails ? 2 : 1,
            attacksPerMember: 2,
            preparationStartTime: spec.preparationStartTime ?? 1_000,
            startTime: spec.startTime ?? 1_100,
            endTime: spec.endTime ?? 2_000,
            seasonId: null,
            roundNumber: null,
        },
        clans: [
            {
                side: 'home',
                clanTag,
                clanName: 'Integration Clan',
                clanLevel: 10,
                attacksCount: withDetails ? 2 : 0,
                stars: withDetails ? 5 : 0,
                destructionPercentage: withDetails ? 90.0 : 0.0,
            },
            {
                side: 'opponent',
                clanTag: opponentTag,
                clanName: 'Opponent Clan',
                clanLevel: 9,
                attacksCount: withDetails ? 2 : 0,
                stars: withDetails ? 3 : 0,
                destructionPercentage: withDetails ? 80.0 : 0.0,
            },
        ],
        attacks: withDetails
            ? [
                  {
                      attackerTag: '#P1',
                      defenderTag: '#OP1',
                      attackerClanTag: clanTag,
                      defenderClanTag: opponentTag,
                      attackerPosition: 1,
                      defenderPosition: 1,
                      stars: 3,
                      destructionPercentage: 100.0,
                      orderNum: 1,
                      duration: 120,
                  },
              ]
            : [],
        members: withDetails
            ? [
                  [
                      {
                          clanTag,
                          playerTag: '#P1',
                          playerName: 'Alice',
                          townhallLevel: 14,
                          mapPosition: 1,
                      },
                  ],
                  [
                      {
                          clanTag: opponentTag,
                          playerTag: '#OP1',
                          playerName: 'Opponent Player',
                          townhallLevel: 13,
                          mapPosition: 1,
                      },
                  ],
              ]
            : [[], []],
    };
}

class FakeClanwarApiClient implements ClanwarApiClient {
    warData: CompleteClanwarData | null = null;
    errorToThrow: Error | null = null;
    onGetCompleteClanwarData?: (clanTag: string, signal?: AbortSignal) => void;

    getCompleteClanwarData(
        clanTag: string,
        signal?: AbortSignal,
    ): Promise<CompleteClanwarData | null> {
        this.onGetCompleteClanwarData?.(clanTag, signal);
        if (this.errorToThrow !== null) {
            return Promise.reject(this.errorToThrow);
        }
        return Promise.resolve(this.warData);
    }
}

function tableRowCount(db: Database, tableName: string): number {
    const row = db.connection
        .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${tableName};`)
        .get();
    return row?.count ?? 0;
}

describe('ClanwarService', () => {
    const openDatabases: Database[] = [];

    function setup(initialEpochSeconds = 1_700_000_000): {
        db: Database;
        clock: FakeClock;
        clansRepo: ClansRepo;
        clanwarRepo: ClanwarRepo;
        subscriptionRepo: SubscriptionRepo;
        domainEventsRepo: DomainEventsRepo;
        apiClient: FakeClanwarApiClient;
        service: ClanwarService;
    } {
        const db = new Database(':memory:');
        openDatabases.push(db);
        const txManager = new TransactionManager(db);
        const migrator = new MigratorManager(db, txManager);
        migrator.migrate(REAL_MIGRATIONS_PATH);

        const clansRepo = new ClansRepo(db);
        const clanwarRepo = new ClanwarRepo(db);
        const subscriptionRepo = new SubscriptionRepo(db);
        const domainEventsRepo = new DomainEventsRepo(db);
        const serializer = new DomainEventPayloadSerializer();
        const recorder = new DomainEventRecorder(serializer, subscriptionRepo, domainEventsRepo);
        const apiClient = new FakeClanwarApiClient();
        const clock = new FakeClock(initialEpochSeconds * 1000);
        const service = new ClanwarService(clanwarRepo, apiClient, txManager, recorder, clock);

        return {
            db,
            clock,
            clansRepo,
            clanwarRepo,
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
        expect(service.getServiceName()).toBe('ClanwarService');
    });

    it('saves war, members, attacks, and war_ended event for players and management while fetching API outside transaction', async () => {
        const {
            db,
            clansRepo,
            clanwarRepo,
            subscriptionRepo,
            domainEventsRepo,
            apiClient,
            service,
        } = setup(10_000);

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.saveTelegramChat(5001, 0, 'Management');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        subscriptionRepo.subscribeToChat(5001, 0, CLAN_TAG, 'management');
        const playersSubId = subscriptionRepo.getSubscriptionId(-1001, 0, CLAN_TAG, 'players');
        const managementSubId = subscriptionRepo.getSubscriptionId(5001, 0, CLAN_TAG, 'management');

        let wasInTransactionDuringApiCall = true;
        apiClient.onGetCompleteClanwarData = () => {
            wasInTransactionDuringApiCall = db.connection.inTransaction;
        };
        apiClient.warData = makeClanwarData({
            warUID: 'war-ended-1',
            state: 'warEnded',
            preparationStartTime: 1_000,
            startTime: 1_100,
            endTime: 2_000,
        });

        const result = await service.updateData(CLAN_TAG);

        expect(wasInTransactionDuringApiCall).toBe(false);
        expect(result.successFlag).toBe(true);
        expect(result.serviceName).toBe('ClanwarService');
        expect(result.clanTag).toBe(CLAN_TAG);
        expect(result.errorMsg).toBe('');
        expect(result.events).toHaveLength(1);

        const endedEvent = result.events[0];
        expect(endedEvent?.type).toBe(APPLICATION_EVENT_TYPES.warEnded);
        if (endedEvent?.type !== APPLICATION_EVENT_TYPES.warEnded) {
            throw new Error('Expected WarEndedEvent');
        }

        const overviews = clanwarRepo.getClanwarOverviews(endedEvent.warReference);
        expect(overviews.home.clanTag).toBe(CLAN_TAG);
        expect(overviews.home.clanName).toBe('Integration Clan');
        expect(overviews.home.stars).toBe(5);
        expect(overviews.opponent.clanTag).toBe(OPPONENT_TAG);
        expect(overviews.opponent.stars).toBe(3);

        const attackStats = clanwarRepo.getClanwarAttackStats(endedEvent.warReference);
        expect(attackStats.attacksUsed).toBe(1);
        expect(attackStats.maxAttacks).toBe(4);
        expect(attackStats.teamSize).toBe(2);
        expect(attackStats.totalAttackStars).toBe(3);
        expect(attackStats.threeStarAttacks).toBe(1);

        const bestAttacks = clanwarRepo.getBestAttacks(endedEvent.warReference);
        expect(bestAttacks).toHaveLength(1);
        expect(bestAttacks[0]).toMatchObject({
            attackerTag: '#P1',
            attackerName: 'Alice',
            stars: 3,
            destructionPercentage: 100.0,
        });

        const pending = domainEventsRepo.getPendingDestinations(50);
        expect(pending).toHaveLength(2);
        expect(pending).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    eventType: 'war_ended',
                    eventId: String(endedEvent.warReference.warId),
                    payloadVersion: 1,
                    chatId: -1001,
                    audience: 'players',
                    subscriptionId: playersSubId,
                }),
                expect.objectContaining({
                    eventType: 'war_ended',
                    eventId: String(endedEvent.warReference.warId),
                    payloadVersion: 1,
                    chatId: 5001,
                    audience: 'management',
                    subscriptionId: managementSubId,
                }),
            ]),
        );
    });

    it('returns empty success when no active war (null or notInWar) or war log is private (HTTP 403 accessDenied)', async () => {
        const { db, clansRepo, apiClient, service } = setup();
        clansRepo.insertMinimalClan(CLAN_TAG);

        // 1. API returns null (notInWar parsed by CocApiClient)
        apiClient.warData = null;
        const noWarResult = await service.updateData(CLAN_TAG);
        expect(noWarResult.successFlag).toBe(true);
        expect(noWarResult.serviceName).toBe('ClanwarService');
        expect(noWarResult.clanTag).toBe(CLAN_TAG);
        expect(noWarResult.errorMsg).toBe('');
        expect(noWarResult.events).toHaveLength(0);

        // 2. API returns object with state === 'notInWar'
        apiClient.warData = makeClanwarData({ state: 'notInWar', withDetails: false });
        const notInWarStateResult = await service.updateData(CLAN_TAG);
        expect(notInWarStateResult.successFlag).toBe(true);
        expect(notInWarStateResult.events).toHaveLength(0);

        // 3. API throws 403 forbidden for private war log (JSON body)
        apiClient.warData = null;
        apiClient.errorToThrow = new CocApiError('HTTP 403 (forbidden)', {
            kind: 'forbidden',
            statusCode: 403,
            endpoint: '/clans/%232PPLQ/currentwar',
            responseBody: JSON.stringify({ reason: 'accessDenied' }),
        });
        const privateLogResult = await service.updateData(CLAN_TAG);
        expect(privateLogResult.successFlag).toBe(true);
        expect(privateLogResult.errorMsg).toBe('');
        expect(privateLogResult.events).toHaveLength(0);

        // 4. API throws 403 forbidden without responseBody
        apiClient.errorToThrow = new CocApiError('HTTP 403 (forbidden)', {
            kind: 'forbidden',
            statusCode: 403,
            endpoint: '/clans/%232PPLQ/currentwar',
        });
        const bareForbiddenResult = await service.updateData(CLAN_TAG);
        expect(bareForbiddenResult.successFlag).toBe(true);
        expect(bareForbiddenResult.events).toHaveLength(0);

        expect(tableRowCount(db, 'wars')).toBe(0);
        expect(tableRowCount(db, 'domain_events')).toBe(0);
    });

    it('returns SyncResult error on API failures including invalid authorization 403 and server errors', async () => {
        const { db, clansRepo, apiClient, service } = setup();
        clansRepo.insertMinimalClan(CLAN_TAG);

        // 1. 403 due to invalid IP / API token must still be treated as sync error
        apiClient.errorToThrow = new CocApiError('HTTP 403 (forbidden)', {
            kind: 'forbidden',
            statusCode: 403,
            endpoint: '/clans/%232PPLQ/currentwar',
            responseBody: JSON.stringify({
                reason: 'accessDenied.invalidIp',
                message: 'Invalid authorization: API key does not allow access from IP 1.2.3.4',
            }),
        });
        const invalidIpResult = await service.updateData(CLAN_TAG);
        expect(invalidIpResult.successFlag).toBe(false);
        expect(invalidIpResult.serviceName).toBe('ClanwarService');
        expect(invalidIpResult.clanTag).toBe(CLAN_TAG);
        expect(invalidIpResult.events).toHaveLength(0);
        expect(invalidIpResult.errorMsg).toContain('HTTP 403');

        // 2. 503 server error
        apiClient.errorToThrow = new CocApiError('HTTP 503 (server_error)', {
            kind: 'server_error',
            statusCode: 503,
            endpoint: '/clans/%232PPLQ/currentwar',
        });
        const serverErrResult = await service.updateData(CLAN_TAG);
        expect(serverErrResult.successFlag).toBe(false);
        expect(serverErrResult.errorMsg).toContain('HTTP 503');
        expect(serverErrResult.events).toHaveLength(0);

        expect(tableRowCount(db, 'wars')).toBe(0);
        expect(tableRowCount(db, 'domain_events')).toBe(0);
    });

    it('rethrows AbortError on API cancellation or pre-aborted AbortSignal without modifying DB', async () => {
        const { db, clansRepo, apiClient, service } = setup();
        clansRepo.insertMinimalClan(CLAN_TAG);

        // 1. API throws AbortError
        apiClient.errorToThrow = new AbortError('Shutdown requested');
        await expect(service.updateData(CLAN_TAG)).rejects.toBeInstanceOf(AbortError);

        // 2. Signal is already aborted even if fake API resolves
        apiClient.errorToThrow = null;
        apiClient.warData = makeClanwarData({ state: 'warEnded' });
        const controller = new AbortController();
        controller.abort(new Error('stop'));
        await expect(service.updateData(CLAN_TAG, controller.signal)).rejects.toBeInstanceOf(
            AbortError,
        );

        expect(tableRowCount(db, 'wars')).toBe(0);
        expect(tableRowCount(db, 'domain_events')).toBe(0);
    });

    it('records 3 war reminder checkpoints via FakeClock for players only and deduplicates across repeated runs', async () => {
        const startTime = 1_700_100_000;
        const endTime = startTime + 24 * SECONDS_PER_HOUR;
        const { db, clock, clansRepo, subscriptionRepo, domainEventsRepo, apiClient, service } =
            setup(startTime - 60);

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.saveTelegramChat(5001, 0, 'Management');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        subscriptionRepo.subscribeToChat(5001, 0, CLAN_TAG, 'management');

        const baseWarSpec: WarDataSpec = {
            warUID: 'war-checkpoints-1',
            preparationStartTime: startTime - 23 * SECONDS_PER_HOUR,
            startTime,
            endTime,
            withDetails: false,
        };

        // 1. Preparation phase (before startTime): war saved, 0 events
        apiClient.warData = makeClanwarData({ ...baseWarSpec, state: 'preparation' });
        const prepResult = await service.updateData(CLAN_TAG);
        expect(prepResult.successFlag).toBe(true);
        expect(prepResult.events).toHaveLength(0);
        expect(tableRowCount(db, 'wars')).toBe(1);
        expect(tableRowCount(db, 'domain_events')).toBe(0);

        // 2. Exact startTime -> 'started' reminder
        clock.setNow(startTime * 1000);
        apiClient.warData = makeClanwarData({ ...baseWarSpec, state: 'inWar' });
        const startedResult = await service.updateData(CLAN_TAG);
        expect(startedResult.successFlag).toBe(true);
        expect(startedResult.events).toHaveLength(1);
        const startedReminder = startedResult.events[0];
        expect(startedReminder).toMatchObject({
            type: APPLICATION_EVENT_TYPES.warReminder,
            clanTag: CLAN_TAG,
            endTime,
            warKind: WAR_REMINDER_WAR_KINDS.regular,
            kind: WAR_REMINDER_KINDS.started,
        });
        if (startedReminder?.type !== APPLICATION_EVENT_TYPES.warReminder) {
            throw new Error('Expected WarReminderEvent');
        }
        const warId = startedReminder.warId;
        expect(warId).toBeGreaterThan(0);

        // Repeat in same window -> idempotent (no duplicate domain_events / destinations)
        const startedRepeat = await service.updateData(CLAN_TAG);
        expect(startedRepeat.successFlag).toBe(true);
        expect(tableRowCount(db, 'domain_events')).toBe(1);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(1);

        // 3. Exact 6h before end -> started + six_hours_left (only 1 new domain_event persisted)
        clock.setNow((endTime - 6 * SECONDS_PER_HOUR) * 1000);
        const sixHoursResult = await service.updateData(CLAN_TAG);
        expect(sixHoursResult.successFlag).toBe(true);
        expect(
            sixHoursResult.events.map((e) => (e.type === 'war_reminder' ? e.kind : e.type)),
        ).toEqual([WAR_REMINDER_KINDS.started, WAR_REMINDER_KINDS.sixHoursLeft]);
        expect(tableRowCount(db, 'domain_events')).toBe(2);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(2);

        // 4. Exact 1h before end -> all 3 reminders (only 1 new domain_event persisted)
        clock.setNow((endTime - SECONDS_PER_HOUR) * 1000);
        const oneHourResult = await service.updateData(CLAN_TAG);
        expect(oneHourResult.successFlag).toBe(true);
        expect(
            oneHourResult.events.map((e) => (e.type === 'war_reminder' ? e.kind : e.type)),
        ).toEqual([
            WAR_REMINDER_KINDS.started,
            WAR_REMINDER_KINDS.sixHoursLeft,
            WAR_REMINDER_KINDS.oneHourLeft,
        ]);
        expect(tableRowCount(db, 'domain_events')).toBe(3);

        const pendingReminders = domainEventsRepo.getPendingDestinations(50);
        expect(pendingReminders).toHaveLength(3);
        expect(pendingReminders.map((d) => d.eventId)).toEqual([
            `${String(warId)}:started`,
            `${String(warId)}:six_hours_left`,
            `${String(warId)}:one_hour_left`,
        ]);
        for (const dest of pendingReminders) {
            expect(dest.eventType).toBe('war_reminder');
            expect(dest.audience).toBe('players');
            expect(dest.chatId).toBe(-1001);
        }

        // 5. After endTime with warEnded -> 0 reminders + war_ended (players + management), idempotent on repeat
        clock.setNow(endTime * 1000);
        apiClient.warData = makeClanwarData({ ...baseWarSpec, state: 'warEnded' });
        const endedFirst = await service.updateData(CLAN_TAG);
        const endedSecond = await service.updateData(CLAN_TAG);
        expect(endedFirst.successFlag).toBe(true);
        expect(endedSecond.successFlag).toBe(true);
        expect(endedFirst.events).toHaveLength(1);
        expect(endedFirst.events[0]?.type).toBe(APPLICATION_EVENT_TYPES.warEnded);

        expect(tableRowCount(db, 'wars')).toBe(1);
        expect(tableRowCount(db, 'war_clans')).toBe(2);
        expect(tableRowCount(db, 'domain_events')).toBe(4);
        // 3 players-only reminders + 2 destinations (players + management) for war_ended = 5
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(5);
    });

    it('rolls back database changes when saving war fails or domain event storage fails, then succeeds on retry', async () => {
        const { db, clansRepo, subscriptionRepo, domainEventsRepo, apiClient, service } =
            setup(10_000);
        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');

        // 1. Invalid warType triggers CHECK constraint failure
        apiClient.warData = makeClanwarData({
            warUID: 'war-invalid-1',
            state: 'warEnded',
            warType: 'invalid' as CompleteClanwarData['clanwar']['warType'],
        });
        const invalidResult = await service.updateData(CLAN_TAG);
        expect(invalidResult.successFlag).toBe(false);
        expect(invalidResult.events).toHaveLength(0);
        expect(invalidResult.errorMsg.length).toBeGreaterThan(0);
        expect(tableRowCount(db, 'wars')).toBe(0);
        expect(tableRowCount(db, 'war_clans')).toBe(0);
        expect(tableRowCount(db, 'war_members')).toBe(0);
        expect(tableRowCount(db, 'attacks')).toBe(0);
        expect(tableRowCount(db, 'domain_events')).toBe(0);

        // 2. Domain event insert failure rolls back war tables too
        apiClient.warData = makeClanwarData({
            warUID: 'war-rollback-2',
            state: 'warEnded',
        });
        db.connection.exec(`
            CREATE TEMP TRIGGER reject_war_domain_event
            BEFORE INSERT ON domain_events
            BEGIN
                SELECT RAISE(ABORT, 'simulated war event failure');
            END;
        `);

        const failed = await service.updateData(CLAN_TAG);
        expect(failed.successFlag).toBe(false);
        expect(failed.events).toHaveLength(0);
        expect(tableRowCount(db, 'wars')).toBe(0);
        expect(tableRowCount(db, 'war_clans')).toBe(0);
        expect(tableRowCount(db, 'war_members')).toBe(0);
        expect(tableRowCount(db, 'attacks')).toBe(0);
        expect(tableRowCount(db, 'domain_events')).toBe(0);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(0);

        db.connection.exec('DROP TRIGGER reject_war_domain_event;');

        const recovered = await service.updateData(CLAN_TAG);
        expect(recovered.successFlag).toBe(true);
        expect(recovered.events).toHaveLength(1);
        expect(tableRowCount(db, 'wars')).toBe(1);
        expect(tableRowCount(db, 'war_clans')).toBe(2);
        expect(tableRowCount(db, 'domain_events')).toBe(1);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(1);
    });

    it.each([
        { label: 'A then B', order: ['#CLAN_A', '#CLAN_B'] as const },
        { label: 'B then A', order: ['#CLAN_B', '#CLAN_A'] as const },
    ])(
        'isolates war results, rosters, attacks, history, and shared-chat reports for two tracked opponents ($label)',
        async ({ order }) => {
            const { db, clock, clansRepo, clanwarRepo, subscriptionRepo, domainEventsRepo } =
                setup(1_800_000_000);
            const txManager = new TransactionManager(db);
            const serializer = new DomainEventPayloadSerializer();
            const recorder = new DomainEventRecorder(
                serializer,
                subscriptionRepo,
                domainEventsRepo,
            );
            const notificationRepo = new NotificationRepo(db);
            const leagueRepo = new ClanwarsLeagueRepo(db);
            const raidRepo = new RaidRepo(db);
            const notificationService = new NotificationService({
                notificationRepo,
                clansRepo,
                clanwarRepo,
                clanwarsLeagueRepo: leagueRepo,
                raidRepo,
            });
            const domainEventWorker = new DomainEventWorker({
                domainEventsRepo,
                transactionManager: txManager,
                deserializer: new DomainEventPayloadDeserializer(),
                materializer: notificationService,
                clock,
            });

            const CLAN_A = '#CLAN_A';
            const CLAN_B = '#CLAN_B';
            const SHARED_PLAYERS_CHAT = -100999;
            const SHARED_MANAGEMENT_CHAT = 500999;

            clansRepo.insertMinimalClan(CLAN_A);
            clansRepo.insertMinimalClan(CLAN_B);
            subscriptionRepo.saveTelegramChat(SHARED_PLAYERS_CHAT, 0, 'Shared Players');
            subscriptionRepo.saveTelegramChat(SHARED_MANAGEMENT_CHAT, 0, 'Shared Management');
            subscriptionRepo.subscribeToChat(SHARED_PLAYERS_CHAT, 0, CLAN_A, 'players');
            subscriptionRepo.subscribeToChat(SHARED_PLAYERS_CHAT, 0, CLAN_B, 'players');
            subscriptionRepo.subscribeToChat(SHARED_MANAGEMENT_CHAT, 0, CLAN_A, 'management');
            subscriptionRepo.subscribeToChat(SHARED_MANAGEMENT_CHAT, 0, CLAN_B, 'management');

            const clanARaw = {
                tag: CLAN_A,
                name: 'Clan Alpha',
                clanLevel: 20,
                attacks: 1,
                stars: 3,
                destructionPercentage: 100.0,
                members: [
                    {
                        tag: '#A1',
                        name: 'Alice',
                        townhallLevel: 16,
                        mapPosition: 1,
                        attacks: [
                            {
                                defenderTag: '#B1',
                                stars: 3,
                                destructionPercentage: 100.0,
                                order: 1,
                                duration: 110,
                            },
                        ],
                    },
                    {
                        tag: '#A2',
                        name: 'Anton',
                        townhallLevel: 15,
                        mapPosition: 2,
                    },
                ],
            };

            const clanBRaw = {
                tag: CLAN_B,
                name: 'Clan Beta',
                clanLevel: 18,
                attacks: 1,
                stars: 1,
                destructionPercentage: 55.0,
                members: [
                    {
                        tag: '#B1',
                        name: 'Boris',
                        townhallLevel: 16,
                        mapPosition: 1,
                        attacks: [
                            {
                                defenderTag: '#A2',
                                stars: 1,
                                destructionPercentage: 55.0,
                                order: 2,
                                duration: 140,
                            },
                        ],
                    },
                    {
                        tag: '#B2',
                        name: 'Bella',
                        townhallLevel: 15,
                        mapPosition: 2,
                    },
                ],
            };

            const war1PayloadFor = (clanTag: string): unknown => ({
                state: 'warEnded',
                teamSize: 2,
                attacksPerMember: 2,
                preparationStartTime: '20260910T100000.000Z',
                startTime: '20260911T100000.000Z',
                endTime: '20260912T100000.000Z',
                clan: clanTag === CLAN_A ? clanARaw : clanBRaw,
                opponent: clanTag === CLAN_A ? clanBRaw : clanARaw,
            });

            const war2PayloadFor = (clanTag: string): unknown => {
                if (clanTag === CLAN_A) {
                    return {
                        state: 'warEnded',
                        teamSize: 2,
                        attacksPerMember: 2,
                        preparationStartTime: '20260915T100000.000Z',
                        startTime: '20260916T100000.000Z',
                        endTime: '20260917T100000.000Z',
                        clan: { ...clanARaw, stars: 6, destructionPercentage: 100.0, members: [] },
                        opponent: {
                            tag: '#OPP_A2',
                            name: 'Enemy A2',
                            clanLevel: 15,
                            attacks: 1,
                            stars: 2,
                            destructionPercentage: 60.0,
                            members: [],
                        },
                    };
                }
                return {
                    state: 'warEnded',
                    teamSize: 2,
                    attacksPerMember: 2,
                    preparationStartTime: '20260915T100000.000Z',
                    startTime: '20260916T100000.000Z',
                    endTime: '20260917T100000.000Z',
                    clan: { ...clanBRaw, stars: 5, destructionPercentage: 92.0, members: [] },
                    opponent: {
                        tag: '#OPP_B2',
                        name: 'Enemy B2',
                        clanLevel: 15,
                        attacks: 2,
                        stars: 4,
                        destructionPercentage: 80.0,
                        members: [],
                    },
                };
            };

            let currentPayloadFor = war1PayloadFor;
            const perClanApiClient: ClanwarApiClient = {
                getCompleteClanwarData: (clanTag) =>
                    Promise.resolve(
                        parseCurrentWarResponse(
                            currentPayloadFor(clanTag),
                            clanTag,
                            `/clans/${encodeURIComponent(clanTag)}/currentwar`,
                        ),
                    ),
            };
            const service = new ClanwarService(
                clanwarRepo,
                perClanApiClient,
                txManager,
                recorder,
                clock,
            );

            // Sync War 1 in the parameterized order, then repeat for idempotency
            const war1Results = new Map<
                string,
                Awaited<ReturnType<ClanwarService['updateData']>>
            >();
            for (const tag of order) {
                war1Results.set(tag, await service.updateData(tag));
            }
            for (const tag of order) {
                const repeated = await service.updateData(tag);
                expect(repeated.successFlag).toBe(true);
            }

            const eventA = war1Results.get(CLAN_A)?.events[0];
            const eventB = war1Results.get(CLAN_B)?.events[0];
            expect(eventA?.type).toBe(APPLICATION_EVENT_TYPES.warEnded);
            expect(eventB?.type).toBe(APPLICATION_EVENT_TYPES.warEnded);
            if (
                eventA?.type !== APPLICATION_EVENT_TYPES.warEnded ||
                eventB?.type !== APPLICATION_EVENT_TYPES.warEnded
            ) {
                throw new Error('Expected WarEndedEvent for both clans');
            }

            const refA = eventA.warReference;
            const refB = eventB.warReference;
            expect(refA.warId).not.toBe(refB.warId);

            const warRows = db.connection
                .prepare<[], { war_uid: string; clan_tag: string }>(
                    'SELECT war_uid, clan_tag FROM wars ORDER BY clan_tag ASC;',
                )
                .all();
            expect(warRows).toEqual([
                { war_uid: '#CLAN_A_#CLAN_A_#CLAN_B_20260910T100000', clan_tag: CLAN_A },
                { war_uid: '#CLAN_B_#CLAN_A_#CLAN_B_20260910T100000', clan_tag: CLAN_B },
            ]);

            // Overviews remain isolated and accurate for both clans
            const overviewA = clanwarRepo.getClanwarOverviews(refA);
            expect(overviewA.home).toMatchObject({
                clanTag: CLAN_A,
                clanName: 'Clan Alpha',
                stars: 3,
                destructionPercentage: 100.0,
            });
            expect(overviewA.opponent).toMatchObject({
                clanTag: CLAN_B,
                clanName: 'Clan Beta',
                stars: 1,
                destructionPercentage: 55.0,
            });

            const overviewB = clanwarRepo.getClanwarOverviews(refB);
            expect(overviewB.home).toMatchObject({
                clanTag: CLAN_B,
                clanName: 'Clan Beta',
                stars: 1,
                destructionPercentage: 55.0,
            });
            expect(overviewB.opponent).toMatchObject({
                clanTag: CLAN_A,
                clanName: 'Clan Alpha',
                stars: 3,
                destructionPercentage: 100.0,
            });

            // Rosters, attacks, slackers, and mirror discipline remain isolated
            expect(clanwarRepo.getHomeMemberTags(refA).sort()).toEqual(['#A1', '#A2']);
            expect(clanwarRepo.getHomeMemberTags(refB).sort()).toEqual(['#B1', '#B2']);

            expect(clanwarRepo.getClanwarAttackStats(refA)).toMatchObject({
                attacksUsed: 1,
                totalAttackStars: 3,
                threeStarAttacks: 1,
                oneStarAttacks: 0,
            });
            expect(clanwarRepo.getClanwarAttackStats(refB)).toMatchObject({
                attacksUsed: 1,
                totalAttackStars: 1,
                threeStarAttacks: 0,
                oneStarAttacks: 1,
            });

            expect(clanwarRepo.getSlackersWithNoAttacks(refA)).toEqual([
                { playerTag: '#A2', playerName: 'Anton' },
            ]);
            expect(clanwarRepo.getSlackersWithNoAttacks(refB)).toEqual([
                { playerTag: '#B2', playerName: 'Bella' },
            ]);

            expect(clanwarRepo.getPlayersWithFirstAttackNotOnMirror(refA)).toEqual([]);
            expect(clanwarRepo.getPlayersWithFirstAttackNotOnMirror(refB)).toEqual([
                {
                    attackerTag: '#B1',
                    attackerName: 'Boris',
                    attackerPosition: 1,
                    defenderPosition: 2,
                },
            ]);

            // Materialize domain events into notifications and check shared Telegram chats
            domainEventWorker.processPending();

            const war1Notifications = notificationRepo.getPending(50);
            const sharedPlayersWarEnded = war1Notifications.filter(
                (n) => n.chatId === SHARED_PLAYERS_CHAT && n.eventType === 'war_ended',
            );
            expect(sharedPlayersWarEnded).toHaveLength(2);
            expect(
                sharedPlayersWarEnded.some(
                    (n) =>
                        n.messageText.includes('Clan Alpha') &&
                        n.messageText.includes('3 - 1') &&
                        n.messageText.includes('Итог: Победа'),
                ),
            ).toBe(true);
            expect(
                sharedPlayersWarEnded.some(
                    (n) =>
                        n.messageText.includes('Clan Beta') &&
                        n.messageText.includes('1 - 3') &&
                        n.messageText.includes('Итог: Поражение'),
                ),
            ).toBe(true);

            const sharedManagementViolations = war1Notifications.filter(
                (n) => n.chatId === SHARED_MANAGEMENT_CHAT && n.eventType === 'war_violations',
            );
            expect(sharedManagementViolations).toHaveLength(2);
            expect(
                sharedManagementViolations.some(
                    (n) => n.messageText.includes('Anton') && !n.messageText.includes('Bella'),
                ),
            ).toBe(true);
            expect(
                sharedManagementViolations.some(
                    (n) =>
                        n.messageText.includes('Bella') &&
                        n.messageText.includes('Boris') &&
                        !n.messageText.includes('Anton'),
                ),
            ).toBe(true);

            // Sync War 2 for both clans to verify getPreviousClanwars & war_comparison for both
            currentPayloadFor = war2PayloadFor;
            const war2Results = new Map<
                string,
                Awaited<ReturnType<ClanwarService['updateData']>>
            >();
            for (const tag of order) {
                war2Results.set(tag, await service.updateData(tag));
            }

            const eventA2 = war2Results.get(CLAN_A)?.events[0];
            const eventB2 = war2Results.get(CLAN_B)?.events[0];
            if (
                eventA2?.type !== APPLICATION_EVENT_TYPES.warEnded ||
                eventB2?.type !== APPLICATION_EVENT_TYPES.warEnded
            ) {
                throw new Error('Expected WarEndedEvent for both clans in War 2');
            }

            const prevA = clanwarRepo.getPreviousClanwars(eventA2.warReference, 4);
            expect(prevA).toEqual([refA]);
            const prevB = clanwarRepo.getPreviousClanwars(eventB2.warReference, 4);
            expect(prevB).toEqual([refB]);

            domainEventWorker.processPending();

            const allNotifications = notificationRepo.getPending(50);
            const sharedComparisons = allNotifications.filter(
                (n) => n.chatId === SHARED_PLAYERS_CHAT && n.eventType === 'war_comparison',
            );
            expect(sharedComparisons).toHaveLength(2);
            expect(sharedComparisons.some((n) => n.messageText.includes('Clan Alpha'))).toBe(true);
            expect(sharedComparisons.some((n) => n.messageText.includes('Clan Beta'))).toBe(true);
        },
    );
});
