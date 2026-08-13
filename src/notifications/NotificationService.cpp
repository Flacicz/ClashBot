#include "notifications/NotificationService.h"
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
                                         const ClanwarEndedFormatter clanwarEndedFormatter,
                                         const ClanwarsLeagueRoundEndedFormatter clanwarLeagueRoundEndedFormatter) :
    notification_repo_(notification_repo),
    subscription_repo_(subscription_repo),
    telegramNotifier(std::move(telegram_notifier)),
    playerJoinedFormatter(playerJoinedFormatter),
    playerLeftFormatter(playerLeftFormatter),
    playerRoleChangedFormatter(playerRoleChangedFormatter),
    raidsEndedFormatter(raidsEndedFormatter),
    clanwarEndedFormatter(clanwarEndedFormatter),
    clanwarLeagueRoundEndedFormatter(clanwarLeagueRoundEndedFormatter)
{
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
    const auto& message = playerJoinedFormatter.format(event);

    const auto destinations = subscription_repo_.getDestinationsForClan(event.clanTag);

    for (const auto& destination : destinations)
    {
        if (!telegramNotifier.sendMessage(message, destination.chatId, destination.messageThreadId))
        {
            spdlog::error(
                "[NotificationService] Failed to send PlayerJoinedClanEvent message. ClanTag - {}, Chat ID - {}",
                event.clanTag, destination.chatId);
        }
    }
}

void NotificationService::handleEvent(const PlayerLeftClanEvent& event) const
{
    const auto& message = playerLeftFormatter.format(event);

    const auto destinations = subscription_repo_.getDestinationsForClan(event.clanTag);

    for (const auto& destination : destinations)
    {
        if (!telegramNotifier.sendMessage(message, destination.chatId, destination.messageThreadId))
        {
            spdlog::error(
                "[NotificationService] Failed to send PlayerLeftClanEvent message. ClanTag - {}, Chat ID - {}",
                event.clanTag, destination.chatId);
        }
    }
}

void NotificationService::handleEvent(const PlayerRoleChangedEvent& event) const
{
    const auto& message = playerRoleChangedFormatter.format(event);

    const auto destinations = subscription_repo_.getDestinationsForClan(event.clanTag);

    for (const auto& destination : destinations)
    {
        if (!telegramNotifier.sendMessage(message, destination.chatId, destination.messageThreadId))
        {
            spdlog::error(
                "[NotificationService] Failed to send PlayerRoleChangedEvent message. ClanTag - {}, Chat ID - {}",
                event.clanTag, destination.chatId);
        }
    }
}

void NotificationService::handleEvent(const RaidsEndedEvent& event) const
{
    const auto& message = raidsEndedFormatter.format(event);

    const auto destinations = subscription_repo_.getDestinationsForClan(event.clanTag);

    for (const auto& destination : destinations)
    {
        if (notification_repo_.wasSent(RaidsEndedEvent::Type,
                                       event.key(),
                                       destination.chatId,
                                       destination.messageThreadId))
            continue;

        if (!telegramNotifier.sendMessage(message, destination.chatId, destination.messageThreadId))
        {
            spdlog::error("[NotificationService] Failed to send RaidsEndedEvent message. ClanTag - {}, Chat ID - {}",
                          event.clanTag, destination.chatId);
        }

        notification_repo_.markAsSent(RaidsEndedEvent::Type,
                                      event.key(),
                                      destination.chatId,
                                      destination.messageThreadId);
    }
}

void NotificationService::handleEvent(const WarEndedEvent& event) const
{
    const auto& message = clanwarEndedFormatter.format(event);

    const auto destinations = subscription_repo_.getDestinationsForClan(event.clanTag);

    for (const auto& destination : destinations)
    {
        if (notification_repo_.wasSent(WarEndedEvent::Type,
                                       event.key(),
                                       destination.chatId,
                                       destination.messageThreadId))
            continue;

        if (!telegramNotifier.sendMessage(message, destination.chatId, destination.messageThreadId))
        {
            spdlog::error("[NotificationService] Failed to send WarEndedEvent message. ClanTag - {}, Chat ID - {}",
                          event.clanTag, destination.chatId);
        }

        notification_repo_.markAsSent(WarEndedEvent::Type,
                                      event.key(),
                                      destination.chatId,
                                      destination.messageThreadId);
    }
}

