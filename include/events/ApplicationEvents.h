#ifndef ACTIVITYTRACKING_DOMAINEVENTS_H
#define ACTIVITYTRACKING_DOMAINEVENTS_H

#include <string>
#include <variant>

#include "models/models.h"

struct PlayerJoinedClanEvent
{
    std::string clanTag;
    std::string playerTag;
    std::string playerName;
};

struct PlayerLeftClanEvent
{
    std::string clanTag;
    std::string playerTag;
    std::string playerName;
};

struct PlayerRoleChangedEvent
{
    std::string clanTag;
    std::string playerTag;
    std::string playerName;
    std::string oldRole;
    std::string newRole;
};

struct WarEndedEvent
{
    std::string clanTag;
    InsertedWarResult insertedWarResult;

    static constexpr auto Type = "war_ended";

    [[nodiscard]] std::string key() const
    {
        return std::to_string(insertedWarResult.warId);
    }
};

struct RaidsEndedEvent
{
    std::string clanTag;
    long long raidsId;

    static constexpr auto Type = "raids_ended";

    [[nodiscard]] std::string key() const
    {
        return std::to_string(raidsId);
    }
};

struct ClanwarsLeagueRoundEndedEvent
{
    std::string clanTag;
    long long cwlSeasonId;
    InsertedWarResult insertedWarResult;

    static constexpr auto Type = "cwl_round_ended";

    [[nodiscard]] std::string key() const
    {
        return std::to_string(insertedWarResult.warId);
    }
};

struct SyncFailureEvent
{
    std::string clanTag;
    std::string serviceName;
    std::string errorMsg;
    int attempts;
};

struct SyncRecoveryEvent
{
    std::string clanTag;
    std::string serviceName;
};

using ApplicationEvent = std::variant<
    PlayerJoinedClanEvent,
    PlayerLeftClanEvent,
    PlayerRoleChangedEvent,
    WarEndedEvent,
    RaidsEndedEvent,
    ClanwarsLeagueRoundEndedEvent,
    SyncFailureEvent,
    SyncRecoveryEvent
>;

#endif //ACTIVITYTRACKING_DOMAINEVENTS_H
