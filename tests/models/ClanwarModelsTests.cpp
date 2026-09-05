#include "models/clanwar/ClanwarModels.h"

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

namespace
{
    constexpr long long kStartTime = 1704067200;
    constexpr long long kEndTime = 1704153600;
}

TEST(ClanwarModelsTest, ParsesRegularClanwarAndBuildsStableWarUid)
{
    const nlohmann::json json = {
        {"state", "warEnded"},
        {"teamSize", 15},
        {"attacksPerMember", 2},
        {"preparationStartTime", "20240101T000000.000Z"},
        {"startTime", "20240102T000000Z"},
        {"endTime", "20240103T000000Z"},
        {"clan", {{"tag", "#Z"}}},
        {"opponent", {{"tag", "#A"}}}
    };

    const auto war = Clanwar::fromJson(json, WarType::Regular, "#Z");

    EXPECT_EQ("#A_#Z_20240101T000000", war.warUID);
    EXPECT_EQ("#Z", war.clanTag);
    EXPECT_EQ("warEnded", war.state);
    EXPECT_EQ(std::string(WarType::Regular), war.warType);
    EXPECT_EQ(15, war.teamSize);
    EXPECT_EQ(2, war.attacksPerMember);
    EXPECT_EQ(kStartTime, war.preparationStartTime);
    EXPECT_EQ(kEndTime, war.startTime);
    EXPECT_EQ(1704240000, war.endTime);
    EXPECT_FALSE(war.seasonId.has_value());
    EXPECT_FALSE(war.roundNumber.has_value());
}

TEST(ClanwarModelsTest, UsesOneAttackDefaultForCwlWithoutAttacksPerMember)
{
    const nlohmann::json json = {
        {"state", "inWar"},
        {"teamSize", 15},
        {"preparationStartTime", "20240101T000000Z"},
        {"clan", {{"tag", "#Z"}}},
        {"opponent", {{"tag", "#A"}}}
    };

    const auto war = Clanwar::fromJson(json, WarType::CWL, "#Z");

    EXPECT_EQ(1, war.attacksPerMember);
    EXPECT_EQ(std::string(WarType::CWL), war.warType);
    EXPECT_EQ(0, war.startTime);
    EXPECT_EQ(0, war.endTime);
}

TEST(ClanwarModelsTest, UsesClanwarDefaultsWhenFieldsAreMissing)
{
    const auto war = Clanwar::fromJson(
        nlohmann::json::object(),
        WarType::Regular,
        "#CLAN"
    );

    EXPECT_EQ("unknown_unknown_", war.warUID);
    EXPECT_EQ("unknown", war.clanTag);
    EXPECT_EQ("notInWar", war.state);
    EXPECT_EQ(std::string(WarType::Regular), war.warType);
    EXPECT_EQ(0, war.teamSize);
    EXPECT_EQ(1, war.attacksPerMember);
    EXPECT_EQ(0, war.preparationStartTime);
    EXPECT_EQ(0, war.startTime);
    EXPECT_EQ(0, war.endTime);
    EXPECT_FALSE(war.seasonId.has_value());
    EXPECT_FALSE(war.roundNumber.has_value());
}

TEST(ClanwarModelsTest, SelectsClanTagAfterSortingWarTags)
{
    const auto war = Clanwar::fromJson(
        nlohmann::json{
            {"clan", {{"tag", "#A"}}},
            {"opponent", {{"tag", "#Z"}}}
        },
        WarType::Regular,
        "#A"
    );

    EXPECT_EQ("#A_#Z_", war.warUID);
    EXPECT_EQ("#A", war.clanTag);
}

