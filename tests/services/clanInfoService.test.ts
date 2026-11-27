import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CocApiError, type CompleteClanData } from '../../src/api/index.js';
import { AbortError } from '../../src/common/errors.js';
import {
    ClansRepo,
    Database,
    DomainEventsRepo,
    MigratorManager,
    SubscriptionRepo,
    TransactionManager,
} from '../../src/database/index.js';
import { DomainEventPayloadSerializer, DomainEventRecorder } from '../../src/domainEvents/index.js';
import type {
    ActiveMembership,
    LatestPlayerState,
    PlayerSnapshot,
} from '../../src/models/index.js';
import { detectRoleChanges } from '../../src/services/clanInfoService.js';
import { ClanInfoService, type ClanInfoApiClient } from '../../src/services/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');
const CLAN_TAG = '#2PPLQ';

interface MemberSpec {
    readonly tag: string;
    readonly name: string;
    readonly role: string;
}

function makeClanData(
    clanTag: string,
    members: readonly MemberSpec[],
    overrides: Partial<{ clanSnapshotTag: string; clanName: string }> = {},
): CompleteClanData {
    return {
        clan: {
            tag: clanTag,
            name: overrides.clanName ?? 'Integration Clan',
            description: 'Test clan',
            locationId: 1,
            locationName: 'Test Location',
            chatLanguageId: 1,
            chatLanguage: 'English',
            isFamilyFriendly: true,
        },
        players: members.map((member) => ({
            tag: member.tag,
            name: member.name,
            clanTag,
        })),
        clanSnapshot: {
            clanTag: overrides.clanSnapshotTag ?? clanTag,
            type: 'inviteOnly',
            membersCount: members.length,
            clanLevel: 10,
            clanPoints: 1000,
            clanBuilderBasePoints: 500,
            clanCapitalPoints: 700,
            capitalHallLevel: 5,
            capitalLeagueId: 1,
            requiredTrophies: 1000,
            requiredBuilderBaseTrophies: 500,
            requiredTownhallLevel: 10,
            warFrequency: 'always',
            isWarLogPublic: true,
            warWinStreak: 3,
            warWins: 20,
            warTies: 2,
            warLosses: 5,
            warLeagueId: 1,
        },
        playerSnapshots: members.map((member, index) => ({
            playerTag: member.tag,
            clanTag,
            role: member.role,
            townHallLevel: 14,
            expLevel: 200 - index * 10,
            clanRank: index + 1,
            leagueId: 1,
            builderBaseLeagueId: 1,
            trophies: 5000 - index * 100,
            builderBaseTrophies: 3000 - index * 100,
            donations: 100,
            donationsReceived: 80,
        })),
    };
}

class FakeClanApiClient implements ClanInfoApiClient {
    clanData: CompleteClanData | null = null;
    errorToThrow: Error | null = null;
    onGetCompleteClanData?: (clanTag: string, signal?: AbortSignal) => void;

    getCompleteClanData(clanTag: string, signal?: AbortSignal): Promise<CompleteClanData | null> {
        this.onGetCompleteClanData?.(clanTag, signal);
        if (this.errorToThrow !== null) {
            return Promise.reject(this.errorToThrow);
        }
        return Promise.resolve(this.clanData);
    }
}

