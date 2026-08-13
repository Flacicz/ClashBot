//
// Created by zuevm on 10.08.2026.
//

#include "reports/WarReminderFormatter.h"

#include <sstream>

#include "common/StringUtils.h"
#include "common/TimeParser.h"

namespace
{
    void appendWarDetails(std::ostringstream& message, const WarReminderEvent& event)
    {
        message << "Клан: <code>"
            << utils::escapeHTML(event.clanTag)
            << "</code>\n"
            << "🕒 Окончание: <b>"
            << utils::formatUnixToLocalDateTime(event.endTime)
            << "</b>\n\n";
    }
}

std::string WarReminderFormatter::formatStartOfWarReminder(const WarReminderEvent& event)
{
    std::ostringstream message;
    message << "⚔️ <b>Война кланов началась!</b>\n\n";
    appendWarDetails(message, event);
    message << "Не забудьте использовать свои атаки.";
    return message.str();
}

std::string WarReminderFormatter::formatSixHoursLeftReminder(const WarReminderEvent& event)
{
    std::ostringstream message;
    message << "⏳ <b>До окончания войны осталось 6 часов</b>\n\n";
    appendWarDetails(message, event);
    message << "📢 Участники войны, не забудьте использовать свои атаки до окончания войны!";
    return message.str();
}

std::string WarReminderFormatter::formatOneHourLeftReminder(const WarReminderEvent& event)
{
    std::ostringstream message;
    message << "🚨 <b>До окончания войны остался 1 час</b>\n\n";
    appendWarDetails(message, event);
    message << "Завершите оставшиеся атаки.";
    return message.str();
}

std::string WarReminderFormatter::formatStartOfCwlReminder(const WarReminderEvent& event)
{
    std::ostringstream message;
    message << "⚔️ <b>Раунд CWL начался!</b>\n\n";
    appendWarDetails(message, event);
    message << "Участники раунда, не забудьте использовать свои атаки.";
    return message.str();
}

std::string WarReminderFormatter::formatSixHoursLeftCwlReminder(const WarReminderEvent& event)
{
    std::ostringstream message;
    message << "⏳ <b>До окончания раунда CWL осталось 6 часов</b>\n\n";
    appendWarDetails(message, event);
    message << "📢 Участники раунда, не забудьте использовать свои атаки до окончания раунда!";
    return message.str();
}

std::string WarReminderFormatter::formatOneHourLeftCwlReminder(const WarReminderEvent& event)
{
    std::ostringstream message;
    message << "🚨 <b>До окончания раунда CWL остался 1 час</b>\n\n";
    appendWarDetails(message, event);
    message << "Участники раунда, завершите оставшиеся атаки.";
    return message.str();
}
