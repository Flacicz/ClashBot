//
// Created by zuevm on 11.09.2026.
//

#include <chrono>
#include <filesystem>
#include <future>
#include <gtest/gtest.h>

#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/TransactionManager.h"

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
}

TEST(WorkerConnectionsIntegrationTest, AllowsConcurrentWritesThroughSeparateConnections)
{
    const TemporaryDatabaseFile temporary_database_file;

    Database syncDb(temporary_database_file.path().string());
    const MigratorManager migratorManager(syncDb);
    ASSERT_TRUE(migratorManager.migrate(CLASHBOT_MIGRATIONS_PATH));

    TransactionManager syncTransactionManager(syncDb.getDBInstance());

    const Database telegramDb(temporary_database_file.path().string());
    TransactionManager telegramTransactionManager(telegramDb.getDBInstance());

    ASSERT_NE(syncDb.getDBInstance(), telegramDb.getDBInstance());

    auto syncTask = std::async(
        std::launch::async,
        [&syncDb, &syncTransactionManager]
    {
        syncTransactionManager.retryInTransaction([&syncDb]
        {
            syncDb.clans().insertMinimalClan("#TEST");
        });
    });

    auto telegramTask = std::async(
        std::launch::async,
        [&telegramDb, &telegramTransactionManager]
    {
        telegramTransactionManager.retryInTransaction([&telegramDb]
        {
            telegramDb.clans().insertMinimalClan("#TEST");
            telegramDb.subscriptions().saveTelegramChat(1, 0, "test");
            telegramDb.subscriptions().subscribeToChat(
                1,
                0,
                "#TEST",
                Audience::Management);
        });
    });

    EXPECT_NO_THROW(syncTask.get());
    EXPECT_NO_THROW(telegramTask.get());

    const Database checkConnection(temporary_database_file.path().string());

    const auto trackedClans = checkConnection.clans().getTrackedClans();
    ASSERT_EQ(1U, trackedClans.size());
    EXPECT_EQ("#TEST", trackedClans.front());

    EXPECT_TRUE(checkConnection.subscriptions().hasSubscription(
        1,
        0,
        "#TEST",
        Audience::Management));

    const auto destinations = checkConnection.subscriptions().getDestinationsForClan(
        "#TEST",
        Audience::Management);
    ASSERT_EQ(1U, destinations.size());
    EXPECT_EQ(1, destinations.front().chatId);
    EXPECT_EQ(0, destinations.front().messageThreadId);
}
