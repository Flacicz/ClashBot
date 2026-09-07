#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/SQLiteHelpers.h"

#include <chrono>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <string_view>

#include <gtest/gtest.h>

namespace
{
    class TemporaryDatabaseFile
    {
        std::filesystem::path path_;

        static void removeDatabaseFiles(const std::filesystem::path& path)
        {
            std::error_code error;
            std::filesystem::remove(path, error);
            std::filesystem::remove(path.string() + "-wal", error);
            std::filesystem::remove(path.string() + "-shm", error);
        }

    public:
        TemporaryDatabaseFile()
        {
            const auto uniquePart = std::chrono::high_resolution_clock::now()
                .time_since_epoch()
                .count();

            path_ = std::filesystem::temp_directory_path() /
                ("clashbot-integration-" + std::to_string(uniquePart) + ".sqlite");

            removeDatabaseFiles(path_);
        }

        ~TemporaryDatabaseFile()
        {
            removeDatabaseFiles(path_);
        }

        [[nodiscard]] const std::filesystem::path& path() const
        {
            return path_;
        }
    };

    bool tableExists(sqlite3* database, const std::string_view tableName)
    {
        static constexpr std::string_view sql = R"(
            SELECT 1
            FROM sqlite_master
            WHERE type = 'table' AND name = ?;
        )";

        const auto statement = sqlite::prepare(database, sql);
        sqlite::bind(statement.get(), 1, tableName);

        const int result = sqlite3_step(statement.get());
        if (result == SQLITE_ROW) return true;
        if (result == SQLITE_DONE) return false;

        throw std::runtime_error(sqlite3_errmsg(database));
    }

    int migrationCount(sqlite3* database)
    {
        static constexpr std::string_view sql =
            "SELECT COUNT(*) FROM schema_migrations;";

        const auto statement = sqlite::prepare(database, sql);
        if (sqlite3_step(statement.get()) != SQLITE_ROW)
        {
            throw std::runtime_error(sqlite3_errmsg(database));
        }

        return sqlite::getInt(statement.get(), 0);
    }

    bool clansHaveTrackingColumn(sqlite3* database)
    {
        static constexpr std::string_view sql = "PRAGMA table_info(clans);";
        const auto statement = sqlite::prepare(database, sql);

        while (sqlite3_step(statement.get()) == SQLITE_ROW)
        {
            if (sqlite::getString(statement.get(), 1) == "tracking_enabled")
            {
                return true;
            }
        }

        return false;
    }
}

TEST(DatabaseMigrationTest, CreatesExpectedSchemaInFreshDatabase)
{
    TemporaryDatabaseFile temporaryDatabase;

    {
        Database database(temporaryDatabase.path().string());
        const MigratorManager migratorManager(database);

        ASSERT_TRUE(migratorManager.migrate(CLASHBOT_MIGRATIONS_PATH));

        sqlite3* connection = database.getDBInstance();

        EXPECT_TRUE(tableExists(connection, "schema_migrations"));
        EXPECT_TRUE(tableExists(connection, "clans"));
        EXPECT_TRUE(tableExists(connection, "players"));
        EXPECT_TRUE(tableExists(connection, "clan_raids"));
        EXPECT_TRUE(tableExists(connection, "notifications"));
        EXPECT_TRUE(tableExists(connection, "telegram_chats"));
        EXPECT_TRUE(tableExists(connection, "clan_subscriptions"));

        EXPECT_EQ(8, migrationCount(connection));
        EXPECT_TRUE(clansHaveTrackingColumn(connection));
    }
}

TEST(DatabaseMigrationTest, RunningMigrationsTwiceIsSafe)
{
    TemporaryDatabaseFile temporaryDatabase;

    {
        Database database(temporaryDatabase.path().string());
        const MigratorManager migratorManager(database);

        ASSERT_TRUE(migratorManager.migrate(CLASHBOT_MIGRATIONS_PATH));

        sqlite3* connection = database.getDBInstance();
        ASSERT_EQ(8, migrationCount(connection));

        ASSERT_TRUE(migratorManager.migrate(CLASHBOT_MIGRATIONS_PATH));

        EXPECT_EQ(8, migrationCount(connection));
        EXPECT_TRUE(tableExists(connection, "clans"));
        EXPECT_TRUE(tableExists(connection, "notifications"));
        EXPECT_TRUE(clansHaveTrackingColumn(connection));
    }
}
