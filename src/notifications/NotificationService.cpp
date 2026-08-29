#include "notifications/NotificationService.h"
#include "core/Exceptions.h"
#include <spdlog/spdlog.h>

#include "reports/SystemAlertReportFormatter.h"
#include "reports/RaidReminderFormatter.h"
#include "reports/WarReminderFormatter.h"

NotificationService::NotificationService(NotificationRepo& notification_repo,
                                         SubscriptionRepo& subscription_repo,
                                         TelegramNotifier telegram_notifier,
                                         const PlayerJoinedFormatter playerJoinedFormatter,
                                         const PlayerLeftFormatter playerLeftFormatter,
                                         const PlayerRoleChangedFormatter playerRoleChangedFormatter,
                                         const RaidsEndedFormatter raidsEndedFormatter,
                                         const RaidsComparisonFormatter raidsComparisonFormatter,
                                         const RaidsViolationsFormatter raidsViolationsFormatter,
                                         const ClanwarEndedFormatter clanwarEndedFormatter,
                                         const ClanwarViolationsFormatter clanwarViolationsFormatter,
                                         const ClanwarComparisonFormatter clanwarComparisonFormatter,
                                         const ClanwarRosterFormatter clanwarRosterFormatter,
                                         const ClanwarsLeagueRoundEndedFormatter clanwarLeagueRoundEndedFormatter,
                                         const ClanwarsLeagueRoundViolationsFormatter
                                         clanwarLeagueRoundViolationsFormatter) :
    notification_repo_(notification_repo),
    subscription_repo_(subscription_repo),
    telegramNotifier(std::move(telegram_notifier)),
    playerJoinedFormatter(playerJoinedFormatter),
    playerLeftFormatter(playerLeftFormatter),
    playerRoleChangedFormatter(playerRoleChangedFormatter),
    raidsEndedFormatter(raidsEndedFormatter),
    raidsComparisonFormatter(raidsComparisonFormatter),
    raidsViolationsFormatter(raidsViolationsFormatter),
    clanwarEndedFormatter(clanwarEndedFormatter),
    clanwarViolationsFormatter(clanwarViolationsFormatter),
    clanwarComparisonFormatter(clanwarComparisonFormatter),
    clanwarRosterFormatter(clanwarRosterFormatter),
    clanwarLeagueRoundEndedFormatter(clanwarLeagueRoundEndedFormatter),
    clanwarLeagueRoundViolationsFormatter(clanwarLeagueRoundViolationsFormatter)
{
}

void NotificationService::sendToDestinations(const std::string_view clanTag,
                                             const std::string_view eventName,
                                             const std::string& message,
                                             const Audience audience) const
{
    const auto destinations = subscription_repo_.getDestinationsForClan(clanTag, audience);

    for (const auto& [chatId, messageThreadId] : destinations)
    {
        try
        {
            telegramNotifier.sendMessage(chatId, message, messageThreadId);
        }
        catch (const ApiException& error)
        {
            spdlog::error(
                "[NotificationService] Failed to send {} message. ClanTag - {}, Chat ID - {}, Error - {}",
                eventName,
                clanTag,
                chatId,
                error.what());
        }
    }
}

void NotificationService::sendToDestinationsWithDeduplication(const std::string_view clanTag,
                                                              const std::string_view eventType,
                                                              const std::string_view eventId,
                                                              const std::string_view eventName,
                                                              const std::string& message,
                                                              const Audience audience) const
{
    const auto destinations = subscription_repo_.getDestinationsForClan(clanTag, audience);

    for (const auto& [chatId, messageThreadId] : destinations)
    {
        if (notification_repo_.wasSent(eventType,
                                       eventId,
                                       chatId,
                                       messageThreadId))
            continue;

        try
        {
            telegramNotifier.sendMessage(chatId, message, messageThreadId);

            notification_repo_.markAsSent(eventType,
                                          eventId,
                                          chatId,
                                          messageThreadId);
        }
        catch (const ApiException& error)
        {
            spdlog::error(
                "[NotificationService] Failed to send {} message. ClanTag - {}, Chat ID - {}, Error - {}",
                eventName,
                clanTag,
                chatId,
                error.what());
        }
    }
}

void NotificationService::handle(const ApplicationEvent& application_event)
{
    std::visit(
        [this](auto&& e)
        {
            handleEvent(e);
        },
        application_event
    );
}

void NotificationService::handleEvent(const PlayerJoinedClanEvent& event) const
{
    const auto message = playerJoinedFormatter.format(event);
    sendToDestinations(event.clanTag, "PlayerJoinedClanEvent", message, Audience::Players);
}

void NotificationService::handleEvent(const PlayerLeftClanEvent& event) const
{
    const auto message = playerLeftFormatter.format(event);
    sendToDestinations(event.clanTag, "PlayerLeftClanEvent", message, Audience::Players);
}

void NotificationService::handleEvent(const PlayerRoleChangedEvent& event) const
{
    const auto message = playerRoleChangedFormatter.format(event);
    sendToDestinations(event.clanTag, "PlayerRoleChangedEvent", message, Audience::Players);
}

