#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include <string_view>

class ClanwarLeagueService {
private:
	Database* db;
	APIClient* apiClient;
public:
	ClanwarLeagueService(Database* db, APIClient* apiClient);

	void updateCWLData(std::string_view tag);
};
