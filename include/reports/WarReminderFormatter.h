//
// Created by zuevm on 10.08.2026.
//

#ifndef CLASHBOT_WARREMINDERFORMATTER_H
#define CLASHBOT_WARREMINDERFORMATTER_H
#include <string>

#include "events/ApplicationEvents.h"

class WarReminderFormatter
{
public:
    [[nodiscard]] static std::string formatStartOfWarReminder(const WarReminderEvent& event);
    [[nodiscard]] static std::string formatSixHoursLeftReminder(const WarReminderEvent& event);
    [[nodiscard]] static std::string formatOneHourLeftReminder(const WarReminderEvent& event);
    [[nodiscard]] static std::string formatStartOfCwlReminder(const WarReminderEvent& event);
    [[nodiscard]] static std::string formatSixHoursLeftCwlReminder(const WarReminderEvent& event);
    [[nodiscard]] static std::string formatOneHourLeftCwlReminder(const WarReminderEvent& event);
};

#endif //CLASHBOT_WARREMINDERFORMATTER_H
