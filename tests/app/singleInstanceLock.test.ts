import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
    EXIT_FAILURE,
    EXIT_OK,
    FakeClock,
    InstanceLockError,
    ShutdownCoordinator,
    createApplication,
    createLogger,
    main,
    resolveInstanceLockPath,
    type AppConfig,
    type Application,
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

function createStubCocClient(onCall?: () => void): ClosableCocApiClient {
    return {
        getCompleteClanData(): Promise<CompleteClanData | null> {
            onCall?.();
            return Promise.resolve(null);
        },
        getCompleteClanwarData(): Promise<CompleteClanwarData | null> {
            onCall?.();
            return Promise.resolve(null);
        },
        getCompleteClanwarsLeagueData(): Promise<CompleteClanwarsLeagueData | null> {
            onCall?.();
            return Promise.resolve(null);
        },
        getCompleteRaidData(): Promise<CompleteRaidData | null> {
            onCall?.();
            return Promise.resolve(null);
        },
        close(): Promise<void> {
            return Promise.resolve();
        },
    };
}

function createStubPollingService(clock: FakeClock, onStart?: () => void): TelegramPollingService {
    return {
        async start(signal?: AbortSignal): Promise<void> {
            onStart?.();
            await clock.sleep(60_000, signal).catch(() => undefined);
        },
        stop(): Promise<void> {
            return Promise.resolve();
        },
    };
}

const CHILD_HOLD_LOCK_AND_WAL_SCRIPT = [
    'import BetterSqlite3 from "better-sqlite3";',
    'const dbPath = process.argv[1];',
    'const lockPath = process.argv[2];',
    'const lockDb = new BetterSqlite3(lockPath, { timeout: 0 });',
    'lockDb.pragma("busy_timeout = 0");',
    'lockDb.pragma("locking_mode = EXCLUSIVE");',
    'lockDb.exec("BEGIN EXCLUSIVE");',
    'const mainDb = new BetterSqlite3(dbPath);',
    'mainDb.pragma("journal_mode = WAL");',
    'process.stdout.write("HOLDING\\n");',
    'setInterval(() => { void lockDb.open; void mainDb.open; }, 1000);',
].join('\n');

function spawnChildHolder(dbPath: string, lockPath: string): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ['--input-type=module', '-e', CHILD_HOLD_LOCK_AND_WAL_SCRIPT, dbPath, lockPath],
            { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        let settled = false;

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
            if (!settled && stdout.includes('HOLDING')) {
                settled = true;
                resolve(child);
            }
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            if (!settled) {
                settled = true;
                reject(error);
            }
        });
        child.on('exit', (code) => {
            if (!settled) {
                settled = true;
                reject(
                    new Error(
                        `Child holder exited prematurely (code=${String(code)}, stdout=${stdout.trim()}, stderr=${stderr.trim()})`,
                    ),
                );
            }
        });
    });
}

function waitForExit(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        child.once('exit', () => {
            resolve();
        });
    });
}

