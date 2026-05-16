#pragma once

#include <optional>
#include <string>
#include <vector>
#include <nlohmann/json_fwd.hpp>
#include <string_view>

namespace WarType {
    constexpr std::string_view Regular = "regular";
    constexpr std::string_view CWL = "cwl";
    constexpr std::string_view Friendly = "friendly";
}

namespace ClanType
{
    constexpr std::string_view Home = "home";
    constexpr std::string_view Opponent = "opponent";
}

struct ClanInfo {
	std::string tag;
	std::string name;
    std::string type;
    std::string description;
    int members;

    int clanLevel;
    int clanPoints;
    int clanBuilderPoints;
    int clanCapitalPoints;
    int capitalHallLevel;
    std::string capitalLeague;

    int requiredTrophies;
    int requiredBuilderBaseTrophies;
    int requiredTownhallLevel;

    std::string warFrequency;
    bool isWarLogPublic;
    int warWinStreak;
    int warWins;
    int warTies;
    int warLosses;
    std::string warLeague;

    std::string locationName;
    std::string chatLanguage;

    static ClanInfo fromJson(const nlohmann::json& j);
};

struct Player {
    std::string tag;
    std::string clanTag;
    std::string name;
    std::string role;
    int townHallLevel;
    int expLevel;

    std::string leagueTier;
    int trophies;
    int builderBaseTrophies;

    int donations;
    int donationsReceived;

    int clanRank;

    static Player fromJson(const nlohmann::json& j, std::string_view clanTag);
};

struct PlayerRaidStats {
    std::string playerTag;
    std::string name;
    unsigned short attacksCount;
    unsigned short totalLoot;

    static PlayerRaidStats fromJson(const nlohmann::json& j);
};

struct CapitalRaid {
    std::string clanTag;
    std::string date;
    std::string state;
    unsigned int totalLoot;
    unsigned short raidsCompleted;
    unsigned short totalAttacks;
    unsigned short enemyDistrictsDestroyed;
    unsigned short offensiveReward;
    unsigned short defensiveReward;

    std::vector<PlayerRaidStats> members;

    static CapitalRaid fromJson(const nlohmann::json& j, std::string_view clanTag);
};

struct ClanwarsLeagueSeason {
    std::string clanTag;
    std::string seasonId;

    static ClanwarsLeagueSeason fromJson(const nlohmann::json& j, std::string_view clanTag);
};

struct Clanwar {
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

struct ClanwarAttack {
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

struct ClanwarMember {
    std::string clanTag;
    std::string playerTag;
    std::string playerName;
    int townhallLevel;
    int mapPosition;

    static std::vector<ClanwarMember> parseClanwarMembers(const nlohmann::json& j);
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

struct ClanwarsLeagueWarDetails {
    Clanwar war;
    std::pair<ClanwarClan, ClanwarClan> clans;
    std::vector<ClanwarAttack> attacks;
    std::vector<ClanwarsLeagueMember> members;
};
