#pragma once

#include <string>
#include <vector>

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
};

struct ClanwarSeason {
    std::string seasonId;
    std::string clanTag;
};

struct ClanWar {
    std::string seasonId;
    std::string prep_start_time;
    std::string clanTag;
    std::string opponentTag;
    std::string opponentName;
    unsigned short teamSize;
    unsigned short clanStars;
    unsigned short opponentStars;
    std::string result;  // "win", "lose", "tie"
};

struct ClanwarAttack {
    std::string attackerTag;
    std::string attackerName;
    unsigned short attackerTh;
    unsigned short mapPosition;
    std::string defenderTag;
    unsigned short defenderTh;
    unsigned short stars;
    unsigned short destruction;
    unsigned short duration;
    unsigned short orderNum;
    std::string rules;
    bool isOpponentAttack;
};

struct PlayerRaidStats {
    std::string playerTag;
    std::string name;
    unsigned short attacksCount;
    unsigned short totalLoot;
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
};

struct LeagueClanwarSeason {
    std::string seasonId;
    std::string clanTag;
    std::string leagueId;
    std::string state;
};

struct LeagueClanwarRound {
    std::string warTag;
    std::string seasonId;
    unsigned short round;
    std::string opponent_tag;
};

struct LeagueClanwarAttack {
    std::string warTag;
    std::string attackerClanTag;
    std::string attackerTag;
    unsigned short attackerMapPosition;
    std::string defenderTag;
    unsigned short defenderMapPosition;
    std::string rules;
    unsigned short stars;
    unsigned short destruction;
    unsigned short duration;
    unsigned short attackerTHlvl;
    unsigned short defenderTHlvl;
};

struct LeagueClanwarMember {
    std::string playerTag;
    std::string seasonId;
    std::string name;
    std::string clanTag;
};
