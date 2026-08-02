//
// Created by zuevm on 28.06.2026.
//

#include "database/repos/NotificationsRepo.h"
#include "database/sqliteHelpers.h"
#include <fmt/format.h>

NotificationRepo::NotificationRepo(sqlite3* db) : BaseRepository(db, std::string(repoName))
{
}

bool NotificationRepo::wasSent(const std::string_view eventType, const std::string_view eventId,
                               const long long chatId) const
{
    static constexpr std::string_view sql = R"(
        SELECT EXISTS (
            SELECT 1
            FROM notifications
            WHERE event_type = ?
              AND event_id = ?
              AND chat_id = ?
        );
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> bool
    {
        return sqlite::getInt(stmt, 0) != 0;
    };

    return queryOne<bool>(sql, "load notification",
                          fmt::format("entity_type = {}, entity_id = {}, chat_id = {}",
                                      eventType, eventId, chatId),
                          mapper,
                          eventType, eventId, chatId);
}

void NotificationRepo::markAsSent(const std::string_view eventType, const std::string_view eventId,
                                  const long long chatId) const
{
    static constexpr std::string_view sql = R"(
        INSERT OR IGNORE INTO notifications (event_type, event_id, chat_id)
        VALUES (?, ?, ?);
    )";

    execute(sql, "save notification",
            fmt::format("entity_type = {}, entity_id = {}, chat_id = {}",
                        eventType, eventId, chatId),
            eventType, eventId, chatId);
}
