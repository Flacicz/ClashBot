#include "core/Exceptions.h"
#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/SQLiteHelpers.h"
#include "database/TransactionManager.h"

#include <chrono>
#include <fstream>
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

        std::filesystem::path writeMigration(
            const std::string_view filename,
            const std::string_view sql)
        {
            const auto destination = path_ / std::string(filename);
            if (!std::filesystem::exists(destination))
            {
                files_.push_back(destination);
            }

            std::ofstream out(destination, std::ios::binary | std::ios::trunc);
            if (!out.is_open())
            {
                throw std::runtime_error("Failed to create temporary migration file");
            }

            out << sql;
            if (!out)
            {
                throw std::runtime_error("Failed to write temporary migration file");
            }

            return destination;
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

    int rowCount(sqlite3* database, const std::string_view table)
    {
        const auto statement = sqlite::prepare(
            database, "SELECT COUNT(*) FROM " + std::string(table) + ";");
        if (sqlite3_step(statement.get()) != SQLITE_ROW)
            throw std::runtime_error(sqlite3_errmsg(database));
        return sqlite::getInt(statement.get(), 0);
    }

    bool foreignKeysEnabled(sqlite3* database)
    {
        const auto statement = sqlite::prepare(database, "PRAGMA foreign_keys;");
        if (sqlite3_step(statement.get()) != SQLITE_ROW)
            throw std::runtime_error(sqlite3_errmsg(database));
        return sqlite::getInt(statement.get(), 0) == 1;
    }

    bool foreignKeysValid(sqlite3* database)
    {
        const auto statement = sqlite::prepare(database, "PRAGMA foreign_key_check;");
        return sqlite3_step(statement.get()) == SQLITE_DONE;
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
        TransactionManager transactions(database.getDBInstance());
        const MigratorManager migratorManager(database, transactions);

        ASSERT_NO_THROW(migratorManager.migrate(CLASHBOT_MIGRATIONS_PATH));

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
        EXPECT_TRUE(foreignKeysEnabled(connection));
        EXPECT_TRUE(foreignKeysValid(connection));
    }
}

TEST(DatabaseMigrationTest, RunningMigrationsTwiceIsSafe)
{
    TemporaryDatabaseFile temporaryDatabase;

    {
        Database database(temporaryDatabase.path().string());
        TransactionManager transactions(database.getDBInstance());
        const MigratorManager migratorManager(database, transactions);

        ASSERT_NO_THROW(migratorManager.migrate(CLASHBOT_MIGRATIONS_PATH));

        sqlite3* connection = database.getDBInstance();
        ASSERT_EQ(12, migrationCount(connection));

        ASSERT_NO_THROW(migratorManager.migrate(CLASHBOT_MIGRATIONS_PATH));

        EXPECT_EQ(12, migrationCount(connection));
        EXPECT_TRUE(tableExists(connection, "clans"));
        EXPECT_TRUE(tableExists(connection, "notifications"));
        EXPECT_TRUE(tableExists(connection, "sync_outages"));
        EXPECT_TRUE(clansHaveTrackingColumn(connection));
        EXPECT_TRUE(foreignKeysEnabled(connection));
    }
}

TEST(DatabaseMigrationTest, UpgradesPopulatedVersion010WithoutLosingHistoricalRows)
{
    TemporaryDatabaseFile temporaryDatabase;
    TemporaryMigrationsDirectory oldMigrations(10);
    Database database(temporaryDatabase.path().string());
    TransactionManager transactions(database.getDBInstance());
    const MigratorManager migrator(database, transactions);
    ASSERT_NO_THROW(migrator.migrate(oldMigrations.path().string()));
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
    ASSERT_NO_THROW(migrator.migrate(through011.path().string()));
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

    ASSERT_NO_THROW(migrator.migrate(CLASHBOT_MIGRATIONS_PATH));
    EXPECT_EQ(12, migrationCount(connection));
    EXPECT_FALSE(database.notifications().enqueueIfAbsent(
        "duplicate", "old_report", "historic-1", -1001, 7));

    const auto foreignKeys = sqlite::prepare(connection, "PRAGMA foreign_key_check;");
    EXPECT_EQ(SQLITE_DONE, sqlite3_step(foreignKeys.get()));
}

