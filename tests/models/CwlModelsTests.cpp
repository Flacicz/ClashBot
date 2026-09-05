#include "models/clanwar/ClanwarModels.h"
#include "models/cwl/CwlModels.h"
#include "models/raid/RaidModels.h"

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

TEST(CwlModelsTest, ParsesCwlSeasonAndUsesDefaultSeason)
{
    const auto season = ClanwarsLeagueSeason::fromJson(
        nlohmann::json{{"season", "2024-08"}},
        "#CLAN"
    );
    const auto defaults = ClanwarsLeagueSeason::fromJson(
        nlohmann::json::object(),
        "#CLAN"
    );

    EXPECT_EQ("2024-08", season.seasonId);
    EXPECT_EQ("#CLAN", season.clanTag);
    EXPECT_EQ("0000-00", defaults.seasonId);
    EXPECT_EQ("#CLAN", defaults.clanTag);
}

TEST(CwlModelsTest, ParsesCwlMembersFromMultipleClans)
{
    const nlohmann::json json = {
        {"season", "2024-08"},
        {
            "clans", {
                {
                    {"tag", "#CLAN_ONE"},
                    {
                        "members", {
                            {{"tag", "#ONE"}, {"name", "One"}, {"townHallLevel", 16}},
                            nlohmann::json::object()
                        }
                    }
                },
                {{"tag", "#CLAN_TWO"}},
                {{"tag", "#CLAN_THREE"}, {"members", "not an array"}}
            }
        }
    };

    const auto members = ClanwarsLeagueMember::parseClanwarsLeagueMembers(json);

    ASSERT_EQ(2U, members.size());
    EXPECT_EQ("#ONE", members[0].playerTag);
    EXPECT_EQ("One", members[0].playerName);
    EXPECT_EQ(16, members[0].townhallLevel);
    EXPECT_EQ("#CLAN_ONE", members[0].clanTag);
    EXPECT_EQ("2024-08", members[0].seasonId);
    EXPECT_EQ("", members[1].playerTag);
    EXPECT_EQ("Unknown", members[1].playerName);
    EXPECT_EQ(0, members[1].townhallLevel);
    EXPECT_EQ("#CLAN_ONE", members[1].clanTag);
    EXPECT_EQ("2024-08", members[1].seasonId);
}

TEST(CwlModelsTest, ReturnsEmptyCwlMembersWhenClansAreMissingOrWrongType)
{
    EXPECT_TRUE(
        ClanwarsLeagueMember::parseClanwarsLeagueMembers(nlohmann::json::object()).empty()
    );
    EXPECT_TRUE(
        ClanwarsLeagueMember::parseClanwarsLeagueMembers(
            nlohmann::json{{"clans", "not an array"}}
        ).empty()
    );
}

TEST(CwlModelsTest, UsesDefaultsForEmptyCwlMember)
{
    const auto members = ClanwarsLeagueMember::parseClanwarsLeagueMembers(
        nlohmann::json{
            {
                "clans", {
                    {{"members", {nlohmann::json::object()}}}
                }
            }
        }
    );

    ASSERT_EQ(1U, members.size());
    EXPECT_EQ("", members[0].playerTag);
    EXPECT_EQ("Unknown", members[0].playerName);
    EXPECT_EQ(0, members[0].townhallLevel);
    EXPECT_EQ("unknown", members[0].clanTag);
    EXPECT_EQ("0000-00", members[0].seasonId);
}

TEST(CwlModelsTest, ThrowsForWrongScalarFieldTypes)
{
    EXPECT_THROW(
        ClanRaid::fromJson(nlohmann::json{{"state", 1}}, "#CLAN"),
        nlohmann::json::type_error);
    EXPECT_THROW(
        Clanwar::fromJson(nlohmann::json{{"teamSize", "15"}}, WarType::Regular, "#CLAN"),
        nlohmann::json::type_error);
    EXPECT_THROW(
        ClanwarClan::fromJson(
            nlohmann::json{{"destructionPercentage", "85.5"}},
            ClanType::Home),
        nlohmann::json::type_error);
    EXPECT_THROW(
        PlayerRaidSnapshot::parsePlayerRaidSnapshot(
            nlohmann::json{{"attacks", "3"}}),
        nlohmann::json::type_error);
    EXPECT_THROW(
        ClanwarAttack::parseAttacksList(
            nlohmann::json{
            {"state", "inWar"},
            {"clan", {
            {"members", {
            {{"attacks", nlohmann::json::array({
                nlohmann::json{{"stars", "3"}}
                })}}
            }}
            }}
            }),
        nlohmann::json::type_error);
    EXPECT_THROW(
        ClanwarMember::parseClanwarMembers(
            nlohmann::json{
            {"members", {{{"townhallLevel", "16"}}}}
            }),
        nlohmann::json::type_error);
    EXPECT_THROW(
        ClanwarsLeagueSeason::fromJson(nlohmann::json{{"season", 2024}}, "#CLAN"),
        nlohmann::json::type_error);
    EXPECT_THROW(
        ClanwarsLeagueMember::parseClanwarsLeagueMembers(
            nlohmann::json{
            {"clans", {
            {{"members", {{{"townHallLevel", "16"}}}}}
            }}
            }),
        nlohmann::json::type_error);
}
