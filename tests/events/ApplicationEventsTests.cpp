#include "events/ApplicationEvents.h"

#include <gtest/gtest.h>

TEST(ApplicationEventKeyTest, ReturnsKeysForPersistentEvents)
{
    const WarEndedEvent warEnded{
        "#CLAN",
        ClanwarReference{"#CLAN", 101, 1, 2}
    };
    const RaidsEndedEvent raidsEnded{
        "#CLAN",
        RaidReference{202}
    };
    const ClanwarsLeagueRoundEndedEvent cwlRoundEnded{
        "#CLAN",
        202409,
        ClanwarReference{"#CLAN", 303, 1, 2}
    };

    EXPECT_EQ("101", warEnded.key());
    EXPECT_EQ("202", raidsEnded.key());
    EXPECT_EQ("303", cwlRoundEnded.key());
}

TEST(ApplicationEventKeyTest, ReturnsKeysForEveryWarReminderKind)
{
    const auto makeEvent = [](const WarReminderEvent::WarReminderKind kind)
    {
        return WarReminderEvent{
            "#CLAN",
            404,
            0,
            WarReminderEvent::WarKind::Regular,
            kind
        };
    };

    EXPECT_EQ("404:started", makeEvent(WarReminderEvent::WarReminderKind::Started).key());
    EXPECT_EQ(
        "404:six_hours_left",
        makeEvent(WarReminderEvent::WarReminderKind::SixHoursLeft).key());
    EXPECT_EQ(
        "404:one_hour_left",
        makeEvent(WarReminderEvent::WarReminderKind::OneHourLeft).key());
}

TEST(ApplicationEventKeyTest, ReturnsKeysForEveryRaidReminderKind)
{
    const auto makeEvent = [](const RaidReminderEvent::RaidReminderKind kind)
    {
        return RaidReminderEvent{
            "#CLAN",
            RaidReference{505},
            0,
            kind
        };
    };

    EXPECT_EQ(
        "505:started",
        makeEvent(RaidReminderEvent::RaidReminderKind::Started).key());
    EXPECT_EQ(
        "505:forty_eight_hours_left",
        makeEvent(RaidReminderEvent::RaidReminderKind::FortyEightHoursLeft).key());
    EXPECT_EQ(
        "505:twenty_four_hours_left",
        makeEvent(RaidReminderEvent::RaidReminderKind::TwentyFourHoursLeft).key());
    EXPECT_EQ(
        "505:six_hours_left",
        makeEvent(RaidReminderEvent::RaidReminderKind::SixHoursLeft).key());
    EXPECT_EQ(
        "505:one_hour_left",
        makeEvent(RaidReminderEvent::RaidReminderKind::OneHourLeft).key());
}

TEST(ApplicationEventKindNameTest, ReturnsEveryWarReminderName)
{
    EXPECT_EQ(
        "started",
        WarReminderEvent::kindName(WarReminderEvent::WarReminderKind::Started));
    EXPECT_EQ(
        "six_hours_left",
        WarReminderEvent::kindName(WarReminderEvent::WarReminderKind::SixHoursLeft));
    EXPECT_EQ(
        "one_hour_left",
        WarReminderEvent::kindName(WarReminderEvent::WarReminderKind::OneHourLeft));
}

TEST(ApplicationEventKindNameTest, ReturnsEveryRaidReminderName)
{
    EXPECT_EQ(
        "started",
        RaidReminderEvent::kindName(RaidReminderEvent::RaidReminderKind::Started));
    EXPECT_EQ(
        "forty_eight_hours_left",
        RaidReminderEvent::kindName(
            RaidReminderEvent::RaidReminderKind::FortyEightHoursLeft));
    EXPECT_EQ(
        "twenty_four_hours_left",
        RaidReminderEvent::kindName(
            RaidReminderEvent::RaidReminderKind::TwentyFourHoursLeft));
    EXPECT_EQ(
        "six_hours_left",
        RaidReminderEvent::kindName(RaidReminderEvent::RaidReminderKind::SixHoursLeft));
    EXPECT_EQ(
        "one_hour_left",
        RaidReminderEvent::kindName(RaidReminderEvent::RaidReminderKind::OneHourLeft));
}

TEST(ApplicationEventKeyTest, UsesUnknownNameForInvalidReminderKind)
{
    const auto warEvent = WarReminderEvent{
        "#CLAN",
        606,
        0,
        WarReminderEvent::WarKind::CWL,
        static_cast<WarReminderEvent::WarReminderKind>(999)
    };
    const auto raidEvent = RaidReminderEvent{
        "#CLAN",
        RaidReference{707},
        0,
        static_cast<RaidReminderEvent::RaidReminderKind>(999)
    };

    EXPECT_EQ("unknown", WarReminderEvent::kindName(warEvent.kind));
    EXPECT_EQ("unknown", RaidReminderEvent::kindName(raidEvent.kind));
    EXPECT_EQ("606:unknown", warEvent.key());
    EXPECT_EQ("707:unknown", raidEvent.key());
}

TEST(ApplicationEventTypeTest, ExposesStableEventTypes)
{
    EXPECT_STREQ("war_ended", WarEndedEvent::Type);
    EXPECT_STREQ("raids_ended", RaidsEndedEvent::Type);
    EXPECT_STREQ("cwl_round_ended", ClanwarsLeagueRoundEndedEvent::Type);
    EXPECT_STREQ("war_reminder", WarReminderEvent::Type);
    EXPECT_STREQ("raid_reminder", RaidReminderEvent::Type);
}
