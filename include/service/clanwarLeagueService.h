#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include "notifications/telegramNotifier.h"

#include <string_view>
#include <vector>
#include <string>

#include "ISyncService.h"
#include "../models/models.h"

class ClanwarLeagueService : public ISyncService {
private:
	Database* db;
	APIClient* apiClient;
	TelegramNotifier* telegramNotifier;
public:
	ClanwarLeagueService(Database* db, APIClient* apiClient, TelegramNotifier* telegramNotifier);

	void updateData(std::string_view tag) override;
	std::string getServiceName() override;

	static std::string buildCWLReport(std::string_view tag, const ClanwarsLeagueRound& round, const std::vector<ClanwarsLeagueAttacks>& attacks);
};
