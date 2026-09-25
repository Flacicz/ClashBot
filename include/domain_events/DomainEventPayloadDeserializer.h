#ifndef CLASHBOT_DOMAINEVENTPAYLOADDESERIALIZER_H
#define CLASHBOT_DOMAINEVENTPAYLOADDESERIALIZER_H

#include <string_view>

#include <nlohmann/json_fwd.hpp>

#include "events/ApplicationEvents.h"

class DomainEventPayloadDeserializer
{
private:
    static constexpr int currentPayloadVersion = 1;

    static PlayerJoinedClanEvent deserializePlayerJoined(
        std::string_view clanTag,
        const nlohmann::json& payload);

    static PlayerLeftClanEvent deserializePlayerLeft(
        std::string_view clanTag,
        const nlohmann::json& payload);

    static PlayerRoleChangedEvent deserializePlayerRoleChanged(
        std::string_view clanTag,
        const nlohmann::json& payload);

    static WarEndedEvent deserializeWarEnded(
        std::string_view clanTag,
        const nlohmann::json& payload);

    static RaidsEndedEvent deserializeRaidsEnded(
        std::string_view clanTag,
        const nlohmann::json& payload);

    static ClanwarsLeagueRoundEndedEvent deserializeClanwarsLeagueRoundEnded(
        std::string_view clanTag,
        const nlohmann::json& payload);

    static SyncFailureEvent deserializeSyncFailure(
        std::string_view clanTag,
        const nlohmann::json& payload);

    static SyncRecoveryEvent deserializeSyncRecovery(
        std::string_view clanTag,
        const nlohmann::json& payload);

    static WarReminderEvent deserializeWarReminder(
        std::string_view clanTag,
        const nlohmann::json& payload);

    static RaidReminderEvent deserializeRaidReminder(
        std::string_view clanTag,
        const nlohmann::json& payload);

public:
    static ApplicationEvent deserialize(
        std::string_view clanTag,
        std::string_view eventType,
        std::string_view payload,
        int payloadVersion);
};

#endif // CLASHBOT_DOMAINEVENTPAYLOADDESERIALIZER_H