TEST(ClanwarModelsTest, ParsesClanwarClanAndUsesDefaults)
{
    const auto clan = ClanwarClan::fromJson(
        nlohmann::json{
            {"tag", "#CLAN"},
            {"name", "Clan"},
            {"clanLevel", 20},
            {"attacks", 14},
            {"stars", 31},
            {"destructionPercentage", 85.5}
        },
        ClanType::Home
    );
    const auto defaults = ClanwarClan::fromJson(
        nlohmann::json::object(),
        ClanType::Opponent
    );

    EXPECT_EQ("home", clan.side);
    EXPECT_EQ("#CLAN", clan.clanTag);
    EXPECT_EQ("Clan", clan.clanName);
    EXPECT_EQ(20, clan.clanLevel);
    EXPECT_EQ(14, clan.attacksCount);
    EXPECT_EQ(31, clan.stars);
    EXPECT_DOUBLE_EQ(85.5, clan.destructionPercentage);
    EXPECT_EQ("opponent", defaults.side);
    EXPECT_EQ("unknown", defaults.clanTag);
    EXPECT_EQ("Unknown", defaults.clanName);
    EXPECT_EQ(0, defaults.clanLevel);
    EXPECT_EQ(0, defaults.attacksCount);
    EXPECT_EQ(0, defaults.stars);
    EXPECT_DOUBLE_EQ(0.0, defaults.destructionPercentage);
}

TEST(ClanwarModelsTest, ParsesClanwarAttacksAndResolvesBothSides)
{
    const nlohmann::json json = {
        {"state", "warEnded"},
        {
            "clan", {
                {"tag", "#HOME"},
                {
                    "members", {
                        {
                            {"tag", "#ATTACKER"},
                            {"mapPosition", 5},
                            {
                                "attacks", nlohmann::json::array({
                                    nlohmann::json{
                                        {"defenderTag", "#DEFENDER"},
                                        {"stars", 3},
                                        {"destructionPercentage", 100.0},
                                        {"order", 1},
                                        {"duration", 120}
                                    }
                                })
                            }
                        }
                    }
                }
            }
        },
        {
            "opponent", {
                {"tag", "#OPPONENT"},
                {
                    "members", {
                        {
                            {"tag", "#DEFENDER"},
                            {"mapPosition", 5},
                            {
                                "attacks", nlohmann::json::array({
                                    nlohmann::json{
                                        {"defenderTag", "#ATTACKER"},
                                        {"stars", 2},
                                        {"destructionPercentage", 75.0},
                                        {"order", 2},
                                        {"duration", 100}
                                    }
                                })
                            }
                        }
                    }
                }
            }
        }
    };

    const auto attacks = ClanwarAttack::parseAttacksList(json);

    ASSERT_EQ(2U, attacks.size());
    EXPECT_EQ("#ATTACKER", attacks[0].attackerTag);
    EXPECT_EQ("#DEFENDER", attacks[0].defenderTag);
    EXPECT_EQ("#HOME", attacks[0].attackerClanTag);
    EXPECT_EQ("#OPPONENT", attacks[0].defenderClanTag);
    EXPECT_EQ(5, attacks[0].attackerPosition);
    EXPECT_EQ(5, attacks[0].defenderPosition);
    EXPECT_EQ(3, attacks[0].stars);
    EXPECT_DOUBLE_EQ(100.0, attacks[0].destructionPercentage);
    EXPECT_EQ(1, attacks[0].orderNum);
    EXPECT_EQ(120, attacks[0].duration);

    EXPECT_EQ("#DEFENDER", attacks[1].attackerTag);
    EXPECT_EQ("#ATTACKER", attacks[1].defenderTag);
    EXPECT_EQ("#OPPONENT", attacks[1].attackerClanTag);
    EXPECT_EQ("#HOME", attacks[1].defenderClanTag);
    EXPECT_EQ(2, attacks[1].stars);
    EXPECT_DOUBLE_EQ(75.0, attacks[1].destructionPercentage);
}

