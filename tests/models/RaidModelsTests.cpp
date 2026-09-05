#include "models/raid/RaidModels.h"

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

namespace
{
    constexpr long long kStartTime = 1704067200;
    constexpr long long kEndTime = 1704153600;
}

TEST(RaidModelsTest, ParsesClanRaidAndConvertsTimes)
{
    const nlohmann::json json = {
        {"startTime", "20240101T000000.000Z"},
        {"endTime", "20240102T000000Z"},
        {"state", "ended"},
        {"capitalTotalLoot", 250000},
        {"raidsCompleted", 5},
        {"totalAttacks", 80},
        {"enemyDistrictsDestroyed", 12},
        {"offensiveReward", 1500},
        {"defensiveReward", 700}
    };

    const auto raid = ClanRaid::fromJson(json, "#CLAN");

    EXPECT_EQ("#CLAN", raid.clanTag);
    EXPECT_EQ(kStartTime, raid.startTime);
    EXPECT_EQ(kEndTime, raid.endTime);
    EXPECT_EQ("ended", raid.state);
    EXPECT_EQ(250000, raid.totalLoot);
    EXPECT_EQ(5, raid.raidsCompleted);
    EXPECT_EQ(80, raid.totalAttacks);
    EXPECT_EQ(12, raid.enemyDistrictsDestroyed);
    EXPECT_EQ(1500, raid.offensiveReward);
    EXPECT_EQ(700, raid.defensiveReward);
}

TEST(RaidModelsTest, UsesClanRaidDefaultsAndZeroForMissingTimes)
{
    const auto raid = ClanRaid::fromJson(nlohmann::json::object(), "#CLAN");

    EXPECT_EQ("#CLAN", raid.clanTag);
    EXPECT_EQ(0, raid.startTime);
    EXPECT_EQ(0, raid.endTime);
    EXPECT_EQ("", raid.state);
    EXPECT_EQ(0, raid.totalLoot);
    EXPECT_EQ(0, raid.raidsCompleted);
    EXPECT_EQ(0, raid.totalAttacks);
    EXPECT_EQ(0, raid.enemyDistrictsDestroyed);
    EXPECT_EQ(0, raid.offensiveReward);
    EXPECT_EQ(0, raid.defensiveReward);
}

TEST(RaidModelsTest, UsesZeroForMalformedClanRaidTimes)
{
    const auto raid = ClanRaid::fromJson(
        nlohmann::json{
            {"startTime", "not-a-time"},
            {"endTime", "20240230T120000Z"}
        },
        "#CLAN"
    );

    EXPECT_EQ(0, raid.startTime);
    EXPECT_EQ(0, raid.endTime);
}

TEST(RaidModelsTest, ParsesRaidPlayerSnapshotsAndDefaults)
{
    const auto snapshot = PlayerRaidSnapshot::parsePlayerRaidSnapshot(
        nlohmann::json{
            {"tag", "#PLAYER"},
            {"attacks", 6},
            {"bonusAttackLimit", 2},
            {"capitalResourcesLooted", 42000}
        }
    );
    const auto defaults = PlayerRaidSnapshot::parsePlayerRaidSnapshot(
        nlohmann::json::object()
    );

    EXPECT_EQ("#PLAYER", snapshot.playerTag);
    EXPECT_EQ(6, snapshot.attacksCount);
    EXPECT_EQ(2, snapshot.bonusAttack);
    EXPECT_EQ(42000, snapshot.totalLoot);
    EXPECT_EQ("unknown", defaults.playerTag);
    EXPECT_EQ(0, defaults.attacksCount);
    EXPECT_EQ(0, defaults.bonusAttack);
    EXPECT_EQ(0, defaults.totalLoot);
}

TEST(RaidModelsTest, ParsesRaidPlayerSnapshotListInInputOrder)
{
    const nlohmann::json json = nlohmann::json::array({
        {{"tag", "#ONE"}, {"attacks", 3}},
        {{"tag", "#TWO"}, {"capitalResourcesLooted", 1000}}
    });

    const auto snapshots = PlayerRaidSnapshot::fromJson(json);

    ASSERT_EQ(2U, snapshots.size());
    EXPECT_EQ("#ONE", snapshots[0].playerTag);
    EXPECT_EQ(3, snapshots[0].attacksCount);
    EXPECT_EQ("#TWO", snapshots[1].playerTag);
    EXPECT_EQ(1000, snapshots[1].totalLoot);
}

TEST(RaidModelsTest, ReturnsEmptyRaidPlayerSnapshotListForEmptyArray)
{
    EXPECT_TRUE(PlayerRaidSnapshot::fromJson(nlohmann::json::array()).empty());
}

TEST(RaidModelsTest, ReturnsEmptyRaidPlayerSnapshotListForNonArray)
{
    EXPECT_TRUE(PlayerRaidSnapshot::fromJson(nlohmann::json::object()).empty());
    EXPECT_TRUE(PlayerRaidSnapshot::fromJson(123).empty());
}

