#include "service/ClanwarService.h"
#include "database/TransactionGuard.h"

#include <chrono>
#include <spdlog/spdlog.h>
#include <string>
#include <string_view>


ClanwarService::ClanwarService(ClanwarRepo& clanwar_repo,
                               APIClient& api_client,
                               TransactionManager& transaction_manager)
    : clanwar_repo_(clanwar_repo)
      , api_client_(api_client)
      , transaction_manager_(transaction_manager)
{
}

std::string ClanwarService::getServiceName() const
{
    return "ClanwarService";
}

std::vector<ApplicationEvent> ClanwarService::generateEvents(const std::string_view clanTag, const std::string& state,
                                                             const Clanwar& clanwar,
                                                             const InsertedWarResult& insertedWarResult)
{
    std::vector<ApplicationEvent> events;

    const auto now = std::chrono::system_clock::to_time_t(
        std::chrono::system_clock::now());

    if (now >= clanwar.startTime && now < clanwar.endTime)
    {
        events.emplace_back(WarReminderEvent{
            .clanTag = std::string(clanTag),
            .warId = insertedWarResult.warId,
            .endTime = clanwar.endTime,
            .kind = WarReminderEvent::WarReminderKind::Started
        });
    }

    if (now >= clanwar.endTime - 6 * 60 * 60 && now < clanwar.endTime)
    {
        events.emplace_back(WarReminderEvent{
            .clanTag = std::string(clanTag),
            .warId = insertedWarResult.warId,
            .endTime = clanwar.endTime,
            .kind = WarReminderEvent::WarReminderKind::SixHoursLeft
        });
    }

    if (now >= clanwar.endTime - 60 * 60 && now < clanwar.endTime)
    {
        events.emplace_back(WarReminderEvent{
            .clanTag = std::string(clanTag),
            .warId = insertedWarResult.warId,
            .endTime = clanwar.endTime,
            .kind = WarReminderEvent::WarReminderKind::OneHourLeft
        });
    }

    if (state == "warEnded")
    {
        events.emplace_back(
            WarEndedEvent(std::string(clanTag), insertedWarResult)
        );
    }

    return events;
}

SyncResult ClanwarService::updateData(std::string_view tag)
{
    auto svc = getServiceName();
    spdlog::info(
        "[Service: {}] Starting update for clan '{}'.",
        svc,
        tag);

    const auto [status, completeData, errorMsg] = api_client_.getCompleteClanwarData(tag);

    if (status == ClanwarFetchStatus::Error)
    {
        std::string detailedError = fmt::format("[Service: {}] Technical error fetching CW data for {}: {}",
                                                svc, tag, errorMsg);
        spdlog::error(detailedError);
        return SyncResult::error(getServiceName(), std::string(tag), std::move(detailedError));
    }

    SyncResult syncResult;
    if (status == ClanwarFetchStatus::NoActiveWar)
    {
        spdlog::info("[Service: {}] No active Clan War for clan '{}'.", svc, tag);
        syncResult.successFlag = true;
        return syncResult;
    }

    if (!completeData.has_value())
    {
        std::string criticalError = fmt::format(
            "[Service: {}] Critical: Fetch status is Success, but data is empty for {}", svc, tag);
        spdlog::critical(criticalError);
        return SyncResult::error(getServiceName(), std::string(tag), std::move(criticalError));
    }

    const auto& [clanwar, clans, attacks, members] = completeData.value();

    try
    {
        auto transaction = transaction_manager_.beginTransaction();

        const auto warResult = clanwar_repo_.saveCompleteClanwarData(clanwar, clans, attacks, members);
        if (warResult.warId == -1) throw std::runtime_error("saveCompleteClanwarData returned error status");

        syncResult.events = generateEvents(tag, clanwar.state, clanwar, warResult);
        syncResult.successFlag = true;
        syncResult.serviceName = svc;
        syncResult.clanTag = tag;

        transaction.commit();

        spdlog::info(
            "[Service: {}] Successfully updated Clan War for clan '{}'. Members: {}, Attacks: {}, Events generated: {}.",
            svc,
            tag,
            members.first.size() + members.second.size(),
            attacks.size(),
            syncResult.events.size());

        return syncResult;
    }
    catch (const std::exception& e)
    {
        spdlog::error(
            "[Service: {}] Failed to update Clan War for clan '{}': {}",
            svc,
            tag,
            e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
