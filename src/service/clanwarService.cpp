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

    const auto optClanwarData = apiClient->getCompleteClanwarData(tag);

    if (!optClanwarData.has_value())
    {
        spdlog::info("[Service: {}] War is not active for {}", svc, tag);
        return SyncResult::error(getServiceName(), std::string(tag),
                                 std::format("[Service: {}] War is not active for {}", svc, tag));
    }

    const auto& [clanwar, clans, attacks, members] = optClanwarData.value();

    spdlog::debug("[DB] Transaction STARTED");
    if (!db->execute("BEGIN TRANSACTION;"))
    {
        throw std::runtime_error("Failed to BEGIN TRANSACTION");
    }

    try
    {
        const long long lastClanwarId = db->war().insertSingleClanwarInfo(clanwar);
        if (lastClanwarId == -1)
        {
            throw std::runtime_error("insertSingleClanwarInfo returned false");
        }

        const long long homeClanwarId = db->war().insertSingleClanwarDetails(lastClanwarId, clans.first);
        const long long opponentClanwarId = db->war().insertSingleClanwarDetails(
            lastClanwarId, clans.second);
        if (homeClanwarId == -1 || opponentClanwarId == -1)
        {
            throw std::runtime_error("insertSingleClanwarDetails returned false");
        }

        if (!db->war().insertSingleClanwarAttacks(lastClanwarId, homeClanwarId,
                                                  opponentClanwarId, attacks))
        {
            throw std::runtime_error("insertSingleClanwarAttacks returned false");
        }

        if (!db->war().insertSingleClanwarMembers(lastClanwarId, homeClanwarId, members.first))
        {
            throw std::runtime_error("insertSingleClanwarMembers returned false");
        }

        if (!db->war().insertSingleClanwarMembers(lastClanwarId, opponentClanwarId, members.second))
        {
            throw std::runtime_error("insertSingleClanwarMembers returned false");
        }

        if (!db->execute("COMMIT;"))
        {
            throw std::runtime_error("Failed to COMMIT transaction");
        }
        spdlog::debug("[DB] Transaction COMMITTED");

        return SyncResult::successWithClanwarReport(getServiceName(), std::string(tag),
                                                    {std::string(tag), attacks, summaryValue}, 1);
    }
    catch (const std::exception& e)
    {
        spdlog::error("[DB] Transaction failed: {}", e.what());

        if (!db->execute("ROLLBACK;"))
        {
            spdlog::critical("[DB] Failed to rollback transaction");
        }

        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
