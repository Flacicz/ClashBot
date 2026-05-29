#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"
#include <string_view>
#include <vector>

#include "ISyncService.h"
#include "../models/models.h"
#include "notifications/telegramNotifier.h"

class RaidService : public ISyncService
{
    Database& db;
    APIClient& apiClient;

public:
    RaidService(Database& db, APIClient& apiClient);

    SyncResult updateData(std::string_view tag) override;
    [[nodiscard]] std::string getServiceName() const override;
};
