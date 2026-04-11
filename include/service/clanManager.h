#pragma once

#include "../../include/service/clanInfoService.h"
#include "../../include/service/clanwarLeagueService.h"
#include "../../include/service/clanwarService.h"
#include "../../include/service/raidService.h"
#include "../database/database.h"
#include "../api/apiclient.h"

#include <string>
#include <vector>
#include <memory>
#include <atomic>

class ClanManager {
private:
	Database* db;
	APIClient* apiClient;

	std::unique_ptr<ClanInfoService> clanInfoService;
	std::unique_ptr<ClanwarService> cwService;
	std::unique_ptr<RaidService> raidService;
	std::unique_ptr<ClanwarLeagueService> cwlService;

	std::vector<std::string> targetClans;

	std::atomic<bool> isRunning{true};
public:
	ClanManager(Database* db, APIClient* apiClient,const std::vector<std::string>& targetClans);
	~ClanManager() = default;

	void syncAll();

	void stop() { isRunning.store(false); };
};