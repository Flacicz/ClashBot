#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"

class ClanInfoService {
private:
	Database* db;
	APIClient* apiClient;
public:
	ClanInfoService(Database* db, APIClient* apiClient);

	void updateClanInfo();
};
