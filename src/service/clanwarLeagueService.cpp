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
        return SyncResult::success(getServiceName(), std::string(tag));
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
        TransactionGuard tx(db);

        const long long lastCWLId = db.leagueWar().saveCompleteCWLData(clanwarsLeagueSeason, clanwarsLeagueMembers);

        std::vector<ClanwarReportData> leagueRoundsReports;
        leagueRoundsReports.reserve(warDetails.size());

        for (const auto& [war, clans, attacks, members] : warDetails)
        {
            auto [warId, homeId, oppId] = db.war().saveCompleteClanwarData(war, clans, attacks, members);
            if (warId == -1) throw std::runtime_error("saveCompleteClanwarData returned error status");

            const auto missedAllAttacks = db.war().getSlackersWithNoAttacks(warId, homeId);
            const auto noMirror = db.war().getPlayersWithNotMirrorAttack(warId, homeId);

            leagueRoundsReports.push_back(ClanwarReportData{
                .clanwarId = warId,
                .state = war.state,
                .clanwars = clans,
                .missedAllAttacks = missedAllAttacks,
                .notMirror = noMirror
            });
        }

        tx.commit();

        const auto chatIds = db.subscriptions().getChatIdsForClan(utils::normalizedTag(tag));
        long long activeReportWarId = 0;
        for (const auto& report : leagueRoundsReports)
        {
            for (const auto& chatId : chatIds)
            {
                if (report.state == "warEnded" && !db.isNotified(getServiceName(), report.clanwarId, chatId))
                {
                    activeReportWarId = report.clanwarId;
                    break;
                }
            }

            if (activeReportWarId != 0) break;
        }

        return SyncResult::successWithClanwarsLeagueReport(getServiceName(), std::string(tag),
                                                           {lastCWLId, std::string(tag), leagueRoundsReports},
                                                           activeReportWarId);
    }
    catch (const std::exception& e)
    {
        spdlog::error("[DB] Transaction failed: {}", e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
