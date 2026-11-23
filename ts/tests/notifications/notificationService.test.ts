import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
    SubscriptionRepo,
    TransactionManager,
    WarTypes,
    type ClanwarReference,
    type PendingDomainEventDestination,
} from '../../src/database/index.js';
import {
    DomainEventPayloadSerializer,
    DomainEventRecorder,
    EventNotificationPolicy,
} from '../../src/domainEvents/index.js';
import {
    APPLICATION_EVENT_TYPES,
    RAID_REMINDER_KINDS,
    WAR_REMINDER_KINDS,
    WAR_REMINDER_WAR_KINDS,
    type ApplicationEvent,
} from '../../src/events/index.js';
import { createLogger } from '../../src/logging/index.js';
import type { RaidReference } from '../../src/models/index.js';
import {
    DEFAULT_NOTIFICATION_PART_COUNT,
    DEFAULT_NOTIFICATION_PART_INDEX,
    NOTIFICATION_EVENT_TYPES,
    NotificationService,
} from '../../src/notifications/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../../src/database/migrations');
const CLAN_TAG = '#2PPLQ';
const PLAYERS_CHAT_ID = -1001;
const PLAYERS_THREAD_ID = 7;
const MANAGEMENT_CHAT_ID = 2001;
const MANAGEMENT_THREAD_ID = 0;

interface NotificationRow {
    readonly id: number;
    readonly domain_event_destination_id: number | null;
    readonly event_type: string;
    readonly event_id: string;
    readonly chat_id: number;
    readonly message_thread_id: number;
    readonly message_text: string;
    readonly part_index: number;
    readonly part_count: number;
    readonly status: string;
}

interface TestContext {
    readonly db: Database;
    readonly tx: TransactionManager;
    readonly clansRepo: ClansRepo;
    readonly clanwarRepo: ClanwarRepo;
    readonly clanwarsLeagueRepo: ClanwarsLeagueRepo;
    readonly raidRepo: RaidRepo;
    readonly subscriptionRepo: SubscriptionRepo;
    readonly domainEventsRepo: DomainEventsRepo;
    readonly notificationRepo: NotificationRepo;
    readonly recorder: DomainEventRecorder;
    readonly notificationService: NotificationService;
    readonly wakeSpy: ReturnType<typeof vi.fn>;
}

function getAllNotificationRows(db: Database): NotificationRow[] {
    return db.connection
        .prepare<[], NotificationRow>(
            `SELECT id,
                    domain_event_destination_id,
                    event_type,
                    event_id,
                    chat_id,
                    message_thread_id,
                    message_text,
                    part_index,
                    part_count,
                    status
             FROM notifications
             ORDER BY id;`,
        )
        .all();
}