describe('Single-instance database lock in application lifecycle', () => {
    const tempDirs: string[] = [];
    const apps: Application[] = [];
    const children: ChildProcess[] = [];

    function createTempDbPath(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clashbot-single-instance-'));
        tempDirs.push(dir);
        return path.join(dir, 'database.sqlite');
    }

    afterEach(async () => {
        for (const child of children.splice(0)) {
            if (child.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL');
                await waitForExit(child);
            }
        }
        for (const app of apps.splice(0).reverse()) {
            await app.coordinator.shutdown();
        }
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('rejects a second createApplication on an open WAL database while still allowing online SQLite backup, then succeeds after graceful shutdown', async () => {
        const dbPath = createTempDbPath();
        const clock = new FakeClock(1_700_000_000_000);
        const { logger } = createBufferingLogger();
        const telegramGateway: TelegramGateway = {
            sendMessage: () => Promise.resolve(),
        };

        const app1 = await createApplication(makeTestConfig(dbPath), {
            logger,
            clock,
            cocApiClient: createStubCocClient(),
            telegramGateway,
            telegramBotService: createStubPollingService(clock),
        });
        apps.push(app1);

        expect(app1.db.connection.pragma('journal_mode', { simple: true })).toBe('wal');
        expect(app1.instanceLock.isLocked).toBe(true);

        // Online backup (mirroring scripts/backup-sqlite.sh) works concurrently with running instance
        const backupPath = path.join(path.dirname(dbPath), 'backup.sqlite');
        const backupReader = new BetterSqlite3(dbPath, { readonly: true, timeout: 5000 });
        try {
            await backupReader.backup(backupPath);
        } finally {
            backupReader.close();
        }
        const verified = new BetterSqlite3(backupPath, { readonly: true });
        try {
            expect(verified.pragma('integrity_check', { simple: true })).toBe('ok');
            const migrations = verified
                .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
                .get() as { count: number };
            expect(migrations.count).toBe(16);
        } finally {
            verified.close();
        }

        // Second instance must fail BEFORE creating or starting any loops
        let secondPollingStarted = false;
        let secondCocCalled = false;
        const secondCoordinator = new ShutdownCoordinator({ clock, logger });
        await expect(
            createApplication(makeTestConfig(dbPath), {
                logger,
                coordinator: secondCoordinator,
                clock,
                cocApiClient: createStubCocClient(() => {
                    secondCocCalled = true;
                }),
                telegramGateway,
                telegramBotService: createStubPollingService(clock, () => {
                    secondPollingStarted = true;
                }),
            }),
        ).rejects.toThrow(InstanceLockError);

        expect(secondPollingStarted).toBe(false);
        expect(secondCocCalled).toBe(false);

        // Graceful shutdown closes SQLite first and releases the lock last
        await app1.coordinator.shutdown();
        apps.pop();
        expect(app1.db.isOpen).toBe(false);
        expect(app1.instanceLock.isLocked).toBe(false);

        // A new instance starts cleanly without manually removing database.sqlite.lock
        const app2 = await createApplication(makeTestConfig(dbPath), {
            logger,
            clock,
            cocApiClient: createStubCocClient(),
            telegramGateway,
            telegramBotService: createStubPollingService(clock),
        });
        apps.push(app2);
        expect(app2.db.isOpen).toBe(true);
        expect(app2.instanceLock.isLocked).toBe(true);
    });

    it('returns EXIT_FAILURE from a second main() before starting loops while the first main() keeps running cleanly', async () => {
        const dbPath = createTempDbPath();
        const clock = new FakeClock(1_700_000_000_000);
        const firstLogs = createBufferingLogger();
        const secondLogs = createBufferingLogger();
        const firstSignals = new FakeSignalSource();
        const secondSignals = new FakeSignalSource();

        let firstPollingStarts = 0;
        let secondPollingStarts = 0;
        const telegramGateway: TelegramGateway = {
            sendMessage: () => Promise.resolve(),
        };

        const firstMain = main([], {
            logger: firstLogs.logger,
            signalSource: firstSignals,
            loadConfig: () => makeTestConfig(dbPath),
            applicationOptions: {
                clock,
                cocApiClient: createStubCocClient(),
                telegramGateway,
                telegramBotService: createStubPollingService(clock, () => {
                    firstPollingStarts += 1;
                }),
            },
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(firstPollingStarts).toBe(1);

        const secondExitCode = await main([], {
            logger: secondLogs.logger,
            signalSource: secondSignals,
            loadConfig: () => makeTestConfig(dbPath),
            applicationOptions: {
                clock,
                cocApiClient: createStubCocClient(),
                telegramGateway,
                telegramBotService: createStubPollingService(clock, () => {
                    secondPollingStarts += 1;
                }),
            },
        });

        expect(secondExitCode).toBe(EXIT_FAILURE);
        expect(secondPollingStarts).toBe(0);
        const secondLogOutput = secondLogs.lines.join('');
        expect(secondLogOutput).toContain('[Main] Application startup failed');
        expect(secondLogOutput).toContain('Another ClashBot instance is already using database');

        // Stop the first instance cleanly, then verify a subsequent main() succeeds
        firstSignals.emit('SIGTERM');
        expect(await firstMain).toBe(EXIT_OK);

        const thirdLogs = createBufferingLogger();
        const thirdSignals = new FakeSignalSource();
        let thirdPollingStarts = 0;
        const thirdMain = main([], {
            logger: thirdLogs.logger,
            signalSource: thirdSignals,
            loadConfig: () => makeTestConfig(dbPath),
            applicationOptions: {
                clock,
                cocApiClient: createStubCocClient(),
                telegramGateway,
                telegramBotService: createStubPollingService(clock, () => {
                    thirdPollingStarts += 1;
                }),
            },
        });

        await Promise.resolve();
        await Promise.resolve();
        expect(thirdPollingStarts).toBe(1);

        thirdSignals.emit('SIGINT');
        expect(await thirdMain).toBe(EXIT_OK);
    });

    it('releases the acquired lock if createApplication fails later during startup', async () => {
        const dbPath = createTempDbPath();
        const clock = new FakeClock(1_700_000_000_000);
        const { logger } = createBufferingLogger();

        const badConfig = makeTestConfig(dbPath, {
            attackGuidesPath: path.join(path.dirname(dbPath), 'missing-attack-guides.json'),
        });

        await expect(
            createApplication(badConfig, {
                logger,
                clock,
                cocApiClient: createStubCocClient(),
                telegramGateway: { sendMessage: () => Promise.resolve() },
                telegramBotService: createStubPollingService(clock),
            }),
        ).rejects.toThrow();

        // Subsequent valid startup must not be blocked by the failed startup
        const app = await createApplication(makeTestConfig(dbPath), {
            logger,
            clock,
            cocApiClient: createStubCocClient(),
            telegramGateway: { sendMessage: () => Promise.resolve() },
            telegramBotService: createStubPollingService(clock),
        });
        apps.push(app);
        expect(app.instanceLock.isLocked).toBe(true);
    });

    it('rejects startup while another OS process holds the lock and starts cleanly after that process crashes (SIGKILL) with a stale lock file left on disk', async () => {
        const dbPath = createTempDbPath();
        const lockPath = resolveInstanceLockPath(dbPath);
        if (lockPath === null) {
            throw new Error('Expected non-null lockPath for file-backed DB');
        }

        const holder = await spawnChildHolder(dbPath, lockPath);
        children.push(holder);

        const clock = new FakeClock(1_700_000_000_000);
        const { logger, lines } = createBufferingLogger();
        let pollingStarts = 0;

        // While the other OS process is running, main() refuses to start before launching any loops
        const blockedExit = await main([], {
            logger,
            signalSource: new FakeSignalSource(),
            loadConfig: () => makeTestConfig(dbPath),
            applicationOptions: {
                clock,
                cocApiClient: createStubCocClient(),
                telegramGateway: { sendMessage: () => Promise.resolve() },
                telegramBotService: createStubPollingService(clock, () => {
                    pollingStarts += 1;
                }),
            },
        });
        expect(blockedExit).toBe(EXIT_FAILURE);
        expect(pollingStarts).toBe(0);
        expect(lines.join('')).toContain('INSTANCE_LOCK_ERROR');

        // Kill the holder abruptly without graceful cleanup (stale lock file remains on disk)
        holder.kill('SIGKILL');
        await waitForExit(holder);
        expect(fs.existsSync(lockPath)).toBe(true);

        // Next application starts immediately without manual cleanup
        const app = await createApplication(makeTestConfig(dbPath), {
            logger,
            clock,
            cocApiClient: createStubCocClient(),
            telegramGateway: { sendMessage: () => Promise.resolve() },
            telegramBotService: createStubPollingService(clock),
        });
        apps.push(app);
        expect(app.db.isOpen).toBe(true);
        expect(app.instanceLock.isLocked).toBe(true);
    });
});
