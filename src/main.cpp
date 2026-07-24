#include <iostream>
#include <exception>
#include <thread>
#include <string>
#include <csignal>
#include <atomic>

#include <spdlog/spdlog.h>
#include <spdlog/sinks/stdout_color_sinks.h>
#include <spdlog/sinks/rotating_file_sink.h>
#include <spdlog/common.h>
#include <spdlog/logger.h>

#ifdef _WIN32
#include <windows.h>
#endif

#include "database/database.h"
#include "database/migratorManager.h"

#include "api/apiclient.h"

#include "config/configLoader.h"
#include "config/config.h"
#include "database/TransactionManager.h"

#include "service/ISyncService.h"
#include "service/clanInfoService.h"
#include "service/clanwarService.h"
#include "service/raidService.h"
#include "service/clanwarLeagueService.h"
#include "service/clanManager.h"

#include "reports/RaidsEndedFormatter.h"
#include "reports/ClanwarsLeagueRoundEndedFormatter.h"
#include "reports/ClanwarEndedFormatter.h"

#include "notifications/telegramNotifier.h"
#include "notifications/notificationService.h"

std::atomic g_shutdown_requested{false};

void signalHandler(int signum)
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
        std::string configPath = argc > 1 ? argv[1] : "../config.json";

        spdlog::info("[Main] Loading configuration from '{}'.", configPath);

        AppConfig config = loadConfig(configPath);

        spdlog::info("[Main] Configuration loaded successfully.");

        auto apiClient = APIClient(
            std::move(config.supercellToken),
            config.useTunnel,
            std::move(config.baseUrl),
            std::move(config.tunnelBaseUrl)
        );

        auto db = Database(
            std::move(config.databasePath)
        );

        auto migratorManager = MigratorManager(db);
        if (!migratorManager.migrate(config.migrationPath))
        {
            spdlog::critical("[DB] Failed to apply migrations. Startup aborted.");
            return EXIT_FAILURE;
        }

        auto transactions = TransactionManager(db.getDBInstance());

        spdlog::info("[DB] Database migrations completed successfully.");

        auto targetClans = db.clans().getTrackedClans();

        spdlog::info("[Main] Target clans: {}", targetClans.size());


        auto telegramNotifier = TelegramNotifier(std::move(config.telegramToken));
        PlayerJoinedFormatter playerJoinedFormatter(db.clans());
        PlayerLeftFormatter playerLeftFormatter(db.clans());
        RaidsEndedFormatter raidsEndedFormatter(db.clans(), db.raids());
        ClanwarEndedFormatter clanwarEndedFormatter(db.war());
        ClanwarsLeagueRoundEndedFormatter clanwarsLeagueRoundEndedFormatter(db.leagueWar(), db.war());

        auto notificationService = NotificationService(
            db.notifications(),
            db.subscriptions(),
            std::move(telegramNotifier),
            playerJoinedFormatter,
            playerLeftFormatter,
            raidsEndedFormatter,
            clanwarEndedFormatter,
            clanwarsLeagueRoundEndedFormatter
        );

        auto eventDispatcher = EventDispatcher(notificationService);

        std::vector<std::unique_ptr<ISyncService>> services;
        services.push_back(std::make_unique<ClanInfoService>(db.clans(), apiClient, transactions));
        services.push_back(std::make_unique<ClanwarService>(db.war(), apiClient, transactions));
        services.push_back(std::make_unique<RaidService>(db.clans(), db.raids(), apiClient, transactions));
        services.push_back(std::make_unique<ClanwarLeagueService>(db.war(), db.leagueWar(), apiClient, transactions));

        ClanManager clanManager(eventDispatcher, std::move(services), std::move(targetClans));

        spdlog::info("[Main] All application services initialized successfully.");

        spdlog::info("[Main] Application startup completed successfully.");

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
