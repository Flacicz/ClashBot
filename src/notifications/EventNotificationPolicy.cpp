//
// Created by zuevm on 20.09.2026.
//

#include <type_traits>

#include "notifications/EventNotificationPolicy.h"

namespace
{
    template <typename>
    inline constexpr bool alwaysFalse = false;
}

std::vector<Audience> EventNotificationPolicy::audiencesFor(const ApplicationEvent& event)
{
    return std::visit(
        []<typename T>(const T& value) -> std::vector<Audience>
        {
            using Event = std::decay_t<T>;

            if constexpr (
                std::is_same_v<Event, PlayerJoinedClanEvent> ||
                std::is_same_v<Event, PlayerLeftClanEvent> ||
                std::is_same_v<Event, PlayerRoleChangedEvent> ||
                std::is_same_v<Event, WarReminderEvent> ||
                std::is_same_v<Event, RaidReminderEvent>)
            {
                return {Audience::Players};
            }
            else if constexpr (
                std::is_same_v<Event, WarEndedEvent> ||
                std::is_same_v<Event, RaidsEndedEvent> ||
                std::is_same_v<Event, ClanwarsLeagueRoundEndedEvent>)
            {
                return {Audience::Players, Audience::Management};
            }
            else if constexpr (
                std::is_same_v<Event, SyncFailureEvent> ||
                std::is_same_v<Event, SyncRecoveryEvent>)
            {
                return {Audience::Management};
            }
            else
            {
                static_assert(alwaysFalse<Event>,
                              "Audience policy is missing for this event type");
            }
        },
        event);
}
