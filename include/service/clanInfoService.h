#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include <string_view>

#include "ISyncService.h"

class ClanInfoService : public ISyncService {
private:
	Database* db;
	APIClient* apiClient;
public:
	ClanInfoService(Database* db, APIClient* apiClient);

	void updateData(std::string_view tag) override;
	std::string getServiceName() override;
};
