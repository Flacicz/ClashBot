import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    ClansRepo,
    ClanwarRepo,
    DomainEventsRepo,
    FakeClock,
    NotificationRepo,
    RaidRepo,
    SubscriptionRepo,
    SyncOutageRepo,
    createApplication,
    createLogger,
    type AppConfig,
    type ClosableCocApiClient,
    type CompleteClanData,
    type CompleteClanwarData,
    type CompleteClanwarsLeagueData,
    type CompleteRaidData,
    type TelegramGateway,
    type TelegramPollingService,
} from '../../src/index.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const MIGRATIONS_PATH = path.join(REPO_ROOT, 'migrations');
const ATTACK_GUIDES_PATH = path.join(REPO_ROOT, 'resources/telegram/attack_guides.json');
const CPP_V012_FIXTURE_PATH = path.resolve(import.meta.dirname, '../fixtures/cpp_v012.sqlite');

interface DeliveredTelegramMessage {
    readonly chatId: number;
    readonly messageThreadId: number;
    readonly text: string;
}

function createNoChangeCocApiClient(): ClosableCocApiClient {
    const clanData: CompleteClanData = {
        clan: {
            tag: '#2PP',
            name: 'Alpha Clan',
            description: 'C++ v012 fixture clan',
            locationId: 32000193,
            locationName: 'International',
            chatLanguageId: 75000000,
            chatLanguage: 'English',
            isFamilyFriendly: true,
        },
        clanSnapshot: {
            clanTag: '#2PP',
            type: 'open',
            membersCount: 2,
            clanLevel: 15,
            clanPoints: 42000,
            clanBuilderBasePoints: 38000,
            clanCapitalPoints: 2500,
            capitalHallLevel: 10,
            capitalLeagueId: 85000000,
            requiredTrophies: 2000,
            requiredBuilderBaseTrophies: 1000,
            requiredTownhallLevel: 12,
            warFrequency: 'always',
            isWarLogPublic: true,
            warWinStreak: 4,
            warWins: 120,
            warTies: 3,
            warLosses: 25,
            warLeagueId: 48000015,
        },
        players: [
            { tag: '#P1', name: 'Alice', clanTag: '#2PP' },
            { tag: '#P2', name: 'Bob', clanTag: '#2PP' },
        ],
        playerSnapshots: [
            {
                playerTag: '#P1',
                clanTag: '#2PP',
                role: 'leader',
                townHallLevel: 16,
                expLevel: 220,
                clanRank: 1,
                leagueId: 29000022,
                builderBaseLeagueId: 44000030,
                trophies: 5200,
                builderBaseTrophies: 4100,
                donations: 800,
                donationsReceived: 450,
            },
            {
                playerTag: '#P2',
                clanTag: '#2PP',
                role: 'coLeader',
                townHallLevel: 15,
                expLevel: 205,
                clanRank: 2,
                leagueId: 29000020,
                builderBaseLeagueId: 44000028,
                trophies: 4900,
                builderBaseTrophies: 3900,
                donations: 600,
                donationsReceived: 500,
            },
        ],
    };

    return {
        getCompleteClanData(): Promise<CompleteClanData> {
            return Promise.resolve(clanData);
        },
        getCompleteClanwarData(): Promise<CompleteClanwarData | null> {
            return Promise.resolve(null);
        },
        getCompleteClanwarsLeagueData(): Promise<CompleteClanwarsLeagueData | null> {
            return Promise.resolve(null);
        },
        getCompleteRaidData(): Promise<CompleteRaidData | null> {
            return Promise.resolve(null);
        },
        close(): Promise<void> {
            return Promise.resolve();
        },
    };
}

