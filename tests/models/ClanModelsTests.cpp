#include "models/clan/ClanModels.h"

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

TEST(ClanModelsTest, ParsesClanWithNestedLocationAndLanguage)
{
    const nlohmann::json json = {
        {"tag", "#CLAN"},
        {"name", "Test clan"},
        {"description", "Description"},
        {"location", {{"id", 32000006}, {"name", "Russia"}}},
        {"chatLanguage", {{"id", 7}, {"name", "Russian"}}},
        {"isFamilyFriendly", true}
    };

    const auto clan = Clan::fromJson(json);

    EXPECT_EQ("#CLAN", clan.tag);
    EXPECT_EQ("Test clan", clan.name);
    EXPECT_EQ("Description", clan.description);
    EXPECT_EQ(32000006, clan.locationId);
    EXPECT_EQ("Russia", clan.locationName);
    EXPECT_EQ(7, clan.chatLanguageId);
    EXPECT_EQ("Russian", clan.chatLanguage);
    EXPECT_TRUE(clan.isFamilyFriendly);
}

TEST(ClanModelsTest, UsesClanDefaultsWhenFieldsAreMissing)
{
    const auto clan = Clan::fromJson(nlohmann::json::object());

    EXPECT_EQ("unknown", clan.tag);
    EXPECT_EQ("Unknown", clan.name);
    EXPECT_EQ("", clan.description);
    EXPECT_EQ(0, clan.locationId);
    EXPECT_EQ("International", clan.locationName);
    EXPECT_EQ(0, clan.chatLanguageId);
    EXPECT_EQ("Not set", clan.chatLanguage);
    EXPECT_FALSE(clan.isFamilyFriendly);
}

TEST(ClanModelsTest, UsesDefaultsForIncompleteNestedObjects)
{
    const auto clan = Clan::fromJson(
        nlohmann::json{
            {"location", nlohmann::json::object()},
            {"chatLanguage", nlohmann::json::object()}
        }
    );
    const auto clanSnapshot = ClanSnapshot::fromJson(
        nlohmann::json{
            {"clanCapital", nlohmann::json::object()},
            {"capitalLeague", nlohmann::json::object()},
            {"warLeague", nlohmann::json::object()}
        }
    );
    const auto playerSnapshot = PlayerSnapshot::parsePlayerSnapshot(
        nlohmann::json{
            {"league", nlohmann::json::object()},
            {"builderBaseLeague", nlohmann::json::object()}
        },
        "#CLAN"
    );

    EXPECT_EQ("International", clan.locationName);
    EXPECT_EQ("Not set", clan.chatLanguage);
    EXPECT_EQ(1, clanSnapshot.capitalHallLevel);
    EXPECT_EQ(0, clanSnapshot.capitalLeagueId);
    EXPECT_EQ(0, clanSnapshot.warLeagueId);
    EXPECT_EQ(0, playerSnapshot.leagueId);
    EXPECT_EQ(0, playerSnapshot.builderBaseLeagueId);
}

TEST(ClanModelsTest, ParsesPlayerAndUsesPassedClanTag)
{
    const auto player = Player::parsePlayer(
        nlohmann::json{{"tag", "#PLAYER"}, {"name", "Player"}},
        "#CLAN"
    );

    EXPECT_EQ("#PLAYER", player.tag);
    EXPECT_EQ("Player", player.name);
    EXPECT_EQ("#CLAN", player.clanTag);
}

TEST(ClanModelsTest, UsesPlayerDefaultsWhenFieldsAreMissing)
{
    const auto player = Player::parsePlayer(nlohmann::json::object(), "#CLAN");

    EXPECT_EQ("unknown", player.tag);
    EXPECT_EQ("Unknown", player.name);
    EXPECT_EQ("#CLAN", player.clanTag);
}

TEST(ClanModelsTest, ParsesPlayerListAndAppliesPlayerDefaults)
{
    const nlohmann::json json = {
        {"tag", "#CLAN"},
        {
            "memberList", {
                {{"tag", "#ONE"}, {"name", "One"}},
                {{"name", "Two"}}
            }
        }
    };

    const auto players = Player::parsePlayersList(json);

    ASSERT_EQ(2U, players.size());
    EXPECT_EQ("#ONE", players[0].tag);
    EXPECT_EQ("One", players[0].name);
    EXPECT_EQ("#CLAN", players[0].clanTag);
    EXPECT_EQ("unknown", players[1].tag);
    EXPECT_EQ("Two", players[1].name);
    EXPECT_EQ("#CLAN", players[1].clanTag);
}

TEST(ClanModelsTest, ReturnsEmptyPlayerListForJSONWithoutMemberList)
{
    EXPECT_TRUE(Player::parsePlayersList(nlohmann::json::object()).empty());
}

