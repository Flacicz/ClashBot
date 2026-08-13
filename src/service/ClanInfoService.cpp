#include "service/ClanInfoService.h"

#include <algorithm>

#include "database/TransactionGuard.h"

#include <string_view>
#include <string>
#include <api/APIClient.h>
#include <spdlog/spdlog.h>

ClanInfoService::ClanInfoService(ClansRepo& clans_repo, APIClient& api_client, TransactionManager& transaction_manager)
    : clans_repo_(clans_repo)
      , api_client_(api_client)
      , transaction_manager_(transaction_manager)
{
}

std::string ClanInfoService::getServiceName() const
{
    return "ClanInfoService";
}

MembershipChanges ClanInfoService::detectMembershipChanges(
    const std::string_view clanTag, std::vector<Player> players) const
{
    std::vector<Player> activeClanPlayers = clans_repo_.getActiveMembers(clanTag);

    auto compare_tags = [](const Player& a, const Player& b)
    {
        return a.tag < b.tag;
    };

    std::ranges::sort(activeClanPlayers, compare_tags);
    std::ranges::sort(players, compare_tags);

    std::vector<Player> leftPlayers;
    std::ranges::set_difference(activeClanPlayers, players,
                                std::back_inserter(leftPlayers),
                                compare_tags
    );

    std::vector<Player> joinedPlayers;
    std::ranges::set_difference(players, activeClanPlayers,
                                std::back_inserter(joinedPlayers),
                                compare_tags
    );

    return MembershipChanges{
        .leftPlayers = std::move(leftPlayers),
        .joinedPlayers = std::move(joinedPlayers)
    };;
}

RoleChanges ClanInfoService::detectRoleChanges(const std::string& clanTag,
                                               const std::vector<PlayerSnapshot>& currentPlayers) const
{
    RoleChanges roleChanges;

    const std::vector<LatestPlayerState> latestPlayerStates = clans_repo_.getLatestPlayerSnapshots(clanTag);
    std::unordered_map<std::string, LatestPlayerState> oldPlayers;

    for (const auto& player : latestPlayerStates)
    {
        oldPlayers.emplace(player.playerTag, player);
    }

    for (auto& player : currentPlayers)
    {
        auto it = oldPlayers.find(player.playerTag);

        if (it == oldPlayers.end())
            continue;

        if (it->second.role != player.role)
        {
            roleChanges.changes.emplace_back(RoleChange{
                .clanTag = clanTag,
                .playerTag = std::move(it->second.playerTag),
                .playerName = std::move(it->second.playerName),
                .oldRole = std::move(it->second.role),
                .newRole = player.role
            });
        }
    }

    return roleChanges;
}

std::vector<ApplicationEvent> ClanInfoService::generateEvents(const MembershipChanges& changes,
                                                              const RoleChanges& roleChanges)
{
    std::vector<ApplicationEvent> events;
    events.reserve(changes.joinedPlayers.size() + changes.leftPlayers.size());

    for (const auto& [tag, name, clanTag] : changes.leftPlayers)
    {
        events.emplace_back(
            PlayerLeftClanEvent(
                clanTag,
                tag,
                name
            )
        );
    }

    for (const auto& [tag, name, clanTag] : changes.joinedPlayers)
    {
        events.emplace_back(
            PlayerJoinedClanEvent(
                clanTag,
                tag,
                name
            )
        );
    }

    for (const auto& [clanTag, playerTag, playerName, oldRole, newRole] : roleChanges.changes)
    {
        events.emplace_back(
            PlayerRoleChangedEvent{
                .clanTag = clanTag,
                .playerTag = playerTag,
                .playerName = playerName,
                .oldRole = oldRole,
                .newRole = newRole
            }
        );
    }

    return events;
}

SyncResult ClanInfoService::updateData(std::string_view tag)
{
    auto svc = getServiceName();
    spdlog::info("[Service: {}] Starting update for clan {}", svc, tag);

    auto optClanData = api_client_.getCompleteClanData(tag);
    if (!optClanData.has_value())
    {
        spdlog::warn("[Service: {}] Received empty API response for clan {}", svc, tag);
        return SyncResult::error(getServiceName(), std::string(tag),
                                 fmt::format("[Service: {}] Received empty API response for clan {}", svc, tag));
    }

    auto& [clan, players, clanSnapshot, playerSnapshots] = optClanData.value();

    try
    {
        auto transaction = transaction_manager_.beginTransaction();

        const auto roleChanges = detectRoleChanges(std::string(tag), playerSnapshots);

        clans_repo_.saveCompleteClanData(clan, clanSnapshot, players, playerSnapshots);

        const auto changes = detectMembershipChanges(tag, std::move(players));

        clans_repo_.saveMembershipChanges(changes);

        SyncResult syncResult = SyncResult::success(
            svc,
            std::string(tag),
            generateEvents(changes, roleChanges));

        transaction.commit();

        spdlog::info(
            "[Service: {}] Successfully updated clan '{}' ({}). Members: {}, Events generated: {}.",
            svc,
            tag,
            clan.name,
            clanSnapshot.membersCount,
            syncResult.events.size());

        return syncResult;
    }
    catch (const std::exception& e)
    {
        spdlog::error(
            "[Service: {}] Database transaction failed while updating clan '{}': {}",
            svc,
            tag,
            e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
