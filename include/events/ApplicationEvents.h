#ifndef CLASHBOT_DOMAINEVENTS_H
#define CLASHBOT_DOMAINEVENTS_H

#include <string>
#include <string_view>
#include <variant>

#include "models/Models.h"

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

struct WarReminderEvent
{
    enum class WarReminderKind
    {
        Started,
        SixHoursLeft,
        OneHourLeft
    };

    std::string clanTag;
    long long warId;
    long long endTime;
    WarReminderKind kind;

    static constexpr auto Type = "war_reminder";

    [[nodiscard]] static std::string_view kindName(const WarReminderKind& kind)
    {
        switch (kind)
        {
        case WarReminderKind::Started:
            return "started";
        case WarReminderKind::SixHoursLeft:
            return "six_hours_left";
        case WarReminderKind::OneHourLeft:
            return "one_hour_left";
        }
        return "unknown";
    }

    [[nodiscard]] std::string key() const
    {
        return std::to_string(warId) + ":" + std::string(kindName(kind));
    }
};

using ApplicationEvent = std::variant<
    PlayerJoinedClanEvent,
    PlayerLeftClanEvent,
    PlayerRoleChangedEvent,
    WarEndedEvent,
    RaidsEndedEvent,
    ClanwarsLeagueRoundEndedEvent,
    SyncFailureEvent,
    SyncRecoveryEvent,
    WarReminderEvent
>;

#endif //CLASHBOT_DOMAINEVENTS_H
