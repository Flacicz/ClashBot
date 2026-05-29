#include "service/raidService.h"
#include "models/models.h"
#include "database/database.h"
#include "api/apiclient.h"
#include "database/TransactionGuard.h"

#include <exception>
#include <string>
#include <string_view>
#include <stdexcept>
#include <vector>

#include <spdlog/spdlog.h>



RaidService::RaidService(Database& db, APIClient& apiClient)
    : db(db), apiClient(apiClient) {}

std::string RaidService::getServiceName() const
{
    return "RaidService";
}

SyncResult RaidService::updateData(std::string_view tag)
{
    auto svc = "Raid";
    spdlog::info("[Service: {}] Starting Capital Raids data update for {}", svc, tag);

    const auto optRaidData = apiClient.getCompleteRaidData(tag);

    if (!optRaidData.has_value())
    {
        spdlog::warn("[Service: {}] Raid data is currently unavailable for {}", svc, tag);
        return SyncResult::error(getServiceName(), std::string(tag),
            std::format("[Service: {}] Raid data is currently unavailable for {}", svc, tag));
    }

    const auto& [clanRaid, playerRaidSnapshots] = optRaidData.value();

    try
    {
        TransactionGuard tx(db);

        const long long lastRaidId = db.raids().saveCompleteRaidData(clanRaid, playerRaidSnapshots);

        tx.commit();

        spdlog::info("[Service: {}] Raids for {} successfully updated. Participants: {}", svc, clanRaid.startTime,
                     playerRaidSnapshots.size());

        const auto slackers = db.raids().getRaidSlackers(lastRaidId, clanRaid.clanTag);

        return SyncResult::successWithRaidReport(getServiceName(), std::string(tag),
            {lastRaidId, clanRaid.state, slackers}, std::to_string(lastRaidId));
    }
    catch (const std::exception& e)
    {
        spdlog::error("[DB] Transaction failed: {}", e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
