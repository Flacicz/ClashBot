#pragma once
#include "ISyncService.h"
#include <api/APIClient.h>
#include <database/Database.h>

#include "database/TransactionManager.h"

class ClanInfoService : public ISyncService
{
    ClansRepo& clans_repo_;
    APIClient& api_client_;
    TransactionManager& transaction_manager_;

    [[nodiscard]] MembershipChanges detectMembershipChanges(
        std::string_view clanTag, std::vector<Player> players) const;
    [[nodiscard]] RoleChanges detectRoleChanges(const std::string& clanTag,
                                                const std::vector<PlayerSnapshot>& currentPlayers) const;

    static std::vector<ApplicationEvent> generateEvents(const MembershipChanges& changes,
                                                   const RoleChanges& roleChanges);

public:
    ClanInfoService(ClansRepo& clans_repo, APIClient& api_client, TransactionManager& transaction_manager);

    SyncResult updateData(std::string_view tag) override;
    [[nodiscard]] std::string getServiceName() const override;
};