TEST(DatabaseMigrationTest, RollsBackMigrationWhenFailureOccursBeforeVersionInsert)
{
    TemporaryDatabaseFile temporaryDatabase;
    TemporaryMigrationsDirectory migrations(10);
    constexpr std::string_view migrationName = "011_failure_before_version.sql";

    {
        Database database(temporaryDatabase.path().string());
        TransactionManager transactions(database.getDBInstance());
        const MigratorManager migrator(database, transactions);
        ASSERT_NO_THROW(migrator.migrate(migrations.path().string()));
        ASSERT_EQ(10, migrationCount(database.getDBInstance()));
    }

    migrations.writeMigration(migrationName, R"(
        CREATE TABLE migration_test_before_version (
            id INTEGER PRIMARY KEY
        );

        CREATE TRIGGER fail_migration_version_insert
        BEFORE INSERT ON schema_migrations
        WHEN NEW.version = '011_failure_before_version.sql'
        BEGIN
            SELECT RAISE(ABORT, 'injected failure before version insert');
        END;
    )");

    {
        Database database(temporaryDatabase.path().string());
        TransactionManager transactions(database.getDBInstance());
        const MigratorManager migrator(database, transactions);
        EXPECT_THROW(migrator.migrate(migrations.path().string()), DatabaseException);
    }

    {
        Database database(temporaryDatabase.path().string());
        sqlite3* connection = database.getDBInstance();

        EXPECT_FALSE(tableExists(connection, "migration_test_before_version"));
        EXPECT_EQ(10, migrationCount(connection));
    }

    migrations.writeMigration(migrationName, R"(
        CREATE TABLE migration_test_before_version (
            id INTEGER PRIMARY KEY
        );
    )");

    {
        Database database(temporaryDatabase.path().string());
        TransactionManager transactions(database.getDBInstance());
        const MigratorManager migrator(database, transactions);

        ASSERT_NO_THROW(migrator.migrate(migrations.path().string()));
        EXPECT_TRUE(tableExists(database.getDBInstance(), "migration_test_before_version"));
        EXPECT_EQ(11, migrationCount(database.getDBInstance()));
    }
}

TEST(DatabaseMigrationTest, PreservesRelatedRowsWhenUpgradingPopulatedVersion002)
{
    TemporaryDatabaseFile temporaryDatabase;
    TemporaryMigrationsDirectory through002(2);
    TemporaryMigrationsDirectory through003(3);
    Database database(temporaryDatabase.path().string());
    TransactionManager transactions(database.getDBInstance());
    const MigratorManager migrator(database, transactions);
    sqlite3* connection = database.getDBInstance();

    ASSERT_NO_THROW(migrator.migrate(through002.path().string()));
    sqlite::execute(connection,
        "INSERT INTO clans(tag, name, type) VALUES ('#OLD', 'Old clan', 'open');"
        "INSERT INTO cwl_seasons(clan_tag, season_id) VALUES ('#OLD', '2026-08');"
        "INSERT INTO raid_summary(clan_tag, date, state) VALUES ('#OLD', 1000, 'ended');");

    ASSERT_NO_THROW(migrator.migrate(through003.path().string()));
    EXPECT_EQ(3, migrationCount(connection));
    EXPECT_EQ(1, rowCount(connection, "clans"));
    EXPECT_EQ(1, rowCount(connection, "cwl_seasons"));
    EXPECT_EQ(1, rowCount(connection, "raid_summary"));
    EXPECT_TRUE(foreignKeysValid(connection));
    EXPECT_TRUE(foreignKeysEnabled(connection));
}

