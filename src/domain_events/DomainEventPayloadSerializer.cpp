#include "domain_events/DomainEventPayloadSerializer.h"

#include <nlohmann/json.hpp>

namespace
{
    template <typename Event>
    DomainEventRecord makeRecord(const Event& event,
                                 nlohmann::json payload,
                                 const int payloadVersion)
    {
        return DomainEventRecord{
            .eventType = Event::Type,
            .eventId = event.key(),
            .payload = payload.dump(),
            .payloadVersion = payloadVersion,
            .clanTag = event.clanTag,
        };
    }

    nlohmann::json serializeClanwarReference(const ClanwarReference& reference)
    {
        return {
            {"clan_tag", reference.clanTag},
            {"war_id", reference.warId},
            {"home_clan_id", reference.homeClanId},
            {"opponent_clan_id", reference.opponentClanId}
        };
    }

    std::string_view warKindName(const WarReminderEvent::WarKind kind)
    {
        switch (kind)
        {
        case WarReminderEvent::WarKind::Regular:
            return "regular";
        case WarReminderEvent::WarKind::CWL:
            return "cwl";
        }

        return "unknown";
    }
}

DomainEventRecord DomainEventPayloadSerializer::serialize(const ApplicationEvent& event) const
{
    return std::visit(
        [](const auto& concreteEvent)
        {
            return serializeConcrete(concreteEvent);
        },
        event);
}

DomainEventRecord DomainEventPayloadSerializer::serializeConcrete(const PlayerJoinedClanEvent& event)
{
    const nlohmann::json payload = {
        {"player_tag", event.playerTag},
        {"player_name", event.playerName},
        {"membership_id", event.membershipId}
    };

    return makeRecord(event, payload, currentPayloadVersion);
}

DomainEventRecord DomainEventPayloadSerializer::serializeConcrete(const PlayerLeftClanEvent& event)
{
    const nlohmann::json payload = {
        {"player_tag", event.playerTag},
        {"player_name", event.playerName},
        {"membership_id", event.membershipId}
    };

    return makeRecord(event, payload, currentPayloadVersion);
}

DomainEventRecord DomainEventPayloadSerializer::serializeConcrete(const PlayerRoleChangedEvent& event)
{
    const nlohmann::json payload = {
        {"player_tag", event.playerTag},
        {"player_name", event.playerName},
        {"old_role", event.oldRole},
        {"new_role", event.newRole},
        {"snapshot_id", event.snapshotId}
    };

    return makeRecord(event, payload, currentPayloadVersion);
}

DomainEventRecord DomainEventPayloadSerializer::serializeConcrete(const WarEndedEvent& event)
{
    const nlohmann::json payload = {
        {"war_reference", serializeClanwarReference(event.warReference)}
    };

    return makeRecord(event, payload, currentPayloadVersion);
}

DomainEventRecord DomainEventPayloadSerializer::serializeConcrete(const RaidsEndedEvent& event)
{
    const nlohmann::json payload = {
        {"raid_reference", {
            {"raid_id", event.raidReference.raidId}
        }}
    };

    return makeRecord(event, payload, currentPayloadVersion);
}

DomainEventRecord DomainEventPayloadSerializer::serializeConcrete(
    const ClanwarsLeagueRoundEndedEvent& event)
{
    const nlohmann::json payload = {
        {"cwl_season_id", event.cwlSeasonId},
        {"war_reference", serializeClanwarReference(event.warReference)}
    };

    return makeRecord(event, payload, currentPayloadVersion);
}

DomainEventRecord DomainEventPayloadSerializer::serializeConcrete(const SyncFailureEvent& event)
{
    const nlohmann::json payload = {
        {"service_name", event.serviceName},
        {"error_message", event.errorMsg},
        {"attempts", event.attempts},
        {"outage_id", event.outageId}
    };

    return makeRecord(event, payload, currentPayloadVersion);
}

DomainEventRecord DomainEventPayloadSerializer::serializeConcrete(const SyncRecoveryEvent& event)
{
    const nlohmann::json payload = {
        {"service_name", event.serviceName},
        {"outage_id", event.outageId}
    };

    return makeRecord(event, payload, currentPayloadVersion);
}

DomainEventRecord DomainEventPayloadSerializer::serializeConcrete(const WarReminderEvent& event)
{
    const nlohmann::json payload = {
        {"war_id", event.warId},
        {"end_time", event.endTime},
        {"war_kind", std::string(warKindName(event.warKind))},
        {"reminder_kind", std::string(WarReminderEvent::kindName(event.kind))}
    };

    return makeRecord(event, payload, currentPayloadVersion);
}

DomainEventRecord DomainEventPayloadSerializer::serializeConcrete(const RaidReminderEvent& event)
{
    const nlohmann::json payload = {
        {"raid_reference", {
            {"raid_id", event.raidReference.raidId}
        }},
        {"end_time", event.endTime},
        {"reminder_kind", std::string(RaidReminderEvent::kindName(event.kind))}
    };

    return makeRecord(event, payload, currentPayloadVersion);
}
