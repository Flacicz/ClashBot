#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"

class RaidService {
private:
	Database* db;
	APIClient* apiClient;
public:
	RaidService(Database* db, APIClient* apiClient);

	void updateRaidData();
};
