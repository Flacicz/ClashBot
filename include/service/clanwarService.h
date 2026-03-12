#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"

class ClanwarService {
private:
	Database* db;
	APIClient* apiClient;
public:
	ClanwarService(Database* db, APIClient* apiClient);

	void updateCWData();
};
