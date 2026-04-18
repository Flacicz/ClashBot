#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include "notifications/telegramNotifier.h"

#include <string_view>
#include <vector>
#include <string>
#include "../models/models.h"

class ClanwarLeagueService {
private:
	Database* db;
	APIClient* apiClient;
	TelegramNotifier* telegramNotifier;
public:
	ClanwarLeagueService(Database* db, APIClient* apiClient, TelegramNotifier* telegramNotifier);

	void updateCWLData(std::string_view tag);
	std::string buildCWLReport(std::string_view tag, const ClanwarsLeagueRound& round, const std::vector<ClanwarsLeagueAttacks>& attacks);
};
