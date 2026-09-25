#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/TransactionManager.h"
#include "database/SQLiteHelpers.h"
#include "domain_events/DomainEventPayloadDeserializer.h"
#include "domain_events/DomainEventPayloadSerializer.h"
#include "domain_events/DomainEventRecorder.h"
#include "domain_events/DomainEventWorker.h"
#include "notifications/NotificationService.h"
#include "notifications/NotificationWorker.h"

#include "support/FakeTelegramApiClient.h"

#include <chrono>
#include <filesystem>
#include <functional>
#include <memory>
#include <string_view>
#include <thread>
#include <vector>

#include <gtest/gtest.h>

namespace
{
    bool waitUntil(const std::function<bool()>& predicate)
    {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
        while (std::chrono::steady_clock::now() < deadline)
        {
            if (predicate()) return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        return predicate();
    }

    struct DestinationState
    {
        std::string status;
        int attempts;
        long long nextAttemptAt;
        std::string lastError;
    };

    DestinationState destinationState(sqlite3* connection, const std::string_view eventId)
    {
        const auto statement = sqlite::prepare(connection,
            "SELECT d.status, d.attempts, d.next_attempt_at, d.last_error "
            "FROM domain_event_destinations d "
            "JOIN domain_events e ON e.id = d.domain_event_id WHERE e.event_id = ?;");
        sqlite::bind(statement.get(), 1, eventId);
        if (sqlite3_step(statement.get()) != SQLITE_ROW)
            throw std::runtime_error("destination not found");
        return {sqlite::getString(statement.get(), 0), sqlite::getInt(statement.get(), 1),
                sqlite3_column_type(statement.get(), 2) == SQLITE_NULL
                    ? 0 : sqlite::getLong(statement.get(), 2),
                sqlite3_column_type(statement.get(), 3) == SQLITE_NULL
                    ? "" : sqlite::getString(statement.get(), 3)};
    }

    class NotificationServiceIntegrationTest : public ::testing::Test
    {
    protected:
        std::filesystem::path databasePath;
        std::unique_ptr<Database> database;
        std::unique_ptr<TransactionManager> transactionManager;
        FakeTelegramApiClient telegramApiClient;

        std::unique_ptr<TelegramNotifier> telegramNotifier;
        std::unique_ptr<NotificationWorker> notificationWorker;
        std::unique_ptr<PlayerJoinedFormatter> playerJoinedFormatter;
        std::unique_ptr<PlayerLeftFormatter> playerLeftFormatter;
        std::unique_ptr<PlayerRoleChangedFormatter> playerRoleChangedFormatter;
        std::unique_ptr<RaidsEndedFormatter> raidsEndedFormatter;
        std::unique_ptr<RaidsComparisonFormatter> raidsComparisonFormatter;
        std::unique_ptr<RaidsViolationsFormatter> raidsViolationsFormatter;
        std::unique_ptr<ClanwarEndedFormatter> clanwarEndedFormatter;
        std::unique_ptr<ClanwarViolationsFormatter> clanwarViolationsFormatter;
        std::unique_ptr<ClanwarComparisonFormatter> clanwarComparisonFormatter;
        std::unique_ptr<ClanwarRosterFormatter> clanwarRosterFormatter;
        std::unique_ptr<ClanwarsLeagueRoundEndedFormatter> clanwarLeagueRoundEndedFormatter;
        std::unique_ptr<ClanwarsLeagueRoundViolationsFormatter> clanwarLeagueRoundViolationsFormatter;
        std::unique_ptr<NotificationService> notificationService;

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
                ("clashbot-notification-service-integration-" +
                 std::to_string(uniquePart) + ".sqlite");

            removeDatabaseFiles(databasePath);

            database = std::make_unique<Database>(databasePath.string());
            const MigratorManager migratorManager(*database);
            ASSERT_TRUE(migratorManager.migrate(CLASHBOT_MIGRATIONS_PATH));

            transactionManager = std::make_unique<TransactionManager>(
                database->getDBInstance());

            telegramNotifier = std::make_unique<TelegramNotifier>(telegramApiClient);
            notificationWorker = std::make_unique<NotificationWorker>(
                database->notifications(),
                *telegramNotifier);
            playerJoinedFormatter = std::make_unique<PlayerJoinedFormatter>(database->clans());
            playerLeftFormatter = std::make_unique<PlayerLeftFormatter>(database->clans());
            playerRoleChangedFormatter = std::make_unique<PlayerRoleChangedFormatter>(database->clans());
            raidsEndedFormatter = std::make_unique<RaidsEndedFormatter>(database->clans(), database->raids());
            raidsComparisonFormatter = std::make_unique<RaidsComparisonFormatter>(database->clans(), database->raids());
            raidsViolationsFormatter = std::make_unique<RaidsViolationsFormatter>(database->raids());
            clanwarEndedFormatter = std::make_unique<ClanwarEndedFormatter>(database->war());
            clanwarViolationsFormatter = std::make_unique<ClanwarViolationsFormatter>(database->war());
            clanwarComparisonFormatter = std::make_unique<ClanwarComparisonFormatter>(database->war());
            clanwarRosterFormatter = std::make_unique<ClanwarRosterFormatter>(database->clans(), database->war());
            clanwarLeagueRoundEndedFormatter = std::make_unique<ClanwarsLeagueRoundEndedFormatter>(
                database->leagueWar(), database->war());
            clanwarLeagueRoundViolationsFormatter = std::make_unique<ClanwarsLeagueRoundViolationsFormatter>(
                database->leagueWar(), database->war());

            notificationService = std::make_unique<NotificationService>(
                database->notifications(),
                database->subscriptions(),
                *transactionManager,
                *notificationWorker,
                *playerJoinedFormatter,
                *playerLeftFormatter,
                *playerRoleChangedFormatter,
                *raidsEndedFormatter,
                *raidsComparisonFormatter,
                *raidsViolationsFormatter,
                *clanwarEndedFormatter,
                *clanwarViolationsFormatter,
                *clanwarComparisonFormatter,
                *clanwarRosterFormatter,
                *clanwarLeagueRoundEndedFormatter,
                *clanwarLeagueRoundViolationsFormatter);
        }

        void TearDown() override
        {
            notificationService.reset();
            clanwarLeagueRoundViolationsFormatter.reset();
            clanwarLeagueRoundEndedFormatter.reset();
            clanwarRosterFormatter.reset();
            clanwarComparisonFormatter.reset();
            clanwarViolationsFormatter.reset();
            clanwarEndedFormatter.reset();
            raidsViolationsFormatter.reset();
            raidsComparisonFormatter.reset();
            raidsEndedFormatter.reset();
            playerRoleChangedFormatter.reset();
            playerLeftFormatter.reset();
            playerJoinedFormatter.reset();
            notificationWorker.reset();
            telegramNotifier.reset();
            transactionManager.reset();
            database.reset();
            removeDatabaseFiles(databasePath);
        }
    };
}

