#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/TransactionManager.h"
#include "database/SQLiteHelpers.h"
#include "api/TelegramApiClient.h"
#include "api/TelegramHttpTransport.h"
#include "notifications/NotificationWorker.h"
#include "support/FakeTelegramApiClient.h"
#include "support/LocalHttpTestServer.h"

#include <atomic>
#include "support/FakeTelegramApiClient.h"

#include <chrono>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <thread>

#include <gtest/gtest.h>

namespace
{
    struct NotificationState
    {
        std::string status;
        int attempts;
        bool hasNextAttempt;
        std::string lastError;
    };

    NotificationState stateOf(sqlite3* connection, const long long id)
    {
        const auto statement = sqlite::prepare(connection,
            "SELECT status, attempts, next_attempt_at, last_error FROM notifications WHERE id = ?;");
        sqlite::bind(statement.get(), 1, id);
        if (sqlite3_step(statement.get()) != SQLITE_ROW)
            throw std::runtime_error("notification not found");
        return {sqlite::getString(statement.get(), 0), sqlite::getInt(statement.get(), 1),
                sqlite3_column_type(statement.get(), 2) != SQLITE_NULL,
                sqlite3_column_type(statement.get(), 3) == SQLITE_NULL
                    ? "" : sqlite::getString(statement.get(), 3)};
    }

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
            TransactionManager migrationTransactions(database->getDBInstance());
            const MigratorManager migratorManager(*database, migrationTransactions);

            ASSERT_NO_THROW(migratorManager.migrate(CLASHBOT_MIGRATIONS_PATH));
        }

        void TearDown() override
        {
            database.reset();
            removeDatabaseFiles(databasePath);
        }
    };
}

TEST_F(NotificationIntegrationTest, EnqueuesTheSameEventOnlyOnceForDestination)
{
    constexpr std::string_view eventType = "RaidsEndedEvent";
    constexpr std::string_view eventId = "raid-42";
    constexpr long long chatId = -1001234567890LL;
    constexpr long long messageThreadId = 456;

    EXPECT_TRUE(database->notifications().enqueueIfAbsent(
        "raid report",
        eventType,
        eventId,
        chatId,
        messageThreadId));

    EXPECT_FALSE(database->notifications().enqueueIfAbsent(
        "raid report",
        eventType,
        eventId,
        chatId,
        messageThreadId));

    const auto pending = database->notifications().getPending(10);
    ASSERT_EQ(1U, pending.size());
    EXPECT_EQ(eventType, pending.front().eventType);
    EXPECT_EQ(eventId, pending.front().eventId);
    EXPECT_EQ(chatId, pending.front().chatId);
    EXPECT_EQ(messageThreadId, pending.front().messageThreadId);
    EXPECT_EQ("raid report", pending.front().messageText);

    database->notifications().markAsSent(pending.front().id);

    EXPECT_TRUE(database->notifications().getPending(10).empty());

    EXPECT_NO_THROW(database->notifications().markAsSent(pending.front().id));

    EXPECT_TRUE(database->notifications().enqueueIfAbsent(
        "raid report",
        eventType,
        eventId,
        chatId + 1,
        messageThreadId));
}

TEST_F(NotificationIntegrationTest, DomainDestinationAndReportTypeAreIndependentDeduplicationKeys)
{
    const DomainEventRecord event{"war_ended", "42", "{}", 1, "#CLAN"};
    database->domainEvents().appendEvent(event, {
        {-1001, 0, Audience::Players, 1},
        {-1001, 7, Audience::Management, 2}
    });
    const auto destinations = database->domainEvents().getPendingDestinations(10);
    ASSERT_EQ(2U, destinations.size());
    const auto& notifications = database->notifications();
    const auto enqueue = [&](const long long destinationId, const std::string_view type,
                             const long long chatId, const long long topic)
    {
        return notifications.enqueueDomainEventIfAbsent(
            "report", destinationId, type, "42", chatId, topic, 1, 1);
    };

    EXPECT_TRUE(enqueue(destinations[0].destinationId, "roster", -1001, 0));
    EXPECT_FALSE(enqueue(destinations[0].destinationId, "roster", -1001, 0));
    EXPECT_TRUE(enqueue(destinations[0].destinationId, "comparison", -1001, 0));
    EXPECT_TRUE(enqueue(destinations[1].destinationId, "roster", -1001, 7));
    EXPECT_EQ(3U, notifications.getPending(10).size());
}

