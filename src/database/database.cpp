#include "database/database.h"
#include "database/tableManager.h"
#include "database/repos/clanInfoRepo.h"
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

Database::Database(const std::string& path) : db(nullptr), pathToDb(path)
{
    if (sqlite3_open(path.c_str(), &db) != SQLITE_OK)
    {
        std::string errMsg = sqlite3_errmsg(db);
        spdlog::critical("[DB] Failed to open/create database: {}", errMsg);
        throw std::runtime_error("Database initialization failed: " + errMsg);
    }

    spdlog::info("[DB] Database successfully opened at {}", path);

    execute("PRAGMA foreign_keys = ON;");
    execute("PRAGMA journal_mode = WAL;");
    execute("PRAGMA synchronous = NORMAL;");
}

Database::~Database()
{
    if (db)
    {
        sqlite3_close(db);
        spdlog::info("[DB] Database closed.");
    }
}

TableManager& Database::getTableManager()
{
    if (!tableManager) tableManager = std::make_unique<TableManager>(this);
    return *tableManager;
}

ClanInfoRepo& Database::getClanInfoRepo()
{
    if (!clanInfoRepo) clanInfoRepo = std::make_unique<ClanInfoRepo>(this);
    return *clanInfoRepo;
}

RaidRepo& Database::getRaidRepo()
{
    if (!raidRepo) raidRepo = std::make_unique<RaidRepo>(this);
    return *raidRepo;
}

LeagueClanwarRepo& Database::getCwlRepo()
{
    if (!cwlRepo) cwlRepo = std::make_unique<LeagueClanwarRepo>(this);
    return *cwlRepo;
}

ClanwarRepo& Database::getCwRepo()
{
    if (!cwRepo) cwRepo = std::make_unique<ClanwarRepo>(this);
    return *cwRepo;
}

bool Database::execute(const std::string& sql) const
{
    char* err = nullptr;
    if (sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &err) != SQLITE_OK)
    {
        spdlog::error("[DB] Execute failed: {} | SQL: {}", err, sql);
        sqlite3_free(err);
        return false;
    }
    return true;
}

bool Database::executePrepared(sqlite3_stmt* stmt) const
{
    if (const int result = sqlite3_step(stmt); result != SQLITE_DONE && result != SQLITE_ROW)
    {
        spdlog::error("[DB] Prepared statement execution failed: {}", sqlite3_errmsg(db));
        return false;
    }
    return true;
}

Database::QueryResult Database::query(const std::string& sql) const
{
    QueryResult result;
    sqlite3_stmt* raw_stmt;

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
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

Database::QueryResult Database::queryWithParam(const std::string& sql, const std::string& param) const
{
    QueryResult result;
    sqlite3_stmt* raw_stmt;

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        spdlog::error("[DB] Failed to prepare parameterized query: {}", sqlite3_errmsg(db));
        return result;
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, param.c_str(), -1, SQLITE_TRANSIENT);

    const int cols = sqlite3_column_count(stmt.get());
    for (int i = 0; i < cols; i++)
    {
        result.columns.emplace_back(sqlite3_column_name(stmt.get(), i));
    }

    while (sqlite3_step(stmt.get()) == SQLITE_ROW)
    {
        std::vector<std::string> row;
        row.reserve(cols);

        for (int i = 0; i < cols; i++)
        {
            auto text = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), i));
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
