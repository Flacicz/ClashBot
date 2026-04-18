#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include "notifications/telegramNotifier.h"

#include <string_view>
#include <vector>
#include <string>
#include "../models/models.h"

class ClanwarService {
private:
	Database* db;
	APIClient* apiClient;
	TelegramNotifier* telegramNotifier;
public:
	ClanwarService(Database* db, APIClient* apiClient, TelegramNotifier* telegramNotifier);

	void updateCWData(std::string_view tag);
	std::string buildCWReport(std::string_view tag, const std::vector<ClanwarAttack>& attacks, const ClanWar& summary);
};