TEST_F(NotificationIntegrationTest, TransientFailurePersistsRetryAndNextRunDelivers)
{
    auto& notifications = database->notifications();
    ASSERT_TRUE(notifications.enqueueIfAbsent("report", "test", "retry", -1001, 7));
    const auto id = notifications.getPending(10).front().id;
    FakeTelegramApiClient api;
    TelegramNotifier notifier(api);
    api.failNextSend = true;

    {
        NotificationWorker worker(notifications, notifier, std::chrono::hours(1));
        std::thread thread([&] { worker.run(); });
        const bool attempted = api.waitForAttemptedMessages(1);
        worker.requestStop();
        thread.join();
        ASSERT_TRUE(attempted);
    }

    const auto failedAttempt = stateOf(database->getDBInstance(), id);
    EXPECT_EQ("pending", failedAttempt.status);
    EXPECT_EQ(1, failedAttempt.attempts);
    EXPECT_TRUE(failedAttempt.hasNextAttempt);
    EXPECT_FALSE(failedAttempt.lastError.empty());

    sqlite::execute(database->getDBInstance(),
        "UPDATE notifications SET next_attempt_at = 0 WHERE event_id = 'retry';");
    {
        NotificationWorker worker(notifications, notifier, std::chrono::hours(1));
        std::thread thread([&] { worker.run(); });
        const bool sent = api.waitForSentMessages(1);
        worker.requestStop();
        thread.join();
        ASSERT_TRUE(sent);
    }
    const auto delivered = stateOf(database->getDBInstance(), id);
    EXPECT_EQ("sent", delivered.status);
    EXPECT_EQ(1, delivered.attempts);
    EXPECT_FALSE(delivered.hasNextAttempt);
    EXPECT_TRUE(delivered.lastError.empty());
}

TEST_F(NotificationIntegrationTest, PermanentFailureAndExhaustedRetryBecomeFailed)
{
    auto& notifications = database->notifications();
    ASSERT_TRUE(notifications.enqueueIfAbsent("missing chat", "test", "permanent", -1001, 0));
    const auto permanentId = notifications.getPending(10).front().id;
    FakeTelegramApiClient api;
    TelegramNotifier notifier(api);
    api.nextSendError = ApiError::NotFound;

    {
        NotificationWorker worker(notifications, notifier, std::chrono::hours(1));
        std::thread thread([&] { worker.run(); });
        const bool attempted = api.waitForAttemptedMessages(1);
        worker.requestStop();
        thread.join();
        ASSERT_TRUE(attempted);
    }
    EXPECT_EQ("failed", stateOf(database->getDBInstance(), permanentId).status);

    ASSERT_TRUE(notifications.enqueueIfAbsent("timeout", "test", "exhausted", -1002, 0));
    const auto exhaustedId = notifications.getPending(10).front().id;
    api.failNextSend = true;
    {
        NotificationWorker worker(notifications, notifier, std::chrono::hours(1), RetryPolicy{1});
        std::thread thread([&] { worker.run(); });
        const bool attempted = api.waitForAttemptedMessages(2);
        worker.requestStop();
        thread.join();
        ASSERT_TRUE(attempted);
    }
    EXPECT_EQ("failed", stateOf(database->getDBInstance(), exhaustedId).status);
    EXPECT_EQ(1, stateOf(database->getDBInstance(), exhaustedId).attempts);
}

TEST_F(NotificationIntegrationTest, CancelledNotificationIsNeverSent)
{
    auto& notifications = database->notifications();
    ASSERT_TRUE(notifications.enqueueIfAbsent("cancel me", "test", "cancelled", -1001, 0));
    sqlite::execute(database->getDBInstance(),
        "UPDATE notifications SET status = 'cancelled' WHERE event_id = 'cancelled';");
    FakeTelegramApiClient api;
    TelegramNotifier notifier(api);
    NotificationWorker worker(notifications, notifier, std::chrono::milliseconds(10));
    std::thread thread([&] { worker.run(); });
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    worker.requestStop();
    thread.join();
    EXPECT_TRUE(api.attemptedMessages.empty());
}

