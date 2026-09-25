//
// Created by zuevm on 28.06.2026.
//

#include "database/repos/NotificationsRepo.h"
#include "database/SQLiteHelpers.h"
#include <fmt/format.h>

NotificationRepo::NotificationRepo(sqlite3* db) : BaseRepository(db, std::string(repoName))
{
}

bool NotificationRepo::enqueueIfAbsent(const std::string& message,
                                       const std::string_view eventType,
                                       const std::string_view eventId,
                                       const long long chatId,
                                       const long long messageThreadId) const
{
    static constexpr std::string_view sql = R"(
        INSERT INTO notifications (event_type, event_id, chat_id, message_thread_id, message_text)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (
            event_type,
            event_id,
            chat_id,
            message_thread_id,
            part_index
        ) DO NOTHING
        RETURNING id;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> long long
    {
        return sqlite::getLong(stmt, 0);
    };

    return queryOptional<long long>(
            sql,
            "enqueue notification",
            fmt::format(
                "event_type = {}, event_id = {}, chat_id = {}, message_thread_id = {}",
                eventType,
                eventId,
                chatId,
                messageThreadId),
            mapper,
            eventType,
            eventId,
            chatId,
            messageThreadId,
            message)
        .has_value();
}

bool NotificationRepo::enqueueDomainEventIfAbsent(const std::string& message,
                                                   const long long domainEventDestinationId,
                                                   const std::string_view eventType,
                                                   const std::string_view eventId,
                                                   const long long chatId,
                                                   const long long messageThreadId,
                                                   const int partIndex,
                                                   const int partCount) const
{
    static constexpr std::string_view sql = R"(
        INSERT INTO notifications (
            domain_event_destination_id,
            event_type,
            event_id,
            chat_id,
            message_thread_id,
            message_text,
            part_index,
            part_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (
            domain_event_destination_id,
            event_type,
            event_id,
            part_index
        ) DO NOTHING
        RETURNING id;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> long long
    {
        return sqlite::getLong(stmt, 0);
    };

    return queryOptional<long long>(
            sql,
            "enqueue notification for domain event destination",
            fmt::format(
                "domain_event_destination_id = {}, event_type = {}, event_id = {}, "
                "chat_id = {}, message_thread_id = {}",
                domainEventDestinationId,
                eventType,
                eventId,
                chatId,
                messageThreadId),
            mapper,
            domainEventDestinationId,
            eventType,
            eventId,
            chatId,
            messageThreadId,
            message,
            partIndex,
            partCount)
        .has_value();
}

std::vector<telegram::PendingNotification> NotificationRepo::getPending(const int limit) const
{
    if (limit <= 0)
    {
        return {};
    }

    static constexpr std::string_view sql = R"(
        SELECT id,
               event_type,
               event_id,
               chat_id,
               message_thread_id,
               message_text,
               attempts
        FROM notifications
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL
               OR next_attempt_at <= strftime('%s', 'now'))
        ORDER BY created_at, id
        LIMIT ?;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> telegram::PendingNotification
    {
        return telegram::PendingNotification{
            .id = sqlite::getLong(stmt, 0),
            .eventType = sqlite::getString(stmt, 1),
            .eventId = sqlite::getString(stmt, 2),
            .chatId = sqlite::getLong(stmt, 3),
            .messageThreadId = sqlite::getLong(stmt, 4),
            .messageText = sqlite::getString(stmt, 5),
            .attempts = sqlite::getInt(stmt, 6)
        };
    };

    return query<telegram::PendingNotification>(
        sql,
        "load pending notifications",
        fmt::format("limit = {}", limit),
        mapper,
        limit);
}

void NotificationRepo::markAsSent(const long long notificationId) const
{
    static constexpr std::string_view sql = R"(
        UPDATE notifications
        SET status = 'sent',
            sent_at = strftime('%s', 'now'),
            next_attempt_at = NULL,
            last_error = NULL
        WHERE id = ?
          AND status = 'pending';
    )";

    execute(
        sql,
        "mark notification as sent",
        fmt::format("notification_id = {}", notificationId),
        notificationId);
}

void NotificationRepo::reschedule(const long long notificationId,
                                  const long long nextAttemptAt,
                                  const std::string_view error) const
{
    static constexpr std::string_view sql = R"(
        UPDATE notifications
        SET status = 'pending',
            attempts = attempts + 1,
            next_attempt_at = ?,
            last_error = ?
        WHERE id = ?
          AND status = 'pending';
    )";

    execute(
        sql,
        "reschedule notification",
        fmt::format("notification_id = {}", notificationId),
        nextAttemptAt,
        error,
        notificationId);
}

void NotificationRepo::markAsFailed(const long long notificationId,
                                    const std::string_view error) const
{
    static constexpr std::string_view sql = R"(
        UPDATE notifications
        SET status = 'failed',
            attempts = attempts + 1,
            next_attempt_at = NULL,
            last_error = ?,
            sent_at = NULL
        WHERE id = ?
          AND status = 'pending';
    )";

    execute(
        sql,
        "mark notification as failed",
        fmt::format("notification_id = {}", notificationId),
        error,
        notificationId);
}
