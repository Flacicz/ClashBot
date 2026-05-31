#ifndef ACTIVITYTRACKING_NOTIFICATIONSERVICE_H
#define ACTIVITYTRACKING_NOTIFICATIONSERVICE_H
#include <memory>

#include "telegramNotifier.h"
#include "database/database.h"
#include "reports/IReportFormatter.h"


class NotificationService
{
    Database& db;
    std::unique_ptr<TelegramNotifier> telegramNotifier;
    std::map<std::string, std::unique_ptr<IReportFormatter>> formatters;

    static std::string formatFailureAlert(const SyncResult& result);
    static std::string formatRecoveryAlert(const std::string& serviceName, const std::string& clanTag);

public:
    NotificationService(Database& db, std::unique_ptr<TelegramNotifier> telegram_notifier,
                        std::map<std::string, std::unique_ptr<IReportFormatter>> formatters);

    void handle(const SyncResult& result) const;

    void sendFailureAlert(const SyncResult& result) const;
    void sendRecoveryAlert(const std::string& serviceName, const std::string& clanTag) const;
};


#endif //ACTIVITYTRACKING_NOTIFICATIONSERVICE_H
