#include "service/clanwarService.h"
#include "database/TransactionGuard.h"

#include <spdlog/spdlog.h>
#include <string>
#include <string_view>


ClanwarService::ClanwarService(Database& db,
                               APIClient& apiClient) :
    db(db), apiClient(apiClient)
{
}

std::string ClanwarService::getServiceName() const
{
    return "ClanwarService";
}

std::vector<DomainEvent> ClanwarService::generateEvents(const std::string_view clanTag, const std::string& state, InsertedWarResult insertedWarResult)
{
    std::vector<DomainEvent> events;

    if (state == "ended")
    {
        events.emplace_back(
            WarEndedEvent(std::string(clanTag), insertedWarResult)
        );
    }

    return events;
}

SyncResult ClanwarService::updateData(std::string_view tag)
{
    auto svc = "CW";
    spdlog::info("[Service: {}] Starting Clan War data update for {}", svc, tag);

    const auto [status, completeData, errorMsg] = apiClient.getCompleteClanwarData(tag);

    if (status == ClanwarFetchStatus::Error)
    {
        std::string detailedError = fmt::format("[Service: {}] Technical error fetching CW data for {}: {}",
                                                svc, tag, errorMsg);
        spdlog::error(detailedError);
        return SyncResult::error(getServiceName(), std::string(tag), std::move(detailedError));
    }

    if (status == ClanwarFetchStatus::NoActiveWar)
    {
        spdlog::info("[Service: {}] CW is not active for {}", svc, tag);
        return {};
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
        SyncResult syncResult;

        TransactionGuard tx(db);

        const auto warResult = db.war().saveCompleteClanwarData(clanwar, clans, attacks, members);
        if (warResult.warId == -1) throw std::runtime_error("saveCompleteClanwarData returned error status");

        auto events = generateEvents(tag, clanwar.state, warResult);
        syncResult.events = std::move(events);
        syncResult.successFlag = true;
        syncResult.serviceName = svc;
        syncResult.clanTag = tag;

        tx.commit();

        return syncResult;
    }
    catch (const std::exception& e)
    {
        spdlog::error("[DB] Transaction failed: {}", e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
