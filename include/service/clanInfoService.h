#pragma once
#include "ISyncService.h"
#include <api/apiclient.h>
#include <database/database.h>

class APIClient;
class Database;

class ClanInfoService : public ISyncService
{
    Database& db;
    APIClient& apiClient;

    [[nodiscard]] MembershipChanges detectMembershipChanges(
        std::string_view clanTag, std::vector<Player>& players) const;
    [[nodiscard]] RoleChanges detectRoleChanges(const std::string& clanTag,
                                                const std::vector<PlayerSnapshot>& currentPlayers) const;

    static std::vector<DomainEvent> generateEvents(const MembershipChanges& changes,
                                                   const RoleChanges& roleChanges);

public:
    ClanInfoService(Database& db, APIClient& apiClient);

    SyncResult updateData(std::string_view tag) override;
    [[nodiscard]] std::string getServiceName() const override;
};
