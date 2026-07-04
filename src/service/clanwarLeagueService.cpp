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
    auto svc = getServiceName();
    spdlog::info("[Service: {}] Starting Clan War League data update for {}", svc, tag);

    auto [status, completeClanwarsLeagueData, errorMsg] = apiClient.getCompleteClanwarsLeagueData(tag);

    if (status == LeagueFetchStatus::Error)
    {
        std::string detailedError = fmt::format("[Service: {}] Technical error fetching CWL data for {}: {}",
                                                svc, tag, errorMsg);
        spdlog::error(detailedError);
        return SyncResult::error(getServiceName(), std::string(tag), std::move(detailedError));
    }

    SyncResult syncResult;
    if (status == LeagueFetchStatus::NoActiveLeague)
    {
        spdlog::info(
            "[Service: {}] No active Clan War League season for clan '{}'.",
            svc,
            tag);

        syncResult.successFlag = true;
        return syncResult;
    }

    if (!completeClanwarsLeagueData.has_value())
    {
        std::string criticalError = fmt::format(
            "[Service: {}] Critical: Fetch status is Success, but data is empty for {}", svc, tag);
        spdlog::critical(criticalError);
        return SyncResult::error(getServiceName(), std::string(tag), std::move(criticalError));
    }

    auto& [clanwarsLeagueSeason, clanwarsLeagueMembers, warDetails] = completeClanwarsLeagueData.value();

    try
    {
        TransactionGuard tx(db);

        const long long lastCWLId = db.leagueWar().saveCompleteCWLData(clanwarsLeagueSeason, clanwarsLeagueMembers);

        int roundNumber = 1;
        for (auto& [war, clans, attacks, members] : warDetails)
        {
            try
            {
                war.seasonId = lastCWLId;
                war.roundNumber = roundNumber++;

                auto warResult = db.war().saveCompleteClanwarData(war, clans, attacks, members);
                if (warResult.warId == -1) throw std::runtime_error("saveCompleteClanwarData returned error status");

                if (war.state == "warEnded")
                {
                    syncResult.events.emplace_back(
                        ClanwarsLeagueRoundEndedEvent(std::string(tag), lastCWLId, warResult)
                    );
                }
            }
            catch (const std::exception& e)
            {
                throw std::runtime_error(
                    fmt::format(
                        "Failed to save war '{}' in CWL season: {}",
                        war.warUID,
                        e.what()));
            }
        }

        syncResult.successFlag = true;
        syncResult.serviceName = svc;
        syncResult.clanTag = tag;

        tx.commit();

        spdlog::info(
            "[Service: {}] Successfully updated Clan War League for clan '{}'. "
            "Wars: {}, Members: {}, Events generated: {}.",
            svc,
            tag,
            warDetails.size(),
            clanwarsLeagueMembers.size(),
            syncResult.events.size());

        return syncResult;
    }
    catch (const std::exception& e)
    {
        spdlog::error(
            "[Service: {}] Failed to update Clan War League for clan '{}': {}",
            svc,
            tag,
            e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
