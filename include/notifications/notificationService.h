#ifndef ACTIVITYTRACKING_NOTIFICATIONSERVICE_H
#define ACTIVITYTRACKING_NOTIFICATIONSERVICE_H
#include <memory>

#include "telegramNotifier.h"
#include "database/database.h"
#include "reports/IReportFormatter.h"


class NotificationService
{
private:
    std::unique_ptr<Database> db;
    std::unique_ptr<TelegramNotifier> telegramNotifier;
    std::map<std::string, std::unique_ptr<IReportFormatter>> formatters;

public:
    NotificationService(std::unique_ptr<Database> db, std::unique_ptr<TelegramNotifier> telegram_notifier,
                        std::map<std::string, std::unique_ptr<IReportFormatter>> formatters);

    void handle(const SyncResult& result) const;
};


#endif //ACTIVITYTRACKING_NOTIFICATIONSERVICE_H
