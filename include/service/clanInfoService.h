#pragma once
#include "ISyncService.h"
#include <api/apiclient.h>
#include <database/database.h>

class APIClient;
class Database;

class ClanInfoService : public ISyncService {
	Database& db;
	APIClient& apiClient;
public:
	ClanInfoService(Database& db, APIClient& apiClient);

	SyncResult updateData(std::string_view tag) override;
	[[nodiscard]] std::string getServiceName() const override;
};
