#include "reports/RaidReminderFormatter.h"

#include <sstream>

#include "common/StringUtils.h"
#include "common/TimeParser.h"

namespace
{
    void appendRaidDetails(std::ostringstream& message, const RaidReminderEvent& event)
    {
        message << "Клан: <code>"
                << utils::escapeHTML(event.clanTag)
                << "</code>\n"
                << "🕒 Окончание: <b>"
                << utils::formatUnixToLocalDateTime(event.endTime)
                << "</b>\n\n";
    }
}

std::string RaidReminderFormatter::formatStartOfRaidReminder(const RaidReminderEvent& event)
{
    std::ostringstream message;
    message << "🏰 <b>Рейдовые выходные начались!</b>\n\n";
    appendRaidDetails(message, event);
    message << "⚔️ Участники рейда, не забудьте использовать свои атаки.";
    return message.str();
}

std::string RaidReminderFormatter::formatFortyEightHoursLeftReminder(const RaidReminderEvent& event)
{
    std::ostringstream message;
    message << "⏳ <b>До окончания рейдовых выходных осталось 48 часов</b>\n\n";
    appendRaidDetails(message, event);
    message << "📢 Участники рейда, проверьте, что вы начали использовать свои атаки.";
    return message.str();
}

std::string RaidReminderFormatter::formatTwentyFourHoursLeftReminder(const RaidReminderEvent& event)
{
    std::ostringstream message;
    message << "⏳ <b>До окончания рейдовых выходных осталось 24 часа</b>\n\n";
    appendRaidDetails(message, event);
    message << "📢 Участники рейда, не забудьте использовать оставшиеся атаки.";
    return message.str();
}

std::string RaidReminderFormatter::formatSixHoursLeftReminder(const RaidReminderEvent& event)
{
    std::ostringstream message;
    message << "🚨 <b>До окончания рейдовых выходных осталось 6 часов</b>\n\n";
    appendRaidDetails(message, event);
    message << "⚔️ Участники рейда, завершите оставшиеся атаки.";
    return message.str();
}

std::string RaidReminderFormatter::formatOneHourLeftReminder(const RaidReminderEvent& event)
{
    std::ostringstream message;
    message << "🚨 <b>До окончания рейдовых выходных остался 1 час</b>\n\n";
    appendRaidDetails(message, event);
    message << "⏰ Участники рейда, это последнее напоминание — завершите оставшиеся атаки!";
    return message.str();
}