TEST(ClanwarModelsTest, ReturnsEmptyAttacksForNotInWarAndHandlesUnknownDefender)
{
    EXPECT_TRUE(ClanwarAttack::parseAttacksList(nlohmann::json::object()).empty());
    EXPECT_TRUE(
        ClanwarAttack::parseAttacksList(nlohmann::json{{"state", "notInWar"}}).empty()
    );
    EXPECT_TRUE(
        ClanwarAttack::parseAttacksList(
            nlohmann::json{
                {"state", "inWar"},
                {"opponent", {{"tag", "#OPPONENT"}}}
            }
        ).empty()
    );
    EXPECT_TRUE(
        ClanwarAttack::parseAttacksList(
            nlohmann::json{
                {"state", "inWar"},
                {"clan", {{"members", 123}}},
                {"opponent", {{"members", nlohmann::json::object()}}}
            }
        ).empty()
    );

    const nlohmann::json json = {
        {"state", "inWar"},
        {
            "clan", {
                {"tag", "#HOME"},
                {
                    "members", {
                        {
                            {"tag", "#ATTACKER"},
                            {"mapPosition", 1},
                            {
                                "attacks", nlohmann::json::array({
                                    nlohmann::json{{"defenderTag", "#UNKNOWN"}}
                                })
                            }
                        }
                    }
                }
            }
        }
    };

    const auto attacks = ClanwarAttack::parseAttacksList(json);

    ASSERT_EQ(1U, attacks.size());
    EXPECT_EQ("unknown", attacks[0].defenderClanTag);
    EXPECT_EQ(0, attacks[0].defenderPosition);
    EXPECT_EQ(0, attacks[0].stars);
    EXPECT_DOUBLE_EQ(0.0, attacks[0].destructionPercentage);
    EXPECT_EQ(0, attacks[0].orderNum);
    EXPECT_EQ(0, attacks[0].duration);
}

TEST(ClanwarModelsTest, SkipsMembersWithoutArrayOfAttacks)
{
    const nlohmann::json json = {
        {"state", "inWar"},
        {
            "clan", {
                {"tag", "#HOME"},
                {
                    "members", {
                        {{"tag", "#NO_ATTACKS"}, {"mapPosition", 1}},
                        {{"tag", "#INVALID_ATTACKS"}, {"attacks", nlohmann::json::object()}},
                        {
                            {"tag", "#VALID"},
                            {"mapPosition", 3},
                            {
                                "attacks", nlohmann::json::array({
                                    nlohmann::json{{"defenderTag", "#DEFENDER"}}
                                })
                            }
                        }
                    }
                }
            }
        },
        {
            "opponent", {
                {"tag", "#OPPONENT"},
                {
                    "members", {
                        {{"tag", "#DEFENDER"}, {"mapPosition", 4}}
                    }
                }
            }
        }
    };

    const auto attacks = ClanwarAttack::parseAttacksList(json);

    ASSERT_EQ(1U, attacks.size());
    EXPECT_EQ("#VALID", attacks[0].attackerTag);
    EXPECT_EQ("#DEFENDER", attacks[0].defenderTag);
    EXPECT_EQ("#OPPONENT", attacks[0].defenderClanTag);
    EXPECT_EQ(4, attacks[0].defenderPosition);
}

TEST(ClanwarModelsTest, ParsesClanwarMembersAndAppliesDefaults)
{
    const nlohmann::json json = {
        {"tag", "#CLAN"},
        {
            "members", {
                {
                    {"tag", "#ONE"},
                    {"name", "One"},
                    {"townhallLevel", 16},
                    {"mapPosition", 7}
                },
                nlohmann::json::object()
            }
        }
    };

    const auto members = ClanwarMember::parseClanwarMembers(json);

    ASSERT_EQ(2U, members.size());
    EXPECT_EQ("#CLAN", members[0].clanTag);
    EXPECT_EQ("#ONE", members[0].playerTag);
    EXPECT_EQ("One", members[0].playerName);
    EXPECT_EQ(16, members[0].townhallLevel);
    EXPECT_EQ(7, members[0].mapPosition);
    EXPECT_EQ("unknown", members[1].playerTag);
    EXPECT_EQ("Unknown", members[1].playerName);
    EXPECT_EQ(0, members[1].townhallLevel);
    EXPECT_EQ(0, members[1].mapPosition);
}

TEST(ClanwarModelsTest, ReturnsEmptyClanwarMemberListForEmptyMembers)
{
    EXPECT_TRUE(
        ClanwarMember::parseClanwarMembers(
            nlohmann::json{{"members", nlohmann::json::array()}}
        ).empty()
    );
}

TEST(ClanwarModelsTest, ReturnsEmptyClanwarMemberListWhenMembersAreMissingOrNotArray)
{
    EXPECT_TRUE(ClanwarMember::parseClanwarMembers(nlohmann::json::object()).empty());
    EXPECT_TRUE(
        ClanwarMember::parseClanwarMembers(
            nlohmann::json{{"tag", "#CLAN"}, {"members", 123}}
        ).empty()
    );
}

