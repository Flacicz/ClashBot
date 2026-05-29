#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include "notifications/telegramNotifier.h"

#include <string_view>
#include <vector>
#include <string>

#include "ISyncService.h"
#include "../models/models.h"

class ClanwarService : public ISyncService
{
    Database& db;
    APIClient& apiClient;

public:
    ClanwarService(Database& db,
                   APIClient& apiClient);

    SyncResult updateData(std::string_view tag) override;
    [[nodiscard]] std::string getServiceName() const override;
};
