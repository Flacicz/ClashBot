#pragma once
#include "ISyncService.h"
#include "api/APIClient.h"
#include "database/Database.h"
#include "database/TransactionManager.h"


class ClanwarLeagueService : public ISyncService
{
    ClanwarRepo& clanwar_repo_;
    ClanwarsLeagueRepo& clanwars_league_repo_;
    APIClient& api_client_;
    TransactionManager& transaction_manager_;

public:
    ClanwarLeagueService(ClanwarRepo& clanwar_repo_,
                         ClanwarsLeagueRepo& clanwars_league_repo_,
                         APIClient& api_client,
                         TransactionManager& transaction_manager);

    SyncResult updateData(std::string_view tag) override;
    [[nodiscard]] std::string getServiceName() const override;
};
