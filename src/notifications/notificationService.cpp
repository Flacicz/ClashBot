#include "notifications/notificationService.h"
#include <spdlog/spdlog.h>

#include "reports/PlayerJoinedFormatter.h"
#include "reports/PlayerLeftFormatter.h"

NotificationService::NotificationService(Database& db, std::unique_ptr<TelegramNotifier> telegramNotifier,
                                         const PlayerJoinedFormatter& playerJoinedFormatter,
                                         const PlayerLeftFormatter& playerLeftFormatter,
                                         const RaidsEndedFormatter& raidsEndedFormatter,
                                         const ClanwarEndedFormatter& clanwarEndedFormatter,
                                         const ClanwarsLeagueRoundEndedFormatter& clanwarLeagueRoundEndedFormatter) :
    db(db), telegramNotifier(std::move(telegramNotifier)), playerJoinedFormatter(playerJoinedFormatter),
    playerLeftFormatter(playerLeftFormatter), raidsEndedFormatter(raidsEndedFormatter),
    clanwarEndedFormatter(clanwarEndedFormatter), clanwarLeagueRoundEndedFormatter(clanwarLeagueRoundEndedFormatter)
{
}

std::string NotificationService::formatFailureAlert(const SyncResult& result)
{
    return fmt::format(
        "----------------------------------\n"
        "⚠️ *SYSTEM ALERT*\n"
        "*Service:* {}\n"
        "*Clan:* `{}`\n"
        "*Issue:* {}\n"
        "----------------------------------",
        result.serviceName, result.clanTag, result.errorMsg
    );
}

std::string NotificationService::formatRecoveryAlert(const std::string& serviceName, const std::string& clanTag)
{
    return fmt::format(
        "----------------------------------\n"
        "✅ *SYSTEM RECOVERY*\n"
        "*Service:* {}\n"
        "*Clan:* `{}` is now synchronized successfully.\n"
        "----------------------------------",
        serviceName, clanTag);
}

void NotificationService::sendFailureAlert(const SyncResult& result) const
{
    const auto chatIds = db.subscriptions().getChatIdsForClan(result.clanTag);
    const std::string failureMessage = formatFailureAlert(result);

    for (const auto& chatId : chatIds)
    {
        if (!telegramNotifier->sendMessage(failureMessage, chatId))
        {
            spdlog::error("[NotificationService] Failed to send failure message. Chat ID - {}", chatId);
        }
    }
}

void NotificationService::sendRecoveryAlert(const SyncResult& result) const
{
    const auto chatIds = db.subscriptions().getChatIdsForClan(result.clanTag);
    const std::string recoveryMessage = formatRecoveryAlert(result.serviceName, result.clanTag);

    for (const auto& chatId : chatIds)
    {
        if (!telegramNotifier->sendMessage(recoveryMessage, chatId))
        {
            spdlog::error("[NotificationService] Failed to send recovery message. Chat ID - {}", chatId);
        }
    }
}

void NotificationService::handle(const DomainEvent& domainEvent)
{
    std::visit(
        [this](auto&& e)
        {
            handleEvent(e);
        },
        domainEvent
    );
}

void NotificationService::handleEvent(const PlayerJoinedClanEvent& event) const
{
    const auto& message = PlayerJoinedFormatter::format(event);

    const auto chatIds = db.subscriptions().getChatIdsForClan(event.clanTag);

    for (const auto& chatId : chatIds)
    {
        if (!telegramNotifier->sendMessage(message, chatId))
        {
            spdlog::error("[NotificationService] Failed to send PlayerJoinedClanEvent message. ClanTag - {}, Chat ID - {}",
                          event.clanTag, chatId);
        }
    }
}

void NotificationService::handleEvent(const PlayerLeftClanEvent& event) const
{
    const auto& message = PlayerLeftFormatter::format(event);

    const auto chatIds = db.subscriptions().getChatIdsForClan(event.clanTag);

    for (const auto& chatId : chatIds)
    {
        if (!telegramNotifier->sendMessage(message, chatId))
        {
            spdlog::error("[NotificationService] Failed to send PlayerLeftClanEvent message. ClanTag - {}, Chat ID - {}",
                          event.clanTag, chatId);
        }
    }
}

void NotificationService::handleEvent(const RaidsEndedEvent& event) const
{
    const auto& message = raidsEndedFormatter.format(event);

    const auto chatIds = db.subscriptions().getChatIdsForClan(event.clanTag);

    for (const auto& chatId : chatIds)
    {
        if (db.notifications().wasSent(event.Type, event.key(), chatId)) continue;

        if (!telegramNotifier->sendMessage(message, chatId))
        {
            spdlog::error("[NotificationService] Failed to send RaidsEndedEvent message. ClanTag - {}, Chat ID - {}",
                          event.clanTag, chatId);
        }

        db.notifications().markAsSent(event.Type, event.key(), chatId);
    }
}

void NotificationService::handleEvent(const WarEndedEvent& event) const
{
    const auto& message = clanwarEndedFormatter.format(event);

    const auto chatIds = db.subscriptions().getChatIdsForClan(event.clanTag);

    for (const auto& chatId : chatIds)
    {
        if (db.notifications().wasSent(event.Type, event.key(), chatId)) continue;

        if (!telegramNotifier->sendMessage(message, chatId))
        {
            spdlog::error("[NotificationService] Failed to send WarEndedEvent message. ClanTag - {}, Chat ID - {}",
                          event.clanTag, chatId);
        }

        db.notifications().markAsSent(event.Type, event.key(), chatId);
    }
}

void NotificationService::handleEvent(const ClanwarsLeagueRoundEndedEvent& event) const
{
    const auto& message = clanwarLeagueRoundEndedFormatter.format(event);

    const auto chatIds = db.subscriptions().getChatIdsForClan(event.clanTag);

    for (const auto& chatId : chatIds)
    {
        if (db.notifications().wasSent(event.Type, event.key(), chatId)) continue;

        if (!telegramNotifier->sendMessage(message, chatId))
        {
            spdlog::error("[NotificationService] Failed to send WarEndedEvent message. ClanTag - {}, Chat ID - {}",
                          event.clanTag, chatId);
        }

        db.notifications().markAsSent(event.Type, event.key(), chatId);
    }
}
