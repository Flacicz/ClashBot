#pragma once
#include "ISyncService.h"
#include "api/APIClient.h"
#include "database/Database.h"
#include "database/TransactionManager.h"
#include "domain_events/DomainEventRecorder.h"


class ClanwarLeagueService : public ISyncService
{
    ClanwarRepo& clanwar_repo_;
    ClanwarsLeagueRepo& clanwars_league_repo_;
    APIClient& api_client_;
    TransactionManager& transaction_manager_;
    DomainEventRecorder& domain_event_recorder_;

    static std::vector<ApplicationEvent> generateEvents(
        std::string_view clanTag,
        long long cwlSeasonId,
        const Clanwar& war,
        const ClanwarReference& warReference);

public:
    ClanwarLeagueService(ClanwarRepo& clanwar_repo_,
                         ClanwarsLeagueRepo& clanwars_league_repo_,
                         APIClient& api_client,
                         TransactionManager& transaction_manager,
                         DomainEventRecorder& domain_event_recorder);

    SyncResult updateData(std::string_view tag) override;
    [[nodiscard]] std::string getServiceName() const override;
};
