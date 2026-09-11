#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/TransactionManager.h"

#include <chrono>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>

#include <gtest/gtest.h>

namespace
{
    class SubscriptionIntegrationTest : public ::testing::Test
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
                ("clashbot-subscription-integration-" +
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

TEST_F(SubscriptionIntegrationTest, LinksClanToTelegramDestination)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    constexpr long long chatId = -1001234567890LL;
    constexpr long long messageThreadId = 456;

    TransactionManager transactionManager(database->getDBInstance());
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

        transaction.commit();
    }

    ASSERT_TRUE(database->subscriptions().hasSubscription(
        chatId,
        messageThreadId,
        clanTag,
        Audience::Players));

    const auto clanTags = database->subscriptions().getClanTagsForChat(
        chatId,
        messageThreadId,
        Audience::Players);

    ASSERT_EQ(1U, clanTags.size());
    EXPECT_EQ(clanTag, clanTags.front());

    const auto destinations = database->subscriptions().getDestinationsForClan(
        clanTag,
        Audience::Players);

    ASSERT_EQ(1U, destinations.size());
    EXPECT_EQ(chatId, destinations.front().chatId);
    EXPECT_EQ(messageThreadId, destinations.front().messageThreadId);

    const auto trackedClans = database->clans().getTrackedClans();
    ASSERT_EQ(1U, trackedClans.size());
    EXPECT_EQ(clanTag, trackedClans.front());
}

TEST_F(SubscriptionIntegrationTest, RepeatingLinkDoesNotDuplicateSubscription)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    constexpr long long chatId = -1001234567890LL;
    constexpr long long messageThreadId = 456;

    TransactionManager transactionManager(database->getDBInstance());

    for (int attempt = 0; attempt < 2; ++attempt)
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

        transaction.commit();
    }

    const auto clanTags = database->subscriptions().getClanTagsForChat(
        chatId,
        messageThreadId,
        Audience::Players);
    EXPECT_EQ(1U, clanTags.size());

    const auto destinations = database->subscriptions().getDestinationsForClan(
        clanTag,
        Audience::Players);
    EXPECT_EQ(1U, destinations.size());

    const auto trackedClans = database->clans().getTrackedClans();
    EXPECT_EQ(1U, trackedClans.size());
}
