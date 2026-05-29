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
    std::optional<std::string> seasonId;

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

struct InsertedWarResult {
    long long warId;
    long long homeClanId;
    long long opponentClanId;
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

struct ClanwarsLeagueWarDetails
{
    Clanwar war;
    std::pair<ClanwarClan, ClanwarClan> clans;
    std::vector<ClanwarAttack> attacks;
};

struct CompleteClanwarsLeagueData
{
    ClanwarsLeagueSeason clanwarsLeagueSeason;
    std::vector<ClanwarsLeagueMember> clanwarsLeagueMembers;
    std::vector<ClanwarsLeagueWarDetails> warDetails;
};

struct RaidSlacker
{
    std::string playerTag;
    std::string playerName;
    int attacksCount;
};

struct RaidReportData
{
    long long raidId;
    std::string state;
    std::vector<RaidSlacker> raidSlackers;
};

struct ClanwarSlacker
{
    std::string playerTag;
    std::string playerName;
};

struct ClanwarReportData
{
    long long clanwarId;
    std::string state;
    std::pair<ClanwarClan, ClanwarClan> clanwars;

    std::vector<ClanwarSlacker> missedAllAttacks;
    std::vector<ClanwarSlacker> missedOneAttack;
    std::vector<ClanwarSlacker> notMirror;
};

struct ClanwarsLeagueReportData
{
    long long seasonId;
    std::string clanTag;

    std::vector<ClanwarReportData> reports;
};