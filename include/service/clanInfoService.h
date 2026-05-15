#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include <string_view>

#include "ISyncService.h"

class ClanInfoService : public ISyncService {
private:
	std::unique_ptr<Database> db;
	std::unique_ptr<APIClient> apiClient;
public:
	ClanInfoService(std::unique_ptr<Database> db, std::unique_ptr<APIClient> apiClient);

	SyncResult updateData(std::string_view tag) override;
	std::string getServiceName() const override;
};
