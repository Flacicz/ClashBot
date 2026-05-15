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

    auto raid = apiClient->getRaidInfo(tag);

    if (!raid.has_value())
    {
        spdlog::warn("[Service: {}] Raid data is currently unavailable for {}", svc, tag);
        return SyncResult::error(getServiceName(), std::string(tag),
            std::format("[Service: {}] Raid data is currently unavailable for {}", svc, tag));
    }

    auto& raidValue = raid.value();

    spdlog::debug("[DB] Transaction STARTED");
    db->execute("BEGIN TRANSACTION;");

    try
    {
        long long currentRaidId = -1;
        if (!db->getRaidRepo().insertOrUpdateSingleRaidInfo(raidValue))
        {
            throw std::runtime_error("Failed to write raid_summary");
        }

        currentRaidId = db->getRaidRepo().getRaidIdByDate(raidValue.clanTag, raidValue.date);
        if (currentRaidId == -1)
        {
            throw std::runtime_error("Failed to retrieve Raid ID from database");
        }

        if (!db->getRaidRepo().insertOrUpdateSinglePlayersRaidInfo(currentRaidId, raidValue.members))
        {
            throw std::runtime_error("Failed to write raid_details");
        }

        db->execute("COMMIT;");
        spdlog::debug("[DB] Transaction COMMITTED");

        spdlog::info("[Service: {}] Raids for {} successfully updated. Participants: {}", svc, raidValue.date,
                     raidValue.members.size());

        return SyncResult::successWithRaidReport(getServiceName(), std::string(tag),
            {std::string(tag), raidValue.members, apiClient->getPlayersInfo(tag)}, currentRaidId);
    }
    catch (const std::exception& e)
    {
        db->execute("ROLLBACK;");
        spdlog::error("[DB] Transaction ROLLED BACK");
        spdlog::error("[Service: {}] Critical error saving raids for {}: {}", svc, tag, e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
