import { type ClashOfClansApi } from '../api/models.js';
import { createCocApiClientFromConfig } from '../api/cocApiClient.js';
import { SystemClock, type Clock } from '../common/clock.js';
import { type AppConfig } from '../config/configSchema.js';
import { Database } from '../database/database.js';
import { MigratorManager } from '../database/migratorManager.js';
import {
    ClansRepo,
    ClanwarRepo,
    ClanwarsLeagueRepo,
    DomainEventsRepo,
    NotificationRepo,
    RaidRepo,
    SubscriptionRepo,
    SyncOutageRepo,
} from '../database/repos/index.js';
import { TransactionManager } from '../database/transactionManager.js';
import { DomainEventPayloadSerializer } from '../domainEvents/domainEventPayloadSerializer.js';
import { DomainEventRecorder } from '../domainEvents/domainEventRecorder.js';
import {
    DomainEventWorker,
    type DomainEventWorkerOptions,
} from '../domainEvents/domainEventWorker.js';
import { type Logger } from '../logging/logger.js';
import { NotificationService } from '../notifications/notificationService.js';
import {
    NotificationWorker,
    type NotificationWorkerOptions,
} from '../notifications/notificationWorker.js';
import { GrammyTelegramGateway, type TelegramGateway } from '../notifications/telegramGateway.js';
import { ClanInfoService } from '../services/clanInfoService.js';
import { ClanManager, type ClanManagerOptions } from '../services/clanManager.js';
import { ClanwarLeagueService } from '../services/clanwarLeagueService.js';
import { ClanwarService } from '../services/clanwarService.js';
import { RaidService } from '../services/raidService.js';
import { type SyncService } from '../services/syncService.js';
import { loadAttackGuideCatalog } from '../telegram/attackGuideCatalog.js';
import { TelegramBotService } from '../telegram/telegramBotService.js';
import { ShutdownCoordinator } from './shutdownCoordinator.js';

export interface ClosableCocApiClient extends Pick<
    ClashOfClansApi,
    | 'getCompleteClanData'
    | 'getCompleteClanwarData'
    | 'getCompleteClanwarsLeagueData'
    | 'getCompleteRaidData'
> {
    close(): Promise<void>;
}

export interface TelegramPollingService {
    start(signal?: AbortSignal): Promise<void>;
    stop(): Promise<void>;
}

export interface ApplicationOptions {
    readonly logger: Logger;
    readonly coordinator?: ShutdownCoordinator;
    readonly clock?: Clock;
    /** Переопределения для тестов: по умолчанию создаются из `config`. */
    readonly cocApiClient?: ClosableCocApiClient;
    readonly telegramGateway?: TelegramGateway;
    readonly telegramBotService?: TelegramPollingService;
    readonly clanManagerOptions?: Omit<ClanManagerOptions, 'clock' | 'logger'>;
    readonly notificationWorkerOptions?: Omit<NotificationWorkerOptions, 'clock' | 'logger'>;
    readonly domainEventWorkerOptions?: Omit<DomainEventWorkerOptions, 'clock' | 'logger'>;
}

export interface Application {
    readonly coordinator: ShutdownCoordinator;
    readonly db: Database;
    readonly cocApiClient: ClosableCocApiClient;
    readonly clanManager: ClanManager;
    readonly notificationService: NotificationService;
    readonly domainEventWorker: DomainEventWorker;
    readonly notificationWorker: NotificationWorker;
    readonly telegramBotService: TelegramPollingService;
    /** Запускает четыре цикла (sync, domain events, notifications, Telegram polling). */
    start(): void;
}

type Cleanup = () => void | Promise<void>;

/**
 * Composition root: одно соединение SQLite, миграции, сервисы, воркеры и Telegram (ADR-0002).
 * При ошибке инициализации уже созданные ресурсы закрываются, исключение пробрасывается выше.
 */
