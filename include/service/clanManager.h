#pragma once

#include "../../include/service/clanInfoService.h"
#include "../../include/service/clanwarLeagueService.h"
#include "../../include/service/clanwarService.h"
#include "../../include/service/raidService.h"
#include "../database/database.h"
#include "../api/apiclient.h"
#include "notifications/telegramNotifier.h"

#include <string>
#include <vector>
#include <memory>
#include <atomic>
#include <condition_variable>
#include <mutex>

class ClanManager {
private:
	Database* db;
	APIClient* apiClient;

	std::unique_ptr<ClanInfoService> clanInfoService;
	std::unique_ptr<ClanwarService> cwService;
	std::unique_ptr<RaidService> raidService;
	std::unique_ptr<ClanwarLeagueService> cwlService;
	std::unique_ptr<TelegramNotifier> telegramNotifier;

	std::vector<std::string> targetClans;

	std::mutex mtx;
	std::condition_variable cv;
	std::atomic<bool> isRunning{true};
public:
	ClanManager(Database* db, APIClient* apiClient, TelegramNotifier* telegramNotifier, const std::vector<std::string>& targetClans);
	~ClanManager() = default;

	void syncAll();

	void stop()
	{
		isRunning.store(false);
		cv.notify_all();
	};

};