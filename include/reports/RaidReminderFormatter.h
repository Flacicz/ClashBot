#ifndef CLASHBOT_RAIDREMINDERFORMATTER_H
#define CLASHBOT_RAIDREMINDERFORMATTER_H

#include <string>

#include "events/ApplicationEvents.h"

class RaidReminderFormatter
{
public:
    [[nodiscard]] static std::string formatStartOfRaidReminder(const RaidReminderEvent& event);
    [[nodiscard]] static std::string formatFortyEightHoursLeftReminder(const RaidReminderEvent& event);
    [[nodiscard]] static std::string formatTwentyFourHoursLeftReminder(const RaidReminderEvent& event);
    [[nodiscard]] static std::string formatSixHoursLeftReminder(const RaidReminderEvent& event);
    [[nodiscard]] static std::string formatOneHourLeftReminder(const RaidReminderEvent& event);
};

#endif // CLASHBOT_RAIDREMINDERFORMATTER_H
