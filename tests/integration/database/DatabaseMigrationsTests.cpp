#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/SQLiteHelpers.h"

#include <chrono>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

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

    class TemporaryMigrationsDirectory
    {
        std::filesystem::path path_;
        std::vector<std::filesystem::path> files_;

    public:
        explicit TemporaryMigrationsDirectory(const int lastVersion)
        {
            const auto uniquePart = std::chrono::high_resolution_clock::now()
                .time_since_epoch().count();
            path_ = std::filesystem::temp_directory_path() /
                ("clashbot-migrations-" + std::to_string(uniquePart));
            std::filesystem::create_directory(path_);
            for (const auto& entry : std::filesystem::directory_iterator(CLASHBOT_MIGRATIONS_PATH))
            {
                if (entry.path().extension() != ".sql") continue;
                const int version = std::stoi(entry.path().filename().string().substr(0, 3));
                if (version > lastVersion) continue;
                const auto destination = path_ / entry.path().filename();
                std::filesystem::copy_file(entry.path(), destination);
                files_.push_back(destination);
            }
        }

        ~TemporaryMigrationsDirectory()
        {
            std::error_code error;
            for (const auto& file : files_) std::filesystem::remove(file, error);
            std::filesystem::remove(path_, error);
        }

        [[nodiscard]] const std::filesystem::path& path() const { return path_; }
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
        EXPECT_TRUE(tableExists(connection, "sync_outages"));
        EXPECT_TRUE(tableExists(connection, "telegram_chats"));
        EXPECT_TRUE(tableExists(connection, "clan_subscriptions"));

        EXPECT_EQ(12, migrationCount(connection));
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
        ASSERT_EQ(12, migrationCount(connection));

        ASSERT_TRUE(migratorManager.migrate(CLASHBOT_MIGRATIONS_PATH));

        EXPECT_EQ(12, migrationCount(connection));
        EXPECT_TRUE(tableExists(connection, "clans"));
        EXPECT_TRUE(tableExists(connection, "notifications"));
        EXPECT_TRUE(tableExists(connection, "sync_outages"));
        EXPECT_TRUE(clansHaveTrackingColumn(connection));
    }
}

TEST(DatabaseMigrationTest, UpgradesPopulatedVersion010WithoutLosingHistoricalRows)
{
    TemporaryDatabaseFile temporaryDatabase;
    TemporaryMigrationsDirectory oldMigrations(10);
    Database database(temporaryDatabase.path().string());
    const MigratorManager migrator(database);
    ASSERT_TRUE(migrator.migrate(oldMigrations.path().string()));
    sqlite3* connection = database.getDBInstance();
    ASSERT_EQ(10, migrationCount(connection));

    database.clans().insertMinimalClan("#OLD");
    database.subscriptions().saveTelegramChat(-1001, 7, "old topic");
    sqlite::execute(connection,
        "INSERT INTO clan_subscriptions (clan_tag, chat_id, message_thread_id, audience) "
        "VALUES ('#OLD', -1001, 7, 'players');");
    sqlite::execute(connection,
        "INSERT INTO notifications (event_type, event_id, chat_id, message_thread_id, "
        "message_text, status, attempts) "
        "VALUES ('old_report', 'historic-1', -1001, 7, 'already delivered', 'sent', 1);");

    TemporaryMigrationsDirectory through011(11);
    ASSERT_TRUE(migrator.migrate(through011.path().string()));
    EXPECT_EQ(11, migrationCount(connection));
    EXPECT_TRUE(tableExists(connection, "domain_events"));
    EXPECT_TRUE(tableExists(connection, "domain_event_destinations"));

    const auto subscription = database.subscriptions().getSubscriptionId(
        -1001, 7, "#OLD", Audience::Players);
    ASSERT_TRUE(subscription.has_value());
    EXPECT_GT(*subscription, 0);

    const auto oldRow = sqlite::prepare(connection,
        "SELECT status, message_text, domain_event_destination_id "
        "FROM notifications WHERE event_id = 'historic-1';");
    ASSERT_EQ(SQLITE_ROW, sqlite3_step(oldRow.get()));
    EXPECT_EQ("sent", sqlite::getString(oldRow.get(), 0));
    EXPECT_EQ("already delivered", sqlite::getString(oldRow.get(), 1));
    EXPECT_EQ(SQLITE_NULL, sqlite3_column_type(oldRow.get(), 2));
    EXPECT_EQ(SQLITE_DONE, sqlite3_step(oldRow.get()));

    ASSERT_TRUE(migrator.migrate(CLASHBOT_MIGRATIONS_PATH));
    EXPECT_EQ(12, migrationCount(connection));
    EXPECT_FALSE(database.notifications().enqueueIfAbsent(
        "duplicate", "old_report", "historic-1", -1001, 7));

    const auto foreignKeys = sqlite::prepare(connection, "PRAGMA foreign_key_check;");
    EXPECT_EQ(SQLITE_DONE, sqlite3_step(foreignKeys.get()));
}
