#include "core/Exceptions.h"
#include "database/SQLiteHelpers.h"
#include "database/TransactionManager.h"

#include <chrono>

#include <gtest/gtest.h>

namespace
{
    class TransactionManagerTest : public ::testing::Test
    {
    protected:
        sqlite3* connection = nullptr;

        void SetUp() override
        {
            ASSERT_EQ(sqlite3_open(":memory:", &connection), SQLITE_OK);
        }

        void TearDown() override
        {
            if (connection)
            {
                sqlite3_close(connection);
            }
        }

        [[nodiscard]] TransactionManager makeManager() const
        {
            return TransactionManager(
                connection,
                RetryPolicy(3, std::chrono::milliseconds::zero()));
        }
    };
}

TEST_F(TransactionManagerTest, RetriesBusyOperationUntilItSucceeds)
{
    auto transactionManager = makeManager();
    int attempts = 0;

    const int result = transactionManager.retryInTransaction([&]
    {
        ++attempts;

        if (attempts < 3)
        {
            throw DatabaseException(SQLITE_BUSY, "database is busy");
        }

        return 42;
    });

    EXPECT_EQ(result, 42);
    EXPECT_EQ(attempts, 3);
}

TEST_F(TransactionManagerTest, DoesNotRetryNonBusyDatabaseError)
{
    auto transactionManager = makeManager();
    int attempts = 0;

    EXPECT_THROW(
        transactionManager.retryInTransaction([&]
        {
            ++attempts;
            throw DatabaseException(SQLITE_CONSTRAINT, "constraint failed");
        }),
        DatabaseException);

    EXPECT_EQ(attempts, 1);
}

TEST_F(TransactionManagerTest, PropagatesBusyErrorAfterMaxAttempts)
{
    auto transactionManager = makeManager();
    int attempts = 0;

    EXPECT_THROW(
        transactionManager.retryInTransaction([&]
        {
            ++attempts;
            throw DatabaseException(SQLITE_BUSY, "database is busy");
        }),
        DatabaseException);

    EXPECT_EQ(attempts, 3);
}

TEST_F(TransactionManagerTest, SupportsVoidOperations)
{
    auto transactionManager = makeManager();
    int attempts = 0;

    transactionManager.retryInTransaction([&]
    {
        ++attempts;

        if (attempts == 1)
        {
            throw DatabaseException(SQLITE_BUSY, "database is busy");
        }

        sqlite::execute(connection, "CREATE TABLE test_table (value INTEGER);");
    });

    EXPECT_EQ(attempts, 2);
}
