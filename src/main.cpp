#include <iostream>
#include <exception>
#include <thread>
#include <string>
#include <csignal>
#include <atomic>
#include <filesystem>

#include <spdlog/spdlog.h>
#include <spdlog/sinks/stdout_color_sinks.h>
#include <spdlog/sinks/rotating_file_sink.h>
#include <spdlog/common.h>
#include <spdlog/logger.h>

#ifdef _WIN32
#include <windows.h>
#endif

#include "database/Database.h"
#include "database/MigratorManager.h"

#include "api/APIClient.h"
#include "common/RetryPolicies.h"

#include "config/ConfigLoader.h"
#include "config/Config.h"
#include "database/TransactionManager.h"
#include "domain_events/DomainEventPayloadDeserializer.h"
#include "domain_events/DomainEventPayloadSerializer.h"
#include "domain_events/DomainEventRecorder.h"
#include "domain_events/DomainEventWorker.h"

#include "service/ISyncService.h"
#include "service/ClanInfoService.h"
#include "service/ClanwarService.h"
#include "service/RaidService.h"
#include "service/ClanwarLeagueService.h"
#include "service/ClanManager.h"

#include "reports/RaidsEndedFormatter.h"
#include "reports/RaidsViolationsFormatter.h"
#include "reports/ClanwarsLeagueRoundEndedFormatter.h"
#include "reports/ClanwarsLeagueRoundViolationsFormatter.h"
#include "reports/ClanwarComparisonFormatter.h"
#include "reports/ClanwarEndedFormatter.h"
#include "reports/ClanwarRosterFormatter.h"
#include "reports/ClanwarViolationsFormatter.h"

#include "notifications/TelegramNotifier.h"
#include "notifications/NotificationService.h"
#include "notifications/NotificationWorker.h"
#include "service/TelegramBotService.h"
#include "telegram/AttackGuideCatalog.h"

std::atomic g_shutdown_requested{false};

void signalHandler(int)
{
    g_shutdown_requested.store(true);
}

static void setupLogger()
{
    try
    {
        constexpr size_t MAX_LOG_SIZE = 1024 * 1024 * 5;
        constexpr size_t MAX_LOG_FILES = 3;

        const auto console_sink = std::make_shared<spdlog::sinks::stdout_color_sink_mt>();

        // Создаем sink для файла с ротацией (максимум 5 МБ, храним 3 последних файла)
        const auto file_sink = std::make_shared<spdlog::sinks::rotating_file_sink_mt>(
            "logs/bot.log", MAX_LOG_SIZE, MAX_LOG_FILES);

        // Объединяем их в один логгер
        std::vector<spdlog::sink_ptr> sinks{console_sink, file_sink};
        const auto logger = std::make_shared<spdlog::logger>("ClashBot", sinks.begin(), sinks.end());

        // Настраиваем формат: [Год-Мес-День Час:Мин:Сек] [Имя логгера] [Уровень] Текст
        logger->set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%n] [%^%l%$] %v");

        // Делаем его логгером по умолчанию
        spdlog::set_default_logger(logger);
        spdlog::set_level(spdlog::level::info); // Фильтруем всё, что ниже INFO
    }
    catch (const spdlog::spdlog_ex& ex)
    {
        // Если логгер упал, пишем в поток ошибок (cerr)
        std::cerr << "Logger initialization failed: " << ex.what() << std::endl;
    }
}