TEST(ClanModelsTest, ReturnsEmptyPlayerListWhenMemberListIsNotArray)
{
    EXPECT_TRUE(
        Player::parsePlayersList(
            nlohmann::json{{"memberList", "invalid"}}
        ).empty()
    );
}

TEST(ClanModelsTest, ReturnsEmptyPlayerListForEmptyMemberList)
{
    EXPECT_TRUE(
        Player::parsePlayersList(
            nlohmann::json{
                {"tag", "#CLAN"},
                {"memberList", nlohmann::json::array()}
            }
        ).empty()
    );
}

TEST(ClanModelsTest, ParsesClanSnapshotWithAllFields)
{
    const nlohmann::json json = {
        {"tag", "#CLAN"},
        {"type", "inviteOnly"},
        {"members", 42},
        {"clanLevel", 18},
        {"clanPoints", 32000},
        {"clanBuilderBasePoints", 12000},
        {"clanCapitalPoints", 9000},
        {"clanCapital", {{"capitalHallLevel", 10}}},
        {"capitalLeague", {{"id", 48000012}}},
        {"requiredTrophies", 2000},
        {"requiredBuilderBaseTrophies", 1000},
        {"requiredTownhallLevel", 12},
        {"warFrequency", "always"},
        {"isWarLogPublic", true},
        {"warWinStreak", 4},
        {"warWins", 30},
        {"warTies", 2},
        {"warLosses", 10},
        {"warLeague", {{"id", 48000020}}}
    };

    const auto snapshot = ClanSnapshot::fromJson(json);

    EXPECT_EQ("#CLAN", snapshot.clanTag);
    EXPECT_EQ("inviteOnly", snapshot.type);
    EXPECT_EQ(42, snapshot.membersCount);
    EXPECT_EQ(18, snapshot.clanLevel);
    EXPECT_EQ(32000, snapshot.clanPoints);
    EXPECT_EQ(12000, snapshot.clanBuilderBasePoints);
    EXPECT_EQ(9000, snapshot.clanCapitalPoints);
    EXPECT_EQ(10, snapshot.capitalHallLevel);
    EXPECT_EQ(48000012, snapshot.capitalLeagueId);
    EXPECT_EQ(2000, snapshot.requiredTrophies);
    EXPECT_EQ(1000, snapshot.requiredBuilderBaseTrophies);
    EXPECT_EQ(12, snapshot.requiredTownhallLevel);
    EXPECT_EQ("always", snapshot.warFrequency);
    EXPECT_TRUE(snapshot.isWarLogPublic);
    EXPECT_EQ(4, snapshot.warWinStreak);
    EXPECT_EQ(30, snapshot.warWins);
    EXPECT_EQ(2, snapshot.warTies);
    EXPECT_EQ(10, snapshot.warLosses);
    EXPECT_EQ(48000020, snapshot.warLeagueId);
}

TEST(ClanModelsTest, UsesClanSnapshotDefaultsWhenFieldsAreMissing)
{
    const auto snapshot = ClanSnapshot::fromJson(nlohmann::json::object());

    EXPECT_EQ("unknown", snapshot.clanTag);
    EXPECT_EQ("open", snapshot.type);
    EXPECT_EQ(0, snapshot.membersCount);
    EXPECT_EQ(1, snapshot.clanLevel);
    EXPECT_EQ(0, snapshot.clanPoints);
    EXPECT_EQ(0, snapshot.clanBuilderBasePoints);
    EXPECT_EQ(0, snapshot.clanCapitalPoints);
    EXPECT_EQ(1, snapshot.capitalHallLevel);
    EXPECT_EQ(0, snapshot.capitalLeagueId);
    EXPECT_EQ(0, snapshot.requiredTrophies);
    EXPECT_EQ(0, snapshot.requiredBuilderBaseTrophies);
    EXPECT_EQ(1, snapshot.requiredTownhallLevel);
    EXPECT_EQ("unknown", snapshot.warFrequency);
    EXPECT_FALSE(snapshot.isWarLogPublic);
    EXPECT_EQ(0, snapshot.warWinStreak);
    EXPECT_EQ(0, snapshot.warWins);
    EXPECT_EQ(0, snapshot.warTies);
    EXPECT_EQ(0, snapshot.warLosses);
    EXPECT_EQ(0, snapshot.warLeagueId);
}

