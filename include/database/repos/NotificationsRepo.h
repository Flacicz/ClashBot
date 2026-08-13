//
// Created by zuevm on 28.06.2026.
//

#ifndef CLASHBOT_NOTIFICATIONSREPO_H
#define CLASHBOT_NOTIFICATIONSREPO_H
#include <sqlite3.h>
#include <string_view>

#include "BaseRepository.h"


class NotificationRepo : public BaseRepository
{
    static constexpr std::string_view repoName = "NotificationsRepo";

public:
    explicit NotificationRepo(sqlite3* db);

    [[nodiscard]] bool wasSent(
        std::string_view eventType,
        std::string_view eventId,
        long long chatId,
        long long messageThreadId) const;
    void markAsSent(
        std::string_view eventType,
        std::string_view eventId,
        long long chatId,
        long long messageThreadId) const;
};

#endif //CLASHBOT_NOTIFICATIONSREPO_H
