#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include <string_view>
#include <vector>
#include "../models/models.h"

class RaidService {
private:
	Database* db;
	APIClient* apiClient;
public:
	RaidService(Database* db, APIClient* apiClient);

	void updateRaidData(std::string_view tag);
	void printRaidSlackers(std::string_view tag, const std::vector<PlayerRaidStats>& participants);
};
