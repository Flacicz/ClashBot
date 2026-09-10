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

#include "config/ConfigLoader.h"
#include "config/Config.h"
#include "database/TransactionManager.h"

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

        constexpr RetryPolicy databaseRetryPolicy{
            RetryPolicy::defaultMaxAttempts,
            RetryPolicy::defaultInitialDelay};
        constexpr RetryPolicy syncRetryPolicy{
            RetryPolicy::defaultMaxAttempts,
            std::chrono::seconds(2)};

        TransactionManager syncTransactions(
            syncDb.getDBInstance(), databaseRetryPolicy);
        Database telegramDb(config.databasePath);
        TransactionManager telegramTransactions(
            telegramDb.getDBInstance(), databaseRetryPolicy);
        spdlog::info("[DB] Worker database connections initialized successfully.");

        APIClient apiClient(
            std::move(config.supercellToken),
            config.useTunnel,
            std::move(config.baseUrl),
            std::move(config.tunnelBaseUrl)
        );

        TelegramApiClient telegramApiClient(std::move(config.telegramToken));
        telegram::AttackGuideCatalog attackGuideCatalog(config.attackGuidesPath);
        TelegramNotifier telegramNotifier(telegramApiClient);

        TelegramBotService telegramBotService(
            telegramApiClient,
            attackGuideCatalog,
            telegramDb.clans(),
            telegramDb.subscriptions(),
            telegramTransactions);

        PlayerJoinedFormatter playerJoinedFormatter(syncDb.clans());
        PlayerLeftFormatter playerLeftFormatter(syncDb.clans());
        PlayerRoleChangedFormatter playerRoleChangedFormatter(syncDb.clans());
        RaidsEndedFormatter raidsEndedFormatter(syncDb.clans(), syncDb.raids());
        RaidsComparisonFormatter raidsComparisonFormatter(syncDb.clans(), syncDb.raids());
        RaidsViolationsFormatter raidsViolationsFormatter(syncDb.raids());
        ClanwarEndedFormatter clanwarEndedFormatter(syncDb.war());
        ClanwarViolationsFormatter clanwarViolationsFormatter(syncDb.war());
        ClanwarComparisonFormatter clanwarComparisonFormatter(syncDb.war());
        ClanwarRosterFormatter clanwarRosterFormatter(syncDb.clans(), syncDb.war());
        ClanwarsLeagueRoundEndedFormatter clanwarsLeagueRoundEndedFormatter(syncDb.leagueWar(), syncDb.war());
        ClanwarsLeagueRoundViolationsFormatter clanwarsLeagueRoundViolationsFormatter(syncDb.leagueWar(), syncDb.war());

        NotificationService notificationService(
            syncDb.notifications(),
            syncDb.subscriptions(),
            syncTransactions,
            telegramNotifier,
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

        EventDispatcher eventDispatcher(notificationService);

        std::vector<std::unique_ptr<ISyncService>> services;
        services.push_back(std::make_unique<ClanInfoService>(syncDb.clans(), apiClient, syncTransactions));
        services.push_back(std::make_unique<ClanwarService>(syncDb.war(), apiClient, syncTransactions));
        services.push_back(std::make_unique<RaidService>(syncDb.clans(), syncDb.raids(), apiClient, syncTransactions));
        services.push_back(
            std::make_unique<ClanwarLeagueService>(syncDb.war(), syncDb.leagueWar(), apiClient, syncTransactions));

        ClanManager clanManager(
            eventDispatcher,
            std::move(services),
            syncDb.clans(),
            syncRetryPolicy);

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

        std::thread telegramThread;

        try
        {
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
        }
        catch (...)
        {
            clanManager.stop();
            if (syncThread.joinable())
            {
                syncThread.join();
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

        telegramBotService.stopLoop();
        if (telegramThread.joinable())
        {
            telegramThread.join();
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
