#include <iostream>
#include <exception>
#include <thread>
#include <string>
#include <memory>
#include <vector>
#include <csignal>
#include <atomic>

#ifdef _WIN32
#include <windows.h>
#endif

#include "database/database.h"
#include "api/apiclient.h"
#include "service/clanManager.h"
#include "config/configLoader.h"
#include "config/config.h"

#include <spdlog/spdlog.h>
#include <spdlog/sinks/stdout_color_sinks.h>
#include <spdlog/sinks/rotating_file_sink.h>
#include <spdlog/common.h>
#include <spdlog/logger.h>

std::atomic<bool> g_shutdown_requested{true};

void signalHandler(int signum) {
    spdlog::info("[Main] Received system signal: {}. Initiating shutdown...", signum);
    g_shutdown_requested.store(true);
}

static void setupLogger() {
    try {
        constexpr size_t MAX_LOG_SIZE = 1024 * 1024 * 5;
        constexpr size_t MAX_LOG_FILES = 3;

        const auto console_sink = std::make_shared<spdlog::sinks::stdout_color_sink_mt>();

        // Создаем sink для файла с ротацией (максимум 5 МБ, храним 3 последних файла)
        const auto file_sink = std::make_shared<spdlog::sinks::rotating_file_sink_mt>("logs/bot.log", MAX_LOG_SIZE, MAX_LOG_FILES);

        // Объединяем их в один логгер
        std::vector<spdlog::sink_ptr> sinks{ console_sink, file_sink };
        const auto logger = std::make_shared<spdlog::logger>("ClashBot", sinks.begin(), sinks.end());

        // Настраиваем формат: [Год-Мес-День Час:Мин:Сек] [Имя логгера] [Уровень] Текст
        logger->set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%n] [%^%l%$] %v");

        // Делаем его логгером по умолчанию
        spdlog::set_default_logger(logger);
        spdlog::set_level(spdlog::level::info); // Фильтруем всё, что ниже INFO
    }
    catch (const spdlog::spdlog_ex& ex) {
        // Если логгер упал, пишем в поток ошибок (cerr)
        std::cerr << "Logger initialization failed: " << ex.what() << std::endl;
    }
}

int main(int argc, char* argv[]) {
#ifdef _WIN32
    SetConsoleOutputCP(65001);
#endif

    setupLogger();

    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);

    spdlog::info("[Main] Starting ClashBot v1.0...");



    try {
        std::string configPath = (argc > 1) ? argv[1] : "../config.json";

        AppConfig config = loadConfig(configPath);

        spdlog::info("[Main] Configuration loaded from '{}'. Target clans: {}", configPath, config.defaultClanTags.size());

        APIClient apiClient(config.supercellToken, config.useTunnel, config.baseUrl, config.tunnelBaseUrl);
        Database db(config.databasePath);
        TelegramNotifier telegramNotifier(config.telegramToken, config.telegramChatId);

        ClanManager clanManager(&db, &apiClient, &telegramNotifier, config.defaultClanTags);

        db.getTableManager().initAllTables();

        std::thread syncThread([&clanManager]() {
            try {
                clanManager.syncAll();
            } catch (const std::exception& e) {
                spdlog::critical("[FATAL] Synchronization thread crashed: {}", e.what());
                g_shutdown_requested.store(true);
            } catch (...) {
                spdlog::critical("[FATAL] Synchronization thread crashed with unknown exception!");
                g_shutdown_requested.store(true);
            }
        });

        spdlog::info("[Main] Bot is running. Press Ctrl+C or send SIGTERM to stop.");

        while (!g_shutdown_requested.load()) {
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
        }

        spdlog::info("[Main] Stopping the service...");

        clanManager.stop();
        if (syncThread.joinable()) {
            syncThread.join();
        }

        spdlog::info("[Main] Shutting down gracefully...");
        return 0;
    }
    catch (const std::exception& e) {
        spdlog::error("[Main] Startup/runtime error: {}", e.what());
        return 1;
    }
}