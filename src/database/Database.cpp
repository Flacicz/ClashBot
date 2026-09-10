#include "database/Database.h"

#include <spdlog/spdlog.h>

#include "core/Exceptions.h"
#include "database/repos/SubscriptionRepo.h"

Database::Database(std::string path) : pathToDb(path)
{
    const int rc = sqlite3_open(path.c_str(), &db);

    if (rc != SQLITE_OK)
    {
        const std::string sqliteError = db
                                            ? sqlite3_errmsg(db)
                                            : "SQLite did not return an error message";

        if (db)
        {
            sqlite3_close(db);
            db = nullptr;
        }

        throw DatabaseException(
            rc,
            fmt::format("[{}] Failed to open database (path = {}): {}",
                        name, path, sqliteError));
    }

    try
    {
        spdlog::info("[{}] Database successfully opened (path = {})", name, path);

        const int busyTimeoutRc = sqlite3_busy_timeout(db, SQLITE_BUSY_TIMEOUT_MS);

        if (busyTimeoutRc != SQLITE_OK)
        {
            throw DatabaseException(
                busyTimeoutRc,
                fmt::format("[{}] Failed to configure SQLite busy timeout: {}",
                            name, sqlite3_errmsg(db)));
        }

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
    catch (...)
    {
        sqlite3_close(db);
        db = nullptr;
        throw;
    }
}

Database::~Database()
{
    notificationRepo.reset();
    subscriptionRepo.reset();
    cwlRepo.reset();
    cwRepo.reset();
    raidRepo.reset();
    clansRepo.reset();

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