function seedRegularWar(
    clanwarRepo: ClanwarRepo,
    params: {
        readonly warUID: string;
        readonly startTime: number;
        readonly endTime: number;
        readonly homeStars: number;
        readonly opponentStars: number;
        readonly opponentTag: string;
        readonly opponentName: string;
    },
): ClanwarReference {
    return clanwarRepo.saveCompleteClanwarData(
        {
            warUID: params.warUID,
            clanTag: CLAN_TAG,
            state: 'warEnded',
            warType: WarTypes.Regular,
            teamSize: 2,
            attacksPerMember: 2,
            preparationStartTime: params.startTime - 3600,
            startTime: params.startTime,
            endTime: params.endTime,
            seasonId: null,
            roundNumber: null,
        },
        {
            home: {
                side: ClanType.Home,
                clanTag: CLAN_TAG,
                clanName: 'Alpha Clan',
                clanLevel: 15,
                attacksCount: 2,
                stars: params.homeStars,
                destructionPercentage: 85.0,
            },
            opponent: {
                side: ClanType.Opponent,
                clanTag: params.opponentTag,
                clanName: params.opponentName,
                clanLevel: 14,
                attacksCount: 2,
                stars: params.opponentStars,
                destructionPercentage: 70.0,
            },
        },
        [
            {
                attackerTag: '#P1',
                defenderTag: '#E1',
                attackerClanTag: CLAN_TAG,
                defenderClanTag: params.opponentTag,
                attackerPosition: 1,
                defenderPosition: 1,
                orderNum: 1,
                stars: 3,
                destructionPercentage: 100.0,
                duration: 120,
            },
            {
                attackerTag: '#P1',
                defenderTag: '#E2',
                attackerClanTag: CLAN_TAG,
                defenderClanTag: params.opponentTag,
                attackerPosition: 1,
                defenderPosition: 2,
                orderNum: 2,
                stars: 2,
                destructionPercentage: 70.0,
                duration: 140,
            },
        ],
        {
            home: [
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
            ],
            opponent: [
                {
                    clanTag: params.opponentTag,
                    playerTag: '#E1',
                    playerName: 'Enemy 1',
                    townhallLevel: 16,
                    mapPosition: 1,
                },
                {
                    clanTag: params.opponentTag,
                    playerTag: '#E2',
                    playerName: 'Enemy 2',
                    townhallLevel: 15,
                    mapPosition: 2,
                },
            ],
        },
    );
}

function seedCwlSeasonAndRound(
    clanwarRepo: ClanwarRepo,
    clanwarsLeagueRepo: ClanwarsLeagueRepo,
): {
    readonly cwlSeasonId: number;
    readonly warReference: ClanwarReference;
} {
    const cwlSeasonId = clanwarsLeagueRepo.saveCompleteCWLData(
        {
            clanTag: CLAN_TAG,
            seasonId: '2026-11',
        },
        [
            {
                playerTag: '#P1',
                playerName: 'Alice',
                townhallLevel: 16,
                clanTag: CLAN_TAG,
                seasonId: '2026-11',
            },
            {
                playerTag: '#P2',
                playerName: 'Bob',
                townhallLevel: 15,
                clanTag: CLAN_TAG,
                seasonId: '2026-11',
            },
        ],
    );

    const warReference = clanwarRepo.saveCompleteClanwarData(
        {
            warUID: 'cwl-round-1',
            clanTag: CLAN_TAG,
            state: 'warEnded',
            warType: WarTypes.CWL,
            teamSize: 2,
            attacksPerMember: 1,
            preparationStartTime: 1_700_500_000,
            startTime: 1_700_586_400,
            endTime: 1_700_672_800,
            seasonId: cwlSeasonId,
            roundNumber: 1,
        },
        {
            home: {
                side: ClanType.Home,
                clanTag: CLAN_TAG,
                clanName: 'Alpha Clan',
                clanLevel: 15,
                attacksCount: 1,
                stars: 3,
                destructionPercentage: 50.0,
            },
            opponent: {
                side: ClanType.Opponent,
                clanTag: '#CWLOPP',
                clanName: 'CWL Opponent',
                clanLevel: 15,
                attacksCount: 1,
                stars: 2,
                destructionPercentage: 45.0,
            },
        },
        [
            {
                attackerTag: '#P1',
                defenderTag: '#CE2',
                attackerClanTag: CLAN_TAG,
                defenderClanTag: '#CWLOPP',
                attackerPosition: 1,
                defenderPosition: 2,
                orderNum: 1,
                stars: 3,
                destructionPercentage: 100.0,
                duration: 110,
            },
        ],
        {
            home: [
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
            ],
            opponent: [
                {
                    clanTag: '#CWLOPP',
                    playerTag: '#CE1',
                    playerName: 'CWL Enemy 1',
                    townhallLevel: 16,
                    mapPosition: 1,
                },
                {
                    clanTag: '#CWLOPP',
                    playerTag: '#CE2',
                    playerName: 'CWL Enemy 2',
                    townhallLevel: 15,
                    mapPosition: 2,
                },
            ],
        },
    );

    return { cwlSeasonId, warReference };
}

