#pragma once
#include "ISyncService.h"
#include "api/apiclient.h"
#include "database/database.h"
#include "database/TransactionManager.h"


class RaidService : public ISyncService
{
    ClansRepo& clans_repo_;
    RaidRepo& raid_repo_;
    APIClient& api_client_;
    TransactionManager& transaction_manager_;

    void ensurePlayersExist(const std::vector<PlayerRaidSnapshot>& players) const;
    static std::vector<ApplicationEvent> generateEvents(std::string_view clanTag, const std::string& state,
                                                        long long raidId);

public:
    RaidService(ClansRepo& clans_repo,
                RaidRepo& raid_repo,
                APIClient& api_client,
                TransactionManager& transaction_manager);

    SyncResult updateData(std::string_view tag) override;
    [[nodiscard]] std::string getServiceName() const override;
};
