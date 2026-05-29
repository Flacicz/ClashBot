#include "service/clanwarLeagueService.h"
#include "database/database.h"
#include "api/apiclient.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>
#include <exception>
#include <string>
#include <string_view>

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

    const auto optClanwarsLeagueData = apiClient.getCompleteClanwarsLeagueData(tag);

    if (!optClanwarsLeagueData.has_value())
    {
        spdlog::info("[Service: {}] CWL is not active for {}", svc, tag);
        return SyncResult::error(getServiceName(), std::string(tag),
                                 std::format("[Service: {}] CWL is not active for {}", svc, tag));
    }

    const auto& [clanwarsLeagueSeason, clanwarsLeagueMembers, warDetails] = optClanwarsLeagueData.value();

    try
    {
        TransactionGuard tx(db);

        const long long lastCWLId = db.leagueWar().saveCompleteCWLData(clanwarsLeagueSeason, clanwarsLeagueMembers);

        std::vector<ClanwarReportData> leagueRoundsReports;
        leagueRoundsReports.reserve(warDetails.size());

        for (const auto& [war, clans, attacks] : warDetails)
        {
            auto [warId, homeId, oppId] = db.war().saveCompleteClanwarData(war, clans, attacks);
            if (warId == -1) throw std::runtime_error("saveCompleteClanwarData returned error status");

            const auto missedAllAttacks = db.war().getSlackersWithNoAttacks(warId, homeId);
            const auto missedOneAttack = db.war().getSlackersWithOneAttack();
            const auto noMirror = db.war().getPlayersWithNotMirrorAttack();

            leagueRoundsReports.push_back(ClanwarReportData{
                .clanwarId = warId,
                .state = war.state,
                .clanwars = clans,
                .missedAllAttacks = missedAllAttacks,
                .missedOneAttack = missedOneAttack,
                .notMirror = noMirror
            });
        }

        tx.commit();

        return SyncResult::successWithClanwarsLeagueReport(getServiceName(), std::string(tag),
                                                           {lastCWLId, std::string(tag), leagueRoundsReports},
                                                           std::to_string(lastCWLId));
    }
    catch (const std::exception& e)
    {
        spdlog::error("[DB] Transaction failed: {}", e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