int main(const int argc, char* argv[])
{
#ifdef _WIN32
    SetConsoleOutputCP(65001);
#endif

    setupLogger();

    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);

    spdlog::info("[Main] Starting ClashBot v1.0");

    try
    {
        const std::filesystem::path configPath =
            argc > 1 ? argv[1] : "../config.json";

        const std::filesystem::path envPath =
            std::filesystem::absolute(configPath).parent_path() / ".env";

        if (std::filesystem::exists(envPath))
        {
            Config::loadDotEnv(envPath.string());
        }

        spdlog::info("[Main] Loading configuration from '{}'.", configPath.string());

        auto config = Config::loadConfig(configPath.string());

        spdlog::info("[Main] Configuration loaded successfully.");

        Database syncDb(config.databasePath);

        MigratorManager migratorManager(syncDb);
        if (!migratorManager.migrate(config.migrationPath))
        {
            spdlog::critical("[DB] Failed to apply migrations. Startup aborted.");
            return EXIT_FAILURE;
        }
        spdlog::info("[DB] Database migrations completed successfully.");

        TransactionManager syncTransactions(
            syncDb.getDBInstance(), retryPolicies::databaseRetryPolicy);
        Database telegramDb(config.databasePath);
        TransactionManager telegramTransactions(
            telegramDb.getDBInstance(), retryPolicies::databaseRetryPolicy);
        Database notificationDb(config.databasePath);
        Database domainEventDb(config.databasePath);
        TransactionManager domainEventTransactions(
            domainEventDb.getDBInstance(), retryPolicies::databaseRetryPolicy);
        spdlog::info("[DB] Worker database connections initialized successfully.");

        APIClient apiClient(
            std::move(config.supercellToken),
            config.useTunnel,
            std::move(config.baseUrl),
            std::move(config.tunnelBaseUrl)
        );

        TelegramHttpTransport telegramHttpTransport(std::move(config.telegramToken));
        TelegramApiClient telegramApiClient(telegramHttpTransport);
        telegram::AttackGuideCatalog attackGuideCatalog(config.attackGuidesPath);
        TelegramNotifier telegramNotifier(telegramApiClient);
        NotificationWorker notificationWorker(
            notificationDb.notifications(),
            telegramNotifier);

        TelegramBotService telegramBotService(
            telegramApiClient,
            attackGuideCatalog,
            telegramDb.clans(),
            telegramDb.subscriptions(),
            telegramTransactions);

        PlayerJoinedFormatter playerJoinedFormatter(domainEventDb.clans());
        PlayerLeftFormatter playerLeftFormatter(domainEventDb.clans());
        PlayerRoleChangedFormatter playerRoleChangedFormatter(domainEventDb.clans());
        RaidsEndedFormatter raidsEndedFormatter(domainEventDb.clans(), domainEventDb.raids());
        RaidsComparisonFormatter raidsComparisonFormatter(domainEventDb.clans(), domainEventDb.raids());
        RaidsViolationsFormatter raidsViolationsFormatter(domainEventDb.raids());
        ClanwarEndedFormatter clanwarEndedFormatter(domainEventDb.war());
        ClanwarViolationsFormatter clanwarViolationsFormatter(domainEventDb.war());
        ClanwarComparisonFormatter clanwarComparisonFormatter(domainEventDb.war());
        ClanwarRosterFormatter clanwarRosterFormatter(domainEventDb.clans(), domainEventDb.war());
        ClanwarsLeagueRoundEndedFormatter clanwarsLeagueRoundEndedFormatter(domainEventDb.leagueWar(), domainEventDb.war());
        ClanwarsLeagueRoundViolationsFormatter clanwarsLeagueRoundViolationsFormatter(domainEventDb.leagueWar(), domainEventDb.war());

        NotificationService notificationService(
            domainEventDb.notifications(),
            domainEventDb.subscriptions(),
            domainEventTransactions,
            notificationWorker,
            playerJoinedFormatter,
            playerLeftFormatter,
            playerRoleChangedFormatter,
            raidsEndedFormatter,
            raidsComparisonFormatter,
            raidsViolationsFormatter,
            clanwarEndedFormatter,
            clanwarViolationsFormatter,
            clanwarComparisonFormatter,
            clanwarRosterFormatter,
            clanwarsLeagueRoundEndedFormatter,
            clanwarsLeagueRoundViolationsFormatter
        );

        DomainEventPayloadSerializer domainEventPayloadSerializer;
        DomainEventRecorder domainEventRecorder(
            domainEventPayloadSerializer,
            syncDb.subscriptions(),
            syncDb.domainEvents());
        DomainEventPayloadDeserializer domainEventPayloadDeserializer;
        DomainEventWorker domainEventWorker(
            domainEventDb.domainEvents(),
            domainEventPayloadDeserializer,
            notificationService,
            notificationWorker,
            domainEventTransactions,
            std::chrono::seconds{1},
            retryPolicies::domainEventRetryPolicy);

        std::vector<std::unique_ptr<ISyncService>> services;
        services.push_back(std::make_unique<ClanInfoService>(
            syncDb.clans(),
            apiClient,
            syncTransactions,
            domainEventRecorder));
        services.push_back(std::make_unique<ClanwarService>(
            syncDb.war(),
            apiClient,
            syncTransactions,
            domainEventRecorder));
        services.push_back(std::make_unique<RaidService>(
            syncDb.clans(),
            syncDb.raids(),
            apiClient,
            syncTransactions,
            domainEventRecorder));
        services.push_back(
            std::make_unique<ClanwarLeagueService>(
                syncDb.war(),
                syncDb.leagueWar(),
                apiClient,
                syncTransactions,
                domainEventRecorder));

        ClanManager clanManager(
            std::move(services),
            syncDb.clans(),
            syncDb.syncOutages(),
            syncTransactions,
            domainEventRecorder,
            retryPolicies::syncRetryPolicy);

        spdlog::info("[Main] Synchronization services initialized successfully.");
        spdlog::info("[Main] Telegram service initialized successfully.");

        spdlog::info("[Main] All application services initialized successfully.");

        std::thread syncThread([&clanManager]
        {
            try
            {
                clanManager.syncAll();
            }
            catch (const std::exception& e)
            {
                spdlog::critical("[FATAL] Synchronization thread crashed: {}", e.what());
                g_shutdown_requested.store(true);
            }
            catch (...)
            {
                spdlog::critical("[FATAL] Synchronization thread crashed with unknown exception!");
                g_shutdown_requested.store(true);
            }
        });

        std::thread notificationThread;
        std::thread telegramThread;
        std::thread domainEventThread;

        try
        {
            notificationThread = std::thread(
                [&notificationWorker]
                {
                    try
                    {
                        notificationWorker.run();
                    }
                    catch (const std::exception& error)
                    {
                        spdlog::critical(
                            "[FATAL] Notification worker crashed: {}",
                            error.what());
                        g_shutdown_requested.store(true);
                    }
                    catch (...)
                    {
                        spdlog::critical(
                            "[FATAL] Notification worker crashed with unknown exception!");
                        g_shutdown_requested.store(true);
                    }
                });

            telegramThread = std::thread(
                [&telegramBotService]
                {
                    try
                    {
                        telegramBotService.loop();
                    }
                    catch (const std::exception& error)
                    {
                        spdlog::critical(
                            "[FATAL] Telegram thread crashed: {}",
                            error.what());
                        g_shutdown_requested.store(true);
                    }
                    catch (...)
                    {
                        spdlog::critical(
                            "[FATAL] Telegram thread crashed with unknown exception!");
                        g_shutdown_requested.store(true);
                    }
                }
            );

            domainEventThread = std::thread(
                [&domainEventWorker]
                {
                    try
                    {
                        domainEventWorker.run();
                    }
                    catch (const std::exception& error)
                    {
                        spdlog::critical(
                            "[FATAL] Domain event worker crashed: {}",
                            error.what());
                        g_shutdown_requested.store(true);
                    }
                    catch (...)
                    {
                        spdlog::critical(
                            "[FATAL] Domain event worker crashed with unknown exception!");
                        g_shutdown_requested.store(true);
                    }
                });
        }
        catch (...)
        {
            clanManager.stop();
            if (syncThread.joinable())
            {
                syncThread.join();
            }

            domainEventWorker.requestStop();
            if (domainEventThread.joinable())
            {
                domainEventThread.join();
            }

            telegramBotService.stopLoop();
            if (telegramThread.joinable())
            {
                telegramThread.join();
            }

            notificationWorker.requestStop();
            if (notificationThread.joinable())
            {
                notificationThread.join();
            }
            throw;
        }

        spdlog::info("[Main] Application startup completed successfully.");
        spdlog::info("[Main] Bot is running. Press Ctrl+C or send SIGTERM to stop.");

        while (!g_shutdown_requested.load())
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
        }

        spdlog::info("[Main] Shutdown signal detected. Stopping the service...");

        clanManager.stop();
        if (syncThread.joinable())
        {
            syncThread.join();
        }

        domainEventWorker.requestStop();
        if (domainEventThread.joinable())
        {
            domainEventThread.join();
        }

        telegramBotService.stopLoop();
        if (telegramThread.joinable())
        {
            telegramThread.join();
        }

        notificationWorker.requestStop();
        if (notificationThread.joinable())
        {
            notificationThread.join();
        }

        spdlog::info("[Main] Shutdown completed successfully.");
        return 0;
    }
    catch (const std::exception& e)
    {
        spdlog::critical("[Main] Application startup failed: {}", e.what());
        return EXIT_FAILURE;
    }
    catch (...)
    {
        spdlog::critical("[Main] Application startup failed with unknown exception.");
        return EXIT_FAILURE;
    }
}
