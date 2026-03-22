#pragma once

#include "../../include/service/clanInfoService.h"
#include "../../include/service/clanwarLeagueService.h"
#include "../../include/service/clanwarService.h"
#include "../../include/service/raidService.h"
#include "../database/database.h"
#include "../api/apiclient.h"

class ClanManager {
private:
	ClanInfoService* clanInfoService;
	ClanwarService* cwService;
	RaidService* raidService;
	ClanwarLeagueService* cwlService;
public:
	ClanManager(Database* db, APIClient* apiClient);
	~ClanManager();

	void syncAll();
	void logTime(const std::string& message);
};