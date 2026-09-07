#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/SQLiteHelpers.h"
#include "database/TransactionManager.h"
#include "service/RaidService.h"

#include "FakeAPIClient.h"

#include <chrono>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>

#include <gtest/gtest.h>

namespace
{
    int tableRowCount(sqlite3* database, const std::string_view tableName)
    {
        const std::string sql = "SELECT COUNT(*) FROM " + std::string(tableName) + ";";
        const auto statement = sqlite::prepare(database, sql);

        if (sqlite3_step(statement.get()) != SQLITE_ROW)
        {
            throw std::runtime_error(sqlite3_errmsg(database));
        }

        return sqlite::getInt(statement.get(), 0);
    }

    class RaidSyncIntegrationTest : public ::testing::Test
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
                ("clashbot-raid-integration-" +
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

TEST_F(RaidSyncIntegrationTest, SavesRaidAndPlayerSnapshots)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    FakeAPIClient apiClient;
    apiClient.raidData = CompleteRaidData{
        .clanRaid = ClanRaid{
            .clanTag = std::string(clanTag),
            .startTime = 1000,
            .endTime = 2000,
            .state = "ended",
            .totalLoot = 1500,
            .raidsCompleted = 6,
            .totalAttacks = 8,
            .enemyDistrictsDestroyed = 3,
            .offensiveReward = 120,
            .defensiveReward = 60
        },
        .playerRaidSnapshots = {
            PlayerRaidSnapshot{
                .playerTag = "#P1",
                .attacksCount = 5,
                .bonusAttack = 1,
                .totalLoot = 1000
            },
            PlayerRaidSnapshot{
                .playerTag = "#P2",
                .attacksCount = 3,
                .bonusAttack = 0,
                .totalLoot = 500
            }
        }
    };

    TransactionManager transactionManager(database->getDBInstance());
    RaidService service(
        database->clans(),
        database->raids(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_TRUE(result.successFlag);
    EXPECT_EQ("RaidService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    ASSERT_EQ(1U, result.events.size());

    const auto* endedEvent = std::get_if<RaidsEndedEvent>(&result.events.front());
    ASSERT_NE(nullptr, endedEvent);

    const RaidStats stats = database->raids().getRaidStats(endedEvent->raidReference);
    EXPECT_EQ(1500, stats.totalLoot);
    EXPECT_EQ(6, stats.raidsCompleted);
    EXPECT_EQ(8, stats.totalAttacks);
    EXPECT_EQ(3, stats.enemyDistrictsDestroyed);
    EXPECT_EQ(120, stats.offensiveReward);
    EXPECT_EQ(60, stats.defensiveReward);

    const auto bestMembers = database->raids().getBestRaidMembers(
        endedEvent->raidReference);

    ASSERT_EQ(2U, bestMembers.size());
    EXPECT_EQ("#P1", bestMembers[0].playerTag);
    EXPECT_EQ(1000, bestMembers[0].totalLoot);
    EXPECT_EQ(5, bestMembers[0].attacksCount);
    EXPECT_EQ(1, bestMembers[0].bonusAttacks);
    EXPECT_EQ("#P2", bestMembers[1].playerTag);
    EXPECT_EQ(500, bestMembers[1].totalLoot);
}

TEST_F(RaidSyncIntegrationTest, ReturnsErrorWhenRaidDataIsUnavailable)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    FakeAPIClient apiClient;
    apiClient.raidData = std::nullopt;

    TransactionManager transactionManager(database->getDBInstance());
    RaidService service(
        database->clans(),
        database->raids(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_FALSE(result.successFlag);
    EXPECT_EQ("RaidService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    EXPECT_TRUE(result.events.empty());
    EXPECT_FALSE(result.errorMsg.empty());
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "clan_raids"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "player_raid_snapshots"));
}

TEST_F(RaidSyncIntegrationTest, GeneratesStartedReminderForActiveRaid)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    const auto now = std::chrono::system_clock::to_time_t(
        std::chrono::system_clock::now());
    const auto endTime = now + 72 * 60 * 60;

    FakeAPIClient apiClient;
    apiClient.raidData = CompleteRaidData{
        .clanRaid = ClanRaid{
            .clanTag = std::string(clanTag),
            .startTime = now - 60 * 60,
            .endTime = endTime,
            .state = "ongoing",
            .totalLoot = 100,
            .raidsCompleted = 1,
            .totalAttacks = 1,
            .enemyDistrictsDestroyed = 0,
            .offensiveReward = 10,
            .defensiveReward = 0
        },
        .playerRaidSnapshots = {
            PlayerRaidSnapshot{
                .playerTag = "#P1",
                .attacksCount = 1,
                .bonusAttack = 0,
                .totalLoot = 100
            }
        }
    };

    TransactionManager transactionManager(database->getDBInstance());
    RaidService service(
        database->clans(),
        database->raids(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_TRUE(result.successFlag);
    ASSERT_EQ(1U, result.events.size());

    const auto* reminder = std::get_if<RaidReminderEvent>(&result.events.front());
    ASSERT_NE(nullptr, reminder);
    EXPECT_EQ(clanTag, reminder->clanTag);
    EXPECT_EQ(endTime, reminder->endTime);
    EXPECT_EQ(RaidReminderEvent::RaidReminderKind::Started, reminder->kind);
    EXPECT_GT(reminder->raidReference.raidId, 0);
}

TEST_F(RaidSyncIntegrationTest, UpsertsExistingRaidOnRepeatedSync)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    FakeAPIClient apiClient;
    apiClient.raidData = CompleteRaidData{
        .clanRaid = ClanRaid{
            .clanTag = std::string(clanTag),
            .startTime = 1000,
            .endTime = 2000,
            .state = "ended",
            .totalLoot = 1000,
            .raidsCompleted = 4,
            .totalAttacks = 6,
            .enemyDistrictsDestroyed = 2,
            .offensiveReward = 80,
            .defensiveReward = 40
        },
        .playerRaidSnapshots = {
            PlayerRaidSnapshot{
                .playerTag = "#P1",
                .attacksCount = 5,
                .bonusAttack = 1,
                .totalLoot = 1000
            }
        }
    };

    TransactionManager transactionManager(database->getDBInstance());
    RaidService service(
        database->clans(),
        database->raids(),
        apiClient,
        transactionManager);

    const SyncResult firstResult = service.updateData(clanTag);

    ASSERT_TRUE(firstResult.successFlag);
    ASSERT_EQ(1U, firstResult.events.size());
    const auto* firstEndedEvent = std::get_if<RaidsEndedEvent>(&firstResult.events.front());
    ASSERT_NE(nullptr, firstEndedEvent);

    apiClient.raidData->clanRaid.totalLoot = 2000;
    apiClient.raidData->clanRaid.raidsCompleted = 5;

    const SyncResult secondResult = service.updateData(clanTag);

    ASSERT_TRUE(secondResult.successFlag);
    EXPECT_EQ(1, tableRowCount(database->getDBInstance(), "clan_raids"));
    EXPECT_EQ(1, tableRowCount(database->getDBInstance(), "player_raid_snapshots"));

    const RaidStats stats = database->raids().getRaidStats(firstEndedEvent->raidReference);
    EXPECT_EQ(2000, stats.totalLoot);
    EXPECT_EQ(5, stats.raidsCompleted);
}

TEST_F(RaidSyncIntegrationTest, RollsBackPlayerAndRaidChangesWhenSavingRaidFails)
{
    constexpr std::string_view requestedClanTag = "#2PPLQ";
    constexpr std::string_view missingClanTag = "#MISSING";

    FakeAPIClient apiClient;
    apiClient.raidData = CompleteRaidData{
        .clanRaid = ClanRaid{
            .clanTag = std::string(missingClanTag),
            .startTime = 1000,
            .endTime = 2000,
            .state = "ended",
            .totalLoot = 1000,
            .raidsCompleted = 4,
            .totalAttacks = 6,
            .enemyDistrictsDestroyed = 2,
            .offensiveReward = 80,
            .defensiveReward = 40
        },
        .playerRaidSnapshots = {
            PlayerRaidSnapshot{
                .playerTag = "#P1",
                .attacksCount = 5,
                .bonusAttack = 1,
                .totalLoot = 1000
            }
        }
    };

    TransactionManager transactionManager(database->getDBInstance());
    RaidService service(
        database->clans(),
        database->raids(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(requestedClanTag);

    ASSERT_FALSE(result.successFlag);
    EXPECT_EQ("RaidService", result.serviceName);
    EXPECT_EQ(requestedClanTag, result.clanTag);
    EXPECT_TRUE(result.events.empty());
    EXPECT_FALSE(result.errorMsg.empty());
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "clan_raids"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "player_raid_snapshots"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "players"));
}

TEST_F(RaidSyncIntegrationTest, ReturnsExpectedServiceName)
{
    FakeAPIClient apiClient;
    TransactionManager transactionManager(database->getDBInstance());
    RaidService service(
        database->clans(),
        database->raids(),
        apiClient,
        transactionManager);

    EXPECT_EQ("RaidService", service.getServiceName());
}