TEST_F(NotificationIntegrationTest, SendSuccessBeforeMarkAsSentMayBeRetriedAfterRestart)
{
    auto& notifications = database->notifications();
    ASSERT_TRUE(notifications.enqueueIfAbsent("report", "test", "crash-gap", -1001, 7));
    const auto id = notifications.getPending(10).front().id;
    sqlite::execute(database->getDBInstance(),
        "CREATE TRIGGER reject_sent BEFORE UPDATE OF status ON notifications "
        "WHEN NEW.status = 'sent' BEGIN SELECT RAISE(ABORT, 'simulated crash gap'); END;");
    FakeTelegramApiClient api;
    TelegramNotifier notifier(api);
    {
        NotificationWorker worker(notifications, notifier, std::chrono::hours(1));
        std::thread thread([&] { worker.run(); });
        const bool sent = api.waitForSentMessages(1);
        worker.requestStop();
        thread.join();
        ASSERT_TRUE(sent);
    }
    EXPECT_EQ("pending", stateOf(database->getDBInstance(), id).status);

    sqlite::execute(database->getDBInstance(), "DROP TRIGGER reject_sent;");
    {
        NotificationWorker worker(notifications, notifier, std::chrono::hours(1));
        std::thread thread([&] { worker.run(); });
        const bool sentTwice = api.waitForSentMessages(2);
        worker.requestStop();
        thread.join();
        ASSERT_TRUE(sentTwice);
    }
    EXPECT_EQ("sent", stateOf(database->getDBInstance(), id).status);
    EXPECT_EQ(2U, api.sentMessages.size());
    EXPECT_TRUE(notifications.getPending(10).empty());
}

TEST_F(NotificationIntegrationTest, StopsMidBatchAndDeliversRemainingPendingNotificationsAfterRestart)
{
    auto& notifications = database->notifications();
    std::vector<long long> ids;
    for (int i = 1; i <= 5; ++i)
    {
        const auto eventId = "batch-" + std::to_string(i);
        ASSERT_TRUE(notifications.enqueueIfAbsent("msg-" + std::to_string(i), "test", eventId, -1001, 0));
    }

    const auto initialPending = notifications.getPending(10);
    ASSERT_EQ(5U, initialPending.size());
    for (const auto& item : initialPending)
    {
        ids.push_back(item.id);
    }

    std::atomic<int> requestCount{0};
    LocalHttpTestServer firstServer([&](const std::string&, const std::function<bool()>& shouldStop)
    {
        const int current = requestCount.fetch_add(1) + 1;
        if (current == 1)
        {
            return std::optional<LocalHttpTestServer::ResponseSpec>{
                LocalHttpTestServer::ResponseSpec{
                    .statusCode = 200,
                    .body = R"({"ok":true,"result":{"message_id":1}})"
                }
            };
        }

        while (!shouldStop())
        {
            std::this_thread::sleep_for(std::chrono::milliseconds{20});
        }
        return std::optional<LocalHttpTestServer::ResponseSpec>{};
    });

    {
        TelegramHttpTransport transport(
            "test-token",
            TelegramHttpTransportPolicy{
                .requestTimeout = std::chrono::seconds{10},
                .retry = RetryPolicy{1},
                .baseUrl = firstServer.baseUrl()
            });
        TelegramApiClient apiClient(transport);
        TelegramNotifier notifier(apiClient);
        NotificationWorker worker(notifications, notifier, std::chrono::hours{1});

        std::thread thread([&] { worker.run(); });
        ASSERT_TRUE(firstServer.waitForAcceptedConnections(2));
        std::this_thread::sleep_for(std::chrono::milliseconds{80});

        const auto stopStart = std::chrono::steady_clock::now();
        transport.requestStop();
        worker.requestStop();
        thread.join();
        EXPECT_LT(std::chrono::steady_clock::now() - stopStart, std::chrono::seconds{5});
    }

    EXPECT_EQ(2U, firstServer.acceptedConnections());
    EXPECT_EQ("sent", stateOf(database->getDBInstance(), ids[0]).status);

    EXPECT_EQ(4U, notifications.getPending(10).size());
    for (std::size_t i = 1; i < ids.size(); ++i)
    {
        const auto state = stateOf(database->getDBInstance(), ids[i]);
        EXPECT_EQ("pending", state.status);
        EXPECT_EQ(0, state.attempts);
        EXPECT_TRUE(state.lastError.empty());
    }

    std::atomic<int> restartedDeliveries{0};
    LocalHttpTestServer secondServer([&](const std::string&, const std::function<bool()>&)
    {
        restartedDeliveries.fetch_add(1);
        return LocalHttpTestServer::ResponseSpec{
            .statusCode = 200,
            .body = R"({"ok":true,"result":{"message_id":2}})"
        };
    });

    {
        TelegramHttpTransport transport(
            "test-token",
            TelegramHttpTransportPolicy{
                .requestTimeout = std::chrono::seconds{5},
                .retry = RetryPolicy{1},
                .baseUrl = secondServer.baseUrl()
            });
        TelegramApiClient apiClient(transport);
        TelegramNotifier notifier(apiClient);
        NotificationWorker worker(notifications, notifier, std::chrono::hours{1});

        std::thread thread([&] { worker.run(); });
        ASSERT_TRUE(secondServer.waitForAcceptedConnections(4));

        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds{2};
        while (std::chrono::steady_clock::now() < deadline && !notifications.getPending(10).empty())
        {
            std::this_thread::sleep_for(std::chrono::milliseconds{10});
        }

        transport.requestStop();
        worker.requestStop();
        thread.join();
    }

    EXPECT_EQ(4, restartedDeliveries.load());
    EXPECT_TRUE(notifications.getPending(10).empty());
    for (const auto id : ids)
    {
        EXPECT_EQ("sent", stateOf(database->getDBInstance(), id).status);
    }
}

