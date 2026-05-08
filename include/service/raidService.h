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
	Database* db;
	APIClient* apiClient;
	TelegramNotifier* telegramNotifier;
public:
	RaidService(Database* db, APIClient* apiClient, TelegramNotifier* telegramNotifier);

	void updateData(std::string_view tag) override;
	std::string getServiceName() override;

	std::string buildRaidReport(std::string_view tag, const std::vector<PlayerRaidStats>& participants) const;
};
