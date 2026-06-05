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

#include "service/ISyncService.h"
#include "service/clanInfoService.h"
#include "service/clanwarService.h"
#include "service/raidService.h"
#include "service/clanwarLeagueService.h"
#include "service/clanManager.h"

#include "reports/RaidReportFormatter.h"
#include "reports/ClanwarLeagueReportFormatter.h"
#include "reports/ClanwarReportFormatter.h"

#include "notifications/telegramNotifier.h"
#include "notifications/notificationService.h"
#include "reports/ClanInfoReportFormatter.h"

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

    spdlog::info("[Main] Starting ClashBot v1.0...");

    try
    {
        std::string configPath = argc > 1 ? argv[1] : "../config.json";

        AppConfig config = loadConfig(configPath);

        spdlog::info("[Main] Configuration loaded from '{}'. Target clans: {}", configPath,
                     config.defaultClanTags.size());

        const auto apiClient = std::make_shared<APIClient>(config.supercellToken, config.useTunnel, config.baseUrl,
                                                           config.tunnelBaseUrl);
        const auto db = std::make_shared<Database>(config.databasePath);

        if (const auto migratorManager = std::make_unique<MigratorManager>(*db); !migratorManager->migrate(
            config.migrationPath))
        {
            spdlog::critical("[DB] Failed to apply migrations. Startup aborted.");
            return EXIT_FAILURE;
        }

        std::map<std::string, std::unique_ptr<IReportFormatter>> formatters;
        formatters["ClanInfoService"] = std::make_unique<ClanInfoReportFormatter>();
        formatters["RaidService"] = std::make_unique<RaidReportFormatter>();
        formatters["ClanwarService"] = std::make_unique<ClanwarReportFormatter>();
        formatters["ClanwarLeagueService"] = std::make_unique<ClanwarLeagueReportFormatter>();

        auto telegramNotifier = std::make_unique<TelegramNotifier>(config.telegramToken, config.telegramChatId);
        auto notificationService = std::make_unique<NotificationService>(
            *db, std::move(telegramNotifier), std::move(formatters));

        std::vector<std::unique_ptr<ISyncService>> services;
        services.push_back(std::make_unique<ClanInfoService>(*db, *apiClient));
        services.push_back(std::make_unique<ClanwarService>(*db, *apiClient));
        services.push_back(std::make_unique<RaidService>(*db, *apiClient));
        services.push_back(std::make_unique<ClanwarLeagueService>(*db, *apiClient));
        ClanManager clanManager(*db, *apiClient, std::move(notificationService),
                                std::move(services), config.defaultClanTags);

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

        spdlog::info("[Main] Shutting down gracefully...");
        return 0;
    }
    catch (const std::exception& e)
    {
        spdlog::error("[Main] Startup/runtime error: {}", e.what());
        return 1;
    }
}
