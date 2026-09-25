#include "domain_events/DomainEventPayloadDeserializer.h"

#include <nlohmann/json.hpp>

#include <stdexcept>
#include <string>

namespace
{
    ClanwarReference deserializeClanwarReference(const nlohmann::json& reference)
    {
        return ClanwarReference{
            .clanTag = reference.at("clan_tag").get<std::string>(),
            .warId = reference.at("war_id").get<long long>(),
            .homeClanId = reference.at("home_clan_id").get<long long>(),
            .opponentClanId = reference.at("opponent_clan_id").get<long long>()
        };
    }

    WarReminderEvent::WarKind deserializeWarKind(const std::string_view warKind)
    {
        if (warKind == "regular")
            return WarReminderEvent::WarKind::Regular;
        if (warKind == "cwl")
            return WarReminderEvent::WarKind::CWL;

        throw std::invalid_argument(
            "DomainEventPayloadDeserializer: unknown war kind '" + std::string(warKind) + "'");
    }

    WarReminderEvent::WarReminderKind deserializeWarReminderKind(const std::string_view kind)
    {
        if (kind == "started")
            return WarReminderEvent::WarReminderKind::Started;
        if (kind == "six_hours_left")
            return WarReminderEvent::WarReminderKind::SixHoursLeft;
        if (kind == "one_hour_left")
            return WarReminderEvent::WarReminderKind::OneHourLeft;

        throw std::invalid_argument(
            "DomainEventPayloadDeserializer: unknown war reminder kind '" + std::string(kind) + "'");
    }

    RaidReminderEvent::RaidReminderKind deserializeRaidReminderKind(const std::string_view kind)
    {
        if (kind == "started")
            return RaidReminderEvent::RaidReminderKind::Started;
        if (kind == "forty_eight_hours_left")
            return RaidReminderEvent::RaidReminderKind::FortyEightHoursLeft;
        if (kind == "twenty_four_hours_left")
            return RaidReminderEvent::RaidReminderKind::TwentyFourHoursLeft;
        if (kind == "six_hours_left")
            return RaidReminderEvent::RaidReminderKind::SixHoursLeft;
        if (kind == "one_hour_left")
            return RaidReminderEvent::RaidReminderKind::OneHourLeft;

        throw std::invalid_argument(
            "DomainEventPayloadDeserializer: unknown raid reminder kind '" + std::string(kind) + "'");
    }
}

ApplicationEvent DomainEventPayloadDeserializer::deserialize(
    const std::string_view clanTag,
    const std::string_view eventType,
    const std::string_view payload,
    const int payloadVersion)
{
    if (payloadVersion != currentPayloadVersion)
    {
        throw std::invalid_argument(
            "DomainEventPayloadDeserializer: unsupported payload version " +
            std::to_string(payloadVersion));
    }

    const auto json = nlohmann::json::parse(std::string(payload));

    if (eventType == PlayerJoinedClanEvent::Type)
        return deserializePlayerJoined(clanTag, json);
    if (eventType == PlayerLeftClanEvent::Type)
        return deserializePlayerLeft(clanTag, json);
    if (eventType == PlayerRoleChangedEvent::Type)
        return deserializePlayerRoleChanged(clanTag, json);
    if (eventType == WarEndedEvent::Type)
        return deserializeWarEnded(clanTag, json);
    if (eventType == RaidsEndedEvent::Type)
        return deserializeRaidsEnded(clanTag, json);
    if (eventType == ClanwarsLeagueRoundEndedEvent::Type)
        return deserializeClanwarsLeagueRoundEnded(clanTag, json);
    if (eventType == SyncFailureEvent::Type)
        return deserializeSyncFailure(clanTag, json);
    if (eventType == SyncRecoveryEvent::Type)
        return deserializeSyncRecovery(clanTag, json);
    if (eventType == WarReminderEvent::Type)
        return deserializeWarReminder(clanTag, json);
    if (eventType == RaidReminderEvent::Type)
        return deserializeRaidReminder(clanTag, json);

    throw std::invalid_argument(
        "DomainEventPayloadDeserializer: unknown event type '" + std::string(eventType) + "'");
}

PlayerJoinedClanEvent DomainEventPayloadDeserializer::deserializePlayerJoined(
    const std::string_view clanTag,
    const nlohmann::json& payload)
{
    return PlayerJoinedClanEvent{
        .clanTag = std::string(clanTag),
        .playerTag = payload.at("player_tag").get<std::string>(),
        .playerName = payload.at("player_name").get<std::string>(),
        .membershipId = payload.at("membership_id").get<long long>()
    };
}