TEST(ClanModelsTest, ParsesPlayerSnapshotWithNestedLeagues)
{
    const nlohmann::json json = {
        {"tag", "#PLAYER"},
        {"role", "coLeader"},
        {"townHallLevel", 16},
        {"expLevel", 240},
        {"clanRank", 2},
        {"league", {{"id", 29000022}}},
        {"builderBaseLeague", {{"id", 44000018}}},
        {"trophies", 5200},
        {"builderBaseTrophies", 3500},
        {"donations", 1200},
        {"donationsReceived", 900}
    };

    const auto snapshot = PlayerSnapshot::parsePlayerSnapshot(json, "#CLAN");

    EXPECT_EQ("#PLAYER", snapshot.playerTag);
    EXPECT_EQ("#CLAN", snapshot.clanTag);
    EXPECT_EQ("coLeader", snapshot.role);
    EXPECT_EQ(16, snapshot.townHallLevel);
    EXPECT_EQ(240, snapshot.expLevel);
    EXPECT_EQ(2, snapshot.clanRank);
    EXPECT_EQ(29000022, snapshot.leagueId);
    EXPECT_EQ(44000018, snapshot.builderBaseLeagueId);
    EXPECT_EQ(5200, snapshot.trophies);
    EXPECT_EQ(3500, snapshot.builderBaseTrophies);
    EXPECT_EQ(1200, snapshot.donations);
    EXPECT_EQ(900, snapshot.donationsReceived);
}

TEST(ClanModelsTest, ParsesPlayerSnapshotListWithCurrentClanTag)
{
    const nlohmann::json json = {
        {
            "memberList", {
                {{"tag", "#ONE"}, {"townHallLevel", 15}},
                {{"tag", "#TWO"}, {"role", "leader"}}
            }
        }
    };

    const auto snapshots = PlayerSnapshot::parsePlayerSnapshotList(json, "#CLAN");

    ASSERT_EQ(2U, snapshots.size());
    EXPECT_EQ("#ONE", snapshots[0].playerTag);
    EXPECT_EQ("#CLAN", snapshots[0].clanTag);
    EXPECT_EQ(15, snapshots[0].townHallLevel);
    EXPECT_EQ("#TWO", snapshots[1].playerTag);
    EXPECT_EQ("leader", snapshots[1].role);
}

TEST(ClanModelsTest, UsesPlayerSnapshotDefaultsWhenFieldsAreMissing)
{
    const auto snapshot = PlayerSnapshot::parsePlayerSnapshot(
        nlohmann::json::object(),
        "#CLAN"
    );

    EXPECT_EQ("unknown", snapshot.playerTag);
    EXPECT_EQ("#CLAN", snapshot.clanTag);
    EXPECT_EQ("member", snapshot.role);
    EXPECT_EQ(1, snapshot.townHallLevel);
    EXPECT_EQ(1, snapshot.expLevel);
    EXPECT_EQ(0, snapshot.clanRank);
    EXPECT_EQ(0, snapshot.leagueId);
    EXPECT_EQ(0, snapshot.builderBaseLeagueId);
    EXPECT_EQ(0, snapshot.trophies);
    EXPECT_EQ(0, snapshot.builderBaseTrophies);
    EXPECT_EQ(0, snapshot.donations);
    EXPECT_EQ(0, snapshot.donationsReceived);
}

TEST(ClanModelsTest, ReturnsEmptyPlayerSnapshotListForEmptyMemberList)
{
    EXPECT_TRUE(
        PlayerSnapshot::parsePlayerSnapshotList(
            nlohmann::json{{"memberList", nlohmann::json::array()}},
            "#CLAN"
        ).empty()
    );
}

TEST(ClanModelsTest, ReturnsEmptyPlayerSnapshotListForJSONWithoutMemberList)
{
    EXPECT_TRUE(
        PlayerSnapshot::parsePlayerSnapshotList(
            nlohmann::json::object(),
            "#CLAN"
        ).empty()
    );
}

TEST(ClanModelsTest, ReturnsEmptyPlayerSnapshotListWhenMemberListIsNotArray)
{
    EXPECT_TRUE(
        PlayerSnapshot::parsePlayerSnapshotList(
            nlohmann::json{{"memberList", 123}},
            "#CLAN"
        ).empty()
    );
}

TEST(ClanModelsTest, ThrowsForWrongScalarFieldTypes)
{
    EXPECT_THROW(
        Clan::fromJson(nlohmann::json{{"tag", 123}}),
        nlohmann::json::type_error);
    EXPECT_THROW(
        Player::parsePlayer(nlohmann::json{{"name", 123}}, "#CLAN"),
        nlohmann::json::type_error);
    EXPECT_THROW(
        ClanSnapshot::fromJson(nlohmann::json{{"members", "42"}}),
        nlohmann::json::type_error);
    EXPECT_THROW(
        PlayerSnapshot::parsePlayerSnapshot(
            nlohmann::json{{"townHallLevel", "16"}},
            "#CLAN"),
        nlohmann::json::type_error);
}