TEST(DatabaseMigrationTest, RestoresForeignKeysAfterLegacyRebuildFails)
{
    TemporaryDatabaseFile temporaryDatabase;
    TemporaryMigrationsDirectory through002(2);
    TemporaryMigrationsDirectory through003(3);
    Database database(temporaryDatabase.path().string());
    TransactionManager transactions(database.getDBInstance());
    const MigratorManager migrator(database, transactions);
    sqlite3* connection = database.getDBInstance();

    ASSERT_NO_THROW(migrator.migrate(through002.path().string()));
    sqlite::execute(connection,
        "INSERT INTO clans(tag, name, type) VALUES ('#OLD', 'Old clan', 'open');"
        "INSERT INTO cwl_seasons(clan_tag, season_id) VALUES ('#OLD', '2026-08');"
        "CREATE TRIGGER fail_legacy_version BEFORE INSERT ON schema_migrations "
        "WHEN NEW.version = '003_clan_info_schema_v1_to_v2.sql' "
        "BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");

    EXPECT_THROW(migrator.migrate(through003.path().string()), DatabaseException);
    EXPECT_EQ(2, migrationCount(connection));
    EXPECT_EQ(1, rowCount(connection, "clans"));
    EXPECT_EQ(1, rowCount(connection, "cwl_seasons"));
    EXPECT_FALSE(tableExists(connection, "clans_new"));
    EXPECT_TRUE(foreignKeysEnabled(connection));
    EXPECT_TRUE(foreignKeysValid(connection));
}

TEST(DatabaseMigrationTest, PreservesRelatedRowsWhenUpgradingPopulatedVersion005)
{
    TemporaryDatabaseFile temporaryDatabase;
    TemporaryMigrationsDirectory through005(5);
    TemporaryMigrationsDirectory through006(6);
    TemporaryMigrationsDirectory through007(7);
    Database database(temporaryDatabase.path().string());
    TransactionManager transactions(database.getDBInstance());
    const MigratorManager migrator(database, transactions);
    sqlite3* connection = database.getDBInstance();

    ASSERT_NO_THROW(migrator.migrate(through005.path().string()));
    sqlite::execute(connection,
        "INSERT INTO clans(tag, name) VALUES ('#OLD', 'Old clan');"
        "INSERT INTO telegram_chats(chat_id, title) VALUES (-1001, 'Old chat');"
        "INSERT INTO clan_subscriptions(clan_tag, chat_id) VALUES ('#OLD', -1001);"
        "INSERT INTO notifications(event_type, event_id, chat_id) "
        "VALUES ('old_report', 'historic-1', -1001);");

    ASSERT_NO_THROW(migrator.migrate(through006.path().string()));
    ASSERT_NO_THROW(migrator.migrate(through007.path().string()));
    EXPECT_EQ(7, migrationCount(connection));
    EXPECT_EQ(1, rowCount(connection, "telegram_chats"));
    EXPECT_EQ(1, rowCount(connection, "clan_subscriptions"));
    EXPECT_EQ(1, rowCount(connection, "notifications"));
    const auto row = sqlite::prepare(connection,
        "SELECT message_thread_id, audience FROM clan_subscriptions WHERE clan_tag = '#OLD';");
    ASSERT_EQ(SQLITE_ROW, sqlite3_step(row.get()));
    EXPECT_EQ(0, sqlite::getInt(row.get(), 0));
    EXPECT_EQ("players", sqlite::getString(row.get(), 1));
    EXPECT_TRUE(foreignKeysValid(connection));
    EXPECT_TRUE(foreignKeysEnabled(connection));
}

