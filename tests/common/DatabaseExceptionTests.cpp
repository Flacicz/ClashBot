#include "core/Exceptions.h"

#include <string>

#include <gtest/gtest.h>

TEST(DatabaseExceptionTest, RecognizesBusyPrimaryResultCode)
{
    const DatabaseException exception(SQLITE_BUSY, "database is busy");

    ASSERT_TRUE(exception.sqliteCode().has_value());
    EXPECT_EQ(exception.sqliteCode().value(), SQLITE_BUSY);
    EXPECT_TRUE(exception.isBusy());
}

TEST(DatabaseExceptionTest, RecognizesBusyExtendedResultCode)
{
    const int extendedBusyCode = SQLITE_BUSY | (1 << 8);
    const DatabaseException exception(extendedBusyCode, "database is busy");

    EXPECT_EQ(exception.sqliteCode().value(), extendedBusyCode);
    EXPECT_TRUE(exception.isBusy());
}

TEST(DatabaseExceptionTest, DoesNotRecognizeNonBusyResultCode)
{
    const DatabaseException exception(SQLITE_LOCKED, "database is locked");

    EXPECT_FALSE(exception.isBusy());
}

TEST(DatabaseExceptionTest, DoesNotRecognizeExceptionWithoutSqliteCode)
{
    const DatabaseException exception("database operation failed");

    EXPECT_FALSE(exception.sqliteCode().has_value());
    EXPECT_FALSE(exception.isBusy());
}