describe('ClanInfoService', () => {
    const openDatabases: Database[] = [];

    function setup(): {
        db: Database;
        txManager: TransactionManager;
        clansRepo: ClansRepo;
        subscriptionRepo: SubscriptionRepo;
        domainEventsRepo: DomainEventsRepo;
        apiClient: FakeClanApiClient;
        service: ClanInfoService;
    } {
        const db = new Database(':memory:');
        openDatabases.push(db);
        const txManager = new TransactionManager(db);
        const migrator = new MigratorManager(db, txManager);
        migrator.migrate(REAL_MIGRATIONS_PATH);

        const clansRepo = new ClansRepo(db);
        const subscriptionRepo = new SubscriptionRepo(db);
        const domainEventsRepo = new DomainEventsRepo(db);
        const serializer = new DomainEventPayloadSerializer();
        const recorder = new DomainEventRecorder(serializer, subscriptionRepo, domainEventsRepo);
        const apiClient = new FakeClanApiClient();
        const service = new ClanInfoService(clansRepo, apiClient, txManager, recorder);

        return {
            db,
            txManager,
            clansRepo,
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
        expect(service.getServiceName()).toBe('ClanInfoService');
    });

    it('performs initial sync without generating false join events and fetches CoC API outside transaction', async () => {
        const { db, clansRepo, subscriptionRepo, domainEventsRepo, apiClient, service } = setup();

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');

        let wasInTransactionDuringApiCall = true;
        apiClient.onGetCompleteClanData = () => {
            wasInTransactionDuringApiCall = db.connection.inTransaction;
        };
        apiClient.clanData = makeClanData(CLAN_TAG, [
            { tag: '#P1', name: 'Alice', role: 'member' },
            { tag: '#P2', name: 'Bob', role: 'coLeader' },
        ]);

        const result = await service.updateData(CLAN_TAG);

        expect(wasInTransactionDuringApiCall).toBe(false);
        expect(result.successFlag).toBe(true);
        expect(result.serviceName).toBe('ClanInfoService');
        expect(result.clanTag).toBe(CLAN_TAG);
        expect(result.events).toHaveLength(0);

        expect(clansRepo.getClanNameByTag(CLAN_TAG)).toBe('Integration Clan');
        expect(
            clansRepo
                .getActiveMembers(CLAN_TAG)
                .map((p) => p.tag)
                .sort(),
        ).toEqual(['#P1', '#P2']);
        expect(clansRepo.getLatestPlayerSnapshots(CLAN_TAG)).toHaveLength(2);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(0);

        const eventCount = db.connection
            .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM domain_events;')
            .get();
        expect(eventCount?.count).toBe(0);
    });

    it('detects join, leave, promotion, and demotion on subsequent syncs and records events only for active players subscriptions', async () => {
        const { clansRepo, subscriptionRepo, domainEventsRepo, apiClient, service } = setup();

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.saveTelegramChat(5001, 0, 'Management');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');
        subscriptionRepo.subscribeToChat(5001, 0, CLAN_TAG, 'management');
        const playersSubId = subscriptionRepo.getSubscriptionId(-1001, 0, CLAN_TAG);

        // 1. Initial sync (no events)
        apiClient.clanData = makeClanData(CLAN_TAG, [
            { tag: '#P1', name: 'Alice', role: 'member' },
            { tag: '#P2', name: 'Bob', role: 'coLeader' },
            { tag: '#POLD', name: 'Old Player', role: 'member' },
        ]);
        const initial = await service.updateData(CLAN_TAG);
        expect(initial.successFlag).toBe(true);
        expect(initial.events).toHaveLength(0);

        // 2. Subsequent sync:
        //    - #POLD leaves
        //    - #PNEW joins
        //    - #P1 promoted (member -> elder)
        //    - #P2 demoted (coLeader -> elder)
        apiClient.clanData = makeClanData(CLAN_TAG, [
            { tag: '#P1', name: 'Alice', role: 'elder' },
            { tag: '#P2', name: 'Bob', role: 'elder' },
            { tag: '#PNEW', name: 'New Player', role: 'member' },
        ]);
        const updated = await service.updateData(CLAN_TAG);

        expect(updated.successFlag).toBe(true);
        expect(updated.events).toHaveLength(4);

        const leftEvents = updated.events.filter((e) => e.type === 'PlayerLeftClanEvent');
        const joinedEvents = updated.events.filter((e) => e.type === 'PlayerJoinedClanEvent');
        const roleEvents = updated.events.filter((e) => e.type === 'PlayerRoleChangedEvent');

        expect(leftEvents).toHaveLength(1);
        expect(leftEvents[0]).toMatchObject({
            clanTag: CLAN_TAG,
            playerTag: '#POLD',
            playerName: 'Old Player',
        });
        expect(leftEvents[0]?.membershipId).toBeGreaterThan(0);

        expect(joinedEvents).toHaveLength(1);
        expect(joinedEvents[0]).toMatchObject({
            clanTag: CLAN_TAG,
            playerTag: '#PNEW',
            playerName: 'New Player',
        });
        expect(joinedEvents[0]?.membershipId).toBeGreaterThan(0);

        expect(roleEvents).toHaveLength(2);
        expect(roleEvents).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    clanTag: CLAN_TAG,
                    playerTag: '#P1',
                    oldRole: 'member',
                    newRole: 'elder',
                }),
                expect.objectContaining({
                    clanTag: CLAN_TAG,
                    playerTag: '#P2',
                    oldRole: 'coLeader',
                    newRole: 'elder',
                }),
            ]),
        );
        for (const roleEvent of roleEvents) {
            expect(roleEvent.snapshotId).toBeGreaterThan(0);
        }

        const pending = domainEventsRepo.getPendingDestinations(50);
        expect(pending).toHaveLength(4);
        for (const dest of pending) {
            expect(dest.chatId).toBe(-1001);
            expect(dest.category).toBe('roster');
            expect(dest.subscriptionId).toBe(playersSubId);
            expect(dest.payloadVersion).toBe(1);
        }

        // Verify late subscription does not receive past events
        subscriptionRepo.saveTelegramChat(-2002, 0, 'Late Players');
        subscriptionRepo.subscribeToChat(-2002, 0, CLAN_TAG, 'players');

        // 3. Repeated sync with identical roster is idempotent (0 new events)
        const repeated = await service.updateData(CLAN_TAG);
        expect(repeated.successFlag).toBe(true);
        expect(repeated.events).toHaveLength(0);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(4);
    });

    it('returns SyncResult error without modifying DB when API returns empty data (null)', async () => {
        const { clansRepo, apiClient, service } = setup();

        clansRepo.insertMinimalClan(CLAN_TAG);
        apiClient.clanData = null;

        const result = await service.updateData(CLAN_TAG);

        expect(result.successFlag).toBe(false);
        expect(result.serviceName).toBe('ClanInfoService');
        expect(result.clanTag).toBe(CLAN_TAG);
        expect(result.errorMsg).toContain('Received empty API response');
        expect(result.events).toHaveLength(0);
        expect(clansRepo.getActiveMembers(CLAN_TAG)).toHaveLength(0);
        expect(clansRepo.getLatestPlayerSnapshots(CLAN_TAG)).toHaveLength(0);
    });

    it('returns SyncResult error when CoC API throws an API error', async () => {
        const { clansRepo, apiClient, service } = setup();

        clansRepo.insertMinimalClan(CLAN_TAG);
        apiClient.errorToThrow = new CocApiError('HTTP 503', {
            kind: 'server_error',
            statusCode: 503,
            endpoint: '/clans/%232PPLQ',
        });

        const result = await service.updateData(CLAN_TAG);

        expect(result.successFlag).toBe(false);
        expect(result.errorMsg).toContain('HTTP 503');
        expect(result.events).toHaveLength(0);
    });

    it('rethrows AbortError instead of converting shutdown cancellation into a sync error', async () => {
        const { clansRepo, apiClient, service } = setup();

        clansRepo.insertMinimalClan(CLAN_TAG);
        apiClient.errorToThrow = new AbortError('Shutdown requested');

        await expect(service.updateData(CLAN_TAG)).rejects.toBeInstanceOf(AbortError);
    });

    it('rolls back database changes when saving clan data fails', async () => {
        const { clansRepo, domainEventsRepo, apiClient, service } = setup();

        apiClient.clanData = makeClanData(
            CLAN_TAG,
            [{ tag: '#P1', name: 'Alice', role: 'member' }],
            { clanSnapshotTag: '#UNKNOWN' },
        );

        const result = await service.updateData(CLAN_TAG);

        expect(result.successFlag).toBe(false);
        expect(result.events).toHaveLength(0);
        expect(clansRepo.getTrackedClans()).toHaveLength(0);
        expect(clansRepo.getActiveMembers(CLAN_TAG)).toHaveLength(0);
        expect(clansRepo.getLatestPlayerSnapshots(CLAN_TAG)).toHaveLength(0);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(0);
    });

    it('rolls back both roster state and domain events atomically when event storage fails, then succeeds on retry', async () => {
        const { db, clansRepo, subscriptionRepo, domainEventsRepo, apiClient, service } = setup();

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');

        // Initial sync establishes baseline roster
        apiClient.clanData = makeClanData(CLAN_TAG, [
            { tag: '#P1', name: 'Alice', role: 'member' },
        ]);
        const baseline = await service.updateData(CLAN_TAG);
        expect(baseline.successFlag).toBe(true);
        expect(baseline.events).toHaveLength(0);

        // Next sync has a new player (#P2), which will trigger PlayerJoinedClanEvent
        apiClient.clanData = makeClanData(CLAN_TAG, [
            { tag: '#P1', name: 'Alice', role: 'member' },
            { tag: '#P2', name: 'Bob', role: 'member' },
        ]);

        db.connection.exec(`
            CREATE TEMP TRIGGER reject_domain_event
            BEFORE INSERT ON domain_events
            BEGIN
                SELECT RAISE(ABORT, 'simulated event storage failure');
            END;
        `);

        const failed = await service.updateData(CLAN_TAG);
        expect(failed.successFlag).toBe(false);
        expect(failed.events).toHaveLength(0);
        expect(clansRepo.getActiveMembers(CLAN_TAG).map((p) => p.tag)).toEqual(['#P1']);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(0);

        const countAfterRollback = db.connection
            .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM domain_events;')
            .get();
        expect(countAfterRollback?.count).toBe(0);

        db.connection.exec('DROP TRIGGER reject_domain_event;');

        const recovered = await service.updateData(CLAN_TAG);
        expect(recovered.successFlag).toBe(true);
        expect(recovered.events).toHaveLength(1);
        expect(recovered.events[0]).toMatchObject({
            type: 'PlayerJoinedClanEvent',
            playerTag: '#P2',
        });
        expect(
            clansRepo
                .getActiveMembers(CLAN_TAG)
                .map((p) => p.tag)
                .sort(),
        ).toEqual(['#P1', '#P2']);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(1);
    });

    it.each([
        { label: 'A -> B', order: ['#CLAN_A', '#CLAN_B'] as const },
        { label: 'B -> A', order: ['#CLAN_B', '#CLAN_A'] as const },
    ])(
        'preserves players.clan_tag when a player moves between two tracked clans in sync order $label',
        async ({ order }) => {
            const { db, clansRepo, apiClient, service } = setup();
            const clanA = '#CLAN_A';
            const clanB = '#CLAN_B';

            clansRepo.insertMinimalClan(clanA);
            clansRepo.insertMinimalClan(clanB);

            const responses = new Map<string, CompleteClanData>([
                [
                    clanA,
                    makeClanData(
                        clanA,
                        [
                            { tag: '#P1', name: 'Mover', role: 'member' },
                            { tag: '#PA', name: 'StayA', role: 'leader' },
                        ],
                        { clanName: 'Clan A' },
                    ),
                ],
                [
                    clanB,
                    makeClanData(clanB, [{ tag: '#PB', name: 'StayB', role: 'leader' }], {
                        clanName: 'Clan B',
                    }),
                ],
            ]);

            apiClient.onGetCompleteClanData = (requestedTag) => {
                apiClient.clanData = responses.get(requestedTag) ?? null;
            };

            // Initial sync for both clans
            expect((await service.updateData(clanA)).successFlag).toBe(true);
            expect((await service.updateData(clanB)).successFlag).toBe(true);

            // #P1 moves from Clan A to Clan B
            responses.set(
                clanA,
                makeClanData(clanA, [{ tag: '#PA', name: 'StayA', role: 'leader' }], {
                    clanName: 'Clan A',
                }),
            );
            responses.set(
                clanB,
                makeClanData(
                    clanB,
                    [
                        { tag: '#PB', name: 'StayB', role: 'leader' },
                        { tag: '#P1', name: 'Mover', role: 'member' },
                    ],
                    { clanName: 'Clan B' },
                ),
            );

            const results = new Map<string, Awaited<ReturnType<typeof service.updateData>>>();
            for (const tag of order) {
                const res = await service.updateData(tag);
                expect(res.successFlag).toBe(true);
                results.set(tag, res);
            }

            expect(results.get(clanA)?.events).toEqual([
                expect.objectContaining({
                    type: 'PlayerLeftClanEvent',
                    clanTag: clanA,
                    playerTag: '#P1',
                }),
            ]);
            expect(results.get(clanB)?.events).toEqual([
                expect.objectContaining({
                    type: 'PlayerJoinedClanEvent',
                    clanTag: clanB,
                    playerTag: '#P1',
                }),
            ]);

            const moverRow = db.connection
                .prepare('SELECT clan_tag FROM players WHERE tag = ?')
                .get('#P1') as { clan_tag: string | null };
            expect(moverRow.clan_tag).toBe(clanB);

            expect(clansRepo.getActiveMembers(clanA).map((p) => p.tag)).toEqual(['#PA']);
            expect(
                clansRepo
                    .getActiveMembers(clanB)
                    .map((p) => p.tag)
                    .sort(),
            ).toEqual(['#P1', '#PB']);

            // Repeated syncs are idempotent and preserve players.clan_tag
            for (const tag of order) {
                const repeated = await service.updateData(tag);
                expect(repeated.successFlag).toBe(true);
                expect(repeated.events).toHaveLength(0);
            }

            const moverRowAfterRepeat = db.connection
                .prepare('SELECT clan_tag FROM players WHERE tag = ?')
                .get('#P1') as { clan_tag: string | null };
            expect(moverRowAfterRepeat.clan_tag).toBe(clanB);
        },
    );

    it('does not emit PlayerRoleChangedEvent when a player leaves as coLeader and rejoins as member, but detects subsequent role changes within the new membership', async () => {
        const { db, clansRepo, subscriptionRepo, domainEventsRepo, apiClient, service } = setup();

        clansRepo.insertMinimalClan(CLAN_TAG);
        subscriptionRepo.saveTelegramChat(-1001, 0, 'Players');
        subscriptionRepo.subscribeToChat(-1001, 0, CLAN_TAG, 'players');

        // 1. Initial sync: Alice joins baseline as coLeader
        apiClient.clanData = makeClanData(CLAN_TAG, [
            { tag: '#P1', name: 'Alice', role: 'coLeader' },
            { tag: '#P2', name: 'Bob', role: 'leader' },
        ]);
        const initial = await service.updateData(CLAN_TAG);
        expect(initial.successFlag).toBe(true);
        expect(initial.events).toHaveLength(0);

        // 2. Alice leaves the clan
        apiClient.clanData = makeClanData(CLAN_TAG, [{ tag: '#P2', name: 'Bob', role: 'leader' }]);
        const left = await service.updateData(CLAN_TAG);
        expect(left.successFlag).toBe(true);
        expect(left.events).toEqual([
            expect.objectContaining({
                type: 'PlayerLeftClanEvent',
                clanTag: CLAN_TAG,
                playerTag: '#P1',
                playerName: 'Alice',
            }),
        ]);
        const leftEvent = left.events[0];
        const firstMembershipId =
            leftEvent?.type === 'PlayerLeftClanEvent' ? leftEvent.membershipId : 0;

        // 3. Alice rejoins as member: only PlayerJoinedClanEvent, no false PlayerRoleChangedEvent
        apiClient.clanData = makeClanData(CLAN_TAG, [
            { tag: '#P1', name: 'Alice', role: 'member' },
            { tag: '#P2', name: 'Bob', role: 'leader' },
        ]);
        const rejoined = await service.updateData(CLAN_TAG);
        expect(rejoined.successFlag).toBe(true);
        expect(rejoined.events).toEqual([
            expect.objectContaining({
                type: 'PlayerJoinedClanEvent',
                clanTag: CLAN_TAG,
                playerTag: '#P1',
                playerName: 'Alice',
            }),
        ]);
        const joinedEvent = rejoined.events[0];
        expect(joinedEvent?.type).toBe('PlayerJoinedClanEvent');
        if (joinedEvent?.type === 'PlayerJoinedClanEvent') {
            expect(joinedEvent.membershipId).toBeGreaterThan(firstMembershipId);
        }

        const recordedTypesAfterRejoin = db.connection
            .prepare<[], { event_type: string }>(
                'SELECT event_type FROM domain_events ORDER BY id ASC;',
            )
            .all()
            .map((row) => row.event_type);
        expect(recordedTypesAfterRejoin).toEqual(['PlayerLeftClanEvent', 'PlayerJoinedClanEvent']);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(2);

        // 4. Repeated sync with same roster is idempotent (0 new events)
        const repeatedAfterRejoin = await service.updateData(CLAN_TAG);
        expect(repeatedAfterRejoin.successFlag).toBe(true);
        expect(repeatedAfterRejoin.events).toHaveLength(0);
        expect(domainEventsRepo.getPendingDestinations(50)).toHaveLength(2);

        // 5. Subsequent promotion within the new continuous membership IS detected
        apiClient.clanData = makeClanData(CLAN_TAG, [
            { tag: '#P1', name: 'Alice', role: 'admin' },
            { tag: '#P2', name: 'Bob', role: 'leader' },
        ]);
        const promoted = await service.updateData(CLAN_TAG);
        expect(promoted.successFlag).toBe(true);
        expect(promoted.events).toEqual([
            expect.objectContaining({
                type: 'PlayerRoleChangedEvent',
                clanTag: CLAN_TAG,
                playerTag: '#P1',
                playerName: 'Alice',
                oldRole: 'member',
                newRole: 'admin',
            }),
        ]);

        // 6. Second leave and rejoin with another role also produces no false role change
        apiClient.clanData = makeClanData(CLAN_TAG, [{ tag: '#P2', name: 'Bob', role: 'leader' }]);
        const leftAgain = await service.updateData(CLAN_TAG);
        expect(leftAgain.successFlag).toBe(true);
        expect(leftAgain.events.map((e) => e.type)).toEqual(['PlayerLeftClanEvent']);

        apiClient.clanData = makeClanData(CLAN_TAG, [
            { tag: '#P1', name: 'Alice', role: 'member' },
            { tag: '#P2', name: 'Bob', role: 'leader' },
        ]);
        const rejoinedAgain = await service.updateData(CLAN_TAG);
        expect(rejoinedAgain.successFlag).toBe(true);
        expect(rejoinedAgain.events.map((e) => e.type)).toEqual(['PlayerJoinedClanEvent']);
    });

    it('simultaneously suppresses role change for rejoining member while detecting role change for continuing active member', async () => {
        const { clansRepo, apiClient, service } = setup();

        clansRepo.insertMinimalClan(CLAN_TAG);

        // 1. Initial sync
        apiClient.clanData = makeClanData(CLAN_TAG, [
            { tag: '#P1', name: 'Alice', role: 'coLeader' },
            { tag: '#P2', name: 'Bob', role: 'member' },
            { tag: '#P3', name: 'Charlie', role: 'leader' },
        ]);
        expect((await service.updateData(CLAN_TAG)).successFlag).toBe(true);

        // 2. Alice leaves
        apiClient.clanData = makeClanData(CLAN_TAG, [
            { tag: '#P2', name: 'Bob', role: 'member' },
            { tag: '#P3', name: 'Charlie', role: 'leader' },
        ]);
        const leaveResult = await service.updateData(CLAN_TAG);
        expect(leaveResult.events.map((e) => e.type)).toEqual(['PlayerLeftClanEvent']);

        // 3. In one sync: Alice rejoins as member, Bob is promoted member -> admin, Charlie leaves
        apiClient.clanData = makeClanData(CLAN_TAG, [
            { tag: '#P1', name: 'Alice', role: 'member' },
            { tag: '#P2', name: 'Bob', role: 'admin' },
        ]);
        const mixed = await service.updateData(CLAN_TAG);
        expect(mixed.successFlag).toBe(true);
        expect(mixed.events).toHaveLength(3);
        expect(mixed.events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: 'PlayerLeftClanEvent',
                    playerTag: '#P3',
                }),
                expect.objectContaining({
                    type: 'PlayerJoinedClanEvent',
                    playerTag: '#P1',
                }),
                expect.objectContaining({
                    type: 'PlayerRoleChangedEvent',
                    playerTag: '#P2',
                    oldRole: 'member',
                    newRole: 'admin',
                }),
            ]),
        );
    });

    it('emits only PlayerJoinedClanEvent when the sole member leaves and rejoins with a different role', async () => {
        const { clansRepo, apiClient, service } = setup();

        clansRepo.insertMinimalClan(CLAN_TAG);

        // 1. Initial sync with a single member
        apiClient.clanData = makeClanData(CLAN_TAG, [
            { tag: '#P1', name: 'Solo', role: 'coLeader' },
        ]);
        expect((await service.updateData(CLAN_TAG)).events).toHaveLength(0);

        // 2. Sole member leaves (activeMemberships becomes empty, latestPlayerStates stays non-empty)
        apiClient.clanData = makeClanData(CLAN_TAG, []);
        const left = await service.updateData(CLAN_TAG);
        expect(left.successFlag).toBe(true);
        expect(left.events.map((e) => e.type)).toEqual(['PlayerLeftClanEvent']);

        // 3. Sole member returns as member: must not be treated as initial sync and must not emit role change
        apiClient.clanData = makeClanData(CLAN_TAG, [{ tag: '#P1', name: 'Solo', role: 'member' }]);
        const rejoined = await service.updateData(CLAN_TAG);
        expect(rejoined.successFlag).toBe(true);
        expect(rejoined.events).toEqual([
            expect.objectContaining({
                type: 'PlayerJoinedClanEvent',
                clanTag: CLAN_TAG,
                playerTag: '#P1',
                playerName: 'Solo',
            }),
        ]);
    });
});

