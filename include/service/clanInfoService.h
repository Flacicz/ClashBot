#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include <string_view>

#include "ISyncService.h"

class ClanInfoService : public ISyncService {
	Database& db;
	APIClient& apiClient;
public:
	ClanInfoService(Database& db, APIClient& apiClient);

	SyncResult updateData(std::string_view tag) override;
	[[nodiscard]] std::string getServiceName() const override;
};
