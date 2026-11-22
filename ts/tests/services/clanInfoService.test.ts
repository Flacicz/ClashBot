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
import { ClanInfoService, type ClanInfoApiClient } from '../../src/services/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../../src/database/migrations');
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
        const playersSubId = subscriptionRepo.getSubscriptionId(-1001, 0, CLAN_TAG, 'players');

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
            expect(dest.audience).toBe('players');
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
});
