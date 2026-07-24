#include "service/raidService.h"
#include "database/TransactionGuard.h"

#include <spdlog/spdlog.h>
#include <string>
#include <string_view>

RaidService::RaidService(ClansRepo& clans_repo,
                         RaidRepo& raid_repo,
                         APIClient& api_client,
                         TransactionManager& transaction_manager)
    : clans_repo_(clans_repo)
      , raid_repo_(raid_repo)
      , api_client_(api_client)
      , transaction_manager_(transaction_manager)
{
}

std::string RaidService::getServiceName() const
{
    return "RaidService";
}

void RaidService::ensurePlayersExist(const std::vector<PlayerRaidSnapshot>& players) const
{
    for (const auto& player : players)
    {
        clans_repo_.insertMinimal(player.playerTag);
    }
}

std::vector<ApplicationEvent> RaidService::generateEvents(const std::string_view clanTag, const std::string& state,
                                                          const long long raidId)
{
    std::vector<ApplicationEvent> events;

    if (state == "ended")
    {
        events.emplace_back(
            RaidsEndedEvent(std::string(clanTag), raidId)
        );
    }

    return events;
}

SyncResult RaidService::updateData(std::string_view tag)
{
    auto svc = getServiceName();
    spdlog::info("[Service: {}] Starting Capital Raids data update for {}", svc, tag);

    const auto optRaidData = api_client_.getCompleteRaidData(tag);

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

        auto transaction = transaction_manager_.beginTransaction();

        ensurePlayersExist(playerRaidSnapshots);

        const long long lastRaidId = raid_repo_.saveCompleteRaidData(clanRaid, playerRaidSnapshots);

        syncResult.events = generateEvents(tag, clanRaid.state, lastRaidId);
        syncResult.successFlag = true;
        syncResult.serviceName = svc;
        syncResult.clanTag = tag;

        transaction.commit();

        spdlog::info(
            "[Service: {}] Successfully updated Capital Raid for clan '{}'. Participants: {}, Events generated: {}.",
            svc,
            tag,
            playerRaidSnapshots.size(),
            syncResult.events.size());

        return syncResult;
    }
    catch (const std::exception& e)
    {
        spdlog::error(
            "[Service: {}] Failed to update Capital Raid for clan '{}': {}",
            svc,
            tag,
            e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
