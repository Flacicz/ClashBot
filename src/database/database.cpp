#include "database/database.h"

#include <spdlog/spdlog.h>

#include "core/Exceptions.h"
#include "database/sqliteHelpers.h"
#include "database/repos/SubscriptionRepo.h"

Database::Database(const std::string& path) : pathToDb(path)
{
    if (sqlite3_open(path.c_str(), &db) != SQLITE_OK)
    {
        throw DatabaseException(
            fmt::format("[{}] Failed to open database (path = {}): {}",
                        name, path, sqlite3_errmsg(db)));
    }

    spdlog::info("[{}] Database successfully opened (path = {})", name, path);

    execute("PRAGMA foreign_keys = ON;");
    execute("PRAGMA journal_mode = WAL;");
    execute("PRAGMA synchronous = NORMAL;");

    clansRepo = std::make_unique<ClansRepo>(db);
    raidRepo = std::make_unique<RaidRepo>(db);
    cwRepo = std::make_unique<ClanwarRepo>(db);
    cwlRepo = std::make_unique<ClanwarsLeagueRepo>(db);
    subscriptionRepo = std::make_unique<SubscriptionRepo>(db);
    notificationRepo = std::make_unique<NotificationRepo>(db);
}

Database::~Database()
{
    clansRepo.reset();
    raidRepo.reset();
    cwRepo.reset();
    cwlRepo.reset();
    subscriptionRepo.reset();
    notificationRepo.reset();

    if (db)
    {
        sqlite3_close(db);
        spdlog::info("[{}] Database closed.", name);
    }
}

void Database::execute(const std::string_view sql) const
{
    char* err = nullptr;
    if (sqlite3_exec(db, sql.data(), nullptr, nullptr, &err) != SQLITE_OK)
    {
        std::unique_ptr<char, decltype(&sqlite3_free)> errGuard(err, sqlite3_free);

        throw DatabaseException(
            fmt::format(
                "[{}] Failed to execute SQL (sql = {}): {}",
                name,
                sql,
                errGuard ? errGuard.get() : "Unknown error"));
    }
}

Database::QueryResult Database::query(const std::string_view sql) const
{
    QueryResult result;

    const auto stmt = sqlite::prepare(db, sql);

    const int cols = sqlite3_column_count(stmt.get());
    for (int i = 0; i < cols; i++)
    {
        result.columns.emplace_back(sqlite3_column_name(stmt.get(), i));
    }

    int rc;
    while ((rc = sqlite3_step(stmt.get())) == SQLITE_ROW)
    {
        std::vector<std::string> row;
        row.reserve(cols);

        for (int i = 0; i < cols; i++)
        {
            auto text = sqlite::getString(stmt.get(), i);
            row.emplace_back(text);
        }
        result.rows.push_back(row);
    }

    if (rc != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to execute query\n{}\n: {}",
                name,
                sql,
                sqlite3_errmsg(db)));
    }

    return result;
}
