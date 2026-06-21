#include <service/clanwarLeagueService.h>
#include <spdlog/spdlog.h>
#include <string>
#include <string_view>

#include "common/StringUtils.h"
#include "database/TransactionGuard.h"

ClanwarLeagueService::ClanwarLeagueService(Database& db,
                                           APIClient& apiClient)
    : db(db), apiClient(apiClient)
{
}

std::string ClanwarLeagueService::getServiceName() const
{
    return "ClanwarLeagueService";
}

SyncResult ClanwarLeagueService::updateData(std::string_view tag)
{
    auto svc = "CWL";
    spdlog::info("[Service: {}] Starting Clan War League data update for {}", svc, tag);

    const auto [status, completeClanwarsLeagueData, errorMsg] = apiClient.getCompleteClanwarsLeagueData(tag);

    if (status == LeagueFetchStatus::Error)
    {
        std::string detailedError = fmt::format("[Service: {}] Technical error fetching CWL data for {}: {}",
                                                svc, tag, errorMsg);
        spdlog::error(detailedError);
        return SyncResult::error(getServiceName(), std::string(tag), std::move(detailedError));
    }

    if (status == LeagueFetchStatus::NoActiveLeague)
    {
        spdlog::info("[Service: {}] CWL is not active for {}", svc, tag);
        return {};
    }

    if (!completeClanwarsLeagueData.has_value())
    {
        std::string criticalError = fmt::format(
            "[Service: {}] Critical: Fetch status is Success, but data is empty for {}", svc, tag);
        spdlog::critical(criticalError);
        return SyncResult::error(getServiceName(), std::string(tag), std::move(criticalError));
    }

    const auto& [clanwarsLeagueSeason, clanwarsLeagueMembers, warDetails] = completeClanwarsLeagueData.value();

    try
    {
        SyncResult syncResult;

        TransactionGuard tx(db);

        const long long lastCWLId = db.leagueWar().saveCompleteCWLData(clanwarsLeagueSeason, clanwarsLeagueMembers);

        for (const auto& [war, clans, attacks, members] : warDetails)
        {
            auto warResult = db.war().saveCompleteClanwarData(war, clans, attacks, members);
            if (warResult.warId == -1) throw std::runtime_error("saveCompleteClanwarData returned error status");

            if (war.state == "ended")
            {
                syncResult.events.emplace_back(
                    ClanwarLeagueRoundEndedEvent(std::string(tag), lastCWLId, warResult)
                );
            }
        }

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