TEST_F(NotificationServiceIntegrationTest, EnqueuesMembershipEventForPlayerDestination)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    constexpr long long chatId = -1001;
    constexpr long long threadId = 7;

    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(chatId, threadId, "Players");
    database->subscriptions().subscribeToChat(
        chatId,
        threadId,
        clanTag,
        Audience::Players);

    notificationService->handle(PlayerJoinedClanEvent{
        .clanTag = std::string(clanTag),
        .playerTag = "#P1",
        .playerName = "Alice",
        .membershipId = 42
    });

    const auto pending = database->notifications().getPending(10);

    ASSERT_EQ(1U, pending.size());
    EXPECT_EQ(chatId, pending.front().chatId);
    EXPECT_EQ(threadId, pending.front().messageThreadId);
    EXPECT_NE(std::string::npos,
              pending.front().messageText.find("Alice"));
    EXPECT_EQ("42", pending.front().eventId);
    EXPECT_TRUE(telegramApiClient.sentMessages.empty());
}

TEST_F(NotificationServiceIntegrationTest, DeduplicatesPersistentEventForEveryDestination)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(1001, 0, "Players 1");
    database->subscriptions().saveTelegramChat(1002, 4, "Players 2");
    database->subscriptions().subscribeToChat(1001, 0, clanTag, Audience::Players);
    database->subscriptions().subscribeToChat(1002, 4, clanTag, Audience::Players);

    const RaidReminderEvent event{
        .clanTag = std::string(clanTag),
        .raidReference = RaidReference{.raidId = 42},
        .endTime = 2000,
        .kind = RaidReminderEvent::RaidReminderKind::Started
    };

    notificationService->handle(event);
    notificationService->handle(event);

    const auto pending = database->notifications().getPending(10);

    ASSERT_EQ(2U, pending.size());
    EXPECT_TRUE(telegramApiClient.sentMessages.empty());
}