export async function createApplication(
    config: AppConfig,
    options: ApplicationOptions,
): Promise<Application> {
    const { logger } = options;
    const clock = options.clock ?? new SystemClock();
    const coordinator = options.coordinator ?? new ShutdownCoordinator({ clock, logger });
    const cleanups: Cleanup[] = [];

    try {
        const db = new Database(config.databasePath, { logger });
        cleanups.push(() => {
            db.close();
        });

        const transactions = new TransactionManager(db, { logger });
        new MigratorManager(db, transactions, { logger }).migrate(config.migrationPath);
        logger.info('[DB] Database migrations completed successfully');

        const attackGuideCatalog = loadAttackGuideCatalog(config.attackGuidesPath);

        const cocApiClient =
            options.cocApiClient ??
            createCocApiClientFromConfig(config, { signal: coordinator.signal });
        cleanups.push(() => cocApiClient.close());

        const clansRepo = new ClansRepo(db);
        const clanwarRepo = new ClanwarRepo(db);
        const clanwarsLeagueRepo = new ClanwarsLeagueRepo(db);
        const raidRepo = new RaidRepo(db);
        const subscriptionRepo = new SubscriptionRepo(db);
        const domainEventsRepo = new DomainEventsRepo(db);
        const notificationRepo = new NotificationRepo(db);
        const syncOutageRepo = new SyncOutageRepo(db);

        const telegramGateway =
            options.telegramGateway ?? new GrammyTelegramGateway({ token: config.telegramToken });
        const notificationWorker = new NotificationWorker({
            notificationRepo,
            telegramGateway,
            clock,
            logger,
            ...options.notificationWorkerOptions,
        });

        const notificationService = new NotificationService({
            notificationRepo,
            clansRepo,
            clanwarRepo,
            clanwarsLeagueRepo,
            raidRepo,
            subscriptionRepo,
            transactionManager: transactions,
            notificationWorker,
            logger,
        });

        const domainEventWorker = new DomainEventWorker({
            domainEventsRepo,
            transactionManager: transactions,
            materializer: notificationService,
            notificationWorker,
            clock,
            logger,
            ...options.domainEventWorkerOptions,
        });

        const recorder = new DomainEventRecorder(
            new DomainEventPayloadSerializer(),
            subscriptionRepo,
            domainEventsRepo,
        );

        const services: SyncService[] = [
            new ClanInfoService(clansRepo, cocApiClient, transactions, recorder, logger),
            new ClanwarService(clanwarRepo, cocApiClient, transactions, recorder, clock, logger),
            new RaidService(
                clansRepo,
                raidRepo,
                cocApiClient,
                transactions,
                recorder,
                clock,
                logger,
            ),
            new ClanwarLeagueService(
                clanwarRepo,
                clanwarsLeagueRepo,
                cocApiClient,
                transactions,
                recorder,
                clock,
                logger,
            ),
        ];

        const clanManager = new ClanManager(
            services,
            clansRepo,
            syncOutageRepo,
            transactions,
            recorder,
            { clock, logger, ...options.clanManagerOptions },
        );

        const telegramBotService: TelegramPollingService =
            options.telegramBotService ??
            new TelegramBotService({
                telegramToken: config.telegramToken,
                attackGuideCatalog,
                clansRepo,
                subscriptionRepo,
                domainEventsRepo,
                transactionManager: transactions,
                logger,
            });

        coordinator.addCloser('sqlite', () => {
            db.close();
        });
        coordinator.addCloser('cocHttpPool', () => cocApiClient.close());
        coordinator.addStopAction('domainEventWorker', () => {
            domainEventWorker.requestStop();
        });
        coordinator.addStopAction('telegramBotService', () => telegramBotService.stop());
        coordinator.addStopAction('notificationWorker', () => {
            notificationWorker.requestStop();
        });

        logger.info('[Main] All application services initialized successfully');

        return {
            coordinator,
            db,
            cocApiClient,
            clanManager,
            notificationService,
            domainEventWorker,
            notificationWorker,
            telegramBotService,
            start(): void {
                coordinator.startLoop('syncLoop', (signal) => clanManager.syncAll(signal));
                coordinator.startLoop('notificationWorker', (signal) =>
                    notificationWorker.run(signal),
                );
                coordinator.startLoop('telegramBotService', (signal) =>
                    telegramBotService.start(signal),
                );
                coordinator.startLoop('domainEventWorker', (signal) =>
                    domainEventWorker.run(signal),
                );
            },
        };
    } catch (error: unknown) {
        for (const cleanup of cleanups.reverse()) {
            try {
                await cleanup();
            } catch (cleanupError: unknown) {
                logger.warn({ err: cleanupError }, '[Main] Cleanup after startup failure failed');
            }
        }
        throw error;
    }
}
