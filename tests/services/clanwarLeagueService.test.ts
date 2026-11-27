import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    CocApiClient,
    CocApiError,
    type CompleteClanwarData,
    type CompleteClanwarsLeagueData,
    type CompleteClanwarsLeagueRoundData,
    WAR_TYPES,
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
    ClanwarLeagueService,
    SECONDS_PER_HOUR,
    type ClanwarLeagueApiClient,
} from '../../src/services/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');
const CLAN_TAG = '#2PPLQ';

interface CwlWarSpec {
    readonly clanTag?: string;
    readonly opponentTag: string;
    readonly warUID: string;
    readonly state: string;
    readonly roundNumber?: number;
    readonly warType?: CompleteClanwarData['clanwar']['warType'];
    readonly preparationStartTime: number;
    readonly startTime: number;
    readonly endTime: number;
    readonly withDetails?: boolean;
}

function makeCwlWar(spec: CwlWarSpec): CompleteClanwarsLeagueRoundData {
    const clanTag = spec.clanTag ?? CLAN_TAG;
    const withDetails = spec.withDetails ?? true;
    const roundNumber = spec.roundNumber ?? 1;

    return {
        roundNumber,
        clanwar: {
            warUID: spec.warUID,
            clanTag,
            state: spec.state,
            warType: spec.warType ?? WAR_TYPES.cwl,
            teamSize: 2,
            attacksPerMember: 1,
            preparationStartTime: spec.preparationStartTime,
            startTime: spec.startTime,
            endTime: spec.endTime,
            seasonId: null,
            roundNumber,
        },
        clans: [
            {
                side: 'home',
                clanTag,
                clanName: 'Home Clan',
                clanLevel: 10,
                attacksCount: 1,
                stars: 3,
                destructionPercentage: 100.0,
            },
            {
                side: 'opponent',
                clanTag: spec.opponentTag,
                clanName: 'Opponent Clan',
                clanLevel: 9,
                attacksCount: 1,
                stars: 0,
                destructionPercentage: 0.0,
            },
        ],
        attacks: withDetails
            ? [
                  {
                      attackerTag: '#P1',
                      defenderTag: '#OP1',
                      attackerClanTag: clanTag,
                      defenderClanTag: spec.opponentTag,
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
                          clanTag: spec.opponentTag,
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

class FakeClanwarLeagueApiClient implements ClanwarLeagueApiClient {
    leagueData: CompleteClanwarsLeagueData | null = null;
    errorToThrow: Error | null = null;
    onGetCompleteClanwarsLeagueData?: (clanTag: string, signal?: AbortSignal) => void;

    getCompleteClanwarsLeagueData(
        clanTag: string,
        signal?: AbortSignal,
    ): Promise<CompleteClanwarsLeagueData | null> {
        this.onGetCompleteClanwarsLeagueData?.(clanTag, signal);
        if (this.errorToThrow !== null) {
            return Promise.reject(this.errorToThrow);
        }
        return Promise.resolve(this.leagueData);
    }
}

function tableRowCount(db: Database, tableName: string): number {
    const row = db.connection
        .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${tableName};`)
        .get();
    return row?.count ?? 0;
}

describe('ClanwarLeagueService', () => {
    const openDatabases: Database[] = [];

    function setup(initialEpochSeconds = 1_700_000_000): {
        db: Database;
        clock: FakeClock;
        clansRepo: ClansRepo;
        clanwarRepo: ClanwarRepo;
        leagueRepo: ClanwarsLeagueRepo;
        subscriptionRepo: SubscriptionRepo;
        domainEventsRepo: DomainEventsRepo;
        apiClient: FakeClanwarLeagueApiClient;
        service: ClanwarLeagueService;
    } {
        const db = new Database(':memory:');
        openDatabases.push(db);
        const txManager = new TransactionManager(db);
        const migrator = new MigratorManager(db, txManager);
        migrator.migrate(REAL_MIGRATIONS_PATH);

        const clansRepo = new ClansRepo(db);
        const clanwarRepo = new ClanwarRepo(db);
        const leagueRepo = new ClanwarsLeagueRepo(db);
        const subscriptionRepo = new SubscriptionRepo(db);
        const domainEventsRepo = new DomainEventsRepo(db);
        const serializer = new DomainEventPayloadSerializer();
        const recorder = new DomainEventRecorder(serializer, subscriptionRepo, domainEventsRepo);
        const apiClient = new FakeClanwarLeagueApiClient();
        const clock = new FakeClock(initialEpochSeconds * 1000);
        const service = new ClanwarLeagueService(
            clanwarRepo,
            leagueRepo,
            apiClient,
            txManager,
            recorder,
            clock,
        );

        return {
            db,
            clock,
            clansRepo,
            clanwarRepo,
            leagueRepo,
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
        expect(service.getServiceName()).toBe('ClanwarLeagueService');
    });

    it('saves CWL season, members, rounds with 1-based round numbers, and cwl_round_ended events outside API transaction', async () => {
        const {
            db,
            clansRepo,
            clanwarRepo,
            leagueRepo,
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

        let wasInTransactionDuringApiCall = true;
        apiClient.onGetCompleteClanwarsLeagueData = () => {
            wasInTransactionDuringApiCall = db.connection.inTransaction;
        };
        apiClient.leagueData = {
            clanwarsLeagueSeason: {
                clanTag: CLAN_TAG,
                seasonId: '2026-09',
            },
            clanwarsLeagueMembers: [
                {
                    playerTag: '#P1',
                    playerName: 'Alice',
                    townhallLevel: 14,
                    clanTag: CLAN_TAG,
                    seasonId: '2026-09',
                },
                {
                    playerTag: '#P2',
                    playerName: 'Bob',
                    townhallLevel: 13,
                    clanTag: CLAN_TAG,
                    seasonId: '2026-09',
                },
            ],
            warDetails: [
                makeCwlWar({
                    opponentTag: '#OPP1',
                    warUID: 'cwl-war-1',
                    state: 'warEnded',
                    roundNumber: 1,
                    preparationStartTime: 1_000,
                    startTime: 1_100,
                    endTime: 2_000,
                    withDetails: true,
                }),
                makeCwlWar({
                    opponentTag: '#OPP2',
                    warUID: 'cwl-war-2',
                    state: 'warEnded',
                    roundNumber: 2,
                    preparationStartTime: 3_000,
                    startTime: 3_100,
                    endTime: 4_000,
                    withDetails: false,
                }),
            ],
        };

        const result = await service.updateData(CLAN_TAG);

        expect(wasInTransactionDuringApiCall).toBe(false);
        expect(result.successFlag).toBe(true);
        expect(result.serviceName).toBe('ClanwarLeagueService');
        expect(result.clanTag).toBe(CLAN_TAG);
        expect(result.events).toHaveLength(2);

        const firstEvent = result.events[0];
        const secondEvent = result.events[1];
        if (
            firstEvent?.type !== APPLICATION_EVENT_TYPES.cwlRoundEnded ||
            secondEvent?.type !== APPLICATION_EVENT_TYPES.cwlRoundEnded
        ) {
            throw new Error('Expected ClanwarsLeagueRoundEndedEvent entries');
        }

        expect(firstEvent.cwlSeasonId).toBe(secondEvent.cwlSeasonId);
        expect(leagueRepo.getRoundInfo(firstEvent.warReference)).toEqual({
            season: String(firstEvent.cwlSeasonId),
            roundNumber: 1,
        });
        expect(leagueRepo.getRoundInfo(secondEvent.warReference)).toEqual({
            season: String(secondEvent.cwlSeasonId),
            roundNumber: 2,
        });

        const firstOverviews = clanwarRepo.getClanwarOverviews(firstEvent.warReference);
        expect(firstOverviews.home.clanTag).toBe(CLAN_TAG);
        expect(firstOverviews.opponent.clanTag).toBe('#OPP1');

        const firstStats = clanwarRepo.getClanwarAttackStats(firstEvent.warReference);
        expect(firstStats.attacksUsed).toBe(1);
        expect(firstStats.maxAttacks).toBe(2);
        expect(firstStats.totalAttackStars).toBe(3);

        expect(tableRowCount(db, 'cwl_seasons')).toBe(1);
        expect(tableRowCount(db, 'cwl_season_members')).toBe(2);
        expect(tableRowCount(db, 'wars')).toBe(2);
        expect(tableRowCount(db, 'war_clans')).toBe(4);
        expect(tableRowCount(db, 'attacks')).toBe(1);
        expect(tableRowCount(db, 'war_members')).toBe(2);

        // 2 rounds * 2 audiences (players + management) = 4 pending destinations
        const pending = domainEventsRepo.getPendingDestinations(50);
        expect(pending).toHaveLength(4);
        for (const dest of pending) {
            expect(dest.eventType).toBe('cwl_round_ended');
            expect(dest.payloadVersion).toBe(1);
        }
    });

    it('returns empty success without modifying DB when no active CWL season exists', async () => {
        const { db, clansRepo, apiClient, service } = setup();
        clansRepo.insertMinimalClan(CLAN_TAG);
        apiClient.leagueData = null;

        const result = await service.updateData(CLAN_TAG);

        expect(result.successFlag).toBe(true);
        expect(result.serviceName).toBe('ClanwarLeagueService');
        expect(result.clanTag).toBe(CLAN_TAG);
        expect(result.errorMsg).toBe('');
        expect(result.events).toHaveLength(0);
        expect(tableRowCount(db, 'cwl_seasons')).toBe(0);
        expect(tableRowCount(db, 'wars')).toBe(0);
        expect(tableRowCount(db, 'domain_events')).toBe(0);
    });

    it('returns SyncResult error when API fails and rethrows AbortError on shutdown cancellation', async () => {
        const { db, clansRepo, apiClient, service } = setup();
        clansRepo.insertMinimalClan(CLAN_TAG);

        apiClient.errorToThrow = new CocApiError('API unavailable', {
            kind: 'server_error',
            statusCode: 503,
            endpoint: '/clans/%232PPLQ/currentwar/leaguegroup',
        });
        const errorResult = await service.updateData(CLAN_TAG);
        expect(errorResult.successFlag).toBe(false);
        expect(errorResult.serviceName).toBe('ClanwarLeagueService');
        expect(errorResult.clanTag).toBe(CLAN_TAG);
        expect(errorResult.errorMsg).toContain('API unavailable');
        expect(errorResult.events).toHaveLength(0);

        apiClient.errorToThrow = new AbortError('CWL sync aborted');
        await expect(service.updateData(CLAN_TAG)).rejects.toBeInstanceOf(AbortError);

        apiClient.errorToThrow = null;
        apiClient.leagueData = {
            clanwarsLeagueSeason: { clanTag: CLAN_TAG, seasonId: '2026-09' },
            clanwarsLeagueMembers: [],
            warDetails: [],
        };
        const controller = new AbortController();
        controller.abort();
        await expect(service.updateData(CLAN_TAG, controller.signal)).rejects.toBeInstanceOf(
            AbortError,
        );

        expect(tableRowCount(db, 'cwl_seasons')).toBe(0);
        expect(tableRowCount(db, 'wars')).toBe(0);
    });

    it('generates CWL reminders across 3 checkpoints per round with deduplication and upserts idempotently', async () => {
        const round1Start = 1_700_100_000;
        const round1End = round1Start + 24 * SECONDS_PER_HOUR;
        const round2Start = round1End;
        const round2End = round2Start + 24 * SECONDS_PER_HOUR;

        const { db, clock, clansRepo, subscriptionRepo, domainEventsRepo, apiClient, service } =
            setup(round1Start);

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.saveTelegramChat(5001, 0, 'Management');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        subscriptionRepo.subscribeToChat(5001, 0, CLAN_TAG, 'management');

        apiClient.leagueData = {
            clanwarsLeagueSeason: { clanTag: CLAN_TAG, seasonId: '2026-09' },
            clanwarsLeagueMembers: [
                {
                    playerTag: '#P1',
                    playerName: 'Alice',
                    townhallLevel: 14,
                    clanTag: CLAN_TAG,
                    seasonId: '2026-09',
                },
            ],
            warDetails: [
                makeCwlWar({
                    opponentTag: '#OPP1',
                    warUID: 'cwl-round-1',
                    state: 'inWar',
                    roundNumber: 1,
                    preparationStartTime: round1Start - 24 * SECONDS_PER_HOUR,
                    startTime: round1Start,
                    endTime: round1End,
                    withDetails: false,
                }),
                makeCwlWar({
                    opponentTag: '#OPP2',
                    warUID: 'cwl-round-2',
                    state: 'preparation',
                    roundNumber: 2,
                    preparationStartTime: round1Start,
                    startTime: round2Start,
                    endTime: round2End,
                    withDetails: false,
                }),
            ],
        };

        // At round1Start: round 1 gets 'started', round 2 gets none
        const firstSync = await service.updateData(CLAN_TAG);
        expect(firstSync.successFlag).toBe(true);
        expect(firstSync.events).toHaveLength(1);
        const firstReminder = firstSync.events[0];
        expect(firstReminder).toMatchObject({
            type: APPLICATION_EVENT_TYPES.warReminder,
            clanTag: CLAN_TAG,
            endTime: round1End,
            warKind: WAR_REMINDER_WAR_KINDS.cwl,
            kind: WAR_REMINDER_KINDS.started,
        });
        if (firstReminder?.type !== APPLICATION_EVENT_TYPES.warReminder) {
            throw new Error('Expected WarReminderEvent');
        }
        const round1WarId = firstReminder.warId;

        // Repeat at same time -> idempotent
        await service.updateData(CLAN_TAG);
        expect(tableRowCount(db, 'cwl_seasons')).toBe(1);
        expect(tableRowCount(db, 'cwl_season_members')).toBe(1);
        expect(tableRowCount(db, 'wars')).toBe(2);
        expect(tableRowCount(db, 'war_clans')).toBe(4);
        expect(tableRowCount(db, 'domain_events')).toBe(1);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(1);

        // Advance to round 1 6h left -> only six_hours_left emitted
        clock.setNow((round1End - 6 * SECONDS_PER_HOUR) * 1000);
        const sixHoursSync = await service.updateData(CLAN_TAG);
        expect(sixHoursSync.successFlag).toBe(true);
        expect(sixHoursSync.events).toHaveLength(1);
        expect(tableRowCount(db, 'domain_events')).toBe(2);

        // Advance to round 1 1h left -> only one_hour_left emitted
        clock.setNow((round1End - SECONDS_PER_HOUR) * 1000);
        const oneHourSync = await service.updateData(CLAN_TAG);
        expect(oneHourSync.successFlag).toBe(true);
        expect(oneHourSync.events).toHaveLength(1);
        expect(tableRowCount(db, 'domain_events')).toBe(3);

        // Advance to round 2 6h left (skipping round 2 started), round 1 ended
        clock.setNow((round2End - 6 * SECONDS_PER_HOUR) * 1000);
        apiClient.leagueData = {
            ...apiClient.leagueData,
            warDetails: [
                makeCwlWar({
                    opponentTag: '#OPP1',
                    warUID: 'cwl-round-1',
                    state: 'warEnded',
                    roundNumber: 1,
                    preparationStartTime: round1Start - 24 * SECONDS_PER_HOUR,
                    startTime: round1Start,
                    endTime: round1End,
                    withDetails: false,
                }),
                makeCwlWar({
                    opponentTag: '#OPP2',
                    warUID: 'cwl-round-2',
                    state: 'inWar',
                    roundNumber: 2,
                    preparationStartTime: round1Start,
                    startTime: round2Start,
                    endTime: round2End,
                    withDetails: false,
                }),
            ],
        };

        const transitionSync = await service.updateData(CLAN_TAG);
        const transitionRepeat = await service.updateData(CLAN_TAG);
        expect(transitionSync.successFlag).toBe(true);
        expect(transitionRepeat.successFlag).toBe(true);

        const round2SixHours = transitionSync.events.find(
            (e) => e.type === APPLICATION_EVENT_TYPES.warReminder && e.warId !== round1WarId,
        );
        if (round2SixHours?.type !== APPLICATION_EVENT_TYPES.warReminder) {
            throw new Error('Expected round 2 WarReminderEvent');
        }
        const round2WarId = round2SixHours.warId;

        // Total domain events:
        //   round 1: 3 reminders + 1 cwl_round_ended
        //   round 2: 2 reminders (started [skipped without destinations] + six_hours_left)
        // = 6 unique domain events
        expect(tableRowCount(db, 'domain_events')).toBe(6);

        const pending = domainEventsRepo.getPendingDestinations(50);
        // 4 players-only active reminders + 2 destinations (players + management) for round 1 cwl_round_ended = 6
        expect(pending).toHaveLength(6);

        const reminderEventIds = pending
            .filter((d) => d.eventType === 'war_reminder')
            .map((d) => d.eventId);
        expect(reminderEventIds).toEqual([
            `${String(round1WarId)}:${WAR_REMINDER_KINDS.started}`,
            `${String(round1WarId)}:${WAR_REMINDER_KINDS.sixHoursLeft}`,
            `${String(round1WarId)}:${WAR_REMINDER_KINDS.oneHourLeft}`,
            `${String(round2WarId)}:${WAR_REMINDER_KINDS.sixHoursLeft}`,
        ]);
        for (const reminderDest of pending.filter((d) => d.eventType === 'war_reminder')) {
            expect(reminderDest.category).toBe('reminders');
            expect(JSON.parse(reminderDest.payload)).toMatchObject({ war_kind: 'cwl' });
        }
    });

    it('rolls back season, members, and all rounds atomically when saving a round or domain event fails', async () => {
        const { db, clansRepo, subscriptionRepo, domainEventsRepo, apiClient, service } =
            setup(10_000);
        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');

        // 1. Second round fails CHECK constraint -> entire season + round 1 rolled back
        apiClient.leagueData = {
            clanwarsLeagueSeason: { clanTag: CLAN_TAG, seasonId: '2026-09' },
            clanwarsLeagueMembers: [
                {
                    playerTag: '#P1',
                    playerName: 'Alice',
                    townhallLevel: 14,
                    clanTag: CLAN_TAG,
                    seasonId: '2026-09',
                },
            ],
            warDetails: [
                makeCwlWar({
                    opponentTag: '#OPP1',
                    warUID: 'cwl-valid-1',
                    state: 'warEnded',
                    preparationStartTime: 1_000,
                    startTime: 1_100,
                    endTime: 2_000,
                    withDetails: false,
                }),
                makeCwlWar({
                    opponentTag: '#OPP2',
                    warUID: 'cwl-invalid-2',
                    state: 'warEnded',
                    warType: 'invalid' as CompleteClanwarData['clanwar']['warType'],
                    preparationStartTime: 3_000,
                    startTime: 3_100,
                    endTime: 4_000,
                    withDetails: false,
                }),
            ],
        };

        const invalidResult = await service.updateData(CLAN_TAG);
        expect(invalidResult.successFlag).toBe(false);
        expect(invalidResult.events).toHaveLength(0);
        expect(invalidResult.errorMsg.length).toBeGreaterThan(0);
        expect(tableRowCount(db, 'cwl_seasons')).toBe(0);
        expect(tableRowCount(db, 'cwl_season_members')).toBe(0);
        expect(tableRowCount(db, 'wars')).toBe(0);
        expect(tableRowCount(db, 'war_clans')).toBe(0);
        expect(tableRowCount(db, 'domain_events')).toBe(0);

        // 2. Domain event insert failure rolls back valid season + round
        apiClient.leagueData = {
            ...apiClient.leagueData,
            warDetails: [
                makeCwlWar({
                    opponentTag: '#OPP1',
                    warUID: 'cwl-valid-1',
                    state: 'warEnded',
                    preparationStartTime: 1_000,
                    startTime: 1_100,
                    endTime: 2_000,
                    withDetails: false,
                }),
            ],
        };
        db.connection.exec(`
            CREATE TEMP TRIGGER reject_cwl_domain_event
            BEFORE INSERT ON domain_events
            BEGIN
                SELECT RAISE(ABORT, 'simulated cwl event failure');
            END;
        `);

        const failed = await service.updateData(CLAN_TAG);
        expect(failed.successFlag).toBe(false);
        expect(tableRowCount(db, 'cwl_seasons')).toBe(0);
        expect(tableRowCount(db, 'cwl_season_members')).toBe(0);
        expect(tableRowCount(db, 'wars')).toBe(0);
        expect(tableRowCount(db, 'domain_events')).toBe(0);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(0);

        db.connection.exec('DROP TRIGGER reject_cwl_domain_event;');

        const recovered = await service.updateData(CLAN_TAG);
        expect(recovered.successFlag).toBe(true);
        expect(recovered.events).toHaveLength(1);
        expect(tableRowCount(db, 'cwl_seasons')).toBe(1);
        expect(tableRowCount(db, 'wars')).toBe(1);
        expect(tableRowCount(db, 'domain_events')).toBe(1);
    });

    it('persists original non-contiguous CWL round_number values and stays idempotent when earlier rounds appear later', async () => {
        const { db, clansRepo, leagueRepo, apiClient, service } = setup(10_000);
        clansRepo.insertMinimalClan(CLAN_TAG);

        apiClient.leagueData = {
            clanwarsLeagueSeason: { clanTag: CLAN_TAG, seasonId: '2026-09' },
            clanwarsLeagueMembers: [],
            warDetails: [
                makeCwlWar({
                    opponentTag: '#OPP3',
                    warUID: 'cwl-round-3',
                    state: 'warEnded',
                    roundNumber: 3,
                    preparationStartTime: 3_000,
                    startTime: 3_100,
                    endTime: 4_000,
                    withDetails: false,
                }),
                makeCwlWar({
                    opponentTag: '#OPP5',
                    warUID: 'cwl-round-5',
                    state: 'warEnded',
                    roundNumber: 5,
                    preparationStartTime: 5_000,
                    startTime: 5_100,
                    endTime: 6_000,
                    withDetails: false,
                }),
            ],
        };

        const firstResult = await service.updateData(CLAN_TAG);
        expect(firstResult.successFlag).toBe(true);

        const savedRoundsAfterFirst = db.connection
            .prepare<[], { war_uid: string; round_number: number }>(
                'SELECT war_uid, round_number FROM wars ORDER BY round_number ASC;',
            )
            .all();
        expect(savedRoundsAfterFirst).toEqual([
            { war_uid: 'cwl-round-3', round_number: 3 },
            { war_uid: 'cwl-round-5', round_number: 5 },
        ]);

        // Repeat sync when round 2 becomes available later
        apiClient.leagueData = {
            ...apiClient.leagueData,
            warDetails: [
                makeCwlWar({
                    opponentTag: '#OPP2',
                    warUID: 'cwl-round-2',
                    state: 'warEnded',
                    roundNumber: 2,
                    preparationStartTime: 2_000,
                    startTime: 2_100,
                    endTime: 3_000,
                    withDetails: false,
                }),
                ...apiClient.leagueData.warDetails,
            ],
        };

        const secondResult = await service.updateData(CLAN_TAG);
        expect(secondResult.successFlag).toBe(true);

        const savedRoundsAfterSecond = db.connection
            .prepare<[], { war_uid: string; round_number: number }>(
                'SELECT war_uid, round_number FROM wars ORDER BY round_number ASC;',
            )
            .all();
        expect(savedRoundsAfterSecond).toEqual([
            { war_uid: 'cwl-round-2', round_number: 2 },
            { war_uid: 'cwl-round-3', round_number: 3 },
            { war_uid: 'cwl-round-5', round_number: 5 },
        ]);

        for (const event of secondResult.events) {
            if (event.type !== APPLICATION_EVENT_TYPES.cwlRoundEnded) {
                continue;
            }
            const row = db.connection
                .prepare<[number], { war_uid: string; round_number: number }>(
                    'SELECT war_uid, round_number FROM wars WHERE war_id = ?;',
                )
                .get(event.warReference.warId);
            expect(leagueRepo.getRoundInfo(event.warReference)).toEqual({
                season: String(event.cwlSeasonId),
                roundNumber: row?.round_number,
            });
        }
    });

    it('preserves wars.round_number end-to-end with CocApiClient across #0 placeholders and temporary 404 responses', async () => {
        const {
            db,
            clock,
            clansRepo,
            clanwarRepo,
            leagueRepo,
            subscriptionRepo,
            domainEventsRepo,
        } = setup(1_790_000_000);
        const txManager = new TransactionManager(db);
        const serializer = new DomainEventPayloadSerializer();
        const recorder = new DomainEventRecorder(serializer, subscriptionRepo, domainEventsRepo);

        clansRepo.insertMinimalClan(CLAN_TAG);

        let round2Available = false;
        const server = http.createServer((req, res) => {
            const sendJson = (status: number, body: unknown): void => {
                res.statusCode = status;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(body));
            };

            switch (req.url) {
                case '/clans/%232PPLQ/currentwar/leaguegroup':
                    sendJson(200, {
                        state: 'inWar',
                        season: '2026-09',
                        clans: [
                            {
                                tag: CLAN_TAG,
                                members: [{ tag: '#P1', name: 'Alice', townHallLevel: 14 }],
                            },
                        ],
                        rounds: [
                            { warTags: ['#0', '#0'] },
                            { warTags: ['#WAR_R2_TEMP_404'] },
                            { warTags: ['#WAR_R3_OURS'] },
                            { warTags: ['#0'] },
                            { warTags: ['#WAR_R5_OURS'] },
                        ],
                    });
                    return;

                case '/clanwarleagues/wars/%23WAR_R2_TEMP_404':
                    if (!round2Available) {
                        sendJson(404, { reason: 'notFound' });
                        return;
                    }
                    sendJson(200, {
                        state: 'warEnded',
                        teamSize: 15,
                        preparationStartTime: '20260902T000000.000Z',
                        startTime: '20260903T000000.000Z',
                        endTime: '20260904T000000.000Z',
                        clan: { tag: CLAN_TAG, name: 'Home Clan', members: [] },
                        opponent: { tag: '#OPP2', name: 'Opponent 2', members: [] },
                    });
                    return;

                case '/clanwarleagues/wars/%23WAR_R3_OURS':
                    sendJson(200, {
                        state: 'warEnded',
                        teamSize: 15,
                        preparationStartTime: '20260903T000000.000Z',
                        startTime: '20260904T000000.000Z',
                        endTime: '20260905T000000.000Z',
                        clan: { tag: CLAN_TAG, name: 'Home Clan', members: [] },
                        opponent: { tag: '#OPP3', name: 'Opponent 3', members: [] },
                    });
                    return;

                case '/clanwarleagues/wars/%23WAR_R5_OURS':
                    sendJson(200, {
                        state: 'inWar',
                        teamSize: 15,
                        preparationStartTime: '20260905T000000.000Z',
                        startTime: '20260906T000000.000Z',
                        endTime: '20260907T000000.000Z',
                        clan: { tag: '#OPP5', name: 'Opponent 5', members: [] },
                        opponent: { tag: CLAN_TAG, name: 'Home Clan', members: [] },
                    });
                    return;

                default:
                    sendJson(404, { reason: 'notFound' });
            }
        });

        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address() as AddressInfo;
        const apiClient = new CocApiClient({
            token: 'test-token',
            baseUrl: `http://127.0.0.1:${String(address.port)}`,
        });

        try {
            const service = new ClanwarLeagueService(
                clanwarRepo,
                leagueRepo,
                apiClient,
                txManager,
                recorder,
                clock,
            );

            // Sync 1: round 1 is #0, round 2 is 404, round 4 is #0 -> only rounds 3 and 5 saved
            const firstSync = await service.updateData(CLAN_TAG);
            expect(firstSync.successFlag).toBe(true);

            const rowsAfterFirst = db.connection
                .prepare<[], { war_uid: string; round_number: number }>(
                    'SELECT war_uid, round_number FROM wars ORDER BY round_number ASC;',
                )
                .all();
            expect(rowsAfterFirst).toEqual([
                { war_uid: '#2PPLQ_#2PPLQ_#OPP3_20260903T000000', round_number: 3 },
                { war_uid: '#2PPLQ_#2PPLQ_#OPP5_20260905T000000', round_number: 5 },
            ]);

            // Sync 2: temporary 404 on round 2 resolves -> round 2 saved with round_number = 2, 3 and 5 unchanged
            round2Available = true;
            const secondSync = await service.updateData(CLAN_TAG);
            expect(secondSync.successFlag).toBe(true);

            const rowsAfterSecond = db.connection
                .prepare<[], { war_uid: string; round_number: number }>(
                    'SELECT war_uid, round_number FROM wars ORDER BY round_number ASC;',
                )
                .all();
            expect(rowsAfterSecond).toEqual([
                { war_uid: '#2PPLQ_#2PPLQ_#OPP2_20260902T000000', round_number: 2 },
                { war_uid: '#2PPLQ_#2PPLQ_#OPP3_20260903T000000', round_number: 3 },
                { war_uid: '#2PPLQ_#2PPLQ_#OPP5_20260905T000000', round_number: 5 },
            ]);
        } finally {
            await apiClient.close();
            await new Promise<void>((resolve, reject) => {
                server.close((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        }
    });

    it.each([
        { label: 'A then B', order: ['#CLAN_A', '#CLAN_B'] as const },
        { label: 'B then A', order: ['#CLAN_B', '#CLAN_A'] as const },
    ])(
        'isolates CWL round results, rosters, attacks, seasons, and shared-chat reports for two tracked opponents ($label)',
        async ({ order }) => {
            const {
                db,
                clock,
                clansRepo,
                clanwarRepo,
                leagueRepo,
                subscriptionRepo,
                domainEventsRepo,
            } = setup(1_800_000_000);
            const txManager = new TransactionManager(db);
            const serializer = new DomainEventPayloadSerializer();
            const recorder = new DomainEventRecorder(
                serializer,
                subscriptionRepo,
                domainEventsRepo,
            );
            const notificationRepo = new NotificationRepo(db);
            const raidRepo = new RaidRepo(db);
            const notificationService = new NotificationService({
                notificationRepo,
                clansRepo,
                clanwarRepo,
                clanwarsLeagueRepo: leagueRepo,
                raidRepo,
                subscriptionRepo,
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
            subscriptionRepo.subscribeToChat(SHARED_MANAGEMENT_CHAT, 0, CLAN_A, {
                preset: 'management',
                mirrorRuleEnabled: true,
            });
            subscriptionRepo.subscribeToChat(SHARED_MANAGEMENT_CHAT, 0, CLAN_B, {
                preset: 'management',
                mirrorRuleEnabled: true,
            });

            const leagueGroupBody = {
                state: 'inWar',
                season: '2026-10',
                clans: [
                    {
                        tag: CLAN_A,
                        members: [
                            { tag: '#A1', name: 'Alice', townHallLevel: 16 },
                            { tag: '#A2', name: 'Anton', townHallLevel: 15 },
                        ],
                    },
                    {
                        tag: CLAN_B,
                        members: [
                            { tag: '#B1', name: 'Boris', townHallLevel: 16 },
                            { tag: '#B2', name: 'Bella', townHallLevel: 15 },
                        ],
                    },
                ],
                rounds: [{ warTags: ['#0'] }, { warTags: ['#WAR_AB'] }],
            };

            const sharedCwlWarBody = {
                state: 'warEnded',
                teamSize: 2,
                preparationStartTime: '20261002T000000.000Z',
                startTime: '20261003T000000.000Z',
                endTime: '20261004T000000.000Z',
                clan: {
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
                                    duration: 105,
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
                },
                opponent: {
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
                                    duration: 135,
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
                },
            };

            const server = http.createServer((req, res) => {
                const sendJson = (status: number, body: unknown): void => {
                    res.statusCode = status;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(body));
                };

                switch (req.url) {
                    case '/clans/%23CLAN_A/currentwar/leaguegroup':
                    case '/clans/%23CLAN_B/currentwar/leaguegroup':
                        sendJson(200, leagueGroupBody);
                        return;
                    case '/clanwarleagues/wars/%23WAR_AB':
                        sendJson(200, sharedCwlWarBody);
                        return;
                    default:
                        sendJson(404, { reason: 'notFound' });
                }
            });

            await new Promise<void>((resolve) => {
                server.listen(0, '127.0.0.1', resolve);
            });
            const address = server.address() as AddressInfo;
            const apiClient = new CocApiClient({
                token: 'test-token',
                baseUrl: `http://127.0.0.1:${String(address.port)}`,
            });

            try {
                const service = new ClanwarLeagueService(
                    clanwarRepo,
                    leagueRepo,
                    apiClient,
                    txManager,
                    recorder,
                    clock,
                );

                const results = new Map<
                    string,
                    Awaited<ReturnType<ClanwarLeagueService['updateData']>>
                >();
                for (const tag of order) {
                    results.set(tag, await service.updateData(tag));
                }
                for (const tag of order) {
                    const repeated = await service.updateData(tag);
                    expect(repeated.successFlag).toBe(true);
                }

                const eventA = results.get(CLAN_A)?.events[0];
                const eventB = results.get(CLAN_B)?.events[0];
                expect(eventA?.type).toBe(APPLICATION_EVENT_TYPES.cwlRoundEnded);
                expect(eventB?.type).toBe(APPLICATION_EVENT_TYPES.cwlRoundEnded);
                if (
                    eventA?.type !== APPLICATION_EVENT_TYPES.cwlRoundEnded ||
                    eventB?.type !== APPLICATION_EVENT_TYPES.cwlRoundEnded
                ) {
                    throw new Error('Expected ClanwarsLeagueRoundEndedEvent for both clans');
                }

                const refA = eventA.warReference;
                const refB = eventB.warReference;
                expect(refA.warId).not.toBe(refB.warId);
                expect(eventA.cwlSeasonId).not.toBe(eventB.cwlSeasonId);

                const warRows = db.connection
                    .prepare<
                        [],
                        {
                            war_uid: string;
                            clan_tag: string;
                            round_number: number;
                            season_id: number;
                        }
                    >(
                        'SELECT war_uid, clan_tag, round_number, season_id FROM wars ORDER BY clan_tag ASC;',
                    )
                    .all();
                expect(warRows).toEqual([
                    {
                        war_uid: '#CLAN_A_#CLAN_A_#CLAN_B_20261002T000000',
                        clan_tag: CLAN_A,
                        round_number: 2,
                        season_id: eventA.cwlSeasonId,
                    },
                    {
                        war_uid: '#CLAN_B_#CLAN_A_#CLAN_B_20261002T000000',
                        clan_tag: CLAN_B,
                        round_number: 2,
                        season_id: eventB.cwlSeasonId,
                    },
                ]);

                // Overviews, rosters, attacks, and discipline are isolated
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

                expect(clanwarRepo.getHomeMemberTags(refA).sort()).toEqual(['#A1', '#A2']);
                expect(clanwarRepo.getHomeMemberTags(refB).sort()).toEqual(['#B1', '#B2']);

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

                // Materialize and verify shared Telegram chats receive both CWL reports
                domainEventWorker.processPending();

                const notifications = notificationRepo.getPending(50);
                const sharedPlayersCwl = notifications.filter(
                    (n) => n.chatId === SHARED_PLAYERS_CHAT && n.eventType === 'cwl_round_ended',
                );
                expect(sharedPlayersCwl).toHaveLength(2);
                expect(
                    sharedPlayersCwl.some(
                        (n) =>
                            n.messageText.includes('ВТОРОМУ') &&
                            n.messageText.includes('Clan Alpha') &&
                            n.messageText.includes('3 - 1') &&
                            n.messageText.includes('Итог: Победа'),
                    ),
                ).toBe(true);
                expect(
                    sharedPlayersCwl.some(
                        (n) =>
                            n.messageText.includes('ВТОРОМУ') &&
                            n.messageText.includes('Clan Beta') &&
                            n.messageText.includes('1 - 3') &&
                            n.messageText.includes('Итог: Поражение'),
                    ),
                ).toBe(true);

                const sharedManagementCwl = notifications.filter(
                    (n) => n.chatId === SHARED_MANAGEMENT_CHAT && n.eventType === 'cwl_violations',
                );
                expect(sharedManagementCwl).toHaveLength(2);
                expect(
                    sharedManagementCwl.some(
                        (n) =>
                            n.messageText.includes('Anton [0/1]') &&
                            !n.messageText.includes('Bella'),
                    ),
                ).toBe(true);
                expect(
                    sharedManagementCwl.some(
                        (n) =>
                            n.messageText.includes('Bella [0/1]') &&
                            n.messageText.includes('Boris') &&
                            !n.messageText.includes('Anton'),
                    ),
                ).toBe(true);
            } finally {
                await apiClient.close();
                await new Promise<void>((resolve, reject) => {
                    server.close((err) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            }
        },
    );

    it('emits only the newest CWL reminder on late start and downtime recovery, skipping missed points and rendering actual time', async () => {
        const round1Start = 1_700_100_000;
        const round1End = round1Start + 24 * SECONDS_PER_HOUR;
        const round2Start = round1End;
        const round2End = round2Start + 24 * SECONDS_PER_HOUR;

        // Late start: 21 minutes before round 1 ends
        const {
            db,
            clock,
            clansRepo,
            clanwarRepo,
            leagueRepo,
            subscriptionRepo,
            domainEventsRepo,
            apiClient,
            service,
        } = setup(round1End - 21 * 60);

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');

        apiClient.leagueData = {
            clanwarsLeagueSeason: { clanTag: CLAN_TAG, seasonId: '2026-09' },
            clanwarsLeagueMembers: [],
            warDetails: [
                makeCwlWar({
                    opponentTag: '#OPP1',
                    warUID: 'cwl-late-round-1',
                    state: 'inWar',
                    roundNumber: 1,
                    preparationStartTime: round1Start - 24 * SECONDS_PER_HOUR,
                    startTime: round1Start,
                    endTime: round1End,
                    withDetails: false,
                }),
            ],
        };

        // 1. Late start in final hour of round 1 -> only one_hour_left sent; started & 6h skipped without destinations
        const lateSync = await service.updateData(CLAN_TAG);
        expect(lateSync.successFlag).toBe(true);
        expect(lateSync.events).toHaveLength(1);
        const r1Reminder = lateSync.events[0];
        if (r1Reminder?.type !== APPLICATION_EVENT_TYPES.warReminder) {
            throw new Error('Expected CWL WarReminderEvent');
        }
        expect(r1Reminder.warKind).toBe(WAR_REMINDER_WAR_KINDS.cwl);
        expect(r1Reminder.kind).toBe(WAR_REMINDER_KINDS.oneHourLeft);
        expect(r1Reminder.remainingSeconds).toBe(21 * 60);
        expect(tableRowCount(db, 'domain_events')).toBe(3);

        // Repeat sync 5 minutes later -> idempotent
        clock.setNow((round1End - 16 * 60) * 1000);
        await service.updateData(CLAN_TAG);
        expect(tableRowCount(db, 'domain_events')).toBe(3);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(1);

        // 2. Downtime through round 2 start; recover at 4h 10m left in round 2
        clock.setNow((round2End - 4 * SECONDS_PER_HOUR - 10 * 60) * 1000);
        apiClient.leagueData = {
            ...apiClient.leagueData,
            warDetails: [
                makeCwlWar({
                    opponentTag: '#OPP2',
                    warUID: 'cwl-late-round-2',
                    state: 'inWar',
                    roundNumber: 2,
                    preparationStartTime: round1Start,
                    startTime: round2Start,
                    endTime: round2End,
                    withDetails: false,
                }),
            ],
        };

        const recoverySync = await service.updateData(CLAN_TAG);
        expect(recoverySync.successFlag).toBe(true);
        expect(recoverySync.events).toHaveLength(1);
        const r2Reminder = recoverySync.events[0];
        if (r2Reminder?.type !== APPLICATION_EVENT_TYPES.warReminder) {
            throw new Error('Expected round 2 CWL WarReminderEvent');
        }
        expect(r2Reminder.kind).toBe(WAR_REMINDER_KINDS.sixHoursLeft);
        expect(r2Reminder.remainingSeconds).toBe(4 * SECONDS_PER_HOUR + 10 * 60);

        // 3 events from round 1 + 2 events from round 2 (started skipped + 6h active) = 5 domain_events, 2 destinations
        expect(tableRowCount(db, 'domain_events')).toBe(5);
        const pending = domainEventsRepo.getPendingDestinations(50);
        expect(pending.map((d) => d.eventId)).toEqual([
            `${String(r1Reminder.warId)}:${WAR_REMINDER_KINDS.oneHourLeft}`,
            `${String(r2Reminder.warId)}:${WAR_REMINDER_KINDS.sixHoursLeft}`,
        ]);

        // Materialize and verify actual remaining times in notification texts
        const txManager = new TransactionManager(db);
        const notificationRepo = new NotificationRepo(db);
        const notificationService = new NotificationService({
            notificationRepo,
            clansRepo,
            clanwarRepo,
            clanwarsLeagueRepo: leagueRepo,
            raidRepo: new RaidRepo(db),
        });
        const worker = new DomainEventWorker({
            domainEventsRepo,
            transactionManager: txManager,
            deserializer: new DomainEventPayloadDeserializer(),
            materializer: notificationService,
            clock,
        });
        worker.processPending();

        const allMaterialized = db.connection
            .prepare<[], { event_id: string; message_text: string }>(
                'SELECT event_id, message_text FROM notifications ORDER BY id;',
            )
            .all();
        expect(allMaterialized).toHaveLength(2);
        expect(allMaterialized[0]?.message_text).toContain(
            'До окончания раунда ЛВК осталась 21 минута',
        );
        expect(allMaterialized[1]?.message_text).toContain(
            'До окончания раунда ЛВК осталось 4 часа 10 минут',
        );

        // At round 2 clock time, round 1 has already ended so only round 2's reminder is still deliverable
        const deliverable = notificationRepo.getPending(10, clock.nowEpochSeconds());
        expect(deliverable).toHaveLength(1);
        expect(deliverable[0]?.messageText).toContain(
            'До окончания раунда ЛВК осталось 4 часа 10 минут',
        );
    });

    it('captures CWL attack snapshots (counter with /cwl at 6h, compact list at 1h, and all-used) end-to-end', async () => {
        const startTime = 1_703_980_800;
        const endTime = 1_704_067_200;
        const {
            db,
            clock,
            clansRepo,
            clanwarRepo,
            leagueRepo,
            subscriptionRepo,
            domainEventsRepo,
            apiClient,
            service,
        } = setup(endTime - 6 * SECONDS_PER_HOUR);

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');

        const baseRound = makeCwlWar({
            opponentTag: '#OPP1',
            warUID: 'cwl-snap-r1',
            state: 'inWar',
            roundNumber: 1,
            preparationStartTime: startTime - 24 * SECONDS_PER_HOUR,
            startTime,
            endTime,
            withDetails: true,
        });
        const roundWithMembers: CompleteClanwarsLeagueRoundData = {
            ...baseRound,
            clanwar: { ...baseRound.clanwar, teamSize: 3, attacksPerMember: 1 },
            members: [
                [
                    {
                        clanTag: CLAN_TAG,
                        playerTag: '#P1',
                        playerName: 'Alice',
                        townhallLevel: 16,
                        mapPosition: 1,
                    },
                    {
                        clanTag: CLAN_TAG,
                        playerTag: '#P2',
                        playerName: 'Bob',
                        townhallLevel: 15,
                        mapPosition: 2,
                    },
                    {
                        clanTag: CLAN_TAG,
                        playerTag: '#P3',
                        playerName: 'Bob',
                        townhallLevel: 14,
                        mapPosition: 3,
                    },
                ],
                baseRound.members[1],
            ],
        };

        apiClient.leagueData = {
            clanwarsLeagueSeason: { clanTag: CLAN_TAG, seasonId: '2026-09' },
            clanwarsLeagueMembers: [],
            warDetails: [roundWithMembers],
        };

        // 6h left -> counter with /cwl (2 of 3 pending: #P1 attacked, #P2 & #P3 pending)
        const sixHours = await service.updateData(CLAN_TAG);
        expect(sixHours.events).toHaveLength(1);
        const sixHoursEvent = sixHours.events[0];
        if (sixHoursEvent?.type !== APPLICATION_EVENT_TYPES.warReminder) {
            throw new Error('Expected CWL six_hours_left WarReminderEvent');
        }
        expect(sixHoursEvent.attackSnapshot).toEqual({
            snapshotAt: endTime - 6 * SECONDS_PER_HOUR,
            totalParticipants: 3,
            pendingParticipantsCount: 2,
        });

        // 1h left -> compact list with duplicate nicks disambiguated
        clock.setNow((endTime - SECONDS_PER_HOUR) * 1000);
        const oneHour = await service.updateData(CLAN_TAG);
        const oneHourEvent = oneHour.events[0];
        if (oneHourEvent?.type !== APPLICATION_EVENT_TYPES.warReminder) {
            throw new Error('Expected CWL one_hour_left WarReminderEvent');
        }
        expect(oneHourEvent.attackSnapshot).toEqual({
            snapshotAt: endTime - SECONDS_PER_HOUR,
            totalParticipants: 3,
            pendingParticipantsCount: 2,
            pendingPlayers: [
                { playerTag: '#P2', playerName: 'Bob', attacksUsed: 0, maxAttacks: 1 },
                { playerTag: '#P3', playerName: 'Bob', attacksUsed: 0, maxAttacks: 1 },
            ],
        });

        const txManager = new TransactionManager(db);
        const notificationRepo = new NotificationRepo(db);
        const notificationService = new NotificationService({
            notificationRepo,
            clansRepo,
            clanwarRepo,
            clanwarsLeagueRepo: leagueRepo,
            raidRepo: new RaidRepo(db),
            subscriptionRepo,
        });
        const worker = new DomainEventWorker({
            domainEventsRepo,
            transactionManager: txManager,
            deserializer: new DomainEventPayloadDeserializer(),
            materializer: notificationService,
            clock,
        });
        worker.processPending();

        const rows = db.connection
            .prepare<[], { message_text: string }>(
                'SELECT message_text FROM notifications ORDER BY id;',
            )
            .all();
        expect(rows).toHaveLength(2);
        expect(rows[0]?.message_text).toContain('Ещё не атаковали: 2 из 3 — список: /cwl');
        expect(rows[0]?.message_text).toContain('по данным на 21:00 (UTC+3)');
        expect(rows[1]?.message_text).toContain('Ещё не атаковали (2): Bob (#P2), Bob (#P3)');
        expect(rows[1]?.message_text).toContain('по данным на 02:00 (UTC+3)');
    });
});
