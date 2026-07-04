#pragma once
#include "ISyncService.h"
#include "api/apiclient.h"
#include "database/database.h"


class ClanwarService : public ISyncService
{
    Database& db;
    APIClient& apiClient;

    static std::vector<DomainEvent> generateEvents(std::string_view clanTag, const std::string& state,
                                                   const InsertedWarResult& insertedWarResult);

public:
    ClanwarService(Database& db,
                   APIClient& apiClient);

    SyncResult updateData(std::string_view tag) override;
    [[nodiscard]] std::string getServiceName() const override;
};
