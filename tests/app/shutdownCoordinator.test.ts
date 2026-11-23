import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import {
    APPLICATION_EVENT_TYPES,
    AbortError,
    ClansRepo,
    DEFAULT_SHUTDOWN_BUDGET_MS,
    DomainEventPayloadSerializer,
    DomainEventRecorder,
    DomainEventsRepo,
    EXIT_FAILURE,
    EXIT_OK,
    FakeClock,
    NotificationRepo,
    ShutdownCoordinator,
    SubscriptionRepo,
    SyncOutageRepo,
    TransactionManager,
    createApplication,
    createLogger,
    main,
    type AppConfig,
    type ClosableCocApiClient,
    type CompleteClanData,
    type CompleteClanwarData,
    type CompleteClanwarsLeagueData,
    type CompleteRaidData,
    type SignalSource,
    type TelegramGateway,
    type TelegramPollingService,
} from '../../src/index.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const MIGRATIONS_PATH = path.join(REPO_ROOT, 'migrations');
const ATTACK_GUIDES_PATH = path.join(REPO_ROOT, 'resources/telegram/attack_guides.json');

class FakeSignalSource implements SignalSource {
    private readonly listeners = new Map<'SIGINT' | 'SIGTERM', Set<() => void>>();

    on(event: 'SIGINT' | 'SIGTERM', listener: () => void): void {
        const set = this.listeners.get(event) ?? new Set<() => void>();
        set.add(listener);
        this.listeners.set(event, set);
    }

    off(event: 'SIGINT' | 'SIGTERM', listener: () => void): void {
        this.listeners.get(event)?.delete(listener);
    }

    emit(event: 'SIGINT' | 'SIGTERM'): void {
        for (const listener of this.listeners.get(event) ?? []) {
            listener();
        }
    }

    listenerCount(event: 'SIGINT' | 'SIGTERM'): number {
        return this.listeners.get(event)?.size ?? 0;
    }
}

function createBufferingLogger(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
    const lines: string[] = [];
    const destination = new Writable({
        write(chunk, _encoding, callback) {
            lines.push(String(chunk));
            callback();
        },
    });
    return {
        logger: createLogger({ level: 'debug', pretty: false, destination }),
        lines,
    };
}

function makeTestConfig(dbPath: string, overrides: Partial<AppConfig> = {}): AppConfig {
    return {
        useTunnel: false,
        tunnelBaseUrl: 'https://localhost:8080/v1',
        baseUrl: 'https://api.clashofclans.com/v1/',
        databasePath: dbPath,
        migrationPath: MIGRATIONS_PATH,
        attackGuidesPath: ATTACK_GUIDES_PATH,
        supercellToken: 'test-supercell-token',
        telegramToken: '123456:TEST-TOKEN',
        ...overrides,
    };
}

function createAbortableCocClient(
    clock: FakeClock,
    requestDelayMs: number,
    events: string[],
): ClosableCocApiClient {
    const sampleClanData: CompleteClanData = {
        clan: {
            tag: '#2PP',
            name: 'Alpha',
            description: 'Test',
            locationId: 1,
            locationName: 'Intl',
            chatLanguageId: 1,
            chatLanguage: 'EN',
            isFamilyFriendly: true,
        },
        clanSnapshot: {
            clanTag: '#2PP',
            type: 'open',
            membersCount: 0,
            clanLevel: 10,
            clanPoints: 1000,
            clanBuilderBasePoints: 1000,
            clanCapitalPoints: 1000,
            capitalHallLevel: 5,
            capitalLeagueId: 85000000,
            requiredTrophies: 0,
            requiredBuilderBaseTrophies: 0,
            requiredTownhallLevel: 1,
            warFrequency: 'always',
            isWarLogPublic: true,
            warWinStreak: 0,
            warWins: 0,
            warTies: 0,
            warLosses: 0,
            warLeagueId: 48000000,
        },
        players: [],
        playerSnapshots: [],
    };

    return {
        async getCompleteClanData(
            _clanTag: string,
            signal?: AbortSignal,
        ): Promise<CompleteClanData> {
            events.push('coc:getCompleteClanData:start');
            await clock.sleep(requestDelayMs, signal);
            return sampleClanData;
        },
        async getCompleteClanwarData(
            _clanTag: string,
            signal?: AbortSignal,
        ): Promise<CompleteClanwarData | null> {
            await clock.sleep(requestDelayMs, signal);
            return null;
        },
        async getCompleteClanwarsLeagueData(
            _clanTag: string,
            signal?: AbortSignal,
        ): Promise<CompleteClanwarsLeagueData | null> {
            await clock.sleep(requestDelayMs, signal);
            return null;
        },
        async getCompleteRaidData(
            _clanTag: string,
            signal?: AbortSignal,
        ): Promise<CompleteRaidData | null> {
            await clock.sleep(requestDelayMs, signal);
            return null;
        },
        close(): Promise<void> {
            events.push('closer:cocHttpPool');
            return Promise.resolve();
        },
    };
}

