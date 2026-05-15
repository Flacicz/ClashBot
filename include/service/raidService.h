#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include <string_view>
#include <vector>

#include "ISyncService.h"
#include "../models/models.h"
#include "notifications/telegramNotifier.h"

class RaidService : public ISyncService {
private:
	std::unique_ptr<Database> db;
	std::unique_ptr<APIClient> apiClient;
public:
	RaidService(std::unique_ptr<Database> db, std::unique_ptr<APIClient> apiClient);

	SyncResult updateData(std::string_view tag) override;
	std::string getServiceName() const override;
};
