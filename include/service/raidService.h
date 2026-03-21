#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include "../models/models.h"

class RaidService {
private:
	Database* db;
	APIClient* apiClient;
public:
	RaidService(Database* db, APIClient* apiClient);

	void updateRaidData();
	void printRaidSlackers(const std::vector<PlayerRaidStats>& slackers);
};
