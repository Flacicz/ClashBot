#include "service/RaidService.h"
#include "database/TransactionGuard.h"

#include <chrono>
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

std::vector<ApplicationEvent> RaidService::generateEvents(const std::string_view clanTag,
                                                          const ClanRaid& clanRaid,
                                                          const long long raidId)
{
    std::vector<ApplicationEvent> events;

    const auto now = std::chrono::system_clock::to_time_t(
        std::chrono::system_clock::now());

    const auto addReminder = [&events, clanTag, raidId, endTime = clanRaid.endTime]
    (const RaidReminderEvent::RaidReminderKind kind)
    {
        events.emplace_back(RaidReminderEvent{
            .clanTag = std::string(clanTag),
            .raidId = raidId,
            .endTime = endTime,
            .kind = kind
        });
    };

    if (now >= clanRaid.startTime && now < clanRaid.endTime)
    {
        addReminder(RaidReminderEvent::RaidReminderKind::Started);
    }

    if (now >= clanRaid.endTime - 48 * 60 * 60 && now < clanRaid.endTime)
    {
        addReminder(RaidReminderEvent::RaidReminderKind::FortyEightHoursLeft);
    }

    if (now >= clanRaid.endTime - 24 * 60 * 60 && now < clanRaid.endTime)
    {
        addReminder(RaidReminderEvent::RaidReminderKind::TwentyFourHoursLeft);
    }

    if (now >= clanRaid.endTime - 6 * 60 * 60 && now < clanRaid.endTime)
    {
        addReminder(RaidReminderEvent::RaidReminderKind::SixHoursLeft);
    }

    if (now >= clanRaid.endTime - 60 * 60 && now < clanRaid.endTime)
    {
        addReminder(RaidReminderEvent::RaidReminderKind::OneHourLeft);
    }

    if (clanRaid.state == "ended")
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

        syncResult = SyncResult::success(
            svc,
            std::string(tag),
            generateEvents(tag, clanRaid, lastRaidId));

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
