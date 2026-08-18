#pragma once

#include <optional>
#include <string>
#include <vector>
#include <nlohmann/json_fwd.hpp>
#include <string_view>

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

struct Clan
{
    std::string tag;
    std::string name;
    std::string description;
    int locationId;
    std::string locationName;
    int chatLanguageId;
    std::string chatLanguage;
    bool isFamilyFriendly;

    static Clan fromJson(const nlohmann::json& j);
};

struct TelegramDestination
{
    long long chatId;
    long long messageThreadId;
};

struct Player
{
    std::string tag;
    std::string name;
    std::string clanTag;

    static Player parsePlayer(const nlohmann::json& j, std::string_view clanTag);
    static std::vector<Player> parsePlayersList(const nlohmann::json& j);
};

struct ClanSnapshot
{
    std::string clanTag;
    std::string type;
    int membersCount;
    int clanLevel;
    int clanPoints;
    int clanBuilderBasePoints;
    int clanCapitalPoints;
    int capitalHallLevel;
    int capitalLeagueId;
    int requiredTrophies;
    int requiredBuilderBaseTrophies;
    int requiredTownhallLevel;
    std::string warFrequency;
    bool isWarLogPublic;
    int warWinStreak;
    int warWins;
    int warTies;
    int warLosses;
    int warLeagueId;

    static ClanSnapshot fromJson(const nlohmann::json& j);
};

struct PlayerSnapshot
{
    std::string playerTag;
    std::string clanTag;
    std::string role;
    int townHallLevel;
    int expLevel;
    int clanRank;
    int leagueId;
    int builderBaseLeagueId;
    int trophies;
    int builderBaseTrophies;
    int donations;
    int donationsReceived;

    static PlayerSnapshot parsePlayerSnapshot(const nlohmann::json& j, std::string_view currentClanTag);
    static std::vector<PlayerSnapshot> parsePlayerSnapshotList(const nlohmann::json& j, std::string_view clanTag);
};

struct CompleteClanData
{
    Clan clan;
    std::vector<Player> players;
    ClanSnapshot clanSnapshot;
    std::vector<PlayerSnapshot> playerSnapshots;
};

struct ClanReportData
{
    std::string clanTag;
    std::pair<std::vector<Player>, std::vector<Player>> leaveJoinPlayers;
};

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


struct PreparedAttackData
{
    long long attackerWarClanId;
    long long defenderWarClanId;
    ClanwarAttack attack;

    static PreparedAttackData prepare(const ClanwarAttack& attack,
                                      const long long homeClanId,
                                      const std::string_view homeClanTag,
                                      const long long opponentClanId)
    {
        const bool isHomeAttack = attack.attackerClanTag == homeClanTag;

        return PreparedAttackData{
            .attackerWarClanId = isHomeAttack ? homeClanId : opponentClanId,
            .defenderWarClanId = isHomeAttack ? opponentClanId : homeClanId,
            .attack = attack
        };
    }
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

struct BestAttack
{
    std::string attackerTag;
    std::string attackerName;
    int stars;
    double destructionPercentage;

    int attackerPosition;
    int defenderPosition;
};

struct ClanwarsLeagueSeason
{
    std::string clanTag;
    std::string seasonId;

    static ClanwarsLeagueSeason fromJson(const nlohmann::json& j, std::string_view clanTag);
};

struct ClanwarsLeagueMember
{
    std::string playerTag;
    std::string playerName;
    int townhallLevel;
    std::string clanTag;
    std::string seasonId;

    static std::vector<ClanwarsLeagueMember> parseClanwarsLeagueMembers(const nlohmann::json& j);
};

struct CompleteClanwarsLeagueData
{
    ClanwarsLeagueSeason clanwarsLeagueSeason;
    std::vector<ClanwarsLeagueMember> clanwarsLeagueMembers;
    std::vector<CompleteClanwarData> warDetails;
};

enum class LeagueFetchStatus
{
    Success,
    NoActiveLeague,
    Error
};

struct ClanwarsLeagueFetchResult
{
    LeagueFetchStatus status;
    std::optional<CompleteClanwarsLeagueData> completeClanwarsLeagueData;
    std::string errorMsg;
};

struct RaidSlacker
{
    std::string playerTag;
    std::string playerName;
    int attacksCount;
    int bonusAttacks;
};

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

struct RaidReportData
{
    std::string clanTag;
    std::string clanName;

    RaidStats stats;
    std::vector<RaidMemberStats> bestMembers;
    std::vector<RaidSlacker> slackers;
};

struct ClanwarSlacker
{
    std::string playerTag;
    std::string playerName;
};

struct ClanwarDisciplineStats
{
    int playersWithoutAttacks = 0;
    int playersWithOneAttack = 0;
    int firstAttacksNotOnMirror = 0;
};

struct ClanwarOverview
{
    std::string clanTag;
    std::string clanName;

    int stars;
    double destructionPercentage;
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
    ClanwarDisciplineStats disciplineStats;
};

struct WarRoundDetails
{
    ClanwarOverview home;
    ClanwarOverview opponent;

    ClanwarAttackStats attack_stats;
    std::vector<BestAttack> best_attacks;
    std::vector<ClanwarSlacker> missedAttack;
    std::vector<NotMirrorAttack> notMirrorAttacks;
};

struct CWLRoundInfo
{
    std::string season;
    int roundNumber;
};

struct ClanwarsLeagueRoundReportData
{
    CWLRoundInfo cwlRoundInfo;
    WarRoundDetails warDetails;
};

struct MembershipChanges
{
    std::vector<Player> leftPlayers;
    std::vector<Player> joinedPlayers;
};

enum class RaidStates
{
    Ended,
    Ongoing,
    Scheduled
};

struct LatestPlayerState
{
    std::string clanTag;
    std::string playerTag;
    std::string playerName;
    std::string role;
    int townHallLevel;
    int expLevel;
    int clanRank;
    int leagueId;
    int builderBaseLeagueId;
    int trophies;
    int builderBaseTrophies;
    int donations;
    int donationsReceived;
};

struct RoleChange
{
    std::string clanTag;

    std::string playerTag;
    std::string playerName;

    std::string oldRole;
    std::string newRole;
};

struct RoleChanges
{
    std::vector<RoleChange> changes;
};

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

    double homeDestruction;
    double opponentDestruction;

    ClanwarOutcome result;

    int maxAttacks;
    int attacksUsed;
    int teamSize;

    int totalAttackStars;
    double averageStarsPerAttack;

    ClanwarDisciplineStats disciplineStats;
};

struct ClanwarHistoricalAverages
{
    int warsCount;

    double averageStarsPerAttack;
    double averageDestruction;
    double averageMissedAttacks;
    double averagePlayersWithOneAttack;
    double averageFirstAttacksNotOnMirror;

    double averageMissedAttacksRate;
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
    ClanwarPerformanceTrend trend;
    int improvedMetrics;
    int worsenedMetrics;
};

struct ClanwarComparisonData
{
    ClanwarWarStats currentWar;
    std::optional<ClanwarWarStats> previousWar;
    std::optional<ClanwarHistoricalAverages> previousWarsAverage;
    std::optional<ClanwarPerformanceComparison> performanceComparison;
    std::vector<ClanwarOutcome> recentWarResults;
};
