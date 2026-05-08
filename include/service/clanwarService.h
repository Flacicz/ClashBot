#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include "notifications/telegramNotifier.h"

#include <string_view>
#include <vector>
#include <string>

#include "ISyncService.h"
#include "../models/models.h"

class ClanwarService : public ISyncService {
private:
	Database* db;
	APIClient* apiClient;
	TelegramNotifier* telegramNotifier;
public:
	ClanwarService(Database* db, APIClient* apiClient, TelegramNotifier* telegramNotifier);

	void updateData(std::string_view tag) override;
	std::string getServiceName() override;

	std::string buildCWReport(std::string_view tag, const std::vector<ClanwarAttack>& attacks, const ClanWar& summary) const;
};
