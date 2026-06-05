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

    if (!formatter->shouldNotify(result, db)) return;

    if (const auto msg = formatter->format(result); telegramNotifier->sendMessage(msg))
    {
        formatter->onNotificationSent(result, db);
    }
}

void NotificationService::sendFailureAlert(const SyncResult& result) const
{
    const std::string failureMessage = formatFailureAlert(result);
    telegramNotifier->sendMessage(failureMessage);
}

void NotificationService::sendRecoveryAlert(const std::string& serviceName, const std::string& clanTag) const
{
    const std::string recoveryMessage = formatRecoveryAlert(serviceName, clanTag);
    telegramNotifier->sendMessage(recoveryMessage);
}
