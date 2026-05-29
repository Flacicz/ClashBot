#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"

#include <string_view>
#include <string>

#include "ISyncService.h"

class ClanwarLeagueService : public ISyncService
{
    Database& db;
    APIClient& apiClient;

public:
    ClanwarLeagueService(Database& db,
                         APIClient& apiClient);

    SyncResult updateData(std::string_view tag) override;
    [[nodiscard]] std::string getServiceName() const override;
};
