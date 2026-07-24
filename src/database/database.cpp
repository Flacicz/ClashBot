#include "database/database.h"

#include <spdlog/spdlog.h>

#include "core/Exceptions.h"
#include "database/repos/SubscriptionRepo.h"
#include "spdlog/fmt/bundled/chrono.h"

Database::Database(std::string path) : pathToDb(path)
{
    if (sqlite3_open(path.c_str(), &db) != SQLITE_OK)
    {
        throw DatabaseException(
            fmt::format("[{}] Failed to open database (path = {}): {}",
                        name, path, sqlite3_errmsg(db)));
    }

    spdlog::info("[{}] Database successfully opened (path = {})", name, path);

    sqlite::execute(db, "PRAGMA foreign_keys = ON;");
    sqlite::execute(db, "PRAGMA journal_mode = WAL;");
    sqlite::execute(db, "PRAGMA synchronous = NORMAL;");

    clansRepo = std::make_unique<ClansRepo>(db);
    raidRepo = std::make_unique<RaidRepo>(db);
    cwRepo = std::make_unique<ClanwarRepo>(db);
    cwlRepo = std::make_unique<ClanwarsLeagueRepo>(db);
    subscriptionRepo = std::make_unique<SubscriptionRepo>(db);
    notificationRepo = std::make_unique<NotificationRepo>(db);
}

Database::~Database()
{
    if (db)
    {
        sqlite3_close(db);
        spdlog::info("[{}] Database closed.", name);
    }
}

Database::Database(Database&& other) noexcept
    : db(std::exchange(other.db, nullptr))
      , pathToDb(std::move(other.pathToDb))
      , clansRepo(std::move(other.clansRepo))
      , raidRepo(std::move(other.raidRepo))
      , cwRepo(std::move(other.cwRepo))
      , cwlRepo(std::move(other.cwlRepo))
      , subscriptionRepo(std::move(other.subscriptionRepo))
      , notificationRepo(std::move(other.notificationRepo))
{
}

Database& Database::operator=(Database&& other) noexcept
{
    if (this != &other)
    {
        if (db)
        {
            sqlite3_close(db);
        }

        db = std::exchange(other.db, nullptr);
        pathToDb = std::move(other.pathToDb);
        clansRepo = std::move(other.clansRepo);
        raidRepo = std::move(other.raidRepo);
        cwRepo = std::move(other.cwRepo);
        cwlRepo = std::move(other.cwlRepo);
        subscriptionRepo = std::move(other.subscriptionRepo);
        notificationRepo = std::move(other.notificationRepo);
    }
    return *this;
}