TEST_F(NotificationServiceIntegrationTest,
       MaterializesSavedDomainEventAndDoesNotDuplicateAfterRestart)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    constexpr long long chatId = -1001;
    constexpr long long threadId = 7;

    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(chatId, threadId, "Players");
    database->subscriptions().subscribeToChat(
        chatId,
        threadId,
        clanTag,
        Audience::Players);

    DomainEventPayloadSerializer serializer;
    DomainEventRecorder recorder(
        serializer,
        database->subscriptions(),
        database->domainEvents());

    const std::vector<ApplicationEvent> events{
        PlayerJoinedClanEvent{
            .clanTag = std::string(clanTag),
            .playerTag = "#P1",
            .playerName = "Alice",
            .membershipId = 42
        }
    };
    transactionManager->retryInTransaction([&]
    {
        recorder.recordAll(events);
    });

    DomainEventPayloadDeserializer deserializer;
    Database observerDatabase(databasePath.string());

    const auto runWorkerUntilMaterialized = [&]
    {
        DomainEventWorker worker(
            database->domainEvents(),
            deserializer,
            *notificationService,
            *notificationWorker,
            *transactionManager,
            std::chrono::milliseconds{10});

        std::thread workerThread([&worker]
        {
            worker.run();
        });

        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds{2};
        bool materialized = false;
        while (std::chrono::steady_clock::now() < deadline)
        {
            if (!observerDatabase.notifications().getPending(10).empty())
            {
                materialized = true;
                break;
            }

            std::this_thread::sleep_for(std::chrono::milliseconds{10});
        }

        worker.requestStop();
        workerThread.join();
        return materialized;
    };

    ASSERT_TRUE(runWorkerUntilMaterialized());
    ASSERT_TRUE(runWorkerUntilMaterialized());

    EXPECT_TRUE(observerDatabase.domainEvents().getPendingDestinations(10).empty());

    const auto pending = observerDatabase.notifications().getPending(10);
    ASSERT_EQ(1U, pending.size());
    EXPECT_EQ(chatId, pending.front().chatId);
    EXPECT_EQ(threadId, pending.front().messageThreadId);
    EXPECT_EQ("42", pending.front().eventId);
    EXPECT_NE(std::string::npos, pending.front().messageText.find("Alice"));
}

TEST_F(NotificationServiceIntegrationTest, EnqueuesSynchronizationFailureForManagementDestination)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    constexpr long long chatId = 2001;

    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(chatId, 0, "Private management chat");
    database->subscriptions().subscribeToChat(
        chatId,
        0,
        clanTag,
        Audience::Management);

    notificationService->handle(SyncFailureEvent{
        .clanTag = std::string(clanTag),
        .serviceName = "RaidService",
        .errorMsg = "API unavailable",
        .attempts = 3,
        .outageId = 7
    });

    const auto pending = database->notifications().getPending(10);

    ASSERT_EQ(1U, pending.size());
    EXPECT_EQ(chatId, pending.front().chatId);
    EXPECT_NE(std::string::npos,
              pending.front().messageText.find("RaidService"));
    EXPECT_EQ("7", pending.front().eventId);
    EXPECT_TRUE(telegramApiClient.sentMessages.empty());
}

