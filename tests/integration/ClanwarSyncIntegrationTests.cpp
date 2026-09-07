#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/SQLiteHelpers.h"
#include "database/TransactionManager.h"
#include "service/ClanwarService.h"

#include "FakeAPIClient.h"

#include <chrono>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

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

    CompleteClanwarData makeMinimalClanwarData(const std::string_view clanTag,
                                               const std::string_view warUid,
                                               const std::string_view state,
                                               const long long preparationStartTime,
                                               const long long startTime,
                                               const long long endTime)
    {
        constexpr std::string_view opponentTag = "#OPPONENT";

        return CompleteClanwarData{
            .clanwar = Clanwar{
                .warUID = std::string(warUid),
                .clanTag = std::string(clanTag),
                .state = std::string(state),
                .warType = std::string(WarType::Regular),
                .teamSize = 1,
                .attacksPerMember = 2,
                .preparationStartTime = preparationStartTime,
                .startTime = startTime,
                .endTime = endTime,
                .seasonId = std::nullopt,
                .roundNumber = std::nullopt
            },
            .clans = {
                ClanwarClan{
                    .side = std::string(ClanType::Home),
                    .clanTag = std::string(clanTag),
                    .clanName = "Home Clan",
                    .clanLevel = 1,
                    .attacksCount = 0,
                    .stars = 0,
                    .destructionPercentage = 0.0
                },
                ClanwarClan{
                    .side = std::string(ClanType::Opponent),
                    .clanTag = std::string(opponentTag),
                    .clanName = "Opponent Clan",
                    .clanLevel = 1,
                    .attacksCount = 0,
                    .stars = 0,
                    .destructionPercentage = 0.0
                }
            },
            .attacks = {},
            .members = {
                std::vector<ClanwarMember>{},
                std::vector<ClanwarMember>{}
            }
        };
    }

    class ClanwarSyncIntegrationTest : public ::testing::Test
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
                ("clashbot-clanwar-integration-" +
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

TEST_F(ClanwarSyncIntegrationTest, SavesWarMembersAttacksAndEndedEvent)
{
    constexpr std::string_view clanTag = "#2PPLQ";
    constexpr std::string_view opponentTag = "#OPP1";

    database->clans().insertMinimalClan(clanTag);

    FakeAPIClient apiClient;
    apiClient.clanwarData = ClanwarsFetchResult{
        .status = ClanwarFetchStatus::Success,
        .clanwarData = CompleteClanwarData{
            .clanwar = Clanwar{
                .warUID = "war-integration-1",
                .clanTag = std::string(clanTag),
                .state = "warEnded",
                .warType = std::string(WarType::Regular),
                .teamSize = 2,
                .attacksPerMember = 2,
                .preparationStartTime = 1000,
                .startTime = 1100,
                .endTime = 2000,
                .seasonId = std::nullopt,
                .roundNumber = std::nullopt
            },
            .clans = {
                ClanwarClan{
                    .side = std::string(ClanType::Home),
                    .clanTag = std::string(clanTag),
                    .clanName = "Integration Clan",
                    .clanLevel = 10,
                    .attacksCount = 2,
                    .stars = 5,
                    .destructionPercentage = 90.0
                },
                ClanwarClan{
                    .side = std::string(ClanType::Opponent),
                    .clanTag = std::string(opponentTag),
                    .clanName = "Opponent Clan",
                    .clanLevel = 9,
                    .attacksCount = 2,
                    .stars = 3,
                    .destructionPercentage = 80.0
                }
            },
            .attacks = {
                ClanwarAttack{
                    .attackerTag = "#P1",
                    .defenderTag = "#OP1",
                    .attackerClanTag = std::string(clanTag),
                    .defenderClanTag = std::string(opponentTag),
                    .attackerPosition = 1,
                    .defenderPosition = 1,
                    .stars = 3,
                    .destructionPercentage = 100.0,
                    .orderNum = 1,
                    .duration = 120
                }
            },
            .members = {
                std::vector{
                    ClanwarMember{
                        .clanTag = std::string(clanTag),
                        .playerTag = "#P1",
                        .playerName = "Alice",
                        .townhallLevel = 14,
                        .mapPosition = 1
                    }
                },
                std::vector{
                    ClanwarMember{
                        .clanTag = std::string(opponentTag),
                        .playerTag = "#OP1",
                        .playerName = "Opponent Player",
                        .townhallLevel = 13,
                        .mapPosition = 1
                    }
                }
            }
        },
        .errorMsg = {}
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarService service(
        database->war(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_TRUE(result.successFlag);
    EXPECT_EQ("ClanwarService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    ASSERT_EQ(1U, result.events.size());

    const auto* endedEvent = std::get_if<WarEndedEvent>(&result.events.front());
    ASSERT_NE(nullptr, endedEvent);

    const auto overviews = database->war().getClanwarOverviews(
        endedEvent->warReference);
    EXPECT_EQ(clanTag, overviews.first.clanTag);
    EXPECT_EQ("Integration Clan", overviews.first.clanName);
    EXPECT_EQ(5, overviews.first.stars);
    EXPECT_EQ(opponentTag, overviews.second.clanTag);
    EXPECT_EQ(3, overviews.second.stars);

    const auto attackStats = database->war().getClanwarAttackStats(
        endedEvent->warReference);
    EXPECT_EQ(1, attackStats.attacksUsed);
    EXPECT_EQ(4, attackStats.maxAttacks);
    EXPECT_EQ(2, attackStats.teamSize);
    EXPECT_EQ(3, attackStats.totalAttackStars);
    EXPECT_EQ(1, attackStats.threeStarAttacks);

    const auto bestAttacks = database->war().getBestAttacks(
        endedEvent->warReference);
    ASSERT_EQ(1U, bestAttacks.size());
    EXPECT_EQ("#P1", bestAttacks.front().attackerTag);
    EXPECT_EQ("Alice", bestAttacks.front().attackerName);
    EXPECT_EQ(3, bestAttacks.front().stars);
    EXPECT_DOUBLE_EQ(100.0, bestAttacks.front().destructionPercentage);
}

TEST_F(ClanwarSyncIntegrationTest, ReturnsSuccessWithoutEventsWhenNoActiveWar)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    FakeAPIClient apiClient;
    apiClient.clanwarData = ClanwarsFetchResult{
        .status = ClanwarFetchStatus::NoActiveWar,
        .clanwarData = {},
        .errorMsg = {}
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarService service(
        database->war(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_TRUE(result.successFlag);
    EXPECT_EQ("ClanwarService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    ASSERT_TRUE(result.events.empty());
    ASSERT_TRUE(result.errorMsg.empty());
}

TEST_F(ClanwarSyncIntegrationTest, ReturnsErrorWhenClanwarFetchFails)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    FakeAPIClient apiClient;
    apiClient.clanwarData = ClanwarsFetchResult{
        .status = ClanwarFetchStatus::Error,
        .clanwarData = {},
        .errorMsg = "Error"
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarService service(
        database->war(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_FALSE(result.successFlag);
    EXPECT_EQ("ClanwarService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    ASSERT_TRUE(result.events.empty());
    ASSERT_FALSE(result.errorMsg.empty());
}

TEST_F(ClanwarSyncIntegrationTest, ReturnsErrorWhenSuccessfulFetchHasNoData)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    FakeAPIClient apiClient;
    apiClient.clanwarData = ClanwarsFetchResult{
        .status = ClanwarFetchStatus::Success,
        .clanwarData = std::nullopt,
        .errorMsg = {}
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarService service(
        database->war(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_FALSE(result.successFlag);
    EXPECT_EQ("ClanwarService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    ASSERT_TRUE(result.events.empty());
    ASSERT_FALSE(result.errorMsg.empty());
}

TEST_F(ClanwarSyncIntegrationTest, ReturnsSuccessWithoutEventsWhenWarIsNotStarted)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    const auto now = std::chrono::system_clock::to_time_t(
        std::chrono::system_clock::now());

    FakeAPIClient apiClient;
    apiClient.clanwarData = ClanwarsFetchResult{
        .status = ClanwarFetchStatus::Success,
        .clanwarData = makeMinimalClanwarData(
            clanTag,
            "war-not-started-1",
            "preparation",
            now + 60 * 60,
            now + 2 * 60 * 60,
            now + 24 * 60 * 60),
        .errorMsg = {}
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarService service(
        database->war(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_TRUE(result.successFlag);
    EXPECT_EQ("ClanwarService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    EXPECT_TRUE(result.events.empty());
    EXPECT_EQ(1, tableRowCount(database->getDBInstance(), "wars"));
}

TEST_F(ClanwarSyncIntegrationTest, GeneratesStartedReminderForActiveWar)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    const auto now = std::chrono::system_clock::to_time_t(
        std::chrono::system_clock::now());
    const auto endTime = now + 12 * 60 * 60;

    FakeAPIClient apiClient;
    apiClient.clanwarData = ClanwarsFetchResult{
        .status = ClanwarFetchStatus::Success,
        .clanwarData = makeMinimalClanwarData(
            clanTag,
            "war-started-1",
            "inWar",
            now - 60 * 60,
            now - 30 * 60,
            endTime),
        .errorMsg = {}
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarService service(
        database->war(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_TRUE(result.successFlag);
    ASSERT_EQ(1U, result.events.size());

    const auto* reminder = std::get_if<WarReminderEvent>(&result.events.front());
    ASSERT_NE(nullptr, reminder);
    EXPECT_EQ(clanTag, reminder->clanTag);
    EXPECT_EQ(endTime, reminder->endTime);
    EXPECT_EQ(WarReminderEvent::WarKind::Regular, reminder->warKind);
    EXPECT_EQ(WarReminderEvent::WarReminderKind::Started, reminder->kind);
    EXPECT_GT(reminder->warId, 0);
}

TEST_F(ClanwarSyncIntegrationTest, UpsertsExistingWarOnRepeatedSync)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    FakeAPIClient apiClient;
    apiClient.clanwarData = ClanwarsFetchResult{
        .status = ClanwarFetchStatus::Success,
        .clanwarData = makeMinimalClanwarData(
            clanTag,
            "war-repeat-1",
            "warEnded",
            1000,
            1100,
            2000),
        .errorMsg = {}
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarService service(
        database->war(),
        apiClient,
        transactionManager);

    const SyncResult firstResult = service.updateData(clanTag);
    const SyncResult secondResult = service.updateData(clanTag);

    ASSERT_TRUE(firstResult.successFlag);
    ASSERT_TRUE(secondResult.successFlag);
    EXPECT_EQ(1, tableRowCount(database->getDBInstance(), "wars"));
    EXPECT_EQ(2, tableRowCount(database->getDBInstance(), "war_clans"));
}

TEST_F(ClanwarSyncIntegrationTest, RollsBackDatabaseChangesWhenSavingWarFails)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    auto invalidWarData = makeMinimalClanwarData(
        clanTag,
        "war-invalid-1",
        "warEnded",
        1000,
        1100,
        2000);
    invalidWarData.clanwar.warType = "invalid";

    FakeAPIClient apiClient;
    apiClient.clanwarData = ClanwarsFetchResult{
        .status = ClanwarFetchStatus::Success,
        .clanwarData = std::move(invalidWarData),
        .errorMsg = {}
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarService service(
        database->war(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_FALSE(result.successFlag);
    EXPECT_EQ("ClanwarService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    EXPECT_TRUE(result.events.empty());
    EXPECT_FALSE(result.errorMsg.empty());

    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "wars"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "war_clans"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "war_members"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "attacks"));
}

TEST_F(ClanwarSyncIntegrationTest, ReturnsExpectedServiceName)
{
    FakeAPIClient apiClient;
    TransactionManager transactionManager(database->getDBInstance());
    ClanwarService service(
        database->war(),
        apiClient,
        transactionManager);

    EXPECT_EQ("ClanwarService", service.getServiceName());
}
