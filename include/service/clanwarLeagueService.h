#pragma once

#include "../database/database.h"
#include "../api/apiclient.h"

#include <string_view>
#include <vector>
#include <string>

#include "ISyncService.h"
#include "../models/models.h"

class ClanwarLeagueService : public ISyncService
{
private:
    std::unique_ptr<Database> db;
    std::unique_ptr<APIClient> apiClient;

public:
    ClanwarLeagueService(std::unique_ptr<Database> db,
                         std::unique_ptr<APIClient> apiClient);

    SyncResult updateData(std::string_view tag) override;
    std::string getServiceName() const override;

    static std::string buildCWLReport(std::string_view tag, const ClanwarsLeagueRound& round,
                                      const std::vector<ClanwarsLeagueAttacks>& attacks);
};