TEST_F(NotificationServiceIntegrationTest, EnqueueFailureLeavesDestinationRetryableAndRestartMakesOneNotification)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(-1001, 7, "players");
    database->subscriptions().subscribeToChat(-1001, 7, clanTag, Audience::Players);
    DomainEventPayloadSerializer serializer;
    DomainEventRecorder recorder(serializer, database->subscriptions(), database->domainEvents());
    recorder.recordAll({PlayerJoinedClanEvent{std::string(clanTag), "#P1", "Alice", 42}});

    sqlite::execute(database->getDBInstance(),
        "CREATE TRIGGER reject_enqueue BEFORE INSERT ON notifications "
        "BEGIN SELECT RAISE(ABORT, 'simulated enqueue failure'); END;");
    DomainEventPayloadDeserializer deserializer;
    Database observer(databasePath.string());
    {
        DomainEventWorker worker(database->domainEvents(), deserializer, *notificationService,
                                 *notificationWorker, *transactionManager, std::chrono::hours(1));
        std::thread thread([&] { worker.run(); });
        const bool retried = waitUntil([&]
        {
            return destinationState(observer.getDBInstance(), "42").attempts == 1;
        });
        worker.requestStop();
        thread.join();
        ASSERT_TRUE(retried);
    }

    Database reopenedAfterFailure(databasePath.string());
    const auto failed = destinationState(reopenedAfterFailure.getDBInstance(), "42");
    EXPECT_EQ("pending", failed.status);
    EXPECT_EQ(1, failed.attempts);
    const auto now = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    EXPECT_GT(failed.nextAttemptAt, now);
    EXPECT_NE(std::string::npos, failed.lastError.find("simulated enqueue failure"));
    EXPECT_TRUE(reopenedAfterFailure.notifications().getPending(10).empty());

    sqlite::execute(database->getDBInstance(), "DROP TRIGGER reject_enqueue;");
    sqlite::execute(database->getDBInstance(),
        "UPDATE domain_event_destinations SET next_attempt_at = 0 WHERE status = 'pending';");
    {
        DomainEventWorker worker(database->domainEvents(), deserializer, *notificationService,
                                 *notificationWorker, *transactionManager, std::chrono::hours(1));
        std::thread thread([&] { worker.run(); });
        const bool materialized = waitUntil([&]
        {
            return destinationState(observer.getDBInstance(), "42").status == "materialized";
        });
        worker.requestStop();
        thread.join();
        ASSERT_TRUE(materialized);
    }

    const auto completed = destinationState(observer.getDBInstance(), "42");
    EXPECT_EQ(1, completed.attempts);
    EXPECT_EQ(0, completed.nextAttemptAt);
    EXPECT_TRUE(completed.lastError.empty());
    const auto pending = observer.notifications().getPending(10);
    ASSERT_EQ(1U, pending.size());
    EXPECT_EQ(-1001, pending.front().chatId);
    EXPECT_EQ(7, pending.front().messageThreadId);
    EXPECT_NE(std::string::npos, pending.front().messageText.find("Alice"));
    const auto linked = sqlite::prepare(observer.getDBInstance(),
        "SELECT d.id FROM notifications n JOIN domain_event_destinations d "
        "ON d.id = n.domain_event_destination_id WHERE n.event_id = '42';");
    EXPECT_EQ(SQLITE_ROW, sqlite3_step(linked.get()));
    EXPECT_EQ(SQLITE_DONE, sqlite3_step(linked.get()));
}

TEST_F(NotificationServiceIntegrationTest, MalformedEventDoesNotBlockNextDestination)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(-1001, 0, "players");
    database->subscriptions().subscribeToChat(-1001, 0, clanTag, Audience::Players);
    const auto subscriptionId = *database->subscriptions().getSubscriptionId(
        -1001, 0, clanTag, Audience::Players);
    database->domainEvents().appendEvent(
        {PlayerJoinedClanEvent::Type, "bad", "{}", 1, std::string(clanTag)},
        {{-1001, 0, Audience::Players, subscriptionId}});
    DomainEventPayloadSerializer serializer;
    DomainEventRecorder recorder(serializer, database->subscriptions(), database->domainEvents());
    recorder.recordAll({PlayerJoinedClanEvent{std::string(clanTag), "#P2", "Bob", 43}});

    DomainEventPayloadDeserializer deserializer;
    Database observer(databasePath.string());
    DomainEventWorker worker(database->domainEvents(), deserializer, *notificationService,
                             *notificationWorker, *transactionManager, std::chrono::hours(1));
    std::thread thread([&] { worker.run(); });
    const bool processed = waitUntil([&]
    {
        return destinationState(observer.getDBInstance(), "bad").attempts == 1 &&
            destinationState(observer.getDBInstance(), "43").status == "materialized";
    });
    worker.requestStop();
    thread.join();
    ASSERT_TRUE(processed);

    EXPECT_EQ("pending", destinationState(observer.getDBInstance(), "bad").status);
    EXPECT_FALSE(destinationState(observer.getDBInstance(), "bad").lastError.empty());
    const auto notifications = observer.notifications().getPending(10);
    ASSERT_EQ(1U, notifications.size());
    EXPECT_EQ("43", notifications.front().eventId);
}

