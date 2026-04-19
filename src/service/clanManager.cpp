#include "service/clanManager.h"
#include "service/clanInfoService.h"
#include "database/database.h"
#include "api/apiclient.h"
#include "service/clanwarService.h"
#include "service/raidService.h"
#include "service/clanwarLeagueService.h"

#include <exception>
#include <chrono>
#include <string>
#include <vector>
#include <memory>
#include <condition_variable>
#include <mutex>

#include <spdlog/spdlog.h>


ClanManager::ClanManager(Database* db, APIClient* apiClient, TelegramNotifier* telegramNotifier, const std::vector<std::string>& targetClans)
	: db(db), apiClient(apiClient), telegramNotifier(telegramNotifier), targetClans(targetClans) {
	this->clanInfoService = std::make_unique<ClanInfoService>(db, apiClient);
	this->cwService = std::make_unique<ClanwarService>(db, apiClient, telegramNotifier);
	this->raidService = std::make_unique<RaidService>(db, apiClient, telegramNotifier);
	this->cwlService = std::make_unique<ClanwarLeagueService>(db, apiClient, telegramNotifier);
}

void ClanManager::syncAll()
{
    while (isRunning.load()) {
        spdlog::info("[Manager] Starting synchronization cycle...");

        for (const std::string& tag : targetClans) {
            if (!isRunning) break;

            try { clanInfoService->updateClanInfo(tag); }
            catch (const std::exception& e) { spdlog::error("[Manager] Service 'ClanInfo' failed for clan {}: {}", tag, e.what()); }

            if (!isRunning) break;

            try { cwService->updateCWData(tag); }
            catch (const std::exception& e) { spdlog::error("[Manager] Service 'CW' failed for clan {}: {}", tag, e.what()); }

            if (!isRunning) break;

            try { raidService->updateRaidData(tag); }
            catch (const std::exception& e) { spdlog::error("[Manager] Service 'Raid' failed for clan {}: {}", tag, e.what()); }

            if (!isRunning) break;

            try { cwlService->updateCWLData(tag); }
            catch (const std::exception& e) { spdlog::error("[Manager] Service 'CWL' failed for clan {}: {}", tag, e.what()); }
        }

        if (!isRunning) break;

        spdlog::info("[Manager] Cycle finished. Sleeping for 30 minutes...");

        std::unique_lock<std::mutex> lock(mtx);
        cv.wait_for(lock, std::chrono::minutes(30), [this]() {return !isRunning.load(); });
    }

    spdlog::info("[Manager] Synchronization cycle stopped gracefully.");
}