#include "api/APIClient.h"
#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/SQLiteHelpers.h"
#include "database/TransactionManager.h"
#include "domain_events/DomainEventPayloadSerializer.h"
#include "domain_events/DomainEventRecorder.h"
#include "service/ClanManager.h"
#include "service/ClanwarService.h"
#include "service/ISyncService.h"
#include "support/LocalHttpTestServer.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

#include <gtest/gtest.h>

namespace
{
    class CallbackSyncService final : public ISyncService
    {
    public:
        using Callback = std::function<SyncResult(std::string_view)>;

        CallbackSyncService(std::string name, Callback callback)
            : name_(std::move(name)),
              callback_(std::move(callback))
        {
        }

        SyncResult updateData(const std::string_view tag) override
        {
            return callback_(tag);
        }

        [[nodiscard]] std::string getServiceName() const override
        {
            return name_;
        }

    private:
        std::string name_;
        Callback callback_;
    };

    class ClanManagerIntegrationTest : public ::testing::Test
    {
    protected:
        std::filesystem::path databasePath;
        std::unique_ptr<Database> database;
        std::unique_ptr<TransactionManager> transactionManager;
        DomainEventPayloadSerializer serializer;
        std::unique_ptr<DomainEventRecorder> recorder;

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
                ("clashbot-clan-manager-integration-" +
                 std::to_string(uniquePart) + ".sqlite");

            removeDatabaseFiles(databasePath);

            database = std::make_unique<Database>(databasePath.string());
            transactionManager = std::make_unique<TransactionManager>(
                database->getDBInstance());
            const MigratorManager migratorManager(*database, *transactionManager);
            ASSERT_NO_THROW(migratorManager.migrate(CLASHBOT_MIGRATIONS_PATH));

            recorder = std::make_unique<DomainEventRecorder>(
                serializer,
                database->subscriptions(),
                database->domainEvents());
        }

        void TearDown() override
        {
            recorder.reset();
            transactionManager.reset();
            database.reset();
            removeDatabaseFiles(databasePath);
        }

        void seedTrackedClanWithManagementChat(const std::string_view clanTag,
                                               const long long chatId = 2001) const
        {
            database->clans().insertMinimalClan(clanTag);
            database->subscriptions().saveTelegramChat(chatId, 0, "management");
            database->subscriptions().subscribeToChat(
                chatId,
                0,
                clanTag,
                Audience::Management);
        }

        [[nodiscard]] int countRows(const std::string_view table) const
        {
            const auto stmt = sqlite::prepare(
                database->getDBInstance(),
                "SELECT COUNT(*) FROM " + std::string(table) + ";");
            if (sqlite3_step(stmt.get()) != SQLITE_ROW)
            {
                throw std::runtime_error("Failed to count rows");
            }
            return sqlite::getInt(stmt.get(), 0);
        }
    };
}

TEST_F(ClanManagerIntegrationTest, StopsBetweenClansAndServicesWhenStopRequested)
{
    seedTrackedClanWithManagementChat("#CLAN1", 2001);
    seedTrackedClanWithManagementChat("#CLAN2", 2002);

    std::mutex mutex;
    std::vector<std::pair<std::string, std::string>> calls;
    std::unique_ptr<ClanManager> manager;

    std::vector<std::unique_ptr<ISyncService>> services;
    services.push_back(std::make_unique<CallbackSyncService>(
        "FirstService",
        [&](const std::string_view tag)
        {
            {
                std::lock_guard lock(mutex);
                calls.emplace_back("FirstService", std::string(tag));
            }
            manager->stop();
            return SyncResult::success("FirstService", std::string(tag));
        }));
    services.push_back(std::make_unique<CallbackSyncService>(
        "SecondService",
        [&](const std::string_view tag)
        {
            {
                std::lock_guard lock(mutex);
                calls.emplace_back("SecondService", std::string(tag));
            }
            return SyncResult::success("SecondService", std::string(tag));
        }));

    manager = std::make_unique<ClanManager>(
        std::move(services),
        database->clans(),
        database->syncOutages(),
        *transactionManager,
        *recorder,
        RetryPolicy{1});

    std::thread syncThread([&] { manager->syncAll(); });
    syncThread.join();

    ASSERT_EQ(1U, calls.size());
    EXPECT_EQ("FirstService", calls.front().first);
    EXPECT_EQ(0, countRows("sync_outages"));
    EXPECT_EQ(0, countRows("domain_events"));
}