TEST_F(NotificationServiceIntegrationTest, FailureAfterEnqueueRollsBackNotificationAndDestinationStatus)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(-1001, 0, "players");
    database->subscriptions().subscribeToChat(-1001, 0, clanTag, Audience::Players);
    DomainEventPayloadSerializer serializer;
    DomainEventRecorder recorder(serializer, database->subscriptions(), database->domainEvents());
    recorder.recordAll({PlayerJoinedClanEvent{std::string(clanTag), "#P1", "Alice", 45}});
    sqlite::execute(database->getDBInstance(),
        "CREATE TRIGGER reject_materialized BEFORE UPDATE OF status ON domain_event_destinations "
        "WHEN NEW.status = 'materialized' "
        "BEGIN SELECT RAISE(ABORT, 'simulated status failure'); END;");

    DomainEventPayloadDeserializer deserializer;
    Database observer(databasePath.string());
    DomainEventWorker worker(database->domainEvents(), deserializer, *notificationService,
                             *notificationWorker, *transactionManager, std::chrono::hours(1));
    std::thread thread([&] { worker.run(); });
    const bool retried = waitUntil([&]
    {
        return destinationState(observer.getDBInstance(), "45").attempts == 1;
    });
    worker.requestStop();
    thread.join();
    ASSERT_TRUE(retried);
    EXPECT_EQ("pending", destinationState(observer.getDBInstance(), "45").status);
    EXPECT_TRUE(observer.notifications().getPending(10).empty());
}

TEST_F(NotificationServiceIntegrationTest, CommittedEventEventuallyReachesFakeTelegram)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(-1001, 7, "players");
    database->subscriptions().subscribeToChat(-1001, 7, clanTag, Audience::Players);
    DomainEventPayloadSerializer serializer;
    DomainEventRecorder recorder(serializer, database->subscriptions(), database->domainEvents());
    transactionManager->retryInTransaction([&]
    {
        recorder.recordAll({PlayerJoinedClanEvent{std::string(clanTag), "#P1", "Alice", 44}});
    });

    DomainEventPayloadDeserializer deserializer;
    Database observer(databasePath.string());
    {
        DomainEventWorker worker(database->domainEvents(), deserializer, *notificationService,
                                 *notificationWorker, *transactionManager, std::chrono::hours(1));
        std::thread thread([&] { worker.run(); });
        const bool queued = waitUntil([&]
        {
            return destinationState(observer.getDBInstance(), "44").status == "materialized";
        });
        worker.requestStop();
        thread.join();
        ASSERT_TRUE(queued);
    }

    std::thread sender([&] { notificationWorker->run(); });
    const bool sent = telegramApiClient.waitForSentMessages(1);
    notificationWorker->requestStop();
    sender.join();
    ASSERT_TRUE(sent);
    EXPECT_EQ(-1001, telegramApiClient.sentMessages.front().chatId);
    EXPECT_EQ(7, telegramApiClient.sentMessages.front().messageThreadId);
    EXPECT_NE(std::string::npos, telegramApiClient.sentMessages.front().text.find("Alice"));
    EXPECT_TRUE(observer.notifications().getPending(10).empty());
    const auto statement = sqlite::prepare(observer.getDBInstance(),
        "SELECT status FROM notifications WHERE event_id = '44';");
    ASSERT_EQ(SQLITE_ROW, sqlite3_step(statement.get()));
    EXPECT_EQ("sent", sqlite::getString(statement.get(), 0));
}
