#include <gtest/gtest.h>

#include <string>

#include "common/TimeParser.h"
#include "reports/WarReminderFormatter.h"

namespace
{
    WarReminderEvent makeWarEvent(const WarReminderEvent::WarKind warKind)
    {
        return WarReminderEvent{
            .clanTag = "#2J8PJ9VLG",
            .warId = 42,
            .endTime = 1704067200,
            .warKind = warKind,
            .kind = WarReminderEvent::WarReminderKind::Started
        };
    }
}

TEST(WarReminderFormatterTest, FormatsWarStartedReminder)
{
    const auto event = makeWarEvent(WarReminderEvent::WarKind::Regular);

    EXPECT_EQ(
        WarReminderFormatter::formatStartOfWarReminder(event),
        "⚔️ <b>Война кланов началась!</b>\n\n"
        "Клан: <code>#2J8PJ9VLG</code>\n"
        "🕒 Окончание: <b>01.01.2024 03:00</b>\n\n"
        "🎯 Участники войны, не забудьте использовать свои атаки."
    );
}

TEST(WarReminderFormatterTest, FormatsWarSixHoursLeftReminder)
{
    const auto event = makeWarEvent(WarReminderEvent::WarKind::Regular);

    EXPECT_EQ(
        WarReminderFormatter::formatSixHoursLeftReminder(event),
        "⏳ <b>До окончания войны осталось 6 часов</b>\n\n"
        "Клан: <code>#2J8PJ9VLG</code>\n"
        "🕒 Окончание: <b>01.01.2024 03:00</b>\n\n"
        "📢 Участники войны, используйте оставшиеся атаки, пока есть время!"
    );
}

TEST(WarReminderFormatterTest, FormatsWarOneHourLeftReminder)
{
    const auto event = makeWarEvent(WarReminderEvent::WarKind::Regular);

    EXPECT_EQ(
        WarReminderFormatter::formatOneHourLeftReminder(event),
        "🚨 <b>До окончания войны остался 1 час</b>\n\n"
        "Клан: <code>#2J8PJ9VLG</code>\n"
        "🕒 Окончание: <b>01.01.2024 03:00</b>\n\n"
        "⏰ Участники войны, завершите все оставшиеся атаки!"
    );
}

TEST(WarReminderFormatterTest, FormatsCwlStartedReminder)
{
    const auto event = makeWarEvent(WarReminderEvent::WarKind::CWL);

    EXPECT_EQ(
        WarReminderFormatter::formatStartOfCwlReminder(event),
        "⚔️ <b>Раунд ЛВК начался!</b>\n\n"
        "Клан: <code>#2J8PJ9VLG</code>\n"
        "🕒 Окончание: <b>01.01.2024 03:00</b>\n\n"
        "🎯 Участники раунда ЛВК, не забудьте использовать свои атаки."
    );
}

TEST(WarReminderFormatterTest, FormatsCwlSixHoursLeftReminder)
{
    const auto event = makeWarEvent(WarReminderEvent::WarKind::CWL);

    EXPECT_EQ(
        WarReminderFormatter::formatSixHoursLeftCwlReminder(event),
        "⏳ <b>До окончания раунда ЛВК осталось 6 часов</b>\n\n"
        "Клан: <code>#2J8PJ9VLG</code>\n"
        "🕒 Окончание: <b>01.01.2024 03:00</b>\n\n"
        "📢 Участники раунда ЛВК, используйте оставшиеся атаки, пока есть время!"
    );
}

TEST(WarReminderFormatterTest, FormatsCwlOneHourLeftReminder)
{
    const auto event = makeWarEvent(WarReminderEvent::WarKind::CWL);

    EXPECT_EQ(
        WarReminderFormatter::formatOneHourLeftCwlReminder(event),
        "🚨 <b>До окончания раунда ЛВК остался 1 час</b>\n\n"
        "Клан: <code>#2J8PJ9VLG</code>\n"
        "🕒 Окончание: <b>01.01.2024 03:00</b>\n\n"
        "⏰ Участники раунда ЛВК, завершите все оставшиеся атаки!"
    );
}

TEST(WarReminderFormatterTest, EscapesClanTag)
{
    auto event = makeWarEvent(WarReminderEvent::WarKind::Regular);
    event.clanTag = "#<2J8PJ9VLG&>";

    EXPECT_EQ(
        WarReminderFormatter::formatStartOfWarReminder(event),
        "⚔️ <b>Война кланов началась!</b>\n\n"
        "Клан: <code>#&lt;2J8PJ9VLG&amp;&gt;</code>\n"
        "🕒 Окончание: <b>01.01.2024 03:00</b>\n\n"
        "🎯 Участники войны, не забудьте использовать свои атаки."
    );
}

TEST(WarReminderFormatterTest, UsesFormattedWarEndTime)
{
    const auto event = makeWarEvent(WarReminderEvent::WarKind::Regular);
    const auto report = WarReminderFormatter::formatStartOfWarReminder(event);
    const auto expectedTime =
        "🕒 Окончание: <b>" + utils::formatUnixToLocalDateTime(event.endTime) + "</b>";

    EXPECT_NE(report.find(expectedTime), std::string::npos);
}
