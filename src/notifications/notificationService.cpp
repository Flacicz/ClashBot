#include "notifications/notificationService.h"
#include <spdlog/spdlog.h>

#include "reports/PlayerJoinedFormatter.h"
#include "reports/PlayerLeftFormatter.h"
#include "reports/SystemAlertReportFormatter.h"

NotificationService::NotificationService(NotificationRepo& notification_repo,
                                         SubscriptionRepo& subscription_repo,
                                         TelegramNotifier telegram_notifier,
                                         const PlayerJoinedFormatter playerJoinedFormatter,
                                         const PlayerLeftFormatter playerLeftFormatter,
                                         const RaidsEndedFormatter raidsEndedFormatter,
                                         const ClanwarEndedFormatter clanwarEndedFormatter,
                                         const ClanwarsLeagueRoundEndedFormatter clanwarLeagueRoundEndedFormatter) :
    notification_repo_(notification_repo),
    subscription_repo_(subscription_repo),
    telegramNotifier(std::move(telegram_notifier)),
    playerJoinedFormatter(playerJoinedFormatter),
    playerLeftFormatter(playerLeftFormatter),
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

    const auto chatIds = subscription_repo_.getChatIdsForClan(event.clanTag);

    for (const auto& chatId : chatIds)
    {
        if (!telegramNotifier.sendMessage(message, chatId))
        {
            spdlog::error(
                "[NotificationService] Failed to send PlayerJoinedClanEvent message. ClanTag - {}, Chat ID - {}",
                event.clanTag, chatId);
        }
    }
}

void NotificationService::handleEvent(const PlayerLeftClanEvent& event) const
{
    const auto& message = playerLeftFormatter.format(event);

    const auto chatIds = subscription_repo_.getChatIdsForClan(event.clanTag);

    for (const auto& chatId : chatIds)
    {
        if (!telegramNotifier.sendMessage(message, chatId))
        {
            spdlog::error(
                "[NotificationService] Failed to send PlayerLeftClanEvent message. ClanTag - {}, Chat ID - {}",
                event.clanTag, chatId);
        }
    }
}

void NotificationService::handleEvent(const PlayerRoleChangedEvent& event) const
{
    const auto& message = PlayerRoleChangedFormatter::format(event);

    const auto chatIds = subscription_repo_.getChatIdsForClan(event.clanTag);

    for (const auto& chatId : chatIds)
    {
        if (!telegramNotifier.sendMessage(message, chatId))
        {
            spdlog::error(
                "[NotificationService] Failed to send PlayerRoleChangedEvent message. ClanTag - {}, Chat ID - {}",
                event.clanTag, chatId);
        }
    }
}

void NotificationService::handleEvent(const RaidsEndedEvent& event) const
{
    const auto& message = raidsEndedFormatter.format(event);

    const auto chatIds = subscription_repo_.getChatIdsForClan(event.clanTag);

    for (const auto& chatId : chatIds)
    {
        if (notification_repo_.wasSent(RaidsEndedEvent::Type, event.key(), chatId)) continue;

        if (!telegramNotifier.sendMessage(message, chatId))
        {
            spdlog::error("[NotificationService] Failed to send RaidsEndedEvent message. ClanTag - {}, Chat ID - {}",
                          event.clanTag, chatId);
        }

        notification_repo_.markAsSent(RaidsEndedEvent::Type, event.key(), chatId);
    }
}

void NotificationService::handleEvent(const WarEndedEvent& event) const
{
    const auto& message = clanwarEndedFormatter.format(event);

    const auto chatIds = subscription_repo_.getChatIdsForClan(event.clanTag);

    for (const auto& chatId : chatIds)
    {
        if (notification_repo_.wasSent(WarEndedEvent::Type, event.key(), chatId)) continue;

        if (!telegramNotifier.sendMessage(message, chatId))
        {
            spdlog::error("[NotificationService] Failed to send WarEndedEvent message. ClanTag - {}, Chat ID - {}",
                          event.clanTag, chatId);
        }

        notification_repo_.markAsSent(WarEndedEvent::Type, event.key(), chatId);
    }
}

void NotificationService::handleEvent(const ClanwarsLeagueRoundEndedEvent& event) const
{
    const auto& message = clanwarLeagueRoundEndedFormatter.format(event);

    const auto chatIds = subscription_repo_.getChatIdsForClan(event.clanTag);

    for (const auto& chatId : chatIds)
    {
        if (notification_repo_.wasSent(ClanwarsLeagueRoundEndedEvent::Type, event.key(), chatId)) continue;

        if (!telegramNotifier.sendMessage(message, chatId))
        {
            spdlog::error("[NotificationService] Failed to send WarEndedEvent message. ClanTag - {}, Chat ID - {}",
                          event.clanTag, chatId);
        }

        notification_repo_.markAsSent(ClanwarsLeagueRoundEndedEvent::Type, event.key(), chatId);
    }
}

void NotificationService::handleEvent(const SyncFailureEvent& event) const
{
    const auto message = SystemAlertReportFormatter::formatFailureAlert(event);
    const auto chatIds =
        subscription_repo_.getChatIdsForClan(event.clanTag);

    for (const auto chatId : chatIds)
    {
        if (!telegramNotifier.sendMessage(message, chatId))
        {
            spdlog::error(
                "[NotificationService] Failed to send SyncFailureEvent message. ClanTag - {}, Chat ID - {}",
                event.clanTag, chatId);
        }
    }
}

void NotificationService::handleEvent(const SyncRecoveryEvent& event) const
{
    const auto message = SystemAlertReportFormatter::formatRecoveryAlert(event);
    const auto chatIds =
        subscription_repo_.getChatIdsForClan(event.clanTag);

    for (const auto chatId : chatIds)
    {
        if (!telegramNotifier.sendMessage(message, chatId))
        {
            spdlog::error(
                "[NotificationService] Failed to send SyncRecoveryEvent message. ClanTag - {}, Chat ID - {}",
                event.clanTag, chatId);
        }
    }
}
