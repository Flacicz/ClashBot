import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    CocApiError,
    type CompleteClanwarData,
    type CompleteClanwarsLeagueData,
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
    SubscriptionRepo,
    TransactionManager,
} from '../../src/database/index.js';
import { DomainEventPayloadSerializer, DomainEventRecorder } from '../../src/domainEvents/index.js';
import {
    APPLICATION_EVENT_TYPES,
    WAR_REMINDER_KINDS,
    WAR_REMINDER_WAR_KINDS,
} from '../../src/events/applicationEvents.js';
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
    readonly warType?: CompleteClanwarData['clanwar']['warType'];
    readonly preparationStartTime: number;
    readonly startTime: number;
    readonly endTime: number;
    readonly withDetails?: boolean;
}

function makeCwlWar(spec: CwlWarSpec): CompleteClanwarData {
    const clanTag = spec.clanTag ?? CLAN_TAG;
    const withDetails = spec.withDetails ?? true;

    return {
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
            roundNumber: null,
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
                    preparationStartTime: 1_000,
                    startTime: 1_100,
                    endTime: 2_000,
                    withDetails: true,
                }),
                makeCwlWar({
                    opponentTag: '#OPP2',
                    warUID: 'cwl-war-2',
                    state: 'warEnded',
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
                    preparationStartTime: round1Start - 24 * SECONDS_PER_HOUR,
                    startTime: round1Start,
                    endTime: round1End,
                    withDetails: false,
                }),
                makeCwlWar({
                    opponentTag: '#OPP2',
                    warUID: 'cwl-round-2',
                    state: 'preparation',
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

        // Advance to round 1 1h left -> started + six_hours_left + one_hour_left
        clock.setNow((round1End - SECONDS_PER_HOUR) * 1000);
        const oneHourSync = await service.updateData(CLAN_TAG);
        expect(oneHourSync.successFlag).toBe(true);
        expect(oneHourSync.events).toHaveLength(3);
        expect(tableRowCount(db, 'domain_events')).toBe(3);

        // Advance to round 2 6h left, round 1 ended
        clock.setNow((round2End - 6 * SECONDS_PER_HOUR) * 1000);
        apiClient.leagueData = {
            ...apiClient.leagueData,
            warDetails: [
                makeCwlWar({
                    opponentTag: '#OPP1',
                    warUID: 'cwl-round-1',
                    state: 'warEnded',
                    preparationStartTime: round1Start - 24 * SECONDS_PER_HOUR,
                    startTime: round1Start,
                    endTime: round1End,
                    withDetails: false,
                }),
                makeCwlWar({
                    opponentTag: '#OPP2',
                    warUID: 'cwl-round-2',
                    state: 'inWar',
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

        const round2Started = transitionSync.events.find(
            (e) => e.type === APPLICATION_EVENT_TYPES.warReminder && e.warId !== round1WarId,
        );
        if (round2Started?.type !== APPLICATION_EVENT_TYPES.warReminder) {
            throw new Error('Expected round 2 WarReminderEvent');
        }
        const round2WarId = round2Started.warId;

        // Total domain events:
        //   round 1: 3 reminders + 1 cwl_round_ended
        //   round 2: 2 reminders (started + six_hours_left)
        // = 6 unique domain events
        expect(tableRowCount(db, 'domain_events')).toBe(6);

        const pending = domainEventsRepo.getPendingDestinations(50);
        // 5 players-only reminders + 2 destinations (players + management) for round 1 cwl_round_ended = 7
        expect(pending).toHaveLength(7);

        const reminderEventIds = pending
            .filter((d) => d.eventType === 'war_reminder')
            .map((d) => d.eventId);
        expect(reminderEventIds).toEqual([
            `${String(round1WarId)}:${WAR_REMINDER_KINDS.started}`,
            `${String(round1WarId)}:${WAR_REMINDER_KINDS.sixHoursLeft}`,
            `${String(round1WarId)}:${WAR_REMINDER_KINDS.oneHourLeft}`,
            `${String(round2WarId)}:${WAR_REMINDER_KINDS.started}`,
            `${String(round2WarId)}:${WAR_REMINDER_KINDS.sixHoursLeft}`,
        ]);
        for (const reminderDest of pending.filter((d) => d.eventType === 'war_reminder')) {
            expect(reminderDest.audience).toBe('players');
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
});