TEST_F(NotificationIntegrationTest, CancellationDuringRetryAfterDoesNotBurnAttemptsOrMarkFailed)
{
    auto& notifications = database->notifications();
    ASSERT_TRUE(notifications.enqueueIfAbsent("retry-after-stop", "test", "retry-stop", -1001, 0));
    const auto id = notifications.getPending(10).front().id;

    LocalHttpTestServer rateLimitedServer([](const std::string&, const std::function<bool()>&)
    {
        return LocalHttpTestServer::ResponseSpec{
            .statusCode = 429,
            .body = R"({"ok":false,"parameters":{"retry_after":60}})"
        };
    });

    {
        TelegramHttpTransport transport(
            "test-token",
            TelegramHttpTransportPolicy{
                .requestTimeout = std::chrono::seconds{5},
                .retry = RetryPolicy{3, std::chrono::milliseconds{100}},
                .baseUrl = rateLimitedServer.baseUrl()
            });
        TelegramApiClient apiClient(transport);
        TelegramNotifier notifier(apiClient);
        NotificationWorker worker(notifications, notifier, std::chrono::hours{1}, RetryPolicy{1});

        std::thread thread([&] { worker.run(); });
        ASSERT_TRUE(rateLimitedServer.waitForAcceptedConnections(1));
        std::this_thread::sleep_for(std::chrono::milliseconds{80});

        const auto stopStart = std::chrono::steady_clock::now();
        transport.requestStop();
        worker.requestStop();
        thread.join();
        EXPECT_LT(std::chrono::steady_clock::now() - stopStart, std::chrono::seconds{2});
    }

    const auto afterStop = stateOf(database->getDBInstance(), id);
    EXPECT_EQ("pending", afterStop.status);
    EXPECT_EQ(0, afterStop.attempts);
    EXPECT_EQ(1U, notifications.getPending(10).size());
    EXPECT_TRUE(afterStop.lastError.empty());

    LocalHttpTestServer okServer([](const std::string&, const std::function<bool()>&)
    {
        return LocalHttpTestServer::ResponseSpec{
            .statusCode = 200,
            .body = R"({"ok":true,"result":{"message_id":99}})"
        };
    });

    {
        TelegramHttpTransport transport(
            "test-token",
            TelegramHttpTransportPolicy{
                .requestTimeout = std::chrono::seconds{5},
                .retry = RetryPolicy{1},
                .baseUrl = okServer.baseUrl()
            });
        TelegramApiClient apiClient(transport);
        TelegramNotifier notifier(apiClient);
        NotificationWorker worker(notifications, notifier, std::chrono::hours{1}, RetryPolicy{1});

        std::thread thread([&] { worker.run(); });
        ASSERT_TRUE(okServer.waitForAcceptedConnections(1));

        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds{2};
        while (std::chrono::steady_clock::now() < deadline && !notifications.getPending(10).empty())
        {
            std::this_thread::sleep_for(std::chrono::milliseconds{10});
        }

        transport.requestStop();
        worker.requestStop();
        thread.join();
    }

    EXPECT_EQ("sent", stateOf(database->getDBInstance(), id).status);
}
