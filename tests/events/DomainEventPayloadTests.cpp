#include "domain_events/DomainEventPayloadDeserializer.h"
#include "domain_events/DomainEventPayloadSerializer.h"

#include <nlohmann/json.hpp>

#include <stdexcept>
#include <string>
#include <vector>

#include <gtest/gtest.h>

namespace
{
    struct PayloadCase
    {
        ApplicationEvent event;
        std::string eventType;
        std::string eventId;
        nlohmann::json payload;
    };

    constexpr std::string_view clanTag = "#2PPLQ";

    std::vector<PayloadCase> applicationEvents()
    {
        return {
            {
                PlayerJoinedClanEvent{std::string(clanTag), "#P1", "Alice & Bob", 11},
                "PlayerJoinedClanEvent", "11",
                {{"player_tag", "#P1"}, {"player_name", "Alice & Bob"}, {"membership_id", 11}}
            },
            {
                PlayerLeftClanEvent{std::string(clanTag), "#P2", "Eve", 12},
                "PlayerLeftClanEvent", "12",
                {{"player_tag", "#P2"}, {"player_name", "Eve"}, {"membership_id", 12}}
            },
            {
                PlayerRoleChangedEvent{std::string(clanTag), "#P3", "Carl", "member", "elder", 13},
                "PlayerRoleChangedEvent", "13",
                {{"player_tag", "#P3"}, {"player_name", "Carl"}, {"old_role", "member"},
                 {"new_role", "elder"}, {"snapshot_id", 13}}
            },
            {
                WarEndedEvent{std::string(clanTag), ClanwarReference{std::string(clanTag), 21, 22, 23}},
                "war_ended", "21",
                {{"war_reference", {{"clan_tag", clanTag}, {"war_id", 21},
                                    {"home_clan_id", 22}, {"opponent_clan_id", 23}}}}
            },
            {
                RaidsEndedEvent{std::string(clanTag), RaidReference{31}},
                "raids_ended", "31", {{"raid_reference", {{"raid_id", 31}}}}
            },
            {
                ClanwarsLeagueRoundEndedEvent{
                    std::string(clanTag), 41, ClanwarReference{std::string(clanTag), 42, 43, 44}},
                "cwl_round_ended", "42",
                {{"cwl_season_id", 41},
                 {"war_reference", {{"clan_tag", clanTag}, {"war_id", 42},
                                    {"home_clan_id", 43}, {"opponent_clan_id", 44}}}}
            },
            {
                SyncFailureEvent{std::string(clanTag), "RaidService", "timeout", 3, 51},
                "SyncFailureEvent", "51",
                {{"service_name", "RaidService"}, {"error_message", "timeout"},
                 {"attempts", 3}, {"outage_id", 51}}
            },
            {
                SyncRecoveryEvent{std::string(clanTag), "RaidService", 51},
                "SyncRecoveryEvent", "51",
                {{"service_name", "RaidService"}, {"outage_id", 51}}
            },
            {
                WarReminderEvent{std::string(clanTag), 61, 1700,
                                 WarReminderEvent::WarKind::CWL,
                                 WarReminderEvent::WarReminderKind::SixHoursLeft},
                "war_reminder", "61:six_hours_left",
                {{"war_id", 61}, {"end_time", 1700}, {"war_kind", "cwl"},
                 {"reminder_kind", "six_hours_left"}}
            },
            {
                RaidReminderEvent{std::string(clanTag), RaidReference{71}, 1800,
                                  RaidReminderEvent::RaidReminderKind::FortyEightHoursLeft},
                "raid_reminder", "71:forty_eight_hours_left",
                {{"raid_reference", {{"raid_id", 71}}}, {"end_time", 1800},
                 {"reminder_kind", "forty_eight_hours_left"}}
            }
        };
    }
}

TEST(DomainEventPayloadTest, EveryApplicationEventRoundTripsWithItsPersistedContract)
{
    const DomainEventPayloadSerializer serializer;

    for (const auto& testCase : applicationEvents())
    {
        SCOPED_TRACE(testCase.eventType);

        const auto record = serializer.serialize(testCase.event);
        EXPECT_EQ(testCase.eventType, record.eventType);
        EXPECT_EQ(testCase.eventId, record.eventId);
        EXPECT_EQ(clanTag, record.clanTag);
        EXPECT_EQ(1, record.payloadVersion);
        EXPECT_EQ(testCase.payload, nlohmann::json::parse(record.payload));

        const auto restored = DomainEventPayloadDeserializer::deserialize(
            record.clanTag, record.eventType, record.payload, record.payloadVersion);
        EXPECT_EQ(testCase.event.index(), restored.index());

        const auto restoredRecord = serializer.serialize(restored);
        EXPECT_EQ(record.eventId, restoredRecord.eventId);
        EXPECT_EQ(record.eventType, restoredRecord.eventType);
        EXPECT_EQ(testCase.payload, nlohmann::json::parse(restoredRecord.payload));
    }
}

TEST(DomainEventPayloadTest, RejectsUnknownTypeVersionAndMalformedPayload)
{
    EXPECT_THROW(
        DomainEventPayloadDeserializer::deserialize(clanTag, "UnknownEvent", "{}", 1),
        std::invalid_argument);
    EXPECT_THROW(
        DomainEventPayloadDeserializer::deserialize(clanTag, PlayerJoinedClanEvent::Type, "{}", 2),
        std::invalid_argument);
    EXPECT_THROW(
        DomainEventPayloadDeserializer::deserialize(clanTag, PlayerJoinedClanEvent::Type, "{", 1),
        nlohmann::json::parse_error);
    EXPECT_THROW(
        DomainEventPayloadDeserializer::deserialize(clanTag, PlayerJoinedClanEvent::Type, "{}", 1),
        nlohmann::json::out_of_range);
}