describe('detectRoleChanges', () => {
    function makeSnapshot(playerTag: string, role: string): PlayerSnapshot {
        return {
            playerTag,
            clanTag: CLAN_TAG,
            role,
            townHallLevel: 14,
            expLevel: 200,
            clanRank: 1,
            leagueId: 1,
            builderBaseLeagueId: 1,
            trophies: 5000,
            builderBaseTrophies: 3000,
            donations: 100,
            donationsReceived: 80,
        };
    }

    function makeLatestState(
        playerTag: string,
        playerName: string,
        role: string,
    ): LatestPlayerState {
        return {
            clanTag: CLAN_TAG,
            playerTag,
            playerName,
            role,
            townHallLevel: 14,
            expLevel: 200,
            clanRank: 1,
            leagueId: 1,
            builderBaseLeagueId: 1,
            trophies: 5000,
            builderBaseTrophies: 3000,
            donations: 100,
            donationsReceived: 80,
        };
    }

    function makeActiveMembership(
        membershipId: number,
        playerTag: string,
        playerName: string,
    ): ActiveMembership {
        return {
            membershipId,
            player: {
                tag: playerTag,
                name: playerName,
                clanTag: CLAN_TAG,
            },
        };
    }

    it('detects role changes only for players with an active continuous membership', () => {
        const result = detectRoleChanges(
            CLAN_TAG,
            [
                makeSnapshot('#P_ACTIVE_CHANGED', 'admin'),
                makeSnapshot('#P_ACTIVE_SAME', 'coLeader'),
                makeSnapshot('#P_REJOINED', 'member'),
                makeSnapshot('#P_NEW', 'member'),
            ],
            [
                makeLatestState('#P_ACTIVE_CHANGED', 'ActiveChanged', 'member'),
                makeLatestState('#P_ACTIVE_SAME', 'ActiveSame', 'coLeader'),
                makeLatestState('#P_REJOINED', 'Rejoined', 'coLeader'),
            ],
            [
                makeActiveMembership(1, '#P_ACTIVE_CHANGED', 'ActiveChanged'),
                makeActiveMembership(2, '#P_ACTIVE_SAME', 'ActiveSame'),
            ],
        );

        expect(result.changes).toEqual([
            {
                clanTag: CLAN_TAG,
                playerTag: '#P_ACTIVE_CHANGED',
                playerName: 'ActiveChanged',
                oldRole: 'member',
                newRole: 'admin',
            },
        ]);
    });

    it('returns empty changes when activeMemberships is empty even if historical snapshots exist', () => {
        const result = detectRoleChanges(
            CLAN_TAG,
            [makeSnapshot('#P1', 'member')],
            [makeLatestState('#P1', 'Alice', 'coLeader')],
            [],
        );

        expect(result.changes).toEqual([]);
    });

    it('ignores active members who have no previous snapshot', () => {
        const result = detectRoleChanges(
            CLAN_TAG,
            [makeSnapshot('#P1', 'coLeader')],
            [],
            [makeActiveMembership(1, '#P1', 'Alice')],
        );

        expect(result.changes).toEqual([]);
    });
});
