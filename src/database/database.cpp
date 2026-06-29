#include "database/database.h"

#include <spdlog/spdlog.h>

#include "database/sqliteHelpers.h"
#include "database/repos/SubscriptionRepo.h"

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

    clansRepo = std::make_unique<ClansRepo>(db);
    raidRepo = std::make_unique<RaidRepo>(db);
    cwRepo = std::make_unique<ClanwarRepo>(db);
    cwlRepo = std::make_unique<LeagueClanwarRepo>(db);
    subscriptionRepo = std::make_unique<SubscriptionRepo>(db);
    notificationRepo = std::make_unique<NotificationRepo>(db);
}

Database::~Database()
{
    clansRepo.reset();
    raidRepo.reset();
    cwRepo.reset();
    cwlRepo.reset();

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
