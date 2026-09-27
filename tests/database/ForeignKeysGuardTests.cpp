#include "core/Exceptions.h"
#include "database/Database.h"
#include "database/ForeignKeysGuard.h"
#include "database/SQLiteHelpers.h"
#include "database/TransactionGuard.h"

#include <chrono>
#include <filesystem>
#include <stdexcept>
#include <string>

#include <gtest/gtest.h>

namespace
{
    class TemporaryDatabasePath
    {
        std::filesystem::path path_;

        void removeFiles() const
        {
            std::error_code error;
            std::filesystem::remove(path_, error);
            std::filesystem::remove(path_.string() + "-wal", error);
            std::filesystem::remove(path_.string() + "-shm", error);
        }

    public:
        TemporaryDatabasePath()
        {
            const auto uniquePart = std::chrono::high_resolution_clock::now()
                .time_since_epoch()
                .count();
            path_ = std::filesystem::temp_directory_path() /
                ("clashbot-foreign-keys-" + std::to_string(uniquePart) + ".sqlite");
            removeFiles();
        }

        ~TemporaryDatabasePath()
        {
            removeFiles();
        }

        [[nodiscard]] const std::filesystem::path& path() const
        {
            return path_;
        }
    };

    bool foreignKeysEnabled(sqlite3* const connection)
    {
        const auto statement = sqlite::prepare(connection, "PRAGMA foreign_keys;");
        const int rc = sqlite3_step(statement.get());
        if (rc != SQLITE_ROW)
        {
            throw std::runtime_error(sqlite3_errmsg(connection));
        }

        return sqlite::getInt(statement.get(), 0) != 0;
    }
}

TEST(ForeignKeysGuardTests, RestoreReenablesForeignKeysAndIsIdempotent)
{
    TemporaryDatabasePath path;
    Database database(path.path().string());
    sqlite3* const connection = database.getDBInstance();

    ASSERT_TRUE(foreignKeysEnabled(connection));
    ForeignKeysGuard guard(database);
    ASSERT_FALSE(foreignKeysEnabled(connection));

    EXPECT_NO_THROW(guard.restore());
    EXPECT_TRUE(foreignKeysEnabled(connection));

    EXPECT_NO_THROW(guard.restore());
    EXPECT_TRUE(foreignKeysEnabled(connection));
}

TEST(ForeignKeysGuardTests, RestoreCanBeRetriedAfterTransactionEnds)
{
    TemporaryDatabasePath path;
    Database database(path.path().string());
    sqlite3* const connection = database.getDBInstance();
    ForeignKeysGuard guard(database);

    {
        TransactionGuard transaction(connection);
        EXPECT_THROW(guard.restore(), DatabaseException);
        EXPECT_FALSE(foreignKeysEnabled(connection));
    }

    EXPECT_NO_THROW(guard.restore());
    EXPECT_TRUE(foreignKeysEnabled(connection));
}

TEST(ForeignKeysGuardTests, RestorePreservesInitiallyDisabledState)
{
    TemporaryDatabasePath path;
    Database database(path.path().string());
    sqlite3* const connection = database.getDBInstance();
    sqlite::execute(connection, "PRAGMA foreign_keys = OFF;");

    ForeignKeysGuard guard(database);
    EXPECT_NO_THROW(guard.restore());
    EXPECT_FALSE(foreignKeysEnabled(connection));
}
