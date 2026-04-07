#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"

#include <string_view>
#include <vector>
#include "../models/models.h"

class ClanwarService {
private:
	Database* db;
	APIClient* apiClient;
public:
	ClanwarService(Database* db, APIClient* apiClient);

	void updateCWData(std::string_view tag);
	void printCWSlackers(std::string_view tag, const std::vector<ClanwarAttack>& attacks);
};
