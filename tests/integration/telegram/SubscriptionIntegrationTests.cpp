#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/TransactionManager.h"
#include "database/SQLiteHelpers.h"
#include "domain_events/DomainEventPayloadSerializer.h"
#include "domain_events/DomainEventRecorder.h"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <stdexcept>
#include <vector>

#include <gtest/gtest.h>

namespace
{
    int countRows(sqlite3* connection, const std::string_view table)
    {
        const auto statement = sqlite::prepare(connection,
            "SELECT COUNT(*) FROM " + std::string(table));
        if (sqlite3_step(statement.get()) != SQLITE_ROW)
            throw std::runtime_error(sqlite3_errmsg(connection));
        return sqlite::getInt(statement.get(), 0);
    }

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

TEST_F(SubscriptionIntegrationTest, LooksUpSubscriptionIdForExactSubscription)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    constexpr long long chatId = -1001234567890LL;
    constexpr long long messageThreadId = 456;

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

    const auto subscriptionId = database->subscriptions().getSubscriptionId(
        chatId,
        messageThreadId,
        clanTag,
        Audience::Players);

    ASSERT_TRUE(subscriptionId.has_value());
    EXPECT_GT(*subscriptionId, 0);
    EXPECT_FALSE(database->subscriptions().getSubscriptionId(
        chatId,
        messageThreadId,
        clanTag,
        Audience::Management).has_value());

    database->subscriptions().unsubscribeFromChat(
        chatId,
        messageThreadId,
        clanTag,
        Audience::Players);

    EXPECT_FALSE(database->subscriptions().getSubscriptionId(
        chatId,
        messageThreadId,
        clanTag,
        Audience::Players).has_value());
}

TEST_F(SubscriptionIntegrationTest, RecorderFreezesAudienceAndSubscriptionIdsAtFirstCommit)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    database->clans().insertMinimalClan(clanTag);

    const auto subscribe = [&](const long long chatId, const long long topic,
                               const Audience audience)
    {
        database->subscriptions().saveTelegramChat(chatId, topic, "test chat");
        database->subscriptions().subscribeToChat(chatId, topic, clanTag, audience);
        return *database->subscriptions().getSubscriptionId(chatId, topic, clanTag, audience);
    };

    const auto playersOne = subscribe(-1001, 0, Audience::Players);
    const auto playersTopic = subscribe(-1001, 7, Audience::Players);
    const auto management = subscribe(-1002, 0, Audience::Management);

    DomainEventPayloadSerializer serializer;
    DomainEventRecorder recorder(serializer, database->subscriptions(), database->domainEvents());
    const std::vector<ApplicationEvent> events{
        WarEndedEvent{std::string(clanTag), ClanwarReference{std::string(clanTag), 42, 1, 2}}
    };

    TransactionManager transactions(database->getDBInstance());
    transactions.retryInTransaction([&] { recorder.recordAll(events); });

    auto destinations = database->domainEvents().getPendingDestinations(10);
    ASSERT_EQ(3U, destinations.size());
    EXPECT_EQ(1, countRows(database->getDBInstance(), "domain_events"));
    EXPECT_EQ(3, countRows(database->getDBInstance(), "domain_event_destinations"));

    const auto hasDestination = [&](const long long chatId, const long long topic,
                                    const Audience audience, const long long subscriptionId)
    {
        return std::ranges::any_of(destinations, [&](const auto& destination)
        {
            return destination.chatId == chatId &&
                destination.messageThreadId == topic &&
                destination.audience == audience &&
                destination.subscriptionId == subscriptionId;
        });
    };
    EXPECT_TRUE(hasDestination(-1001, 0, Audience::Players, playersOne));
    EXPECT_TRUE(hasDestination(-1001, 7, Audience::Players, playersTopic));
    EXPECT_TRUE(hasDestination(-1002, 0, Audience::Management, management));

    subscribe(-1003, 0, Audience::Players);
    transactions.retryInTransaction([&] { recorder.recordAll(events); });

    destinations = database->domainEvents().getPendingDestinations(10);
    EXPECT_EQ(3U, destinations.size());
    EXPECT_EQ(1, countRows(database->getDBInstance(), "domain_events"));
    EXPECT_EQ(3, countRows(database->getDBInstance(), "domain_event_destinations"));
}

TEST_F(SubscriptionIntegrationTest, RollbackDiscardsStateEventAndDestinationsTogether)
{
    DomainEventPayloadSerializer serializer;
    DomainEventRecorder recorder(serializer, database->subscriptions(), database->domainEvents());
    TransactionManager transactions(database->getDBInstance());
    bool reachedRollbackPoint = false;

    try
    {
        auto transaction = transactions.beginTransaction();
        database->clans().insertMinimalClan("#ROLLBACK");
        database->subscriptions().saveTelegramChat(-1001, 0, "test chat");
        database->subscriptions().subscribeToChat(-1001, 0, "#ROLLBACK", Audience::Players);
        recorder.recordAll({PlayerJoinedClanEvent{"#ROLLBACK", "#P1", "Alice", 42}});
        EXPECT_EQ(1, countRows(database->getDBInstance(), "clans"));
        EXPECT_EQ(1, countRows(database->getDBInstance(), "domain_events"));
        EXPECT_EQ(1, countRows(database->getDBInstance(), "domain_event_destinations"));
        reachedRollbackPoint = true;
        throw std::runtime_error("simulate failure before commit");
    }
    catch (const std::runtime_error&)
    {
    }

    ASSERT_TRUE(reachedRollbackPoint);
    EXPECT_EQ(0, countRows(database->getDBInstance(), "clans"));
    EXPECT_EQ(0, countRows(database->getDBInstance(), "domain_events"));
    EXPECT_EQ(0, countRows(database->getDBInstance(), "domain_event_destinations"));
}
