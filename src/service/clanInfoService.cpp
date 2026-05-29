#include "service/clanInfoService.h"
#include "database/database.h"
#include "api/apiclient.h"
#include "database/TransactionGuard.h"

#include <chrono>
#include <string_view>
#include <exception>
#include <stdexcept>
#include <string>

#include <spdlog/spdlog.h>


ClanInfoService::ClanInfoService(Database& db, APIClient& apiClient)
    : db(db), apiClient(apiClient)
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

    const auto optClanData = apiClient.getCompleteClanData(tag);
    if (!optClanData.has_value())
    {
        spdlog::warn("[Service: {}] Received empty API response for clan {}", svc, tag);
        return SyncResult::error(getServiceName(), std::string(tag),
                                 std::format("[Service: {}] Received empty API response for clan {}", svc, tag));
    }

    const auto& [clan, players, clanSnapshot, playerSnapshots] = optClanData.value();

    try
    {
        TransactionGuard tx(db);

        if (!db.clans().saveCompleteClanData(clan, clanSnapshot, players, playerSnapshots)) {
            throw std::runtime_error("saveCompleteClanData returned false");
        }

        tx.commit();

        spdlog::info("[Service: {}] Successfully updated clan {} ({}). Synchronized {} members.", svc, tag, clan.name,
                     clanSnapshot.membersCount);

        return SyncResult::success(getServiceName(), std::string(tag));
    }
    catch (const std::exception& e)
    {
        spdlog::error("[DB] Transaction failed: {}", e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
