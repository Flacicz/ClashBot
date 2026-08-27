#pragma once

#include <string>
#include <string_view>
#include <vector>

#include <nlohmann/json_fwd.hpp>

enum class RaidStates
{
    Ended,
    Ongoing,
    Scheduled
};

// Core models.
struct ClanRaid
{
    std::string clanTag;
    long long startTime;
    long long endTime;
    std::string state;
    int totalLoot;
    int raidsCompleted;
    int totalAttacks;
    int enemyDistrictsDestroyed;
    int offensiveReward;
    int defensiveReward;

    static ClanRaid fromJson(const nlohmann::json& j, std::string_view clanTag);
};

struct PlayerRaidSnapshot
{
    std::string playerTag;
    int attacksCount;
    int bonusAttack;
    int totalLoot;

    static PlayerRaidSnapshot parsePlayerRaidSnapshot(const nlohmann::json& j);
    static std::vector<PlayerRaidSnapshot> fromJson(const nlohmann::json& j);
};

struct CompleteRaidData
{
    ClanRaid clanRaid;
    std::vector<PlayerRaidSnapshot> playerRaidSnapshots;
};

// Report models.
struct RaidStats
{
    int totalLoot;
    int raidsCompleted;
    int totalAttacks;
    int enemyDistrictsDestroyed;
    int offensiveReward;
    int defensiveReward;
};

struct RaidMemberStats
{
    std::string playerTag;
    std::string playerName;
    int attacksCount;
    int bonusAttacks;
    int totalLoot;
};

struct RaidSlacker
{
    std::string playerTag;
    std::string playerName;
    int attacksCount;
    int bonusAttacks;
};

struct RaidReportData
{
    std::string clanTag;
    std::string clanName;

    RaidStats stats;
    std::vector<RaidMemberStats> bestMembers;
};