void NotificationService::handleEvent(const ClanwarsLeagueRoundEndedEvent& event) const
{
    const auto& message = clanwarLeagueRoundEndedFormatter.format(event);

    const auto destinations = subscription_repo_.getDestinationsForClan(event.clanTag);

    for (const auto& destination : destinations)
    {
        if (notification_repo_.wasSent(ClanwarsLeagueRoundEndedEvent::Type,
                                       event.key(),
                                       destination.chatId,
                                       destination.messageThreadId))
            continue;

        if (!telegramNotifier.sendMessage(message, destination.chatId, destination.messageThreadId))
        {
            spdlog::error("[NotificationService] Failed to send WarEndedEvent message. ClanTag - {}, Chat ID - {}",
                          event.clanTag, destination.chatId);
        }

        notification_repo_.markAsSent(ClanwarsLeagueRoundEndedEvent::Type,
                                      event.key(),
                                      destination.chatId,
                                      destination.messageThreadId);
    }
}

void NotificationService::handleEvent(const SyncFailureEvent& event) const
{
    const auto message = SystemAlertReportFormatter::formatFailureAlert(event);
    const auto destinations =
        subscription_repo_.getDestinationsForClan(event.clanTag);

    for (const auto& destination : destinations)
    {
        if (!telegramNotifier.sendMessage(message, destination.chatId, destination.messageThreadId))
        {
            spdlog::error(
                "[NotificationService] Failed to send SyncFailureEvent message. ClanTag - {}, Chat ID - {}",
                event.clanTag, destination.chatId);
        }
    }
}

void NotificationService::handleEvent(const SyncRecoveryEvent& event) const
{
    const auto message = SystemAlertReportFormatter::formatRecoveryAlert(event);
    const auto destinations =
        subscription_repo_.getDestinationsForClan(event.clanTag);

    for (const auto& destination : destinations)
    {
        if (!telegramNotifier.sendMessage(message, destination.chatId, destination.messageThreadId))
        {
            spdlog::error(
                "[NotificationService] Failed to send SyncRecoveryEvent message. ClanTag - {}, Chat ID - {}",
                event.clanTag, destination.chatId);
        }
    }
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

    const auto destinations =
        subscription_repo_.getDestinationsForClan(event.clanTag);

    for (const auto& destination : destinations)
    {
        if (notification_repo_.wasSent(WarReminderEvent::Type,
                                       event.key(),
                                       destination.chatId,
                                       destination.messageThreadId))
            continue;

        if (!telegramNotifier.sendMessage(message, destination.chatId, destination.messageThreadId))
        {
            spdlog::error("[NotificationService] Failed to send WarReminderEvent message. ClanTag - {}, Chat ID - {}",
                          event.clanTag, destination.chatId);
        }

        notification_repo_.markAsSent(WarReminderEvent::Type,
                                      event.key(),
                                      destination.chatId,
                                      destination.messageThreadId);
    }
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

    const auto destinations =
        subscription_repo_.getDestinationsForClan(event.clanTag);

    for (const auto& destination : destinations)
    {
        if (notification_repo_.wasSent(RaidReminderEvent::Type,
                                       event.key(),
                                       destination.chatId,
                                       destination.messageThreadId))
            continue;

        if (!telegramNotifier.sendMessage(message, destination.chatId, destination.messageThreadId))
        {
            spdlog::error("[NotificationService] Failed to send RaidReminderEvent message. ClanTag - {}, Chat ID - {}",
                          event.clanTag, destination.chatId);
        }

        notification_repo_.markAsSent(RaidReminderEvent::Type,
                                      event.key(),
                                      destination.chatId,
                                      destination.messageThreadId);
    }
}
