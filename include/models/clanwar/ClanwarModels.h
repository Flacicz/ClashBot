#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <nlohmann/json_fwd.hpp>

namespace WarType
{
    constexpr std::string_view Regular = "regular";
    constexpr std::string_view CWL = "cwl";
    constexpr std::string_view Friendly = "friendly";
}

namespace ClanType
{
    constexpr std::string_view Home = "home";
    constexpr std::string_view Opponent = "opponent";
}

// Core models.
struct Clanwar
{
    std::string warUID;
    std::string clanTag;
    std::string state;
    std::string warType;
    int teamSize;
    int attacksPerMember;
    long long preparationStartTime;
    long long startTime;
    long long endTime;
    std::optional<long long> seasonId;
    std::optional<int> roundNumber;

    static Clanwar fromJson(const nlohmann::json& j, std::string_view warType, std::string_view clanTag);
};

struct ClanwarClan
{
    std::string side;
    std::string clanTag;
    std::string clanName;
    int clanLevel;
    int attacksCount;
    int stars;
    double destructionPercentage;

    static ClanwarClan fromJson(const nlohmann::json& j, std::string_view side);
};

struct ClanwarAttack
{
    std::string attackerTag;
    std::string defenderTag;
    std::string attackerClanTag;
    std::string defenderClanTag;
    int attackerPosition;
    int defenderPosition;
    int stars;
    double destructionPercentage;
    int orderNum;
    int duration;

    static std::vector<ClanwarAttack> parseAttacksList(const nlohmann::json& j);
};

struct ClanwarMember
{
    std::string clanTag;
    std::string playerTag;
    std::string playerName;
    int townhallLevel;
    int mapPosition;

    static std::vector<ClanwarMember> parseClanwarMembers(const nlohmann::json& j);
};

struct CompleteClanwarData
{
    Clanwar clanwar;
    std::pair<ClanwarClan, ClanwarClan> clans;
    std::vector<ClanwarAttack> attacks;
    std::pair<std::vector<ClanwarMember>, std::vector<ClanwarMember>> members;
};

// Persistence and fetch-result models.
struct ClanwarReference
{
    std::string clanTag;
    long long warId;
    long long homeClanId;
    long long opponentClanId;
};

enum class ClanwarFetchStatus
{
    Success,
    NoActiveWar,
    Error
};

struct ClanwarsFetchResult
{
    ClanwarFetchStatus status;
    std::optional<CompleteClanwarData> clanwarData;
    std::string errorMsg;
};

// Report models.
struct ClanwarOverview
{
    std::string clanTag;
    std::string clanName;

    int stars;
    double destructionPercentage;
};

struct ClanwarAttackStats
{
    int attacksUsed;
    int maxAttacks;
    int teamSize;
    int totalAttackStars;
    double averageStars;
    double averageDestruction;
    int threeStarAttacks;
    int twoStarAttacks;
    int oneStarAttacks;
    int zeroStarAttacks;
};

struct BestAttack
{
    std::string attackerTag;
    std::string attackerName;
    int stars;
    double destructionPercentage;

    int attackerPosition;
    int defenderPosition;
};

struct ClanwarDisciplineStats
{
    int playersWithoutAttacks;
    int playersWithOneAttack;
    int firstAttacksNotOnMirror;
};

struct ClanwarSlacker
{
    std::string playerTag;
    std::string playerName;
};

struct NotMirrorAttack
{
    std::string attackerTag;
    std::string attackerName;
    int attackerPosition;
    int defenderPosition;
};

struct ClanwarResultReportData
{
    ClanwarOverview home;
    ClanwarOverview opponent;

    ClanwarAttackStats attackStats;
    std::vector<BestAttack> bestAttacks;
};

struct WarRoundDetails
{
    ClanwarOverview home;
    ClanwarOverview opponent;

    ClanwarAttackStats attack_stats;
    std::vector<BestAttack> best_attacks;
};

// Analytics models.
enum class ClanwarOutcome
{
    Victory,
    Defeat,
    Draw
};

struct ClanwarWarStats
{
    int homeStars;
    int opponentStars;

    // Total clan destruction from the API, used for the war result tie-breaker.
    double homeDestruction;
    double opponentDestruction;

    ClanwarOutcome result;

    int maxAttacks;
    int attacksUsed;
    int teamSize;

    int totalAttackStars;
    double averageStarsPerAttack;
    double averageDestructionPerAttack;

    ClanwarDisciplineStats disciplineStats;

    std::string homeClanTag;
    std::string homeClanName;
    std::string opponentClanTag;
    std::string opponentClanName;
};

struct ClanwarHistoricalAverages
{
    int warsCount;

    double averageStarsPerAttack;
    double averageDestructionPerAttack;
    double averageAttacksUsed;
    double averageMaxAttacks;
    double averageMissedAttacks;
    double averagePlayersWithoutAttacks;
    double averagePlayersWithOneAttack;
    double averageFirstAttacksNotOnMirror;

    double averageMissedAttacksRate;
    double averagePlayersWithoutAttacksRate;
    double averagePlayersWithOneAttackRate;
    double averageFirstAttacksNotOnMirrorRate;
};

enum class ClanwarPerformanceTrend
{
    Better,
    Worse,
    Similar
};

struct ClanwarPerformanceComparison
{
    // The score uses four primary metrics:
    // stars per attack, destruction, players without attacks
    // and first attacks not on mirror.
    // Players with one attack are shown as activity context because a second
    // attack is not automatically a violation.
    ClanwarPerformanceTrend trend;
    int improvedMetrics;
    int worsenedMetrics;
    int unchangedMetrics;
    int totalMetrics;
    double improvedMetricsRate;
    double worsenedMetricsRate;
    double unchangedMetricsRate;
};

struct ClanwarComparisonData
{
    ClanwarWarStats currentWar;
    std::optional<ClanwarWarStats> previousWar;
    std::optional<ClanwarHistoricalAverages> previousWarsAverage;
    std::optional<ClanwarPerformanceComparison> performanceComparison;
    std::vector<ClanwarOutcome> recentWarResults;
};

struct ClanwarPlayerAttack
{
    std::string playerTag;
    int stars;
    double destructionPercentage;
};

struct PlayerRosterStats
{
    std::string playerTag;
    std::string playerName;
    int includedWars = 0;
    std::optional<int> lastWarOffset;
};

struct PlayerAttackStats
{
    std::string playerTag;
    std::string playerName;
    int attacksUsed = 0;
    double averageStarsPerAttack = 0.0;
    double averageDestructionPerAttack = 0.0;
};

struct PlayerViolationStats
{
    std::string playerTag;
    std::string playerName;

    int warsWithoutAttacks = 0;
    int warsWithOneAttack = 0;
    int firstAttacksNotOnMirror = 0;
};

struct ClanwarRosterPlayerReport
{
    std::string playerTag;
    std::string playerName;

    int includedWars = 0;
    std::optional<int> lastWarOffset;

    int attacksUsed = 0;
    double averageStarsPerAttack = 0.0;
    double averageDestructionPerAttack = 0.0;

    int warsWithoutAttacks = 0;
    int warsWithOneAttack = 0;
    int firstAttacksNotOnMirror = 0;
};

struct ClanwarRosterReportData
{
    int warsCount = 0;
    std::vector<ClanwarRosterPlayerReport> players;
};
