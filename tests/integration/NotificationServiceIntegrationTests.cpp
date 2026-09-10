#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/TransactionManager.h"
#include "notifications/NotificationService.h"

#include "FakeTelegramApiClient.h"

#include <chrono>
#include <filesystem>
#include <memory>
#include <string_view>

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
                *telegramNotifier,
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
            telegramNotifier.reset();
            transactionManager.reset();
            database.reset();
            removeDatabaseFiles(databasePath);
        }
    };
}

TEST_F(NotificationServiceIntegrationTest, SendsMembershipEventToPlayerDestination)
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
        .playerName = "Alice"
    });

    ASSERT_EQ(1U, telegramApiClient.sentMessages.size());
    EXPECT_EQ(chatId, telegramApiClient.sentMessages.front().chatId);
    EXPECT_EQ(threadId, telegramApiClient.sentMessages.front().messageThreadId);
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages.front().text.find("Alice"));
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

    ASSERT_EQ(2U, telegramApiClient.sentMessages.size());
    EXPECT_TRUE(database->notifications().wasSent(
        RaidReminderEvent::Type,
        event.key(),
        1001,
        0));
    EXPECT_TRUE(database->notifications().wasSent(
        RaidReminderEvent::Type,
        event.key(),
        1002,
        4));
}

TEST_F(NotificationServiceIntegrationTest, FailedPersistentNotificationCanBeRetried)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    constexpr long long chatId = 1001;
    constexpr long long threadId = 3;

    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(chatId, threadId, "Players");
    database->subscriptions().subscribeToChat(
        chatId,
        threadId,
        clanTag,
        Audience::Players);

    const RaidReminderEvent event{
        .clanTag = std::string(clanTag),
        .raidReference = RaidReference{.raidId = 43},
        .endTime = 2000,
        .kind = RaidReminderEvent::RaidReminderKind::Started
    };

    telegramApiClient.failNextSend = true;
    notificationService->handle(event);

    EXPECT_FALSE(database->notifications().wasSent(
        RaidReminderEvent::Type,
        event.key(),
        chatId,
        threadId));
    EXPECT_EQ(1U, telegramApiClient.attemptedMessages.size());
    EXPECT_TRUE(telegramApiClient.sentMessages.empty());

    notificationService->handle(event);

    EXPECT_TRUE(database->notifications().wasSent(
        RaidReminderEvent::Type,
        event.key(),
        chatId,
        threadId));
    EXPECT_EQ(2U, telegramApiClient.attemptedMessages.size());
    EXPECT_EQ(1U, telegramApiClient.sentMessages.size());
}

TEST_F(NotificationServiceIntegrationTest, RoutesSynchronizationFailureToManagementDestination)
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
        .attempts = 3
    });

    ASSERT_EQ(1U, telegramApiClient.sentMessages.size());
    EXPECT_EQ(chatId, telegramApiClient.sentMessages.front().chatId);
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages.front().text.find("RaidService"));
}
