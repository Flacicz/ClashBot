#include <gtest/gtest.h>

#include <string>

#include "common/TimeParser.h"
#include "reports/RaidReminderFormatter.h"

namespace
{
    RaidReminderEvent makeRaidEvent()
    {
        return RaidReminderEvent{
            .clanTag = "#2J8PJ9VLG",
            .raidId = 42,
            .endTime = 1704067200,
            .kind = RaidReminderEvent::RaidReminderKind::Started
        };
    }
}

TEST(RaidReminderFormatterTest, FormatsRaidStartedReminder)
{
    const auto event = makeRaidEvent();

    EXPECT_EQ(
        RaidReminderFormatter::formatStartOfRaidReminder(event),
        "🏰 <b>Рейдовые выходные начались!</b>\n\n"
        "Клан: <code>#2J8PJ9VLG</code>\n"
        "🕒 Окончание: <b>01.01.2024 03:00</b>\n\n"
        "⚔️ Участники рейда, не забудьте использовать свои атаки."
    );
}

TEST(RaidReminderFormatterTest, FormatsRaidFortyEightHoursLeftReminder)
{
    const auto event = makeRaidEvent();

    EXPECT_EQ(
        RaidReminderFormatter::formatFortyEightHoursLeftReminder(event),
        "⏳ <b>До окончания рейдовых выходных осталось 48 часов</b>\n\n"
        "Клан: <code>#2J8PJ9VLG</code>\n"
        "🕒 Окончание: <b>01.01.2024 03:00</b>\n\n"
        "📢 Участники рейда, проверьте, что вы начали использовать свои атаки."
    );
}

TEST(RaidReminderFormatterTest, FormatsRaidTwentyFourHoursLeftReminder)
{
    const auto event = makeRaidEvent();

    EXPECT_EQ(
        RaidReminderFormatter::formatTwentyFourHoursLeftReminder(event),
        "⏳ <b>До окончания рейдовых выходных осталось 24 часа</b>\n\n"
        "Клан: <code>#2J8PJ9VLG</code>\n"
        "🕒 Окончание: <b>01.01.2024 03:00</b>\n\n"
        "📢 Участники рейда, не забудьте использовать оставшиеся атаки."
    );
}

TEST(RaidReminderFormatterTest, FormatsRaidSixHoursLeftReminder)
{
    const auto event = makeRaidEvent();

    EXPECT_EQ(
        RaidReminderFormatter::formatSixHoursLeftReminder(event),
        "🚨 <b>До окончания рейдовых выходных осталось 6 часов</b>\n\n"
        "Клан: <code>#2J8PJ9VLG</code>\n"
        "🕒 Окончание: <b>01.01.2024 03:00</b>\n\n"
        "⚔️ Участники рейда, завершите оставшиеся атаки."
    );
}

TEST(RaidReminderFormatterTest, FormatsRaidOneHourLeftReminder)
{
    const auto event = makeRaidEvent();

    EXPECT_EQ(
        RaidReminderFormatter::formatOneHourLeftReminder(event),
        "🚨 <b>До окончания рейдовых выходных остался 1 час</b>\n\n"
        "Клан: <code>#2J8PJ9VLG</code>\n"
        "🕒 Окончание: <b>01.01.2024 03:00</b>\n\n"
        "⏰ Участники рейда, это последнее напоминание — завершите оставшиеся атаки!"
    );
}

TEST(RaidReminderFormatterTest, EscapesClanTag)
{
    auto event = makeRaidEvent();
    event.clanTag = "#<2J8PJ9VLG&>";

    EXPECT_EQ(
        RaidReminderFormatter::formatStartOfRaidReminder(event),
        "🏰 <b>Рейдовые выходные начались!</b>\n\n"
        "Клан: <code>#&lt;2J8PJ9VLG&amp;&gt;</code>\n"
        "🕒 Окончание: <b>01.01.2024 03:00</b>\n\n"
        "⚔️ Участники рейда, не забудьте использовать свои атаки."
    );
}

TEST(RaidReminderFormatterTest, UsesFormattedRaidEndTime)
{
    const auto event = makeRaidEvent();
    const auto report = RaidReminderFormatter::formatStartOfRaidReminder(event);
    const auto expectedTime =
        "🕒 Окончание: <b>" + utils::formatUnixToLocalDateTime(event.endTime) + "</b>";

    EXPECT_NE(report.find(expectedTime), std::string::npos);
}
