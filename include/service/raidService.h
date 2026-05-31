#pragma once
#include "ISyncService.h"
#include "api/apiclient.h"
#include "database/database.h"


class RaidService : public ISyncService
{
    Database& db;
    APIClient& apiClient;

public:
    RaidService(Database& db, APIClient& apiClient);

    SyncResult updateData(std::string_view tag) override;
    [[nodiscard]] std::string getServiceName() const override;
};
