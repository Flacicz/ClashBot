#include "service/clanwarLeagueService.h"
#include "database/database.h"
#include "api/apiclient.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>
#include <exception>
#include <string>
#include <string_view>

ClanwarLeagueService::ClanwarLeagueService(std::unique_ptr<Database> db,
                                           std::unique_ptr<APIClient> apiClient)
    : db(std::move(db)), apiClient(std::move(apiClient))
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

    const auto optClanwarsLeagueData = apiClient->getCompleteClanwarsLeagueData(tag);

    if (!optClanwarsLeagueData.has_value())
    {
        spdlog::info("[Service: {}] CWL is not active for {}", svc, tag);
        return SyncResult::error(getServiceName(), std::string(tag),
                                 std::format("[Service: {}] CWL is not active for {}", svc, tag));
    }

    auto& clanwarData = optClanwarsLeagueData.value();

    spdlog::debug("[DB] Transaction STARTED");
    db->execute("BEGIN TRANSACTION;");

    try
    {
        db->getCwlRepo().insertOrUpdateSingleCWLSeasonInfo(season.value());
        db->getCwlRepo().insertOrUpdateSingleCWLMembersInfo(members);
        db->getCwlRepo().insertOrUpdateSingleCWLRoundsInfo(rounds);

        if (db->getCwlRepo().insertOrUpdateSingleCWLAttacksInfo(attacks))
        {
            spdlog::info("[Service: {}] Update successful for {}. Attacks processed: {}",
                         svc, tag, attacks.size());
        }

        db->execute("COMMIT;");
        spdlog::debug("[DB] Transaction COMMITTED");

        return SyncResult::success(getServiceName(), std::string(tag));
    }
    catch (const std::exception& e)
    {
        db->execute("ROLLBACK;");
        spdlog::error("[DB] Transaction ROLLED BACK");

        spdlog::error("[Service: {}] Critical error during CWL update for {}: {}", svc, tag, e.what());
        throw;
    }

    for (const auto& round : rounds)
    {
        try
        {
            if (round.warTag.empty() || round.warTag == "#0") continue;

            if (db->getCwlRepo().isNotified(round.warTag, std::string(tag)))
            {
                continue;
            }

            // Делаем запрос к API, чтобы узнать точный статус войны (закончилась ли она)
            nlohmann::json warParsed;
            try
            {
                auto warTagStr = std::string(round.warTag);
                std::string queryTag = warTagStr.front() == '#' ? "%23" + warTagStr.substr(1) : "%23" + warTagStr;

                warParsed = apiClient->fetchJson("/clanwarleagues/wars/" + queryTag);
            }
            catch (const std::exception& e)
            {
                spdlog::warn("[Service: CWL] Failed to fetch state for round {}: {}", round.warTag, e.what());
                continue;
            }
        }
        catch (const std::exception& e)
        {
            spdlog::error("[Service: CWL] Error during notification check: {}", e.what());
        }
    }
}
