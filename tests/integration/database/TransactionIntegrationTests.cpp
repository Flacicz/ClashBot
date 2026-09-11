#include "core/Exceptions.h"
#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/SQLiteHelpers.h"
#include "database/TransactionManager.h"

#include <chrono>
#include <filesystem>
#include <memory>
#include <string_view>

#include <gtest/gtest.h>

namespace
{
    class TransactionIntegrationTest : public ::testing::Test
    {
    protected:
        std::filesystem::path databasePath;
        std::unique_ptr<Database> database;

        static void removeDatabaseFiles(const std::filesystem::path& path)
        {
            std::error_code error;
            std::filesystem::remove(path, error);
            std::filesystem::remove(path.string() + "-wal", error);
            std::filesystem::remove(path.string() + "-shm", error);
        }

        void SetUp() override
        {
            const auto uniquePart = std::chrono::high_resolution_clock::now()
                .time_since_epoch()
                .count();

            databasePath = std::filesystem::temp_directory_path() /
                ("clashbot-transaction-integration-" +
                 std::to_string(uniquePart) + ".sqlite");

            removeDatabaseFiles(databasePath);

            database = std::make_unique<Database>(databasePath.string());
            const MigratorManager migratorManager(*database);

            ASSERT_TRUE(migratorManager.migrate(CLASHBOT_MIGRATIONS_PATH));
        }

        void TearDown() override
        {
            database.reset();
            removeDatabaseFiles(databasePath);
        }
    };
}

TEST_F(TransactionIntegrationTest, RollbackRemovesPartialChanges)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    constexpr long long chatId = -1001234567890LL;
    constexpr long long messageThreadId = 456;

    TransactionManager transactionManager(database->getDBInstance());

    EXPECT_THROW(
        {
            auto transaction = transactionManager.beginTransaction();

            database->clans().insertMinimalClan(clanTag);
            database->subscriptions().saveTelegramChat(
                chatId,
                messageThreadId,
                "Integration Test Group");
            database->subscriptions().subscribeToChat(
                chatId,
                messageThreadId,
                clanTag,
                Audience::Players);

            sqlite::execute(
                database->getDBInstance(),
                "INSERT INTO table_that_does_not_exist VALUES (1);");

            transaction.commit();
        },
        DatabaseException);

    EXPECT_TRUE(database->clans().getTrackedClans().empty());
    EXPECT_FALSE(database->subscriptions().hasSubscription(
        chatId,
        messageThreadId,
        clanTag,
        Audience::Players));
    EXPECT_FALSE(database->subscriptions().hasSubscriptionsForChat(
        chatId,
        messageThreadId));
}
