#include "service/clanInfoService.h"

#include <algorithm>

#include "database/TransactionGuard.h"

#include <string_view>
#include <string>
#include <api/apiclient.h>
#include <spdlog/spdlog.h>

ClanInfoService::ClanInfoService(Database& db, APIClient& apiClient)
    : db(db), apiClient(apiClient)
{
}

std::string ClanInfoService::getServiceName() const
{
    return "ClanInfoService";
}

MembershipChanges ClanInfoService::detectMembershipChanges(
    const std::string_view clanTag, std::vector<Player>& players) const
{
    std::vector<Player> activeClanPlayers = db.clans().getActiveMembers(clanTag);

    std::ranges::sort(activeClanPlayers, [](const Player& p1, const Player& p2) { return p1.tag < p2.tag; });
    std::ranges::sort(players, [](const Player& p1, const Player& p2) { return p1.tag < p2.tag; });

    auto compare_tags = [](const Player& a, const Player& b)
    {
        return a.tag < b.tag;
    };

    std::vector<Player> left_players;
    std::ranges::set_difference(activeClanPlayers, players,
                                std::back_inserter(left_players),
                                compare_tags
    );

    std::vector<Player> joined_players;
    std::ranges::set_difference(players, activeClanPlayers,
                                std::back_inserter(joined_players),
                                compare_tags
    );

    return {left_players, joined_players};
}

std::vector<DomainEvent> ClanInfoService::generateEvents(const MembershipChanges& changes)
{
    std::vector<DomainEvent> events;
    events.reserve(changes.joinedPlayers.size() + changes.leftPlayers.size());

    for (const auto& player : changes.leftPlayers)
    {
        events.emplace_back(
            PlayerLeftClanEvent(
                player.clanTag,
                player.tag,
                player.name
            )
        );
    }

    for (const auto& player : changes.joinedPlayers)
    {
        events.emplace_back(
            PlayerJoinedClanEvent(
                player.clanTag,
                player.tag,
                player.name
            )
        );
    }

    return events;
}

SyncResult ClanInfoService::updateData(std::string_view tag)
{
    auto svc = "ClanInfo";
    spdlog::info("[Service: {}] Starting update for clan {}", svc, tag);

    auto optClanData = apiClient.getCompleteClanData(tag);
    if (!optClanData.has_value())
    {
        spdlog::warn("[Service: {}] Received empty API response for clan {}", svc, tag);
        return SyncResult::error(getServiceName(), std::string(tag),
                                 fmt::format("[Service: {}] Received empty API response for clan {}", svc, tag));
    }

    auto& [clan, players, clanSnapshot, playerSnapshots] = optClanData.value();

    try
    {
        SyncResult syncResult;

        TransactionGuard tx(db);

        if (!db.clans().saveCompleteClanData(clan, clanSnapshot, players, playerSnapshots))
        {
            throw std::runtime_error("saveCompleteClanData returned false");
        }

        const auto changes = detectMembershipChanges(tag, players);

        if (!db.clans().saveMembershipChanges(changes))
        {
            throw std::runtime_error("saveMembershipChanges returned false");
        }

        auto events = generateEvents(changes);
        syncResult.events = std::move(events);
        syncResult.successFlag = true;
        syncResult.serviceName = svc;
        syncResult.clanTag = tag;

        tx.commit();

        spdlog::info("[Service: {}] Successfully updated clan {} ({}). Synchronized {} members.", svc, tag, clan.name,
                     clanSnapshot.membersCount);

        return syncResult;
    }
    catch (const std::exception& e)
    {
        spdlog::error("[DB] Transaction failed: {}", e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
