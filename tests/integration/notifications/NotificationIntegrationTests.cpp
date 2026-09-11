#include "database/Database.h"
#include "database/MigratorManager.h"

#include <chrono>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>

#include <gtest/gtest.h>

namespace
{
    class NotificationIntegrationTest : public ::testing::Test
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
                ("clashbot-notification-integration-" +
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

TEST_F(NotificationIntegrationTest, DoesNotRecordTheSameEventTwiceForDestination)
{
    constexpr std::string_view eventType = "RaidsEndedEvent";
    constexpr std::string_view eventId = "raid-42";
    constexpr long long chatId = -1001234567890LL;
    constexpr long long messageThreadId = 456;

    EXPECT_FALSE(database->notifications().wasSent(
        eventType,
        eventId,
        chatId,
        messageThreadId));

    database->notifications().markAsSent(
        eventType,
        eventId,
        chatId,
        messageThreadId);

    EXPECT_TRUE(database->notifications().wasSent(
        eventType,
        eventId,
        chatId,
        messageThreadId));

    EXPECT_NO_THROW(database->notifications().markAsSent(
        eventType,
        eventId,
        chatId,
        messageThreadId));

    EXPECT_TRUE(database->notifications().wasSent(
        eventType,
        eventId,
        chatId,
        messageThreadId));

    EXPECT_FALSE(database->notifications().wasSent(
        eventType,
        eventId,
        chatId + 1,
        messageThreadId));
}
