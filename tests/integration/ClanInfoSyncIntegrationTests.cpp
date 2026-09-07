#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/TransactionManager.h"
#include "service/ClanInfoService.h"

#include "FakeAPIClient.h"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <memory>
#include <string_view>

#include <gtest/gtest.h>

namespace
{
    class ClanInfoSyncIntegrationTest : public ::testing::Test
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
                ("clashbot-clan-info-integration-" +
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

    CompleteClanData makeCurrentClanData(const std::string_view clanTag)
    {
        return CompleteClanData{
            .clan = Clan{
                .tag = std::string(clanTag),
                .name = "Integration Clan",
                .description = "Test clan",
                .locationId = 1,
                .locationName = "Test Location",
                .chatLanguageId = 1,
                .chatLanguage = "English",
                .isFamilyFriendly = true
            },
            .players = {
                Player{.tag = "#P1", .name = "Alice", .clanTag = std::string(clanTag)},
                Player{.tag = "#P2", .name = "Bob", .clanTag = std::string(clanTag)}
            },
            .clanSnapshot = ClanSnapshot{
                .clanTag = std::string(clanTag),
                .type = "inviteOnly",
                .membersCount = 2,
                .clanLevel = 10,
                .clanPoints = 1000,
                .clanBuilderBasePoints = 500,
                .clanCapitalPoints = 700,
                .capitalHallLevel = 5,
                .capitalLeagueId = 1,
                .requiredTrophies = 1000,
                .requiredBuilderBaseTrophies = 500,
                .requiredTownhallLevel = 10,
                .warFrequency = "always",
                .isWarLogPublic = true,
                .warWinStreak = 3,
                .warWins = 20,
                .warTies = 2,
                .warLosses = 5,
                .warLeagueId = 1
            },
            .playerSnapshots = {
                PlayerSnapshot{
                    .playerTag = "#P1",
                    .clanTag = std::string(clanTag),
                    .role = "elder",
                    .townHallLevel = 14,
                    .expLevel = 200,
                    .clanRank = 1,
                    .leagueId = 1,
                    .builderBaseLeagueId = 1,
                    .trophies = 5000,
                    .builderBaseTrophies = 3000,
                    .donations = 100,
                    .donationsReceived = 80
                },
                PlayerSnapshot{
                    .playerTag = "#P2",
                    .clanTag = std::string(clanTag),
                    .role = "member",
                    .townHallLevel = 13,
                    .expLevel = 180,
                    .clanRank = 2,
                    .leagueId = 1,
                    .builderBaseLeagueId = 1,
                    .trophies = 4500,
                    .builderBaseTrophies = 2500,
                    .donations = 60,
                    .donationsReceived = 50
                }
            }
        };
    }
}

TEST_F(ClanInfoSyncIntegrationTest, SavesClanStateAndMembershipChanges)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);
    database->clans().savePlayers({
        Player{.tag = "#P1", .name = "Alice", .clanTag = std::string(clanTag)},
        Player{.tag = "#POLD", .name = "Old Player", .clanTag = std::string(clanTag)}
    });
    database->clans().registerPlayerJoin("#P1", clanTag);
    database->clans().registerPlayerJoin("#POLD", clanTag);
    database->clans().savePlayerSnapshots({
        PlayerSnapshot{
            .playerTag = "#P1",
            .clanTag = std::string(clanTag),
            .role = "member",
            .townHallLevel = 14,
            .expLevel = 190,
            .clanRank = 1,
            .leagueId = 1,
            .builderBaseLeagueId = 1,
            .trophies = 4900,
            .builderBaseTrophies = 2900,
            .donations = 90,
            .donationsReceived = 70
        },
        PlayerSnapshot{
            .playerTag = "#POLD",
            .clanTag = std::string(clanTag),
            .role = "member",
            .townHallLevel = 12,
            .expLevel = 150,
            .clanRank = 2,
            .leagueId = 1,
            .builderBaseLeagueId = 1,
            .trophies = 4000,
            .builderBaseTrophies = 2000,
            .donations = 40,
            .donationsReceived = 40
        }
    });

    FakeAPIClient apiClient;
    apiClient.clanData = makeCurrentClanData(clanTag);

    TransactionManager transactionManager(database->getDBInstance());
    ClanInfoService service(database->clans(), apiClient, transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_TRUE(result.successFlag);
    EXPECT_EQ("ClanInfoService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    ASSERT_EQ(3U, result.events.size());

    int joinedEvents = 0;
    int leftEvents = 0;
    int roleChangedEvents = 0;

    for (const auto& event : result.events)
    {
        if (const auto* joined = std::get_if<PlayerJoinedClanEvent>(&event))
        {
            ++joinedEvents;
            EXPECT_EQ("#P2", joined->playerTag);
        }
        else if (const auto* left = std::get_if<PlayerLeftClanEvent>(&event))
        {
            ++leftEvents;
            EXPECT_EQ("#POLD", left->playerTag);
        }
        else if (const auto* roleChanged = std::get_if<PlayerRoleChangedEvent>(&event))
        {
            ++roleChangedEvents;
            EXPECT_EQ("#P1", roleChanged->playerTag);
            EXPECT_EQ("member", roleChanged->oldRole);
            EXPECT_EQ("elder", roleChanged->newRole);
        }
    }

    EXPECT_EQ(1, joinedEvents);
    EXPECT_EQ(1, leftEvents);
    EXPECT_EQ(1, roleChangedEvents);
    EXPECT_EQ("Integration Clan", database->clans().getClanNameByTag(clanTag));

    const auto activeMembers = database->clans().getActiveMembers(clanTag);
    ASSERT_EQ(2U, activeMembers.size());
    EXPECT_TRUE(std::ranges::any_of(activeMembers,
                                    [](const Player& player) { return player.tag == "#P1"; }));
    EXPECT_TRUE(std::ranges::any_of(activeMembers,
                                    [](const Player& player) { return player.tag == "#P2"; }));

    const auto latestSnapshots = database->clans().getLatestPlayerSnapshots(clanTag);
    const auto playerOne = std::ranges::find_if(
        latestSnapshots,
        [](const LatestPlayerState& player) { return player.playerTag == "#P1"; });
    const auto playerTwo = std::ranges::find_if(
        latestSnapshots,
        [](const LatestPlayerState& player) { return player.playerTag == "#P2"; });

    ASSERT_NE(playerOne, latestSnapshots.end());
    ASSERT_NE(playerTwo, latestSnapshots.end());
    EXPECT_EQ("elder", playerOne->role);
    EXPECT_EQ("member", playerTwo->role);
}

TEST_F(ClanInfoSyncIntegrationTest, RepeatedClanSyncDoesNotGenerateFalseEvents)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);
    database->clans().savePlayers({
        Player{.tag = "#P1", .name = "Alice", .clanTag = std::string(clanTag)},
        Player{.tag = "#POLD", .name = "Old Player", .clanTag = std::string(clanTag)}
    });
    database->clans().savePlayerSnapshots({
        PlayerSnapshot{
            .playerTag = "#P1",
            .clanTag = std::string(clanTag),
            .role = "member",
            .townHallLevel = 14,
            .expLevel = 190,
            .clanRank = 1,
            .leagueId = 1,
            .builderBaseLeagueId = 1,
            .trophies = 4900,
            .builderBaseTrophies = 2900,
            .donations = 90,
            .donationsReceived = 70
        },
        PlayerSnapshot{
            .playerTag = "#POLD",
            .clanTag = std::string(clanTag),
            .role = "member",
            .townHallLevel = 12,
            .expLevel = 150,
            .clanRank = 2,
            .leagueId = 1,
            .builderBaseLeagueId = 1,
            .trophies = 4000,
            .builderBaseTrophies = 2000,
            .donations = 40,
            .donationsReceived = 40
        }
    });

    FakeAPIClient apiClient;
    apiClient.clanData = makeCurrentClanData(clanTag);

    TransactionManager transactionManager(database->getDBInstance());
    ClanInfoService service(database->clans(), apiClient, transactionManager);

    SyncResult result = service.updateData(clanTag);

    ASSERT_TRUE(result.successFlag);
    EXPECT_EQ("ClanInfoService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    ASSERT_EQ(3U, result.events.size());

    result = service.updateData(clanTag);

    ASSERT_TRUE(result.successFlag);
    EXPECT_EQ("ClanInfoService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    ASSERT_EQ(0U, result.events.size());
}

TEST_F(ClanInfoSyncIntegrationTest, ReturnsErrorWhenClanDataIsUnavailable)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    FakeAPIClient apiClient;
    apiClient.clanData = {};

    TransactionManager transactionManager(database->getDBInstance());
    ClanInfoService service(database->clans(), apiClient, transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_FALSE(result.successFlag);
    EXPECT_EQ("ClanInfoService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    EXPECT_TRUE(result.events.empty());

    EXPECT_TRUE(database->clans().getActiveMembers(clanTag).empty());
    EXPECT_TRUE(database->clans().getLatestPlayerSnapshots(clanTag).empty());
}

TEST_F(ClanInfoSyncIntegrationTest, RollsBackDatabaseChangesWhenSavingClanDataFails)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    auto invalidClanData = makeCurrentClanData(clanTag);
    invalidClanData.clanSnapshot.clanTag = "#UNKNOWN";

    FakeAPIClient apiClient;
    apiClient.clanData = std::move(invalidClanData);

    TransactionManager transactionManager(database->getDBInstance());
    ClanInfoService service(database->clans(), apiClient, transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_FALSE(result.successFlag);
    EXPECT_EQ("ClanInfoService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    EXPECT_TRUE(result.events.empty());

    EXPECT_TRUE(database->clans().getTrackedClans().empty());
    EXPECT_TRUE(database->clans().getActiveMembers(clanTag).empty());
    EXPECT_TRUE(database->clans().getLatestPlayerSnapshots(clanTag).empty());
}

TEST_F(ClanInfoSyncIntegrationTest, ReturnsExpectedServiceName)
{
    FakeAPIClient apiClient;
    TransactionManager transactionManager(database->getDBInstance());
    const ClanInfoService service(database->clans(), apiClient, transactionManager);

    EXPECT_EQ("ClanInfoService", service.getServiceName());
}
