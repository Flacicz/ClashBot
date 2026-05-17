#include "database/database.h"
#include "database/tableManager.h"
#include "database/repos/clansRepo.h"
#include "database/repos/raidRepo.h"
#include "database/repos/leagueClanwarRepo.h"
#include "database/repos/clanwarRepo.h"
#include "database/sqliteHelpers.h"

#include <spdlog/spdlog.h>
#include <stdexcept>
#include <sqlite3.h>
#include <string>
#include <vector>
#include <memory>

Database::Database(const std::string& path) : pathToDb(path)
{
    if (sqlite3_open(path.c_str(), &db) != SQLITE_OK)
    {
        std::string errMsg = sqlite3_errmsg(db);
        spdlog::critical("[DB] Failed to open/create database: {}", errMsg);
        throw std::runtime_error("Database initialization failed: " + errMsg);
    }

    spdlog::info("[DB] Database successfully opened at {}", path);

    if (!execute("PRAGMA foreign_keys = ON;"))
    {
        spdlog::critical("[DB] Critical configuration failure: Cannot enable FOREIGN KEYS constraint!");
        throw std::runtime_error("DB Error: foreign_keys failed");
    }

    if (!execute("PRAGMA journal_mode = WAL;"))
    {
        spdlog::critical("[DB] Critical configuration failure: Cannot switch journal mode to WAL!");
        throw std::runtime_error("DB Error: WAL mode failed");
    }

    if (!execute("PRAGMA synchronous = NORMAL;"))
    {
        spdlog::critical("[DB] Critical configuration failure: Cannot set synchronous mode to NORMAL!");
        throw std::runtime_error("DB Error: synchronous NORMAL failed");
    }

    tableManager = std::make_unique<TableManager>(db);
    clansRepo = std::make_unique<ClansRepo>(db);
    raidRepo = std::make_unique<RaidRepo>(db);
    cwRepo = std::make_unique<ClanwarRepo>(db);
    cwlRepo = std::make_unique<LeagueClanwarRepo>(db);
}

Database::~Database()
{
    clansRepo.reset();
    raidRepo.reset();
    cwRepo.reset();
    cwlRepo.reset();
    tableManager.reset();

    if (db)
    {
        sqlite3_close(db);
        spdlog::info("[DB] Database closed.");
    }
}

bool Database::execute(std::string_view sql) const
{
    char* err = nullptr;
    if (sqlite3_exec(db, sql.data(), nullptr, nullptr, &err) != SQLITE_OK)
    {
        spdlog::error("[DB] Execute failed: {} | SQL: {}", err, sql);
        sqlite3_free(err);
        return false;
    }
    return true;
}

Database::QueryResult Database::query(std::string_view sql) const
{
    QueryResult result;
    sqlite3_stmt* raw_stmt;

    if (sqlite3_prepare_v2(db, sql.data(), static_cast<int>(sql.size()), &raw_stmt, nullptr) != SQLITE_OK)
    {
        spdlog::error("[DB] Failed to prepare query: {} | SQL: {}", sqlite3_errmsg(db), sql);
        return result;
    }

    const SQliteStmt statement(raw_stmt, &sqlite3_finalize);

    const int cols = sqlite3_column_count(statement.get());
    for (int i = 0; i < cols; i++)
    {
        result.columns.emplace_back(sqlite3_column_name(statement.get(), i));
    }

    while (sqlite3_step(statement.get()) == SQLITE_ROW)
    {
        std::vector<std::string> row;
        row.reserve(cols);

        for (int i = 0; i < cols; i++)
        {
            auto text = reinterpret_cast<const char*>(sqlite3_column_text(statement.get(), i));
            row.emplace_back(text ? text : "");
        }
        result.rows.push_back(row);
    }

    return result;
}

bool Database::isNotified(const std::string& entityType, const long long entityId) const
{
    const std::string sql = "SELECT COUNT(*) FROM notifications WHERE entity_type = ? AND entity_id = ?";
    sqlite3_stmt* raw_stmt = nullptr;

    if (sqlite3_prepare_v2(getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        spdlog::error("[DB] Failed to prepare isNotified: {}", sqlite3_errmsg(getDBInstance()));
        return false;
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, entityType.c_str(), -1,SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt.get(), 1, entityId);

    long long count = -1;
    if (sqlite3_step(stmt.get()) == SQLITE_ROW)
    {
        count = sqlite3_column_int64(stmt.get(), 0);
    }

    return count != -1;
}

void Database::markAsNotified(const std::string& entityType, const long long entityId) const
{
    const std::string sql = "INSERT OR IGNORE INTO notifications (entity_type, entity_id) VALUES (?, ?)";
    sqlite3_stmt* raw_stmt = nullptr;

    if (sqlite3_prepare_v2(getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        spdlog::error("[DB] Failed to prepare markAsNotified: {}", sqlite3_errmsg(getDBInstance()));
        return;
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, entityType.c_str(), -1,SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt.get(), 1, entityId);

    executePrepared(stmt.get());
}