describe('ShutdownCoordinator and application lifecycle', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    function createTempDbPath(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clashbot-t34-'));
        tempDirs.push(dir);
        return path.join(dir, 'test.sqlite');
    }

    it('cancels in-flight sync and notification delivery on SIGTERM within 15s budget without burning attempts or recording sync_outages', async () => {
        const dbPath = createTempDbPath();
        const clock = new FakeClock(1_700_000_000_000);
        const { logger } = createBufferingLogger();
        const signalSource = new FakeSignalSource();
        const lifecycleEvents: string[] = [];
        const exitCodes: number[] = [];

        const coordinator = new ShutdownCoordinator({
            clock,
            logger,
            budgetMs: DEFAULT_SHUTDOWN_BUDGET_MS,
            exit: (code) => exitCodes.push(code),
        });

        const cocApiClient = createAbortableCocClient(clock, 5_000, lifecycleEvents);

        let sendInFlight = false;
        const telegramGateway: TelegramGateway = {
            async sendMessage(_chatId, _text, _threadId, signal): Promise<void> {
                sendInFlight = true;
                lifecycleEvents.push('telegram:sendMessage:start');
                await clock.sleep(5_000, signal);
            },
        };

        const telegramBotService: TelegramPollingService = {
            async start(signal?: AbortSignal): Promise<void> {
                lifecycleEvents.push('telegram:polling:start');
                try {
                    await clock.sleep(60_000, signal);
                } catch {
                    lifecycleEvents.push('telegram:polling:aborted');
                }
            },
            stop(): Promise<void> {
                lifecycleEvents.push('stop:telegramBotService');
                return Promise.resolve();
            },
        };

        const config = makeTestConfig(dbPath);
        const app = await createApplication(config, {
            logger,
            coordinator,
            clock,
            cocApiClient,
            telegramGateway,
            telegramBotService,
        });

        // Seed a tracked clan, a pending notification, and a pending domain event destination
        const clansRepo = new ClansRepo(app.db);
        const subscriptionRepo = new SubscriptionRepo(app.db);
        const domainEventsRepo = new DomainEventsRepo(app.db);
        const notificationRepo = new NotificationRepo(app.db);
        const syncOutageRepo = new SyncOutageRepo(app.db);
        const tm = new TransactionManager(app.db);
        const recorder = new DomainEventRecorder(
            new DomainEventPayloadSerializer(),
            subscriptionRepo,
            domainEventsRepo,
        );

        tm.retryInTransaction(() => {
            clansRepo.insertMinimalClan('#2PP');
            subscriptionRepo.saveTelegramChat(-1001, 0, 'Test Chat');
            subscriptionRepo.subscribeToChat(-1001, 0, '#2PP', 'players');
            notificationRepo.enqueueIfAbsent(
                'In-flight notification',
                'manual_test',
                'evt-1',
                -1001,
                0,
            );
        });

        const removeHandlers = coordinator.installSignalHandlers(signalSource);
        app.start();

        // Flush microtasks so syncAll, NotificationWorker.sendMessage, and Telegram polling enter in-flight sleeps
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(sendInFlight).toBe(true);
        expect(lifecycleEvents).toContain('coc:getCompleteClanData:start');
        expect(lifecycleEvents).toContain('telegram:sendMessage:start');

        // Also enqueue a pending domain event destination right before shutdown signal
        tm.retryInTransaction(() => {
            recorder.recordAll([
                {
                    type: APPLICATION_EVENT_TYPES.playerJoinedClan,
                    clanTag: '#2PP',
                    playerTag: '#P9',
                    playerName: 'Newbie',
                    membershipId: 99,
                },
            ]);
        });

        // Inspect state right before closing DB on shutdown by registering an inspection stop action
        let pendingNotifAttemptsOnStop = -1;
        let pendingDestAttemptsOnStop = -1;
        let openOutageIdOnStop: number | null = -1;
        coordinator.addStopAction('inspectBeforeClose', () => {
            const pendingNotifs = notificationRepo.getPending(10, clock.nowEpochSeconds());
            pendingNotifAttemptsOnStop = pendingNotifs[0]?.attempts ?? -1;
            const pendingDests = domainEventsRepo.getPendingDestinations(
                10,
                clock.nowEpochSeconds(),
            );
            pendingDestAttemptsOnStop = pendingDests[0]?.attempts ?? -1;
            openOutageIdOnStop = syncOutageRepo.getOpenOutageId('#2PP', 'ClanInfoService');
        });

        signalSource.emit('SIGTERM');
        expect(coordinator.shutdownRequested).toBe(true);
        expect(coordinator.reason).toBe('SIGTERM');

        const result = await coordinator.shutdown();
        removeHandlers();

        expect(result.completedWithinBudget).toBe(true);
        expect(result.timedOutComponents).toEqual([]);
        expect(result.failedComponents).toEqual([]);
        expect(exitCodes).toEqual([]);
        expect(app.db.isOpen).toBe(false);
        expect(lifecycleEvents).toContain('closer:cocHttpPool');
        expect(pendingNotifAttemptsOnStop).toBe(0);
        expect(pendingDestAttemptsOnStop).toBe(0);
        expect(openOutageIdOnStop).toBeNull();
        expect(signalSource.listenerCount('SIGTERM')).toBe(0);
    });

    it('enforces the 15-second shutdown budget, logs stuck components, and forces exit(1)', async () => {
        const clock = new FakeClock(1_700_000_000_000);
        const { logger, lines } = createBufferingLogger();
        const exitCodes: number[] = [];

        const coordinator = new ShutdownCoordinator({
            clock,
            logger,
            budgetMs: DEFAULT_SHUTDOWN_BUDGET_MS,
            exit: (code) => exitCodes.push(code),
        });

        // A well-behaved loop that exits on signal abort
        coordinator.startLoop('healthyLoop', async (signal) => {
            await clock.sleep(60_000, signal).catch((err: unknown) => {
                if (err instanceof AbortError) {
                    return;
                }
                throw err;
            });
        });

        // A stuck loop that ignores AbortSignal
        coordinator.startLoop('stuckLoop', async () => {
            await new Promise<void>(() => undefined);
        });

        const shutdownPromise = coordinator.shutdown();
        await Promise.resolve();
        clock.advance(DEFAULT_SHUTDOWN_BUDGET_MS);

        const result = await shutdownPromise;
        expect(result.completedWithinBudget).toBe(false);
        expect(result.timedOutComponents).toEqual(['stuckLoop']);
        expect(exitCodes).toEqual([1]);
        expect(lines.join('')).toContain('stuckLoop');
        expect(lines.join('')).toContain('Shutdown budget (15000ms) exceeded');
    });

    it('returns non-zero exit code from main() on startup error and cleans up opened resources', async () => {
        const dbPath = createTempDbPath();
        const { logger, lines } = createBufferingLogger();
        const signalSource = new FakeSignalSource();
        const closed: string[] = [];

        const cocApiClient = createAbortableCocClient(new FakeClock(), 10, closed);
        const badConfig = makeTestConfig(dbPath, {
            attackGuidesPath: path.join(dbPath, 'missing-guides.json'),
        });

        const code = await main([], {
            logger,
            signalSource,
            loadConfig: () => badConfig,
            applicationOptions: {
                cocApiClient,
            },
        });

        expect(code).toBe(EXIT_FAILURE);
        expect(lines.join('')).toContain('[Main] Application startup failed');
        expect(signalSource.listenerCount('SIGINT')).toBe(0);
        expect(signalSource.listenerCount('SIGTERM')).toBe(0);
    });

    it('returns EXIT_OK (0) from main() on clean SIGINT shutdown and EXIT_FAILURE (1) if a loop crashes', async () => {
        const dbPath = createTempDbPath();
        const clock = new FakeClock(1_700_000_000_000);
        const { logger } = createBufferingLogger();
        const signalSource = new FakeSignalSource();
        const events: string[] = [];

        const mainPromise = main(['custom-config.json'], {
            logger,
            signalSource,
            loadConfig: (argv) => {
                expect(argv).toEqual(['custom-config.json']);
                return makeTestConfig(dbPath);
            },
            applicationOptions: {
                clock,
                cocApiClient: createAbortableCocClient(clock, 1_000, events),
                telegramGateway: {
                    sendMessage: () => Promise.resolve(),
                },
                telegramBotService: {
                    start: async (signal) => {
                        await clock.sleep(60_000, signal).catch(() => undefined);
                    },
                    stop: () => Promise.resolve(),
                },
            },
        });

        await Promise.resolve();
        await Promise.resolve();
        signalSource.emit('SIGINT');

        const exitCode = await mainPromise;
        expect(exitCode).toBe(EXIT_OK);

        // Now verify that an unhandled crash in a background loop triggers shutdown with EXIT_FAILURE
        const crashCoordinator = new ShutdownCoordinator({ clock, logger });
        crashCoordinator.startLoop('crashingWorker', async () => {
            await Promise.resolve();
            throw new Error('boom');
        });
        await crashCoordinator.waitForShutdownRequest();
        const crashResult = await crashCoordinator.shutdown();
        expect(crashCoordinator.crashed).toBe(true);
        expect(crashResult.failedComponents).toContain('crashingWorker');
    });
});