TEST(DatabaseMigrationTest, EnforcesCascadeInOrdinaryMigration)
{
    TemporaryDatabaseFile temporaryDatabase;
    TemporaryMigrationsDirectory migrations(0);
    migrations.writeMigration("001_parent_and_child.sql", R"(
        CREATE TABLE parent(id INTEGER PRIMARY KEY);
        CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL
            REFERENCES parent(id) ON DELETE CASCADE);
        INSERT INTO parent(id) VALUES (1);
        INSERT INTO child(id, parent_id) VALUES (1, 1);
    )");
    migrations.writeMigration("002_delete_parent.sql", "DELETE FROM parent WHERE id = 1;");

    Database database(temporaryDatabase.path().string());
    TransactionManager transactions(database.getDBInstance());
    const MigratorManager migrator(database, transactions);
    sqlite3* connection = database.getDBInstance();

    ASSERT_NO_THROW(migrator.migrate(migrations.path().string()));
    EXPECT_EQ(2, migrationCount(connection));
    EXPECT_EQ(0, rowCount(connection, "parent"));
    EXPECT_EQ(0, rowCount(connection, "child"));
    EXPECT_TRUE(foreignKeysEnabled(connection));
}

TEST(DatabaseMigrationTest, RejectsForeignKeyViolationWithoutRecordingMigration)
{
    TemporaryDatabaseFile temporaryDatabase;
    TemporaryMigrationsDirectory migrations(0);
    migrations.writeMigration("001_marker.sql", "CREATE TABLE migration_marker(id INTEGER);");

    Database database(temporaryDatabase.path().string());
    sqlite3* connection = database.getDBInstance();
    sqlite::execute(connection,
        "CREATE TABLE parent(id INTEGER PRIMARY KEY);"
        "CREATE TABLE child(parent_id INTEGER REFERENCES parent(id));"
        "PRAGMA foreign_keys = OFF;"
        "INSERT INTO child(parent_id) VALUES (123);"
        "PRAGMA foreign_keys = ON;");
    TransactionManager transactions(connection);
    const MigratorManager migrator(database, transactions);

    EXPECT_THROW(migrator.migrate(migrations.path().string()), DatabaseException);
    EXPECT_FALSE(tableExists(connection, "migration_marker"));
    EXPECT_EQ(0, migrationCount(connection));
    EXPECT_TRUE(foreignKeysEnabled(connection));
}

TEST(DatabaseMigrationTest, RejectsTransactionManagerForAnotherConnection)
{
    TemporaryDatabaseFile firstPath;
    TemporaryDatabaseFile secondPath;
    Database database(firstPath.path().string());
    Database otherDatabase(secondPath.path().string());
    TransactionManager otherTransactions(otherDatabase.getDBInstance());

    EXPECT_THROW((MigratorManager{database, otherTransactions}), DatabaseException);
}

TEST(DatabaseMigrationTest, RollsBackPartialMigrationWhenFailureOccursMidScript)
{
    TemporaryDatabaseFile temporaryDatabase;
    TemporaryMigrationsDirectory migrations(0);
    constexpr std::string_view migrationName = "001_failure_mid_script.sql";

    migrations.writeMigration(migrationName, R"(
        CREATE TABLE migration_test_mid_script (
            id INTEGER PRIMARY KEY
        );

        INSERT INTO missing_migration_test_table (id) VALUES (1);
    )");

    {
        Database database(temporaryDatabase.path().string());
        TransactionManager transactions(database.getDBInstance());
        const MigratorManager migrator(database, transactions);

        EXPECT_THROW(migrator.migrate(migrations.path().string()), DatabaseException);
    }

    {
        Database database(temporaryDatabase.path().string());
        sqlite3* connection = database.getDBInstance();

        EXPECT_FALSE(tableExists(connection, "migration_test_mid_script"));
        EXPECT_EQ(0, migrationCount(connection));
    }

    migrations.writeMigration(migrationName, R"(
        CREATE TABLE migration_test_mid_script (
            id INTEGER PRIMARY KEY
        );
    )");

    {
        Database database(temporaryDatabase.path().string());
        TransactionManager transactions(database.getDBInstance());
        const MigratorManager migrator(database, transactions);

        ASSERT_NO_THROW(migrator.migrate(migrations.path().string()));
        EXPECT_TRUE(tableExists(database.getDBInstance(), "migration_test_mid_script"));
        EXPECT_EQ(1, migrationCount(database.getDBInstance()));
    }

}
