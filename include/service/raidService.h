#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include <string_view>
#include <vector>
#include "../models/models.h"
#include "notifications/telegramNotifier.h"

class RaidService {
private:
	Database* db;
	APIClient* apiClient;
	TelegramNotifier* telegramNotifier;
public:
	RaidService(Database* db, APIClient* apiClient, TelegramNotifier* telegramNotifier);

	void updateRaidData(std::string_view tag);
	std::string buildRaidReport(std::string_view tag, const std::vector<PlayerRaidStats>& participants);
};
