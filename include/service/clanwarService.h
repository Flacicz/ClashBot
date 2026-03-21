#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include "../models/models.h"

#include <vector>

class ClanwarService {
private:
	Database* db;
	APIClient* apiClient;
public:
	ClanwarService(Database* db, APIClient* apiClient);

	void updateCWData();
	void printCWSlackers(const std::vector<ClanwarAttack>& attacks);
};
