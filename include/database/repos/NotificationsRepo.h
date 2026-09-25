//
// Created by zuevm on 28.06.2026.
//

#ifndef CLASHBOT_NOTIFICATIONSREPO_H
#define CLASHBOT_NOTIFICATIONSREPO_H
#include <sqlite3.h>
#include <string>
#include <string_view>
#include <vector>

#include "BaseRepository.h"
#include "models/telegram/TelegramModels.h"


class NotificationRepo : public BaseRepository
{
    static constexpr std::string_view repoName = "NotificationsRepo";

public:
    explicit NotificationRepo(sqlite3* db);

    [[nodiscard]] bool enqueueIfAbsent(const std::string& message,
                                       std::string_view eventType,
                                       std::string_view eventId,
                                       long long chatId,
                                       long long messageThreadId) const;

    [[nodiscard]] bool enqueueDomainEventIfAbsent(const std::string& message,
                                                  long long domainEventDestinationId,
                                                  std::string_view eventType,
                                                  std::string_view eventId,
                                                  long long chatId,
                                                  long long messageThreadId,
                                                  int partIndex,
                                                  int partCount) const;

    [[nodiscard]] std::vector<telegram::PendingNotification> getPending(int limit) const;

    void markAsSent(long long notificationId) const;

    void reschedule(long long notificationId,
                    long long nextAttemptAt,
                    std::string_view error) const;

    void markAsFailed(long long notificationId, std::string_view error) const;
};

#endif //CLASHBOT_NOTIFICATIONSREPO_H
