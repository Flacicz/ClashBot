#pragma once
#include "ISyncService.h"
#include "api/apiclient.h"
#include "database/database.h"


class RaidService : public ISyncService
{
    Database& db;
    APIClient& apiClient;

    void ensurePlayersExist(const std::vector<PlayerRaidSnapshot>& players) const;
    static std::vector<DomainEvent> generateEvents(std::string_view clanTag, const std::string& state, long long raidId);

public:
    RaidService(Database& db, APIClient& apiClient);

    SyncResult updateData(std::string_view tag) override;
    [[nodiscard]] std::string getServiceName() const override;
};
