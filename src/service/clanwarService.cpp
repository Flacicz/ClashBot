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

SyncResult ClanwarService::updateData(std::string_view tag)
{
    auto svc = "CW";
    spdlog::info("[Service: {}] Starting Clan War data update for {}", svc, tag);

    const auto optClanwarData = apiClient.getCompleteClanwarData(tag);

    if (!optClanwarData.has_value())
    {
        spdlog::info("[Service: {}] War is not active for {}", svc, tag);
        return SyncResult::error(getServiceName(), std::string(tag),
                                 fmt::format("[Service: {}] War is not active for {}", svc, tag));
    }

    const auto& [clanwar, clans, attacks, members] = optClanwarData.value();

    try
    {
        TransactionGuard tx(db);

        auto [warId, homeId, oppId] = db.war().saveCompleteClanwarData(clanwar, clans, attacks, members);
        if (warId == -1) throw std::runtime_error("saveCompleteClanwarData returned error status");

        tx.commit();

        const auto missedAllAttacks = db.war().getSlackersWithNoAttacks(warId, homeId);
        const auto missedOneAttack = db.war().getSlackersWithOneAttack(warId, homeId);
        const auto noMirror = db.war().getPlayersWithNotMirrorAttack(warId, homeId);

        return SyncResult::successWithClanwarReport(getServiceName(), std::string(tag),
                                                    {
                                                        warId, clanwar.state, clans,
                                                        missedAllAttacks, missedOneAttack, noMirror
                                                    },
                                                    std::to_string(warId));
    }
    catch (const std::exception& e)
    {
        spdlog::error("[DB] Transaction failed: {}", e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