PlayerLeftClanEvent DomainEventPayloadDeserializer::deserializePlayerLeft(
    const std::string_view clanTag,
    const nlohmann::json& payload)
{
    return PlayerLeftClanEvent{
        .clanTag = std::string(clanTag),
        .playerTag = payload.at("player_tag").get<std::string>(),
        .playerName = payload.at("player_name").get<std::string>(),
        .membershipId = payload.at("membership_id").get<long long>()
    };
}

PlayerRoleChangedEvent DomainEventPayloadDeserializer::deserializePlayerRoleChanged(
    const std::string_view clanTag,
    const nlohmann::json& payload)
{
    return PlayerRoleChangedEvent{
        .clanTag = std::string(clanTag),
        .playerTag = payload.at("player_tag").get<std::string>(),
        .playerName = payload.at("player_name").get<std::string>(),
        .oldRole = payload.at("old_role").get<std::string>(),
        .newRole = payload.at("new_role").get<std::string>(),
        .snapshotId = payload.at("snapshot_id").get<long long>()
    };
}

WarEndedEvent DomainEventPayloadDeserializer::deserializeWarEnded(
    const std::string_view clanTag,
    const nlohmann::json& payload)
{
    return WarEndedEvent{
        .clanTag = std::string(clanTag),
        .warReference = deserializeClanwarReference(payload.at("war_reference"))
    };
}

RaidsEndedEvent DomainEventPayloadDeserializer::deserializeRaidsEnded(
    const std::string_view clanTag,
    const nlohmann::json& payload)
{
    return RaidsEndedEvent{
        .clanTag = std::string(clanTag),
        .raidReference = RaidReference{
            .raidId = payload.at("raid_reference").at("raid_id").get<long long>()
        }
    };
}

ClanwarsLeagueRoundEndedEvent DomainEventPayloadDeserializer::deserializeClanwarsLeagueRoundEnded(
    const std::string_view clanTag,
    const nlohmann::json& payload)
{
    return ClanwarsLeagueRoundEndedEvent{
        .clanTag = std::string(clanTag),
        .cwlSeasonId = payload.at("cwl_season_id").get<long long>(),
        .warReference = deserializeClanwarReference(payload.at("war_reference"))
    };
}

SyncFailureEvent DomainEventPayloadDeserializer::deserializeSyncFailure(
    const std::string_view clanTag,
    const nlohmann::json& payload)
{
    return SyncFailureEvent{
        .clanTag = std::string(clanTag),
        .serviceName = payload.at("service_name").get<std::string>(),
        .errorMsg = payload.at("error_message").get<std::string>(),
        .attempts = payload.at("attempts").get<int>(),
        .outageId = payload.at("outage_id").get<long long>()
    };
}

SyncRecoveryEvent DomainEventPayloadDeserializer::deserializeSyncRecovery(
    const std::string_view clanTag,
    const nlohmann::json& payload)
{
    return SyncRecoveryEvent{
        .clanTag = std::string(clanTag),
        .serviceName = payload.at("service_name").get<std::string>(),
        .outageId = payload.at("outage_id").get<long long>()
    };
}

WarReminderEvent DomainEventPayloadDeserializer::deserializeWarReminder(
    const std::string_view clanTag,
    const nlohmann::json& payload)
{
    const auto warKind = payload.at("war_kind").get<std::string>();
    const auto reminderKind = payload.at("reminder_kind").get<std::string>();

    return WarReminderEvent{
        .clanTag = std::string(clanTag),
        .warId = payload.at("war_id").get<long long>(),
        .endTime = payload.at("end_time").get<long long>(),
        .warKind = deserializeWarKind(warKind),
        .kind = deserializeWarReminderKind(reminderKind)
    };
}

RaidReminderEvent DomainEventPayloadDeserializer::deserializeRaidReminder(
    const std::string_view clanTag,
    const nlohmann::json& payload)
{
    const auto reminderKind = payload.at("reminder_kind").get<std::string>();

    return RaidReminderEvent{
        .clanTag = std::string(clanTag),
        .raidReference = RaidReference{
            .raidId = payload.at("raid_reference").at("raid_id").get<long long>()
        },
        .endTime = payload.at("end_time").get<long long>(),
        .kind = deserializeRaidReminderKind(reminderKind)
    };
}
