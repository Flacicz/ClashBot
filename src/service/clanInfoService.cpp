#include "service/clanInfoService.h"
#include "database/database.h"
#include "api/apiclient.h"

#include <chrono>
#include <string_view>
#include <exception>
#include <stdexcept>
#include <string>

#include <spdlog/spdlog.h>


ClanInfoService::ClanInfoService(std::unique_ptr<Database> db, std::unique_ptr<APIClient> apiClient)
    : db(std::move(db)), apiClient(std::move(apiClient))
{
}

std::string ClanInfoService::getServiceName() const
{
    return "ClanInfoService";
}

SyncResult ClanInfoService::updateData(std::string_view tag)
{
    auto svc = "ClanInfo";
    spdlog::info("[Service: {}] Starting update for clan {}", svc, tag);

    const auto optClanData = apiClient->getCompleteClanData(tag);
    if (!optClanData.has_value())
    {
        spdlog::warn("[Service: {}] Received empty API response for clan {}", svc, tag);
        return SyncResult::error(getServiceName(), std::string(tag),
                                 std::format("[Service: {}] Received empty API response for clan {}", svc, tag));
    }

    const auto& [clan, players, clanSnapshot, playerSnapshots] = optClanData.value();

    spdlog::debug("[DB] Transaction STARTED");
    if (!db->execute("BEGIN TRANSACTION;"))
    {
        throw std::runtime_error("Failed to BEGIN TRANSACTION");
    }

    try
    {
        if (!db->clans().insertOrUpdateClanInfo(clan)) {
            throw std::runtime_error("insertOrUpdateClanInfo returned false");
        }

        if (!db->clans().insertOrUpdateClanSnapshot(clanSnapshot)) {
            throw std::runtime_error("insertOrUpdateClanSnapshot returned false");
        }

        if (!db->clans().insertOrUpdatePlayersInfo(players)) {
            throw std::runtime_error("insertOrUpdatePlayersInfo returned false");
        }

        if (!db->clans().insertOrUpdatePlayersSnapshots(playerSnapshots)) {
            throw std::runtime_error("insertOrUpdatePlayersSnapshots returned false");
        }

        if (!db->execute("COMMIT;"))
        {
            throw std::runtime_error("Failed to COMMIT transaction");
        }
        spdlog::debug("[DB] Transaction COMMITTED");

        spdlog::info("[Service: {}] Successfully updated clan {} ({}). Synchronized {} members.", svc, tag, clan.name,
                     clanSnapshot.membersCount);

        return SyncResult::success(getServiceName(), std::string(tag));
    }
    catch (const std::exception& e)
    {
        if (!db->execute("ROLLBACK;"))
        {
            spdlog::critical("[DB] CRITICAL: Failed to ROLLBACK transaction!");
        }
        else
        {
            spdlog::error("[DB] Transaction ROLLED BACK");
        }

        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
