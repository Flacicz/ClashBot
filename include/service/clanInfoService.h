#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include <string_view>

class ClanInfoService {
private:
	Database* db;
	APIClient* apiClient;
public:
	ClanInfoService(Database* db, APIClient* apiClient);

	void updateClanInfo(std::string_view tag);
};