function seedRaid(
    raidRepo: RaidRepo,
    params: {
        readonly startTime: number;
        readonly endTime: number;
        readonly totalLoot: number;
    },
): RaidReference {
    return raidRepo.saveCompleteRaidData(
        {
            clanTag: CLAN_TAG,
            startTime: params.startTime,
            endTime: params.endTime,
            state: 'ended',
            totalLoot: params.totalLoot,
            raidsCompleted: 8,
            totalAttacks: 9,
            enemyDistrictsDestroyed: 35,
            offensiveReward: 1_100,
            defensiveReward: 250,
        },
        [
            {
                playerTag: '#P1',
                attacksCount: 6,
                bonusAttack: 1,
                totalLoot: Math.floor(params.totalLoot * 0.7),
            },
            {
                playerTag: '#P2',
                attacksCount: 3,
                bonusAttack: 0,
                totalLoot: Math.floor(params.totalLoot * 0.3),
            },
        ],
    );
}

describe('NotificationService & DomainEventMaterializer', () => {
    const openDatabases: Database[] = [];

    function setup(): TestContext {
        const db = new Database(':memory:');
        openDatabases.push(db);
        const tx = new TransactionManager(db);
        new MigratorManager(db, tx).migrate(REAL_MIGRATIONS_PATH);

        const clansRepo = new ClansRepo(db);
        const clanwarRepo = new ClanwarRepo(db);
        const clanwarsLeagueRepo = new ClanwarsLeagueRepo(db);
        const raidRepo = new RaidRepo(db);
        const subscriptionRepo = new SubscriptionRepo(db);
        const domainEventsRepo = new DomainEventsRepo(db);
        const notificationRepo = new NotificationRepo(db);
        const recorder = new DomainEventRecorder(
            new DomainEventPayloadSerializer(),
            subscriptionRepo,
            domainEventsRepo,
        );

        // Seed clan, active players, memberships, and subscriptions for both audiences
        clansRepo.insertMinimalClan(CLAN_TAG);
        db.connection.prepare("UPDATE clans SET name = 'Alpha Clan' WHERE tag = ?;").run(CLAN_TAG);
        clansRepo.savePlayers([
            { tag: '#P1', name: 'Alice', clanTag: CLAN_TAG },
            { tag: '#P2', name: 'Bob', clanTag: CLAN_TAG },
        ]);
        db.connection
            .prepare(
                'INSERT INTO clan_memberships (clan_tag, player_tag, joined_at, left_at) VALUES (?, ?, ?, NULL);',
            )
            .run(CLAN_TAG, '#P1', 1_600_000_000);
        db.connection
            .prepare(
                'INSERT INTO clan_memberships (clan_tag, player_tag, joined_at, left_at) VALUES (?, ?, ?, NULL);',
            )
            .run(CLAN_TAG, '#P2', 1_600_000_000);

        subscriptionRepo.saveTelegramChat(PLAYERS_CHAT_ID, PLAYERS_THREAD_ID, 'Players Topic');
        subscriptionRepo.subscribeToChat(PLAYERS_CHAT_ID, PLAYERS_THREAD_ID, CLAN_TAG, 'players');

        subscriptionRepo.saveTelegramChat(
            MANAGEMENT_CHAT_ID,
            MANAGEMENT_THREAD_ID,
            'Management Private',
        );
        subscriptionRepo.subscribeToChat(
            MANAGEMENT_CHAT_ID,
            MANAGEMENT_THREAD_ID,
            CLAN_TAG,
            'management',
        );

        const wakeSpy = vi.fn();
        const notificationService = new NotificationService({
            notificationRepo,
            clansRepo,
            clanwarRepo,
            clanwarsLeagueRepo,
            raidRepo,
            subscriptionRepo,
            transactionManager: tx,
            notificationWorker: { notify: wakeSpy },
            logger: createLogger({ level: 'silent' }),
        });

        return {
            db,
            tx,
            clansRepo,
            clanwarRepo,
            clanwarsLeagueRepo,
            raidRepo,
            subscriptionRepo,
            domainEventsRepo,
            notificationRepo,
            recorder,
            notificationService,
            wakeSpy,
        };
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('skips war_comparison and raids_comparison when there is no previous history', () => {
        const ctx = setup();

        const firstWarRef = seedRegularWar(ctx.clanwarRepo, {
            warUID: 'war-single',
            startTime: 1_700_100_000,
            endTime: 1_700_186_400,
            homeStars: 5,
            opponentStars: 3,
            opponentTag: '#OPP1',
            opponentName: 'Opponent One',
        });
        const firstRaidRef = seedRaid(ctx.raidRepo, {
            startTime: 1_700_200_000,
            endTime: 1_700_459_200,
            totalLoot: 90_000,
        });

        const warEnded: ApplicationEvent = {
            type: APPLICATION_EVENT_TYPES.warEnded,
            clanTag: CLAN_TAG,
            warReference: firstWarRef,
        };
        const raidsEnded: ApplicationEvent = {
            type: APPLICATION_EVENT_TYPES.raidsEnded,
            clanTag: CLAN_TAG,
            raidReference: firstRaidRef,
        };

        ctx.recorder.recordAll([warEnded, raidsEnded]);
        const destinations = ctx.domainEventsRepo.getPendingDestinations(20);
        expect(destinations).toHaveLength(4);

        for (const dest of destinations) {
            const event =
                dest.eventType === APPLICATION_EVENT_TYPES.warEnded ? warEnded : raidsEnded;
            ctx.notificationService.materialize(event, dest);
        }

        const rows = getAllNotificationRows(ctx.db);
        const eventTypes = rows.map((r) => r.event_type);

        // war_ended, war_violations, war_roster_reliability, raids_ended, raids_violations
        // NO war_comparison and NO raids_comparison!
        expect(eventTypes).toEqual([
            NOTIFICATION_EVENT_TYPES.warEnded,
            NOTIFICATION_EVENT_TYPES.warViolations,
            NOTIFICATION_EVENT_TYPES.warRosterReliability,
            NOTIFICATION_EVENT_TYPES.raidsEnded,
            NOTIFICATION_EVENT_TYPES.raidsViolations,
        ]);
    });

    it('materializes all 10 domain event types across players and management audiences into all 16 notification event types with part_index=1 and part_count=1', () => {
        const ctx = setup();

        // Seed 2 regular wars so war_comparison is also generated
        seedRegularWar(ctx.clanwarRepo, {
            warUID: 'war-prev',
            startTime: 1_700_000_000,
            endTime: 1_700_086_400,
            homeStars: 4,
            opponentStars: 4,
            opponentTag: '#OPP0',
            opponentName: 'Previous Opponent',
        });
        const currentWarRef = seedRegularWar(ctx.clanwarRepo, {
            warUID: 'war-curr',
            startTime: 1_700_100_000,
            endTime: 1_700_186_400,
            homeStars: 5,
            opponentStars: 3,
            opponentTag: '#OPP1',
            opponentName: 'Current Opponent',
        });

        // Seed 2 raids so raids_comparison is also generated
        seedRaid(ctx.raidRepo, {
            startTime: 1_700_200_000,
            endTime: 1_700_459_200,
            totalLoot: 80_000,
        });
        const currentRaidRef = seedRaid(ctx.raidRepo, {
            startTime: 1_700_800_000,
            endTime: 1_701_059_200,
            totalLoot: 100_000,
        });

        // Seed CWL season and round
        const cwl = seedCwlSeasonAndRound(ctx.clanwarRepo, ctx.clanwarsLeagueRepo);

        const allEvents: ApplicationEvent[] = [
            {
                type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                clanTag: CLAN_TAG,
                playerTag: '#P1',
                playerName: 'Alice',
                membershipId: 101,
            },
            {
                type: APPLICATION_EVENT_TYPES.playerLeftClan,
                clanTag: CLAN_TAG,
                playerTag: '#P2',
                playerName: 'Bob',
                membershipId: 102,
            },
            {
                type: APPLICATION_EVENT_TYPES.playerRoleChanged,
                clanTag: CLAN_TAG,
                playerTag: '#P1',
                playerName: 'Alice',
                oldRole: 'member',
                newRole: 'admin',
                snapshotId: 201,
            },
            {
                type: APPLICATION_EVENT_TYPES.warEnded,
                clanTag: CLAN_TAG,
                warReference: currentWarRef,
            },
            {
                type: APPLICATION_EVENT_TYPES.raidsEnded,
                clanTag: CLAN_TAG,
                raidReference: currentRaidRef,
            },
            {
                type: APPLICATION_EVENT_TYPES.cwlRoundEnded,
                clanTag: CLAN_TAG,
                cwlSeasonId: cwl.cwlSeasonId,
                warReference: cwl.warReference,
            },
            {
                type: APPLICATION_EVENT_TYPES.syncFailure,
                clanTag: CLAN_TAG,
                serviceName: 'RaidService',
                errorMsg: 'HTTP 503',
                attempts: 3,
                outageId: 301,
            },
            {
                type: APPLICATION_EVENT_TYPES.syncRecovery,
                clanTag: CLAN_TAG,
                serviceName: 'RaidService',
                outageId: 301,
            },
            {
                type: APPLICATION_EVENT_TYPES.warReminder,
                clanTag: CLAN_TAG,
                warId: currentWarRef.warId,
                endTime: 1_700_186_400,
                warKind: WAR_REMINDER_WAR_KINDS.regular,
                kind: WAR_REMINDER_KINDS.sixHoursLeft,
            },
            {
                type: APPLICATION_EVENT_TYPES.raidReminder,
                clanTag: CLAN_TAG,
                raidReference: currentRaidRef,
                endTime: 1_701_059_200,
                kind: RAID_REMINDER_KINDS.twentyFourHoursLeft,
            },
        ];

        ctx.recorder.recordAll(allEvents);
        const destinations = ctx.domainEventsRepo.getPendingDestinations(100);

        // 5 players-only + 2 management-only + 3*(players + management) = 13 destinations
        expect(destinations).toHaveLength(13);

        const eventsByType = new Map<string, ApplicationEvent>();
        for (const event of allEvents) {
            eventsByType.set(event.type, event);
        }

        for (const dest of destinations) {
            const event = eventsByType.get(dest.eventType);
            expect(event).toBeDefined();
            if (event !== undefined) {
                ctx.notificationService.materialize(event, dest);
            }
        }

        const rows = getAllNotificationRows(ctx.db);
        // 13 destinations produce 16 notifications (WarEnded adds comparison + roster; RaidsEnded adds comparison)
        expect(rows).toHaveLength(16);

        const expected16Types = Object.values(NOTIFICATION_EVENT_TYPES);
        expect(expected16Types).toHaveLength(16);
        expect(new Set(rows.map((r) => r.event_type))).toEqual(new Set(expected16Types));

        for (const row of rows) {
            expect(row.part_index).toBe(DEFAULT_NOTIFICATION_PART_INDEX);
            expect(row.part_count).toBe(DEFAULT_NOTIFICATION_PART_COUNT);
            expect(row.status).toBe('pending');
            expect(row.message_text.length).toBeGreaterThan(0);
            expect(row.domain_event_destination_id).not.toBeNull();
        }

        // Verify audience routing by chat_id / thread_id
        const playersRows = rows.filter((r) => r.chat_id === PLAYERS_CHAT_ID);
        const managementRows = rows.filter((r) => r.chat_id === MANAGEMENT_CHAT_ID);

        expect(playersRows.every((r) => r.message_thread_id === PLAYERS_THREAD_ID)).toBe(true);
        expect(managementRows.every((r) => r.message_thread_id === MANAGEMENT_THREAD_ID)).toBe(
            true,
        );

        expect(new Set(playersRows.map((r) => r.event_type))).toEqual(
            new Set([
                NOTIFICATION_EVENT_TYPES.playerJoinedClan,
                NOTIFICATION_EVENT_TYPES.playerLeftClan,
                NOTIFICATION_EVENT_TYPES.playerRoleChanged,
                NOTIFICATION_EVENT_TYPES.warEnded,
                NOTIFICATION_EVENT_TYPES.warComparison,
                NOTIFICATION_EVENT_TYPES.raidsEnded,
                NOTIFICATION_EVENT_TYPES.raidsComparison,
                NOTIFICATION_EVENT_TYPES.cwlRoundEnded,
                NOTIFICATION_EVENT_TYPES.warReminder,
                NOTIFICATION_EVENT_TYPES.raidReminder,
            ]),
        );

        expect(new Set(managementRows.map((r) => r.event_type))).toEqual(
            new Set([
                NOTIFICATION_EVENT_TYPES.warViolations,
                NOTIFICATION_EVENT_TYPES.warRosterReliability,
                NOTIFICATION_EVENT_TYPES.raidsViolations,
                NOTIFICATION_EVENT_TYPES.cwlViolations,
                NOTIFICATION_EVENT_TYPES.syncFailure,
                NOTIFICATION_EVENT_TYPES.syncRecovery,
            ]),
        );

        // Idempotency: re-running materialize on all 13 destinations does not add any duplicate rows
        for (const dest of destinations) {
            const event = eventsByType.get(dest.eventType);
            if (event !== undefined) {
                ctx.notificationService.materialize(event, dest);
            }
        }
        expect(getAllNotificationRows(ctx.db)).toHaveLength(16);
    });

    it('enforces audience guard when materialize is called with a mismatched destination audience and covers all reminder checkpoint kinds', () => {
        const ctx = setup();

        const joinedEvent: ApplicationEvent = {
            type: APPLICATION_EVENT_TYPES.playerJoinedClan,
            clanTag: CLAN_TAG,
            playerTag: '#P1',
            playerName: 'Alice',
            membershipId: 500,
        };
        const syncFailureEvent: ApplicationEvent = {
            type: APPLICATION_EVENT_TYPES.syncFailure,
            clanTag: CLAN_TAG,
            serviceName: 'ClanInfoService',
            errorMsg: 'timeout',
            attempts: 3,
            outageId: 600,
        };

        expect(EventNotificationPolicy.audiencesFor(joinedEvent)).toEqual(['players']);
        expect(EventNotificationPolicy.audiencesFor(syncFailureEvent)).toEqual(['management']);

        ctx.domainEventsRepo.appendEvent(
            {
                eventType: APPLICATION_EVENT_TYPES.playerJoinedClan,
                eventId: '500',
                payload: '{}',
                payloadVersion: 1,
                clanTag: CLAN_TAG,
            },
            [
                {
                    chatId: PLAYERS_CHAT_ID,
                    messageThreadId: PLAYERS_THREAD_ID,
                    audience: 'players',
                    subscriptionId: 1,
                },
            ],
        );

        const baseDest = ctx.domainEventsRepo.getPendingDestinations(1)[0];
        if (baseDest === undefined) {
            throw new Error('Expected pending destination');
        }
        const managementDest: PendingDomainEventDestination = {
            ...baseDest,
            audience: 'management',
        };
        const playersDest: PendingDomainEventDestination = {
            ...baseDest,
            audience: 'players',
        };

        // Calling players-only events with a management destination produces 0 rows
        ctx.notificationService.materialize(joinedEvent, managementDest);
        ctx.notificationService.materialize(
            {
                type: APPLICATION_EVENT_TYPES.playerLeftClan,
                clanTag: CLAN_TAG,
                playerTag: '#P1',
                playerName: 'Alice',
                membershipId: 500,
            },
            managementDest,
        );
        ctx.notificationService.materialize(
            {
                type: APPLICATION_EVENT_TYPES.playerRoleChanged,
                clanTag: CLAN_TAG,
                playerTag: '#P1',
                playerName: 'Alice',
                oldRole: 'member',
                newRole: 'admin',
                snapshotId: 500,
            },
            managementDest,
        );
        ctx.notificationService.materialize(
            {
                type: APPLICATION_EVENT_TYPES.warReminder,
                clanTag: CLAN_TAG,
                warId: 1,
                endTime: 1_700_000_000,
                warKind: WAR_REMINDER_WAR_KINDS.cwl,
                kind: WAR_REMINDER_KINDS.oneHourLeft,
            },
            managementDest,
        );
        ctx.notificationService.materialize(
            {
                type: APPLICATION_EVENT_TYPES.raidReminder,
                clanTag: CLAN_TAG,
                raidReference: { raidId: 1 },
                endTime: 1_700_000_000,
                kind: RAID_REMINDER_KINDS.oneHourLeft,
            },
            managementDest,
        );

        // Calling management-only events with a players destination produces 0 rows
        ctx.notificationService.materialize(syncFailureEvent, playersDest);
        ctx.notificationService.materialize(
            {
                type: APPLICATION_EVENT_TYPES.syncRecovery,
                clanTag: CLAN_TAG,
                serviceName: 'ClanInfoService',
                outageId: 600,
            },
            playersDest,
        );

        expect(getAllNotificationRows(ctx.db)).toHaveLength(0);

        // Cover all CWL war reminder and raid reminder checkpoint variants via direct handle()
        const warKinds = [WAR_REMINDER_WAR_KINDS.regular, WAR_REMINDER_WAR_KINDS.cwl] as const;
        const warCheckpoints = [
            WAR_REMINDER_KINDS.started,
            WAR_REMINDER_KINDS.sixHoursLeft,
            WAR_REMINDER_KINDS.oneHourLeft,
        ] as const;

        let warIdCounter = 10;
        for (const warKind of warKinds) {
            for (const kind of warCheckpoints) {
                warIdCounter += 1;
                ctx.notificationService.handle({
                    type: APPLICATION_EVENT_TYPES.warReminder,
                    clanTag: CLAN_TAG,
                    warId: warIdCounter,
                    endTime: 1_700_000_000,
                    warKind,
                    kind,
                });
            }
        }

        const raidCheckpoints = [
            RAID_REMINDER_KINDS.started,
            RAID_REMINDER_KINDS.fortyEightHoursLeft,
            RAID_REMINDER_KINDS.twentyFourHoursLeft,
            RAID_REMINDER_KINDS.sixHoursLeft,
            RAID_REMINDER_KINDS.oneHourLeft,
        ] as const;

        for (const kind of raidCheckpoints) {
            ctx.notificationService.handle({
                type: APPLICATION_EVENT_TYPES.raidReminder,
                clanTag: CLAN_TAG,
                raidReference: { raidId: 77 },
                endTime: 1_700_000_000,
                kind,
            });
        }

        // Duplicate handle() calls are deduplicated
        ctx.notificationService.handle({
            type: APPLICATION_EVENT_TYPES.raidReminder,
            clanTag: CLAN_TAG,
            raidReference: { raidId: 77 },
            endTime: 1_700_000_000,
            kind: RAID_REMINDER_KINDS.started,
        });

        expect(getAllNotificationRows(ctx.db)).toHaveLength(6 + 5);
        expect(ctx.wakeSpy).toHaveBeenCalled();
    });
});