void NotificationService::handleEvent(const RaidsEndedEvent& event) const
{
    const auto message = raidsEndedFormatter.format(event);
    sendToDestinationsWithDeduplication(event.clanTag,
                                        RaidsEndedEvent::Type,
                                        event.key(),
                                        "RaidsReport",
                                        message,
                                        Audience::Players);

    const auto comparisonMessage = raidsComparisonFormatter.format(event);
    if (!comparisonMessage.empty())
    {
        sendToDestinationsWithDeduplication(
            event.clanTag,
            RaidsComparisonFormatter::EventType,
            event.key(),
            "RaidsComparisonReport",
            comparisonMessage,
            Audience::Players
        );
    }

    const auto violationsMessage = raidsViolationsFormatter.format(event);
    sendToDestinationsWithDeduplication(event.clanTag,
                                        RaidsViolationsFormatter::EventType,
                                        event.key(),
                                        "RaidsViolationsReport",
                                        violationsMessage,
                                        Audience::Management);
}

void NotificationService::handleEvent(const WarEndedEvent& event) const
{
    const auto message = clanwarEndedFormatter.format(event);
    sendToDestinationsWithDeduplication(event.clanTag,
                                        WarEndedEvent::Type,
                                        event.key(),
                                        "WarReport",
                                        message,
                                        Audience::Players);

    const auto violationsMessage = clanwarViolationsFormatter.format(event);
    sendToDestinationsWithDeduplication(event.clanTag,
                                        ClanwarViolationsFormatter::EventType,
                                        event.key(),
                                        "WarViolationsReport",
                                        violationsMessage,
                                        Audience::Management);

    const auto comparisonMessage = clanwarComparisonFormatter.format(event);
    if (!comparisonMessage.empty())
    {
        sendToDestinationsWithDeduplication(event.clanTag,
                                            ClanwarComparisonFormatter::EventType,
                                            event.key(),
                                            "WarComparisonReport",
                                            comparisonMessage,
                                            Audience::Players);
    }

    const auto rosterMessage = clanwarRosterFormatter.format(event);
    if (!rosterMessage.empty())
    {
        sendToDestinationsWithDeduplication(event.clanTag,
                                            ClanwarRosterFormatter::EventType,
                                            event.key(),
                                            "WarRosterReport",
                                            rosterMessage,
                                            Audience::Management);
    }
}

void NotificationService::handleEvent(const ClanwarsLeagueRoundEndedEvent& event) const
{
    const auto message = clanwarLeagueRoundEndedFormatter.format(event);
    sendToDestinationsWithDeduplication(event.clanTag,
                                        ClanwarsLeagueRoundEndedEvent::Type,
                                        event.key(),
                                        "CwlRoundReport",
                                        message,
                                        Audience::Players);

    const auto violationsMessage = clanwarLeagueRoundViolationsFormatter.format(event);
    sendToDestinationsWithDeduplication(event.clanTag,
                                        ClanwarsLeagueRoundViolationsFormatter::EventType,
                                        event.key(),
                                        "CwlRoundViolationsReport",
                                        violationsMessage,
                                        Audience::Management);
}

void NotificationService::handleEvent(const SyncFailureEvent& event) const
{
    const auto message = SystemAlertReportFormatter::formatFailureAlert(event);
    sendToDestinations(event.clanTag, "SyncFailureEvent", message, Audience::Management);
}

void NotificationService::handleEvent(const SyncRecoveryEvent& event) const
{
    const auto message = SystemAlertReportFormatter::formatRecoveryAlert(event);
    sendToDestinations(event.clanTag, "SyncRecoveryEvent", message, Audience::Management);
}

void NotificationService::handleEvent(const WarReminderEvent& event) const
{
    std::string message;

    switch (event.kind)
    {
    case WarReminderEvent::WarReminderKind::Started:
        message = event.warKind == WarReminderEvent::WarKind::CWL
                      ? WarReminderFormatter::formatStartOfCwlReminder(event)
                      : WarReminderFormatter::formatStartOfWarReminder(event);
        break;
    case WarReminderEvent::WarReminderKind::SixHoursLeft:
        message = event.warKind == WarReminderEvent::WarKind::CWL
                      ? WarReminderFormatter::formatSixHoursLeftCwlReminder(event)
                      : WarReminderFormatter::formatSixHoursLeftReminder(event);
        break;
    case WarReminderEvent::WarReminderKind::OneHourLeft:
        message = event.warKind == WarReminderEvent::WarKind::CWL
                      ? WarReminderFormatter::formatOneHourLeftCwlReminder(event)
                      : WarReminderFormatter::formatOneHourLeftReminder(event);
        break;
    }

    sendToDestinationsWithDeduplication(event.clanTag,
                                        WarReminderEvent::Type,
                                        event.key(),
                                        "WarReminderEvent",
                                        message,
                                        Audience::Players);
}

void NotificationService::handleEvent(const RaidReminderEvent& event) const
{
    std::string message;

    switch (event.kind)
    {
    case RaidReminderEvent::RaidReminderKind::Started:
        message = RaidReminderFormatter::formatStartOfRaidReminder(event);
        break;
    case RaidReminderEvent::RaidReminderKind::FortyEightHoursLeft:
        message = RaidReminderFormatter::formatFortyEightHoursLeftReminder(event);
        break;
    case RaidReminderEvent::RaidReminderKind::TwentyFourHoursLeft:
        message = RaidReminderFormatter::formatTwentyFourHoursLeftReminder(event);
        break;
    case RaidReminderEvent::RaidReminderKind::SixHoursLeft:
        message = RaidReminderFormatter::formatSixHoursLeftReminder(event);
        break;
    case RaidReminderEvent::RaidReminderKind::OneHourLeft:
        message = RaidReminderFormatter::formatOneHourLeftReminder(event);
        break;
    }

    sendToDestinationsWithDeduplication(event.clanTag,
                                        RaidReminderEvent::Type,
                                        event.key(),
                                        "RaidReminderEvent",
                                        message,
                                        Audience::Players);
}
