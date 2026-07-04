//
// Created by zuevm on 28.06.2026.
//

#include "database/repos/NotificationsRepo.h"
#include <string>
#include "core/Exceptions.h"
#include "database/sqliteHelpers.h"
#include "spdlog/fmt/bundled/format.h"

NotificationRepo::NotificationRepo(sqlite3* db) : db(db)
{
}

bool NotificationRepo::wasSent(const std::string_view eventType, const std::string_view eventId,
                               const long long chatId) const
{
    static constexpr std::string_view sql = R"(
        SELECT 1
        FROM notifications
        WHERE event_type = ?
          AND event_id = ?
          AND chat_id = ?
        LIMIT 1;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, eventType);
    sqlite::bind(stmt.get(), 2, eventId);
    sqlite::bind(stmt.get(), 3, chatId);

    const int rc = sqlite3_step(stmt.get());

    if (rc == SQLITE_ROW)
    {
        return true;
    }

    if (rc == SQLITE_DONE)
    {
        return false;
    }

    throw DatabaseException(
        fmt::format(
            "[{}] Failed to load notification (entity_type = {}, entity_id = {}, chat_id = {}): {}",
            repoName, eventType,
            eventId, chatId,
            sqlite3_errmsg(db)));
}

void NotificationRepo::markAsSent(const std::string_view eventType, const std::string_view eventId,
                                  const long long chatId) const
{
    static constexpr std::string_view sql = R"(
        INSERT OR IGNORE INTO notifications (event_type, event_id, chat_id)
        VALUES (?, ?, ?);
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, eventType);
    sqlite::bind(stmt.get(), 2, eventId);
    sqlite::bind(stmt.get(), 3, chatId);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to save notification (entity_type = {}, entity_id = {}, chat_id = {}): {}",
                repoName, eventType,
                eventId, chatId,
                sqlite3_errmsg(db)));
    }
}
