//
// Created by zuevm on 28.06.2026.
//

#include "database/repos/NotificationsRepo.h"

#include <string>

#include "database/sqliteHelpers.h"
#include "spdlog/spdlog.h"

NotificationRepo::NotificationRepo(sqlite3* db) : db(db)
{
}

bool NotificationRepo::wasSent(std::string_view entityType, std::string_view entityId, long long chatId) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        SELECT 1
        FROM notifications
        WHERE event_type = ?
          AND event_id = ?
          AND chat_id = ?
        LIMIT 1;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[DB] Failed to prepare isNotified statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, entityType.data(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, entityId.data(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt.get(), 3, chatId);

    return sqlite3_step(stmt.get()) == SQLITE_ROW;
}

void NotificationRepo::markAsSent(std::string_view entityType, std::string_view entityId, long long chatId) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT OR IGNORE INTO notifications (event_type, event_id, chat_id)
        VALUES (?, ?, ?);
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[DB] Failed to prepare markAsNotified statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    if (sqlite3_bind_text(stmt.get(), 1, entityType.data(), -1, SQLITE_TRANSIENT) != SQLITE_OK ||
        sqlite3_bind_text(stmt.get(), 2, entityId.data(), -1, SQLITE_TRANSIENT) != SQLITE_OK ||
        sqlite3_bind_int64(stmt.get(), 3, chatId) != SQLITE_OK)
    {
        throw std::runtime_error(
            "Failed to bind notification parameters: " +
            std::string(sqlite3_errmsg(db)));
    }

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        const std::string err = sqlite3_errmsg(db);

        spdlog::error(
            "[DB] Failed to insert notification ({}, {}, {}): {}",
            entityType,
            entityId,
            chatId,
            err);

        throw std::runtime_error("Failed to insert notification: " + err);
    }
}
