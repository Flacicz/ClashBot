#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/SQLiteHelpers.h"
#include "database/TransactionManager.h"
#include "service/ClanwarLeagueService.h"

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

    CompleteClanwarData makeCwlWar(const std::string_view clanTag,
                                   const std::string_view opponentTag,
                                   const std::string_view warUid,
                                   const std::string_view state,
                                   const long long preparationStartTime,
                                   const long long startTime,
                                   const long long endTime,
                                   const bool withDetails = true)
    {
        CompleteClanwarData data{
            .clanwar = Clanwar{
                .warUID = std::string(warUid),
                .clanTag = std::string(clanTag),
                .state = std::string(state),
                .warType = std::string(WarType::Regular),
                .teamSize = 2,
                .attacksPerMember = 1,
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
                    .clanLevel = 10,
                    .attacksCount = 1,
                    .stars = 3,
                    .destructionPercentage = 100.0
                },
                ClanwarClan{
                    .side = std::string(ClanType::Opponent),
                    .clanTag = std::string(opponentTag),
                    .clanName = "Opponent Clan",
                    .clanLevel = 9,
                    .attacksCount = 1,
                    .stars = 0,
                    .destructionPercentage = 0.0
                }
            }
        };

        if (withDetails)
        {
            data.attacks = {
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
            };

            data.members = {
                std::vector<ClanwarMember>{
                    ClanwarMember{
                        .clanTag = std::string(clanTag),
                        .playerTag = "#P1",
                        .playerName = "Alice",
                        .townhallLevel = 14,
                        .mapPosition = 1
                    }
                },
                std::vector<ClanwarMember>{
                    ClanwarMember{
                        .clanTag = std::string(opponentTag),
                        .playerTag = "#OP1",
                        .playerName = "Opponent Player",
                        .townhallLevel = 13,
                        .mapPosition = 1
                    }
                }
            };
        }
        else
        {
            data.members = {
                std::vector<ClanwarMember>{},
                std::vector<ClanwarMember>{}
            };
        }

        return data;
    }

    class ClanwarLeagueSyncIntegrationTest : public ::testing::Test
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
                ("clashbot-cwl-integration-" +
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

TEST_F(ClanwarLeagueSyncIntegrationTest, SavesSeasonRoundsMembersAndEndedEvents)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    FakeAPIClient apiClient;
    apiClient.clanwarsLeagueData = ClanwarsLeagueFetchResult{
        .status = LeagueFetchStatus::Success,
        .completeClanwarsLeagueData = CompleteClanwarsLeagueData{
            .clanwarsLeagueSeason = ClanwarsLeagueSeason{
                .clanTag = std::string(clanTag),
                .seasonId = "2026-09"
            },
            .clanwarsLeagueMembers = {
                ClanwarsLeagueMember{
                    .playerTag = "#P1",
                    .playerName = "Alice",
                    .townhallLevel = 14,
                    .clanTag = std::string(clanTag),
                    .seasonId = "2026-09"
                },
                ClanwarsLeagueMember{
                    .playerTag = "#P2",
                    .playerName = "Bob",
                    .townhallLevel = 13,
                    .clanTag = std::string(clanTag),
                    .seasonId = "2026-09"
                }
            },
            .warDetails = {
                makeCwlWar(clanTag, "#OPP1", "cwl-war-1", "warEnded", 1000, 1100, 2000),
                makeCwlWar(clanTag, "#OPP2", "cwl-war-2", "warEnded", 3000, 3100, 4000, false)
            }
        },
        .errorMsg = {}
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarLeagueService service(
        database->war(),
        database->leagueWar(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_TRUE(result.successFlag);
    EXPECT_EQ("ClanwarLeagueService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    ASSERT_EQ(2U, result.events.size());

    const auto* firstEvent = std::get_if<ClanwarsLeagueRoundEndedEvent>(&result.events[0]);
    const auto* secondEvent = std::get_if<ClanwarsLeagueRoundEndedEvent>(&result.events[1]);
    ASSERT_NE(nullptr, firstEvent);
    ASSERT_NE(nullptr, secondEvent);
    EXPECT_EQ(firstEvent->cwlSeasonId, secondEvent->cwlSeasonId);

    const auto firstRound = database->leagueWar().getRoundInfo(firstEvent->warReference);
    const auto secondRound = database->leagueWar().getRoundInfo(secondEvent->warReference);
    EXPECT_EQ(std::to_string(firstEvent->cwlSeasonId), firstRound.season);
    EXPECT_EQ(std::to_string(firstEvent->cwlSeasonId), secondRound.season);
    EXPECT_EQ(1, firstRound.roundNumber);
    EXPECT_EQ(2, secondRound.roundNumber);

    const auto firstOverviews = database->war().getClanwarOverviews(firstEvent->warReference);
    EXPECT_EQ(clanTag, firstOverviews.first.clanTag);
    EXPECT_EQ("Home Clan", firstOverviews.first.clanName);
    EXPECT_EQ("#OPP1", firstOverviews.second.clanTag);

    const auto firstAttackStats = database->war().getClanwarAttackStats(firstEvent->warReference);
    EXPECT_EQ(1, firstAttackStats.attacksUsed);
    EXPECT_EQ(2, firstAttackStats.maxAttacks);
    EXPECT_EQ(3, firstAttackStats.totalAttackStars);

    EXPECT_EQ(1, tableRowCount(database->getDBInstance(), "cwl_seasons"));
    EXPECT_EQ(2, tableRowCount(database->getDBInstance(), "cwl_season_members"));
    EXPECT_EQ(2, tableRowCount(database->getDBInstance(), "wars"));
    EXPECT_EQ(4, tableRowCount(database->getDBInstance(), "war_clans"));
    EXPECT_EQ(1, tableRowCount(database->getDBInstance(), "attacks"));
    EXPECT_EQ(2, tableRowCount(database->getDBInstance(), "war_members"));
}

TEST_F(ClanwarLeagueSyncIntegrationTest, ReturnsSuccessWithoutEventsWhenNoActiveLeague)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    FakeAPIClient apiClient;
    apiClient.clanwarsLeagueData = ClanwarsLeagueFetchResult{
        .status = LeagueFetchStatus::NoActiveLeague,
        .completeClanwarsLeagueData = std::nullopt,
        .errorMsg = {}
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarLeagueService service(
        database->war(),
        database->leagueWar(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_TRUE(result.successFlag);
    EXPECT_EQ("ClanwarLeagueService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    EXPECT_TRUE(result.events.empty());
    EXPECT_TRUE(result.errorMsg.empty());
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "cwl_seasons"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "wars"));
}

TEST_F(ClanwarLeagueSyncIntegrationTest, ReturnsErrorWhenLeagueFetchFails)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    FakeAPIClient apiClient;
    apiClient.clanwarsLeagueData = ClanwarsLeagueFetchResult{
        .status = LeagueFetchStatus::Error,
        .completeClanwarsLeagueData = std::nullopt,
        .errorMsg = "API unavailable"
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarLeagueService service(
        database->war(),
        database->leagueWar(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_FALSE(result.successFlag);
    EXPECT_EQ("ClanwarLeagueService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    EXPECT_TRUE(result.events.empty());
    EXPECT_NE(result.errorMsg.find("API unavailable"), std::string::npos);
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "cwl_seasons"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "wars"));
}

TEST_F(ClanwarLeagueSyncIntegrationTest, ReturnsErrorWhenSuccessfulFetchHasNoData)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    FakeAPIClient apiClient;
    apiClient.clanwarsLeagueData = ClanwarsLeagueFetchResult{
        .status = LeagueFetchStatus::Success,
        .completeClanwarsLeagueData = std::nullopt,
        .errorMsg = {}
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarLeagueService service(
        database->war(),
        database->leagueWar(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_FALSE(result.successFlag);
    EXPECT_EQ("ClanwarLeagueService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    EXPECT_TRUE(result.events.empty());
    EXPECT_FALSE(result.errorMsg.empty());
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "cwl_seasons"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "wars"));
}

TEST_F(ClanwarLeagueSyncIntegrationTest, UpsertsExistingSeasonAndWarsOnRepeatedSync)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    const auto leagueData = CompleteClanwarsLeagueData{
        .clanwarsLeagueSeason = ClanwarsLeagueSeason{
            .clanTag = std::string(clanTag),
            .seasonId = "2026-09"
        },
        .clanwarsLeagueMembers = {
            ClanwarsLeagueMember{
                .playerTag = "#P1",
                .playerName = "Alice",
                .townhallLevel = 14,
                .clanTag = std::string(clanTag),
                .seasonId = "2026-09"
            }
        },
        .warDetails = {
            makeCwlWar(clanTag, "#OPP1", "cwl-repeat-1", "warEnded", 1000, 1100, 2000, false)
        }
    };

    FakeAPIClient apiClient;
    apiClient.clanwarsLeagueData = ClanwarsLeagueFetchResult{
        .status = LeagueFetchStatus::Success,
        .completeClanwarsLeagueData = leagueData,
        .errorMsg = {}
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarLeagueService service(
        database->war(),
        database->leagueWar(),
        apiClient,
        transactionManager);

    const SyncResult firstResult = service.updateData(clanTag);
    const SyncResult secondResult = service.updateData(clanTag);

    ASSERT_TRUE(firstResult.successFlag);
    ASSERT_TRUE(secondResult.successFlag);
    EXPECT_EQ(1, tableRowCount(database->getDBInstance(), "cwl_seasons"));
    EXPECT_EQ(1, tableRowCount(database->getDBInstance(), "cwl_season_members"));
    EXPECT_EQ(1, tableRowCount(database->getDBInstance(), "wars"));
    EXPECT_EQ(2, tableRowCount(database->getDBInstance(), "war_clans"));
}

TEST_F(ClanwarLeagueSyncIntegrationTest, GeneratesStartedReminderForActiveLeagueWar)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    const auto now = std::chrono::system_clock::to_time_t(
        std::chrono::system_clock::now());
    const auto endTime = now + 12 * 60 * 60;

    FakeAPIClient apiClient;
    apiClient.clanwarsLeagueData = ClanwarsLeagueFetchResult{
        .status = LeagueFetchStatus::Success,
        .completeClanwarsLeagueData = CompleteClanwarsLeagueData{
            .clanwarsLeagueSeason = ClanwarsLeagueSeason{
                .clanTag = std::string(clanTag),
                .seasonId = "2026-09"
            },
            .clanwarsLeagueMembers = {},
            .warDetails = {
                makeCwlWar(
                    clanTag,
                    "#OPP1",
                    "cwl-started-1",
                    "inWar",
                    now - 60 * 60,
                    now - 30 * 60,
                    endTime,
                    false)
            }
        },
        .errorMsg = {}
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarLeagueService service(
        database->war(),
        database->leagueWar(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_TRUE(result.successFlag);
    ASSERT_EQ(1U, result.events.size());

    const auto* reminder = std::get_if<WarReminderEvent>(&result.events.front());
    ASSERT_NE(nullptr, reminder);
    EXPECT_EQ(clanTag, reminder->clanTag);
    EXPECT_EQ(endTime, reminder->endTime);
    EXPECT_EQ(WarReminderEvent::WarKind::CWL, reminder->warKind);
    EXPECT_EQ(WarReminderEvent::WarReminderKind::Started, reminder->kind);
    EXPECT_GT(reminder->warId, 0);
}

TEST_F(ClanwarLeagueSyncIntegrationTest, RollsBackSeasonAndRoundsWhenSavingRoundFails)
{
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);

    auto invalidWar = makeCwlWar(
        clanTag,
        "#OPP2",
        "cwl-invalid-2",
        "warEnded",
        3000,
        3100,
        4000,
        false);
    invalidWar.clanwar.warType = "invalid";

    FakeAPIClient apiClient;
    apiClient.clanwarsLeagueData = ClanwarsLeagueFetchResult{
        .status = LeagueFetchStatus::Success,
        .completeClanwarsLeagueData = CompleteClanwarsLeagueData{
            .clanwarsLeagueSeason = ClanwarsLeagueSeason{
                .clanTag = std::string(clanTag),
                .seasonId = "2026-09"
            },
            .clanwarsLeagueMembers = {
                ClanwarsLeagueMember{
                    .playerTag = "#P1",
                    .playerName = "Alice",
                    .townhallLevel = 14,
                    .clanTag = std::string(clanTag),
                    .seasonId = "2026-09"
                }
            },
            .warDetails = {
                makeCwlWar(clanTag, "#OPP1", "cwl-valid-1", "warEnded", 1000, 1100, 2000, false),
                std::move(invalidWar)
            }
        },
        .errorMsg = {}
    };

    TransactionManager transactionManager(database->getDBInstance());
    ClanwarLeagueService service(
        database->war(),
        database->leagueWar(),
        apiClient,
        transactionManager);

    const SyncResult result = service.updateData(clanTag);

    ASSERT_FALSE(result.successFlag);
    EXPECT_EQ("ClanwarLeagueService", result.serviceName);
    EXPECT_EQ(clanTag, result.clanTag);
    EXPECT_TRUE(result.events.empty());
    EXPECT_FALSE(result.errorMsg.empty());

    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "cwl_seasons"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "cwl_season_members"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "wars"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "war_clans"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "war_members"));
    EXPECT_EQ(0, tableRowCount(database->getDBInstance(), "attacks"));
}

TEST_F(ClanwarLeagueSyncIntegrationTest, ReturnsExpectedServiceName)
{
    FakeAPIClient apiClient;
    TransactionManager transactionManager(database->getDBInstance());
    ClanwarLeagueService service(
        database->war(),
        database->leagueWar(),
        apiClient,
        transactionManager);

    EXPECT_EQ("ClanwarLeagueService", service.getServiceName());
}
