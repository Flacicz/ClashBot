#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"

class ClanwarLeagueService {
private:
	Database* db;
	APIClient* apiClient;
public:
	ClanwarLeagueService(Database* db, APIClient* apiClient);

	void updateCWLData();
};
