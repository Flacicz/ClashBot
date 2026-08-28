#pragma once

#include <optional>
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

struct RaidReference
{
    long long raidId;
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

struct RaidComparisonStats
{
    long long startTime;

    int totalLoot;
    int raidsCompleted;
    int usedAttacks;
    int availableAttacks;

    // Active participants are players present in the API response.
    int activeParticipants;
    // Eligible participants include active participants and players without attacks.
    int eligibleParticipants;
    int participantsWithAllAttacksUsed;
    int participantsWithoutAttacks;

    int enemyDistrictsDestroyed;
    int offensiveReward;
    int defensiveReward;
};

struct RaidHistoricalAverages
{
    int raidsCount;

    double averageLootPerUsedAttack;
    double averageParticipantsWithAllAttacksUsedRate;
    double averageParticipantsWithoutAttacksRate;

    double averageAttackUsageRate;
    double averageActiveParticipants;
    double averageEligibleParticipants;
    double averageParticipantsWithAllAttacksUsed;
    double averageParticipantsWithoutAttacks;
    double averageUsedAttacks;
    double averageAvailableAttacks;

    double averageTotalLoot;
    double averageRaidsCompleted;
    double averageEnemyDistrictsDestroyed;
    double averageOffensiveReward;
    double averageDefensiveReward;
};

enum class RaidPerformanceTrend
{
    Better,
    Worse,
    Similar
};

struct RaidPerformanceComparison
{
    // The score uses three metrics:
    // loot per used attack, full attack rate among active participants
    // and the rate of eligible participants without attacks.
    RaidPerformanceTrend trend;
    int improvedMetrics;
    int worsenedMetrics;
    int unchangedMetrics;
    int totalMetrics;
    double improvedMetricsRate;
    double worsenedMetricsRate;
    double unchangedMetricsRate;
};

struct RaidComparisonData
{
    std::string clanTag;
    std::string clanName;

    RaidComparisonStats currentRaid;
    std::optional<RaidComparisonStats> previousRaid;
    std::optional<RaidHistoricalAverages> previousRaidsAverage;
    std::optional<RaidPerformanceComparison> performanceComparison;
};
