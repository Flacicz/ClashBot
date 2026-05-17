#include "service/raidService.h"
#include "models/models.h"
#include "database/database.h"
#include "api/apiclient.h"

#include <exception>
#include <unordered_set>
#include <string>
#include <string_view>
#include <stdexcept>
#include <vector>
#include <sstream>

#include <spdlog/spdlog.h>

RaidService::RaidService(std::unique_ptr<Database> db, std::unique_ptr<APIClient> apiClient)
    : db(std::move(db)), apiClient(std::move(apiClient)) {}

std::string RaidService::getServiceName() const
{
    return "RaidService";
}

SyncResult RaidService::updateData(std::string_view tag)
{
    auto svc = "Raid";
    spdlog::info("[Service: {}] Starting Capital Raids data update for {}", svc, tag);

    const auto optRaidData = apiClient->getCompleteRaidData(tag);

    if (!optRaidData.has_value())
    {
        spdlog::warn("[Service: {}] Raid data is currently unavailable for {}", svc, tag);
        return SyncResult::error(getServiceName(), std::string(tag),
            std::format("[Service: {}] Raid data is currently unavailable for {}", svc, tag));
    }

    auto& raidValue = optRaidData.value();

    spdlog::debug("[DB] Transaction STARTED");
    if (!db->execute("BEGIN TRANSACTION;"))
    {
        throw std::runtime_error("Failed to BEGIN TRANSACTION");
    }

    try
    {
        const long long lastRaidId = db->raids().insertOrUpdateSingleRaid(raidValue.clanRaid);
        if (lastRaidId == -1) {
            throw std::runtime_error("insertOrUpdateSingleRaid returned false");
        }

        if (!db->raids().insertOrUpdatePlayersSnapshots(lastRaidId, raidValue.playerRaidSnapshots)) {
            throw std::runtime_error("insertOrUpdateSingleRaid returned false");
        }

        if (!db->execute("COMMIT;"))
        {
            throw std::runtime_error("Failed to COMMIT transaction");
        }
        spdlog::debug("[DB] Transaction COMMITTED");

        spdlog::info("[Service: {}] Raids for {} successfully updated. Participants: {}", svc, raidValue.clanRaid.startTime,
                     raidValue.playerRaidSnapshots.size());

        return SyncResult::successWithRaidReport(getServiceName(), std::string(tag),
            {std::string(tag), raidValue.members, apiClient->getPlayersInfo(tag)}, currentRaidId);
    }
    catch (const std::exception& e)
    {
        spdlog::error("[DB] Transaction failed: {}", e.what());

        if (!db->execute("ROLLBACK;"))
        {
            spdlog::critical("[DB] Failed to rollback transaction");
        }

        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
