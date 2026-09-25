#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/TransactionManager.h"
#include "domain_events/DomainEventPayloadDeserializer.h"
#include "domain_events/DomainEventPayloadSerializer.h"
#include "domain_events/DomainEventRecorder.h"
#include "domain_events/DomainEventWorker.h"
#include "notifications/NotificationService.h"
#include "notifications/NotificationWorker.h"

#include "support/FakeTelegramApiClient.h"

#include <chrono>
#include <filesystem>
#include <memory>
#include <string_view>
#include <thread>
#include <vector>

#include <gtest/gtest.h>

namespace
{
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
