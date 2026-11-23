import { loadConfigFromArgs } from './config/loadConfig.js';
import { type AppConfig } from './config/configSchema.js';
import { createLogger, type Logger } from './logging/logger.js';
import { createApplication, type Application, type ApplicationOptions } from './app/application.js';
import { ShutdownCoordinator, type SignalSource } from './app/shutdownCoordinator.js';

export interface MainDependencies {
    readonly logger?: Logger;
    readonly coordinator?: ShutdownCoordinator;
    readonly signalSource?: SignalSource;
    readonly loadConfig?: (argv: readonly string[]) => AppConfig;
    readonly createApplication?: (
        config: AppConfig,
        options: ApplicationOptions,
    ) => Promise<Application>;
    readonly applicationOptions?: Omit<ApplicationOptions, 'logger' | 'coordinator'>;
}

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;

/**
 * Точка входа: `node dist/cli.js [config.json]`.
 * Возвращает код выхода процесса: 0 — штатная остановка, 1 — ошибка старта, авария цикла
 * или превышение бюджета остановки.
 */
export async function main(argv: readonly string[], deps: MainDependencies = {}): Promise<number> {
    const logger = deps.logger ?? createLogger();
    const coordinator =
        deps.coordinator ??
        new ShutdownCoordinator({
            logger,
            ...(deps.applicationOptions?.clock !== undefined
                ? { clock: deps.applicationOptions.clock }
                : {}),
        });
    logger.info('[Main] Starting ClashBot');

    const removeSignalHandlers = coordinator.installSignalHandlers(deps.signalSource);
    try {
        const load = deps.loadConfig ?? ((args: readonly string[]) => loadConfigFromArgs(args));
        const config = load(argv);
        logger.info('[Main] Configuration loaded successfully');

        const create = deps.createApplication ?? createApplication;
        const app = await create(config, {
            ...deps.applicationOptions,
            logger,
            coordinator,
        });
        app.start();
        logger.info('[Main] Application startup completed successfully');
        logger.info('[Main] Bot is running. Press Ctrl+C or send SIGTERM to stop');

        await coordinator.waitForShutdownRequest();
        logger.info({ reason: coordinator.reason }, '[Main] Stopping the service');

        const result = await coordinator.shutdown();
        if (!result.completedWithinBudget || coordinator.crashed) {
            return EXIT_FAILURE;
        }
        logger.info('[Main] Shutdown completed successfully');
        return EXIT_OK;
    } catch (error: unknown) {
        logger.fatal({ err: error }, '[Main] Application startup failed');
        await coordinator.shutdown().catch(() => undefined);
        return EXIT_FAILURE;
    } finally {
        removeSignalHandlers();
    }
}