TEST_F(ClanManagerIntegrationTest, InterruptsRetryWaitWithoutRecordingFalseSyncOutage)
{
    seedTrackedClanWithManagementChat("#CLAN1");

    std::mutex mutex;
    std::condition_variable cv;
    int attempts = 0;

    std::vector<std::unique_ptr<ISyncService>> services;
    services.push_back(std::make_unique<CallbackSyncService>(
        "FailingService",
        [&](const std::string_view tag)
        {
            {
                std::lock_guard lock(mutex);
                ++attempts;
            }
            cv.notify_all();
            return SyncResult::error("FailingService", std::string(tag), "transient failure");
        }));

    ClanManager manager(
        std::move(services),
        database->clans(),
        database->syncOutages(),
        *transactionManager,
        *recorder,
        RetryPolicy{3, std::chrono::seconds{5}});

    std::thread syncThread([&] { manager.syncAll(); });

    {
        std::unique_lock lock(mutex);
        ASSERT_TRUE(cv.wait_for(
            lock,
            std::chrono::seconds{2},
            [&] { return attempts >= 1; }));
    }

    std::this_thread::sleep_for(std::chrono::milliseconds{80});

    const auto stopStart = std::chrono::steady_clock::now();
    manager.stop();
    syncThread.join();
    const auto stopElapsed = std::chrono::steady_clock::now() - stopStart;

    EXPECT_LT(stopElapsed, std::chrono::seconds{2});
    EXPECT_EQ(1, attempts);
    EXPECT_FALSE(database->syncOutages().getOpenOutageId("#CLAN1", "FailingService").has_value());
    EXPECT_EQ(0, countRows("sync_outages"));
    EXPECT_EQ(0, countRows("domain_events"));
}

TEST_F(ClanManagerIntegrationTest, AbortsActiveApiClientCallWithoutRecordingFalseSyncOutage)
{
    seedTrackedClanWithManagementChat("#CLAN1");

    LocalHttpTestServer server([](const std::string&, const std::function<bool()>& shouldStop)
    {
        while (!shouldStop())
        {
            std::this_thread::sleep_for(std::chrono::milliseconds{20});
        }
        return std::optional<LocalHttpTestServer::ResponseSpec>{};
    });

    APIClient apiClient("test-token", false, server.baseUrl(), "");
    std::vector<std::unique_ptr<ISyncService>> services;
    services.push_back(std::make_unique<ClanwarService>(
        database->war(),
        apiClient,
        *transactionManager,
        *recorder));

    ClanManager manager(
        std::move(services),
        database->clans(),
        database->syncOutages(),
        *transactionManager,
        *recorder,
        RetryPolicy{3, std::chrono::seconds{5}});

    std::thread syncThread([&] { manager.syncAll(); });

    ASSERT_TRUE(server.waitForAcceptedConnections(1));
    std::this_thread::sleep_for(std::chrono::milliseconds{100});

    const auto stopStart = std::chrono::steady_clock::now();
    apiClient.requestStop();
    manager.stop();
    syncThread.join();
    const auto stopElapsed = std::chrono::steady_clock::now() - stopStart;

    EXPECT_LT(stopElapsed, std::chrono::seconds{5});
    EXPECT_EQ(1U, server.acceptedConnections());
    EXPECT_EQ(0, countRows("sync_outages"));
    EXPECT_EQ(0, countRows("domain_events"));
}

TEST_F(ClanManagerIntegrationTest, RecordsSyncOutageWhenRetriesExhaustWithoutStop)
{
    seedTrackedClanWithManagementChat("#CLAN1");

    std::atomic<int> attempts{0};
    std::vector<std::unique_ptr<ISyncService>> services;
    services.push_back(std::make_unique<CallbackSyncService>(
        "FailingService",
        [&](const std::string_view tag)
        {
            attempts.fetch_add(1);
            return SyncResult::error("FailingService", std::string(tag), "api down");
        }));

    ClanManager manager(
        std::move(services),
        database->clans(),
        database->syncOutages(),
        *transactionManager,
        *recorder,
        RetryPolicy{2, std::chrono::milliseconds{10}});

    std::thread syncThread([&] { manager.syncAll(); });

    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds{2};
    while (std::chrono::steady_clock::now() < deadline && countRows("domain_events") == 0)
    {
        std::this_thread::sleep_for(std::chrono::milliseconds{10});
    }

    manager.stop();
    syncThread.join();

    EXPECT_GE(attempts.load(), 2);
    EXPECT_TRUE(database->syncOutages().getOpenOutageId("#CLAN1", "FailingService").has_value());
    EXPECT_EQ(1, countRows("sync_outages"));
    EXPECT_EQ(1, countRows("domain_events"));
}
