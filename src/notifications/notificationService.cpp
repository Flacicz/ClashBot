#include "notifications/notificationService.h"
#include "spdlog/fmt/bundled/compile.h"
#include <spdlog/spdlog.h>

NotificationService::NotificationService(Database& db,
                                         std::unique_ptr<TelegramNotifier> telegram_notifier,
                                         std::map<std::string, std::unique_ptr<IReportFormatter>> formatters) :
    db(db), telegramNotifier(std::move(telegram_notifier)), formatters(std::move(formatters))
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

void NotificationService::handle(const SyncResult& result) const
{
    const auto& formatter = formatters.at(result.serviceName);

    const auto chatIds = db.subscriptions().getChatIdsForClan(result.clanTag);

    for (const auto& chatId : chatIds)
    {
        if (!formatter->shouldNotify(result, db, chatId)) continue;

        const auto report = formatter->format(result);

        if (telegramNotifier->sendMessage(report, chatId))
        {
            formatter->onNotificationSent(result, db, chatId);
        }
    }
}

void NotificationService::sendFailureAlert(const SyncResult& result) const
{
    const auto chatIds = db.subscriptions().getChatIdsForClan(result.clanTag);
    const std::string failureMessage = formatFailureAlert(result);

    for (const auto& chatId : chatIds)
    {
        if (!telegramNotifier->sendMessage(failureMessage, chatId))
        {
            spdlog::error("[NotificationService] Failed to send failure message. Entity ID - {}, Chat ID - {}",
                          result.reportEntityId, chatId);
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
            spdlog::error("[NotificationService] Failed to send recovery message. Entity ID - {}, Chat ID - {}",
                          result.reportEntityId, chatId);
        }
    }
}
