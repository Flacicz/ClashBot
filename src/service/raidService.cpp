#include "service/raidService.h"
#include "database/TransactionGuard.h"

#include <spdlog/spdlog.h>
#include <string>
#include <string_view>

RaidService::RaidService(Database& db, APIClient& apiClient)
    : db(db), apiClient(apiClient)
{
}

std::string RaidService::getServiceName() const
{
    return "RaidService";
}

std::vector<DomainEvent> RaidService::generateEvents(const std::string_view clanTag, const std::string& state,
                                                     const long long raidId)
{
    std::vector<DomainEvent> events;

    if (state == "ended")
    {
        events.emplace_back(
            RaidEndedEvent(std::string(clanTag), raidId)
        );
    }

    return events;
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
                                 fmt::format("[Service: {}] Raid data is currently unavailable for {}", svc, tag));
    }

    const auto& [clanRaid, playerRaidSnapshots] = optRaidData.value();

    try
    {
        SyncResult syncResult;

        TransactionGuard tx(db);

        const long long lastRaidId = db.raids().saveCompleteRaidData(clanRaid, playerRaidSnapshots);
        auto events = generateEvents(tag, clanRaid.state, lastRaidId);

        syncResult.events = std::move(events);
        syncResult.successFlag = true;
        syncResult.serviceName = svc;
        syncResult.clanTag = tag;

        tx.commit();

        spdlog::info("[Service: {}] Raids for {} successfully updated. Participants: {}", svc, clanRaid.startTime,
                     playerRaidSnapshots.size());

        return syncResult;
    }
    catch (const std::exception& e)
    {
        spdlog::error("[DB] Transaction failed: {}", e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
