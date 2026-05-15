#include "service/clanwarService.h"
#include "models/models.h"
#include "database/database.h"
#include "api/apiclient.h"

#include <vector>
#include <string>
#include <utility>
#include <string_view>
#include <exception>
#include <stdexcept>

#include <spdlog/spdlog.h>

ClanwarService::ClanwarService(std::unique_ptr<Database> db,
                               std::unique_ptr<APIClient> apiClient) :
    db(std::move(db)), apiClient(std::move(apiClient))
{
}

std::string ClanwarService::getServiceName() const
{
    return "ClanWar";
}

SyncResult ClanwarService::updateData(std::string_view tag)
{
    auto svc = "CW";
    spdlog::info("[Service: {}] Starting Clan War data update for {}", svc, tag);

    const auto season = apiClient->getClanwarSeason(tag);
    if (!season.has_value())
    {
        spdlog::info("[Service: {}] War is not active for {}", svc, tag);
        return SyncResult::error(getServiceName(), std::string(tag),
                                 std::format("[Service: {}] War is not active for {}", svc, tag));
    }

    const auto summary = apiClient->getClanwarInfo(tag);
    if (!summary.has_value())
    {
        spdlog::info("[Service: {}] War summary unavailable for {}", svc, tag);
        return SyncResult::error(getServiceName(), std::string(tag),
                                 std::format("[Service: {}] War summary unavailable for {}", svc, tag));
    }

    const auto attacks = apiClient->getClanwarAttacks(tag);
    auto& summaryValue = summary.value();

    spdlog::debug("[DB] Transaction STARTED");
    db->execute("BEGIN TRANSACTION;");

    try
    {
        db->getCwRepo().insertSingleClanwarSeasonInfo(season.value());
        db->getCwRepo().insertSingleClanwarInfo(summaryValue);

        const std::string currentWarId = db->getCwRepo().getClanwarIdByDate(
            summaryValue.clanTag, summaryValue.prepStartTime);

        if (currentWarId.empty())
        {
            throw std::runtime_error("Failed to retrieve Clan War ID from database");
        }

        if (db->getCwRepo().insertSingleClanwarAttacksInfo(currentWarId, attacks))
        {
            spdlog::info("[Service: {}] Update successful. Total attacks in DB: {}", svc, attacks.size());
        }

        db->execute("COMMIT;");
        spdlog::debug("[DB] Transaction COMMITTED");

        return SyncResult::successWithClanwarReport(getServiceName(), std::string(tag),
                                                    {std::string(tag), attacks, summaryValue}, 1);
    }
    catch (const std::exception& e)
    {
        db->execute("ROLLBACK;");
        spdlog::error("[DB] Transaction ROLLED BACK");
        spdlog::error("[Service: {}] Critical error saving Clan War data: {}", svc, e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