describe('Drop-in compatibility with C++-generated v012 SQLite database', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    function copyFixtureToTemp(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clashbot-cpp-v012-'));
        tempDirs.push(dir);
        const dest = path.join(dir, 'cpp_v012.sqlite');
        fs.copyFileSync(CPP_V012_FIXTURE_PATH, dest);
        return dest;
    }

    it('opens a real C++ v012 DB, preserves history, does not re-send sent notifications, drains pending records, recovers open sync_outages, and passes integrity checks', async () => {
        const dbPath = copyFixtureToTemp();
        const clock = new FakeClock(2_000_000_000_000);
        const logger = createLogger({ level: 'silent' });
        const delivered: DeliveredTelegramMessage[] = [];

        const telegramGateway: TelegramGateway = {
            sendMessage(chatId, text, messageThreadId = 0): Promise<void> {
                delivered.push({ chatId, messageThreadId, text });
                return Promise.resolve();
            },
        };

        const telegramBotService: TelegramPollingService = {
            async start(signal?: AbortSignal): Promise<void> {
                await clock.sleep(60_000, signal).catch(() => undefined);
            },
            stop(): Promise<void> {
                return Promise.resolve();
            },
        };

        const config: AppConfig = {
            useTunnel: false,
            tunnelBaseUrl: 'https://localhost:8080/v1',
            baseUrl: 'https://api.clashofclans.com/v1/',
            databasePath: dbPath,
            migrationPath: MIGRATIONS_PATH,
            attackGuidesPath: ATTACK_GUIDES_PATH,
            supercellToken: 'test-supercell-token',
            telegramToken: '123456:TEST-TOKEN',
        };

        const app = await createApplication(config, {
            logger,
            clock,
            cocApiClient: createNoChangeCocApiClient(),
            telegramGateway,
            telegramBotService,
        });

        try {
            // 1. Verify schema_migrations preserved all 12 C++ migrations and applied 013-015 cleanly
            const appliedMigrations = app.db.connection
                .prepare('SELECT version FROM schema_migrations ORDER BY version ASC;')
                .all() as { version: string }[];
            expect(appliedMigrations).toHaveLength(15);
            expect(appliedMigrations[0]?.version).toBe('001_initial_schema.sql');
            expect(appliedMigrations[11]?.version).toBe('012_legacy_notification_idempotency.sql');
            expect(appliedMigrations[12]?.version).toBe('013_notification_claim_status.sql');
            expect(appliedMigrations[13]?.version).toBe('014_history_completeness.sql');
            expect(appliedMigrations[14]?.version).toBe('015_notification_expiry.sql');

            const notificationColumns = app.db.connection.pragma(
                'table_info(notifications)',
            ) as readonly { name: string }[];
            expect(notificationColumns.some((col) => col.name === 'expires_at')).toBe(true);

            const backfilledWar = app.db.connection
                .prepare('SELECT state, is_complete, last_observed_at FROM wars WHERE war_id = 1;')
                .get() as { state: string; is_complete: number; last_observed_at: number | null };
            expect(backfilledWar.is_complete).toBe(backfilledWar.state === 'warEnded' ? 1 : 0);
            expect(backfilledWar.last_observed_at).not.toBeNull();

            const backfilledRaid = app.db.connection
                .prepare(
                    'SELECT state, is_complete, last_observed_at FROM clan_raids WHERE id = 1;',
                )
                .get() as { state: string; is_complete: number; last_observed_at: number | null };
            expect(backfilledRaid.is_complete).toBe(backfilledRaid.state === 'ended' ? 1 : 0);
            expect(backfilledRaid.last_observed_at).not.toBeNull();

            // 2. Verify C++ history (clans, wars, raids, subscriptions) is readable via TS repositories
            const clansRepo = new ClansRepo(app.db);
            const clanwarRepo = new ClanwarRepo(app.db);
            const raidRepo = new RaidRepo(app.db);
            const subscriptionRepo = new SubscriptionRepo(app.db);
            const syncOutageRepo = new SyncOutageRepo(app.db);
            const domainEventsRepo = new DomainEventsRepo(app.db);
            const notificationRepo = new NotificationRepo(app.db);

            expect(clansRepo.getTrackedClans()).toEqual(['#2PP']);
            expect(clansRepo.getClanNameByTag('#2PP')).toBe('Alpha Clan');
            expect(clansRepo.getActiveMembers('#2PP').map((p) => p.name)).toEqual(['Alice', 'Bob']);

            const warRef = {
                clanTag: '#2PP',
                warId: 1,
                homeClanId: 1,
                opponentClanId: 2,
            };
            const warOverviews = clanwarRepo.getClanwarOverviews(warRef);
            expect(warOverviews.home.clanName).toBe('Alpha Clan');
            expect(warOverviews.home.stars).toBe(6);
            expect(warOverviews.opponent.clanName).toBe('Bravo Clan');

            const raidStats = raidRepo.getRaidStats({ raidId: 1 });
            expect(raidStats.totalLoot).toBe(450000);
            expect(raidRepo.getBestRaidMembers({ raidId: 1 })).toHaveLength(2);

            expect(
                subscriptionRepo.getSubscriptionDestinationsForClan('#2PP', 'players'),
            ).toHaveLength(1);
            expect(
                subscriptionRepo.getSubscriptionDestinationsForClan('#2PP', 'management'),
            ).toHaveLength(1);

            // 3. Verify initial fixture notification & outage state before workers run
            const initialSentCount = (
                app.db.connection
                    .prepare("SELECT COUNT(*) AS cnt FROM notifications WHERE status = 'sent';")
                    .get() as { cnt: number }
            ).cnt;
            expect(initialSentCount).toBe(2);

            expect(
                notificationRepo.getPending(10, clock.nowEpochSeconds()).map((n) => n.messageText),
            ).toEqual(['Pending management join message']);

            expect(
                domainEventsRepo.getPendingDestinations(10, clock.nowEpochSeconds()),
            ).toHaveLength(1);

            expect(syncOutageRepo.getOpenOutageId('#2PP', 'ClanInfoService')).toBe(1);

            // 4. Process pre-existing pending domain events and pending notifications
            app.domainEventWorker.processPending();
            await app.notificationWorker.processPending();

            // Pre-existing sent messages ("Already sent players join message" and "Legacy sent notification from v010")
            // must NOT be re-sent; only the 1 pre-existing pending notification + 1 newly materialized Bob join notification
            // should be delivered.
            expect(delivered.map((m) => m.text)).not.toContain('Already sent players join message');
            expect(delivered.map((m) => m.text)).not.toContain(
                'Legacy sent notification from v010',
            );
            expect(delivered).toHaveLength(2);
            expect(delivered[0]).toEqual({
                chatId: -10010,
                messageThreadId: 42,
                text: 'Pending management join message',
            });
            expect(delivered[1]?.chatId).toBe(-10010);
            expect(delivered[1]?.messageThreadId).toBe(0);
            expect(delivered[1]?.text).toContain('Bob');

            // 5. Run a ClanManager sync cycle and prove the open sync_outages row from C++ is closed with SyncRecoveryEvent
            const syncAbortController = new AbortController();
            const syncPromise = app.clanManager.syncAll(syncAbortController.signal);
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            syncAbortController.abort();
            await syncPromise;

            expect(syncOutageRepo.getOpenOutageId('#2PP', 'ClanInfoService')).toBeNull();
            const outageRow = app.db.connection
                .prepare('SELECT failure_count, recovered_at FROM sync_outages WHERE id = 1;')
                .get() as { failure_count: number; recovered_at: number | null };
            expect(outageRow.failure_count).toBe(2);
            expect(outageRow.recovered_at).not.toBeNull();

            // Materialize and deliver the SyncRecoveryEvent
            app.domainEventWorker.processPending();
            await app.notificationWorker.processPending();

            expect(delivered).toHaveLength(3);
            const recoveryMessage = delivered[2];
            expect(recoveryMessage?.chatId).toBe(-10010);
            expect(recoveryMessage?.messageThreadId).toBe(42);
            expect(recoveryMessage?.text).toContain('ClanInfoService');
            expect(recoveryMessage?.text).toContain('#2PP');

            // 6. Prove idempotency on repeated worker runs (no duplicate deliveries)
            app.domainEventWorker.processPending();
            await app.notificationWorker.processPending();
            expect(delivered).toHaveLength(3);

            // 7. Verify PRAGMA integrity_check and PRAGMA foreign_key_check
            const integrityRows = app.db.connection.prepare('PRAGMA integrity_check;').all() as {
                integrity_check: string;
            }[];
            expect(integrityRows).toEqual([{ integrity_check: 'ok' }]);

            const fkViolations = app.db.connection.prepare('PRAGMA foreign_key_check;').all();
            expect(fkViolations).toEqual([]);
        } finally {
            await app.coordinator.shutdown();
        }
    });
});
