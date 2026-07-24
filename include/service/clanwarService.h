#pragma once
#include "ISyncService.h"
#include "api/apiclient.h"
#include "database/database.h"
#include "database/TransactionManager.h"


class ClanwarService : public ISyncService
{
    ClanwarRepo& clanwar_repo_;
    APIClient& api_client_;
    TransactionManager& transaction_manager_;

    static std::vector<ApplicationEvent> generateEvents(std::string_view clanTag, const std::string& state,
                                                   const InsertedWarResult& insertedWarResult);

public:
    ClanwarService(ClanwarRepo& clanwar_repo,
                   APIClient& api_client,
                   TransactionManager& transaction_manager);

    SyncResult updateData(std::string_view tag) override;
    [[nodiscard]] std::string getServiceName() const override;
};
