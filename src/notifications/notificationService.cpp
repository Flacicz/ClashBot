#include <utility>

#include "notifications/notificationService.h"

NotificationService::NotificationService(Database& db,
                                         std::unique_ptr<TelegramNotifier> telegram_notifier,
                                         std::map<std::string, std::unique_ptr<IReportFormatter>> formatters) :
    db(db), telegramNotifier(std::move(telegram_notifier)), formatters(std::move(formatters))
{
}

void NotificationService::handle(const SyncResult& result) const
{
    if (!result.hasReportData()) return;

    const auto entityType = result.serviceName;
    const auto entityId = result.reportEntityId;

    if (db.isNotified(entityType, entityId)) return;

    const auto& formatter = formatters.at(entityType);

    if (!formatter->shouldNotify(result)) {
        return;
    }

    if (const auto msg = formatter->format(result); telegramNotifier->sendMessage(msg))
    {
        if (!db.markAsNotified(entityType, entityId)) return;
    }
}
