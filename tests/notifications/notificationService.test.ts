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
    DEFAULT_TELEGRAM_MAX_VISIBLE_LENGTH,
    NOTIFICATION_EVENT_TYPES,
    NotificationService,
    TELEGRAM_HARD_MAX_VISIBLE_LENGTH,
    countTelegramHtmlVisibleLength,
} from '../../src/notifications/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');
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
    readonly expires_at: number | null;
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
                    status,
                    expires_at
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
            if (row.event_type === NOTIFICATION_EVENT_TYPES.warReminder) {
                expect(row.expires_at).toBe(1_700_186_400 - 3600);
            } else if (row.event_type === NOTIFICATION_EVENT_TYPES.raidReminder) {
                expect(row.expires_at).toBe(1_701_059_200 - 6 * 3600);
            } else {
                expect(row.expires_at).toBeNull();
            }
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

    it('enforces category guard when materialize is called with a mismatched destination category and covers all reminder checkpoint kinds', () => {
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

        expect(EventNotificationPolicy.categoriesFor(joinedEvent)).toEqual(['roster']);
        expect(EventNotificationPolicy.categoriesFor(syncFailureEvent)).toEqual(['system']);

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
                    category: 'roster',
                    subscriptionId: 1,
                },
            ],
        );

        const baseDest = ctx.domainEventsRepo.getPendingDestinations(1)[0];
        if (baseDest === undefined) {
            throw new Error('Expected pending destination');
        }
        const disciplineDest: PendingDomainEventDestination = {
            ...baseDest,
            category: 'discipline',
        };
        const rosterDest: PendingDomainEventDestination = {
            ...baseDest,
            category: 'roster',
        };
        const systemDest: PendingDomainEventDestination = {
            ...baseDest,
            category: 'system',
        };

        // Calling roster/reminder events with a discipline destination produces 0 rows
        ctx.notificationService.materialize(joinedEvent, disciplineDest);
        ctx.notificationService.materialize(
            {
                type: APPLICATION_EVENT_TYPES.playerLeftClan,
                clanTag: CLAN_TAG,
                playerTag: '#P1',
                playerName: 'Alice',
                membershipId: 500,
            },
            disciplineDest,
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
            disciplineDest,
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
            disciplineDest,
        );
        ctx.notificationService.materialize(
            {
                type: APPLICATION_EVENT_TYPES.raidReminder,
                clanTag: CLAN_TAG,
                raidReference: { raidId: 1 },
                endTime: 1_700_000_000,
                kind: RAID_REMINDER_KINDS.oneHourLeft,
            },
            disciplineDest,
        );

        // Calling system-only events with a roster destination produces 0 rows
        ctx.notificationService.materialize(syncFailureEvent, rosterDest);
        ctx.notificationService.materialize(
            {
                type: APPLICATION_EVENT_TYPES.syncRecovery,
                clanTag: CLAN_TAG,
                serviceName: 'ClanInfoService',
                outageId: 600,
            },
            rosterDest,
        );

        // Calling war/raid/cwl ended events with a system/roster destination produces 0 rows
        ctx.notificationService.materialize(
            {
                type: APPLICATION_EVENT_TYPES.warEnded,
                clanTag: CLAN_TAG,
                warReference: { clanTag: CLAN_TAG, warId: 1, homeClanId: 1, opponentClanId: 2 },
            },
            systemDest,
        );
        ctx.notificationService.materialize(
            {
                type: APPLICATION_EVENT_TYPES.raidsEnded,
                clanTag: CLAN_TAG,
                raidReference: { raidId: 1 },
            },
            rosterDest,
        );
        ctx.notificationService.materialize(
            {
                type: APPLICATION_EVENT_TYPES.cwlRoundEnded,
                clanTag: CLAN_TAG,
                cwlSeasonId: 1,
                warReference: { clanTag: CLAN_TAG, warId: 1, homeClanId: 1, opponentClanId: 2 },
            },
            systemDest,
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

        const reminderRows = getAllNotificationRows(ctx.db);
        expect(reminderRows).toHaveLength(6 + 5);
        const byEventKey = new Map(reminderRows.map((r) => [`${r.event_type}:${r.event_id}`, r]));
        expect(byEventKey.get('war_reminder:11:started')?.expires_at).toBe(
            1_700_000_000 - 6 * 3600,
        );
        expect(byEventKey.get('war_reminder:12:six_hours_left')?.expires_at).toBe(
            1_700_000_000 - 3600,
        );
        expect(byEventKey.get('war_reminder:13:one_hour_left')?.expires_at).toBe(1_700_000_000);
        expect(byEventKey.get('raid_reminder:77:started')?.expires_at).toBe(
            1_700_000_000 - 48 * 3600,
        );
        expect(byEventKey.get('raid_reminder:77:forty_eight_hours_left')?.expires_at).toBe(
            1_700_000_000 - 24 * 3600,
        );
        expect(byEventKey.get('raid_reminder:77:twenty_four_hours_left')?.expires_at).toBe(
            1_700_000_000 - 6 * 3600,
        );
        expect(byEventKey.get('raid_reminder:77:six_hours_left')?.expires_at).toBe(
            1_700_000_000 - 3600,
        );
        expect(byEventKey.get('raid_reminder:77:one_hour_left')?.expires_at).toBe(1_700_000_000);
        expect(ctx.wakeSpy).toHaveBeenCalled();
    });

    it('splits a 50-player war_roster_reliability report into deduplicated parts 1..N under the Telegram visible length limit', () => {
        const ctx = setup();

        // Seed 50 active players with long names containing HTML special chars and emojis
        const players = Array.from({ length: 50 }, (_, index) => {
            const num = String(index + 1).padStart(2, '0');
            return {
                tag: `#ROSTER${num}`,
                name: `👑 ДлинныйИгрок_${num}_<Клан & Война> 《Боец 🔥⚔️》`,
                clanTag: CLAN_TAG,
            };
        });
        ctx.clansRepo.savePlayers(players);
        const insertMembership = ctx.db.connection.prepare<[string, string, number]>(
            'INSERT INTO clan_memberships (clan_tag, player_tag, joined_at, left_at) VALUES (?, ?, ?, NULL);',
        );
        for (const player of players) {
            insertMembership.run(CLAN_TAG, player.tag, 1_600_000_000);
        }

        const warRef = ctx.clanwarRepo.saveCompleteClanwarData(
            {
                warUID: 'war-50-roster',
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
                    destructionPercentage: 88.5,
                },
                opponent: {
                    side: ClanType.Opponent,
                    clanTag: '#OPP50',
                    clanName: 'Big Opponent',
                    clanLevel: 15,
                    attacksCount: 50,
                    stars: 110,
                    destructionPercentage: 80.0,
                },
            },
            players.slice(0, 30).map((player, index) => ({
                attackerTag: player.tag,
                defenderTag: `#ENEMY${String(index + 1).padStart(2, '0')}`,
                attackerClanTag: CLAN_TAG,
                defenderClanTag: '#OPP50',
                attackerPosition: index + 1,
                defenderPosition: index === 0 ? 2 : index + 1,
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
                    clanTag: '#OPP50',
                    playerTag: `#ENEMY${String(index + 1).padStart(2, '0')}`,
                    playerName: `Enemy ${String(index + 1)}`,
                    townhallLevel: 16,
                    mapPosition: index + 1,
                })),
            },
        );

        const warEnded: ApplicationEvent = {
            type: APPLICATION_EVENT_TYPES.warEnded,
            clanTag: CLAN_TAG,
            warReference: warRef,
        };

        ctx.recorder.recordAll([warEnded]);
        const disciplineDest = ctx.domainEventsRepo
            .getPendingDestinations(20)
            .find((dest) => dest.category === 'discipline');
        if (disciplineDest === undefined) {
            throw new Error('Expected discipline destination');
        }

        ctx.notificationService.materialize(warEnded, disciplineDest);

        const rosterRows = getAllNotificationRows(ctx.db).filter(
            (row) => row.event_type === NOTIFICATION_EVENT_TYPES.warRosterReliability,
        );
        expect(rosterRows.length).toBeGreaterThanOrEqual(2);

        for (let index = 0; index < rosterRows.length; index += 1) {
            const row = rosterRows[index];
            expect(row).toBeDefined();
            if (row === undefined) {
                continue;
            }
            expect(row.part_index).toBe(index + 1);
            expect(row.part_count).toBe(rosterRows.length);
            const visibleLen = countTelegramHtmlVisibleLength(row.message_text);
            expect(visibleLen).toBeLessThanOrEqual(DEFAULT_TELEGRAM_MAX_VISIBLE_LENGTH);
            expect(visibleLen).toBeLessThanOrEqual(TELEGRAM_HARD_MAX_VISIBLE_LENGTH);
            expect(row.message_text).toContain(
                `<i>Часть ${String(index + 1)}/${String(rosterRows.length)}</i>`,
            );
        }

        // Re-materialization is idempotent: no duplicate rows created for any part_index
        const totalBefore = getAllNotificationRows(ctx.db).length;
        ctx.notificationService.materialize(warEnded, disciplineDest);
        expect(getAllNotificationRows(ctx.db)).toHaveLength(totalBefore);
    });

    it('routes all 16 notification types strictly by each of the 5 independent categories, supports preset all, and applies category updates only to new events', () => {
        const ctx = setup();

        // Remove default subscriptions from setup() to test each category cleanly in isolation
        ctx.subscriptionRepo.unsubscribeFromChat(PLAYERS_CHAT_ID, PLAYERS_THREAD_ID, CLAN_TAG);
        ctx.subscriptionRepo.unsubscribeFromChat(
            MANAGEMENT_CHAT_ID,
            MANAGEMENT_THREAD_ID,
            CLAN_TAG,
        );

        const CHAT_SUMMARIES = -5001;
        const CHAT_REMINDERS = -5002;
        const CHAT_ROSTER = -5003;
        const CHAT_DISCIPLINE = -5004;
        const CHAT_SYSTEM = -5005;
        const CHAT_ALL = -5006;

        const singleCategoryChats = [
            {
                chatId: CHAT_SUMMARIES,
                categories: {
                    summaries: true,
                    reminders: false,
                    roster: false,
                    discipline: false,
                    system: false,
                },
            },
            {
                chatId: CHAT_REMINDERS,
                categories: {
                    summaries: false,
                    reminders: true,
                    roster: false,
                    discipline: false,
                    system: false,
                },
            },
            {
                chatId: CHAT_ROSTER,
                categories: {
                    summaries: false,
                    reminders: false,
                    roster: true,
                    discipline: false,
                    system: false,
                },
            },
            {
                chatId: CHAT_DISCIPLINE,
                categories: {
                    summaries: false,
                    reminders: false,
                    roster: false,
                    discipline: true,
                    system: false,
                },
            },
            {
                chatId: CHAT_SYSTEM,
                categories: {
                    summaries: false,
                    reminders: false,
                    roster: false,
                    discipline: false,
                    system: true,
                },
            },
        ] as const;

        for (const item of singleCategoryChats) {
            ctx.subscriptionRepo.saveTelegramChat(item.chatId, 0, `Chat ${String(item.chatId)}`);
            ctx.subscriptionRepo.subscribeToChat(item.chatId, 0, CLAN_TAG, {
                categories: item.categories,
            });
        }
        ctx.subscriptionRepo.saveTelegramChat(CHAT_ALL, 0, 'All Preset Chat');
        ctx.subscriptionRepo.subscribeToChat(CHAT_ALL, 0, CLAN_TAG, 'all');

        // Seed 2 regular wars, 2 raids, and 1 CWL round so all 16 notification types are produced
        seedRegularWar(ctx.clanwarRepo, {
            warUID: 'cat-war-prev',
            startTime: 1_700_000_000,
            endTime: 1_700_086_400,
            homeStars: 4,
            opponentStars: 4,
            opponentTag: '#COPP0',
            opponentName: 'Prev Opp',
        });
        const warRef = seedRegularWar(ctx.clanwarRepo, {
            warUID: 'cat-war-curr',
            startTime: 1_700_100_000,
            endTime: 1_700_186_400,
            homeStars: 6,
            opponentStars: 3,
            opponentTag: '#COPP1',
            opponentName: 'Curr Opp',
        });
        seedRaid(ctx.raidRepo, {
            startTime: 1_700_200_000,
            endTime: 1_700_459_200,
            totalLoot: 80_000,
        });
        const raidRef = seedRaid(ctx.raidRepo, {
            startTime: 1_700_800_000,
            endTime: 1_701_059_200,
            totalLoot: 100_000,
        });
        const cwl = seedCwlSeasonAndRound(ctx.clanwarRepo, ctx.clanwarsLeagueRepo);

        const allEvents: ApplicationEvent[] = [
            {
                type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                clanTag: CLAN_TAG,
                playerTag: '#P1',
                playerName: 'Alice',
                membershipId: 701,
            },
            {
                type: APPLICATION_EVENT_TYPES.playerLeftClan,
                clanTag: CLAN_TAG,
                playerTag: '#P2',
                playerName: 'Bob',
                membershipId: 702,
            },
            {
                type: APPLICATION_EVENT_TYPES.playerRoleChanged,
                clanTag: CLAN_TAG,
                playerTag: '#P1',
                playerName: 'Alice',
                oldRole: 'member',
                newRole: 'admin',
                snapshotId: 703,
            },
            {
                type: APPLICATION_EVENT_TYPES.warEnded,
                clanTag: CLAN_TAG,
                warReference: warRef,
            },
            {
                type: APPLICATION_EVENT_TYPES.raidsEnded,
                clanTag: CLAN_TAG,
                raidReference: raidRef,
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
                outageId: 704,
            },
            {
                type: APPLICATION_EVENT_TYPES.syncRecovery,
                clanTag: CLAN_TAG,
                serviceName: 'RaidService',
                outageId: 704,
            },
            {
                type: APPLICATION_EVENT_TYPES.warReminder,
                clanTag: CLAN_TAG,
                warId: warRef.warId,
                endTime: 1_700_186_400,
                warKind: WAR_REMINDER_WAR_KINDS.regular,
                kind: WAR_REMINDER_KINDS.sixHoursLeft,
            },
            {
                type: APPLICATION_EVENT_TYPES.raidReminder,
                clanTag: CLAN_TAG,
                raidReference: raidRef,
                endTime: 1_701_059_200,
                kind: RAID_REMINDER_KINDS.twentyFourHoursLeft,
            },
        ];

        ctx.recorder.recordAll(allEvents);

        // Changing categories of CHAT_ALL BEFORE materialization must NOT affect already recorded destinations
        ctx.subscriptionRepo.updateSubscriptionCategories(CHAT_ALL, 0, CLAN_TAG, {
            summaries: false,
            reminders: false,
            roster: false,
            discipline: false,
            system: true,
        });

        const destinations = ctx.domainEventsRepo.getPendingDestinations(100);
        const eventsByType = new Map<string, ApplicationEvent>(allEvents.map((e) => [e.type, e]));
        for (const dest of destinations) {
            const event = eventsByType.get(dest.eventType);
            if (event !== undefined) {
                ctx.notificationService.materialize(event, dest);
            }
            ctx.domainEventsRepo.markMaterialized(dest.destinationId);
        }

        const rows = getAllNotificationRows(ctx.db);
        const typesForChat = (chatId: number): Set<string> =>
            new Set(rows.filter((r) => r.chat_id === chatId).map((r) => r.event_type));

        expect(typesForChat(CHAT_SUMMARIES)).toEqual(
            new Set([
                NOTIFICATION_EVENT_TYPES.warEnded,
                NOTIFICATION_EVENT_TYPES.warComparison,
                NOTIFICATION_EVENT_TYPES.cwlRoundEnded,
                NOTIFICATION_EVENT_TYPES.raidsEnded,
                NOTIFICATION_EVENT_TYPES.raidsComparison,
            ]),
        );
        expect(typesForChat(CHAT_REMINDERS)).toEqual(
            new Set([NOTIFICATION_EVENT_TYPES.warReminder, NOTIFICATION_EVENT_TYPES.raidReminder]),
        );
        expect(typesForChat(CHAT_ROSTER)).toEqual(
            new Set([
                NOTIFICATION_EVENT_TYPES.playerJoinedClan,
                NOTIFICATION_EVENT_TYPES.playerLeftClan,
                NOTIFICATION_EVENT_TYPES.playerRoleChanged,
            ]),
        );
        expect(typesForChat(CHAT_DISCIPLINE)).toEqual(
            new Set([
                NOTIFICATION_EVENT_TYPES.warViolations,
                NOTIFICATION_EVENT_TYPES.warRosterReliability,
                NOTIFICATION_EVENT_TYPES.cwlViolations,
                NOTIFICATION_EVENT_TYPES.raidsViolations,
            ]),
        );
        expect(typesForChat(CHAT_SYSTEM)).toEqual(
            new Set([NOTIFICATION_EVENT_TYPES.syncFailure, NOTIFICATION_EVENT_TYPES.syncRecovery]),
        );
        // CHAT_ALL still materialized all 16 types from already-recorded destinations despite category change
        expect(typesForChat(CHAT_ALL)).toEqual(new Set(Object.values(NOTIFICATION_EVENT_TYPES)));

        // A NEW roster event after the category update must NOT go to CHAT_ALL (only to CHAT_ROSTER)
        ctx.recorder.recordAll([
            {
                type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                clanTag: CLAN_TAG,
                playerTag: '#P3',
                playerName: 'Charlie',
                membershipId: 799,
            },
        ]);
        const newPending = ctx.domainEventsRepo.getPendingDestinations(50);
        expect(newPending.map((d) => ({ chatId: d.chatId, category: d.category }))).toEqual([
            { chatId: CHAT_ROSTER, category: 'roster' },
        ]);
    });

    it('materializes reminders and raid comparison reports in each subscribed chat own timezone offset', () => {
        const ctx = setup();
        ctx.subscriptionRepo.unsubscribeFromChat(PLAYERS_CHAT_ID, PLAYERS_THREAD_ID, CLAN_TAG);
        ctx.subscriptionRepo.unsubscribeFromChat(
            MANAGEMENT_CHAT_ID,
            MANAGEMENT_THREAD_ID,
            CLAN_TAG,
        );

        const CHAT_WEST = -7001; // UTC-5
        const CHAT_EAST = -7002; // UTC+14

        ctx.subscriptionRepo.saveTelegramChat(CHAT_WEST, 0, 'West Chat');
        ctx.subscriptionRepo.saveTelegramChat(CHAT_EAST, 0, 'East Chat');
        ctx.subscriptionRepo.subscribeToChat(CHAT_WEST, 0, CLAN_TAG, {
            preset: 'players',
            timezoneOffsetHours: -5,
        });
        ctx.subscriptionRepo.subscribeToChat(CHAT_EAST, 0, CLAN_TAG, {
            preset: 'players',
            timezoneOffsetHours: 14,
        });

        // Two completed raids whose start times cross day boundaries between UTC-5 and UTC+14:
        // prev: 2024-03-02 01:00:00 UTC -> 01.03.2024 (UTC-5) vs 02.03.2024 (UTC+14)
        // curr: 2024-03-09 22:00:00 UTC -> 09.03.2024 (UTC-5) vs 10.03.2024 (UTC+14)
        seedRaid(ctx.raidRepo, {
            startTime: 1_709_341_200,
            endTime: 1_709_500_000,
            totalLoot: 80_000,
        });
        const currentRaidRef = seedRaid(ctx.raidRepo, {
            startTime: 1_710_021_600,
            endTime: 1_710_200_000,
            totalLoot: 100_000,
        });

        // War/raid reminder endTime = 2024-01-01 00:00:00 UTC -> 31.12.2023 19:00 (UTC-5) vs 01.01.2024 14:00 (UTC+14)
        const events: ApplicationEvent[] = [
            {
                type: APPLICATION_EVENT_TYPES.warReminder,
                clanTag: CLAN_TAG,
                warId: 501,
                endTime: 1_704_067_200,
                warKind: WAR_REMINDER_WAR_KINDS.regular,
                kind: WAR_REMINDER_KINDS.sixHoursLeft,
            },
            {
                type: APPLICATION_EVENT_TYPES.raidReminder,
                clanTag: CLAN_TAG,
                raidReference: currentRaidRef,
                endTime: 1_704_067_200,
                kind: RAID_REMINDER_KINDS.oneHourLeft,
            },
            {
                type: APPLICATION_EVENT_TYPES.raidsEnded,
                clanTag: CLAN_TAG,
                raidReference: currentRaidRef,
            },
        ];

        ctx.recorder.recordAll(events);
        const eventsByType = new Map<string, ApplicationEvent>(events.map((e) => [e.type, e]));
        for (const dest of ctx.domainEventsRepo.getPendingDestinations(50)) {
            const event = eventsByType.get(dest.eventType);
            if (event !== undefined) {
                ctx.notificationService.materialize(event, dest);
            }
            ctx.domainEventsRepo.markMaterialized(dest.destinationId);
        }

        const rows = getAllNotificationRows(ctx.db);
        const findText = (chatId: number, eventType: string): string => {
            const row = rows.find((r) => r.chat_id === chatId && r.event_type === eventType);
            expect(row).toBeDefined();
            return row?.message_text ?? '';
        };

        expect(findText(CHAT_WEST, NOTIFICATION_EVENT_TYPES.warReminder)).toContain(
            '🕒 Окончание: <b>31.12.2023 19:00 (UTC-5)</b>',
        );
        expect(findText(CHAT_EAST, NOTIFICATION_EVENT_TYPES.warReminder)).toContain(
            '🕒 Окончание: <b>01.01.2024 14:00 (UTC+14)</b>',
        );

        expect(findText(CHAT_WEST, NOTIFICATION_EVENT_TYPES.raidReminder)).toContain(
            '🕒 Окончание: <b>31.12.2023 19:00 (UTC-5)</b>',
        );
        expect(findText(CHAT_EAST, NOTIFICATION_EVENT_TYPES.raidReminder)).toContain(
            '🕒 Окончание: <b>01.01.2024 14:00 (UTC+14)</b>',
        );

        expect(findText(CHAT_WEST, NOTIFICATION_EVENT_TYPES.raidsComparison)).toContain(
            'Последний рейд: 09.03.2024 (UTC-5)\nПредыдущий рейд: 01.03.2024 (UTC-5)',
        );
        expect(findText(CHAT_EAST, NOTIFICATION_EVENT_TYPES.raidsComparison)).toContain(
            'Последний рейд: 10.03.2024 (UTC+14)\nПредыдущий рейд: 02.03.2024 (UTC+14)',
        );

        // Legacy handle() path also respects per-subscription timezones
        ctx.notificationService.handle({
            type: APPLICATION_EVENT_TYPES.warReminder,
            clanTag: CLAN_TAG,
            warId: 502,
            endTime: 1_704_067_200,
            warKind: WAR_REMINDER_WAR_KINDS.cwl,
            kind: WAR_REMINDER_KINDS.started,
        });
        const legacyRows = getAllNotificationRows(ctx.db).filter(
            (r) => r.domain_event_destination_id === null && r.event_id === '502:started',
        );
        expect(legacyRows.find((r) => r.chat_id === CHAT_WEST)?.message_text).toContain(
            '31.12.2023 19:00 (UTC-5)',
        );
        expect(legacyRows.find((r) => r.chat_id === CHAT_EAST)?.message_text).toContain(
            '01.01.2024 14:00 (UTC+14)',
        );
    });
});
