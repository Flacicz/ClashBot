#pragma once

#include <string>

struct ClanInfo {
	std::string tag;
	std::string name;
	unsigned short members;
    unsigned short clanLevel;
    unsigned short capitalHallLevel;
	std::string capitalLeague;
	std::string warLeague;
    unsigned short warWinStreak;
    unsigned short warWins;
    unsigned short warTies;
    unsigned short warLosses;
};

struct Player {
    std::string tag;
    std::string clanTag;
    std::string name;
    std::string role;
    unsigned short townHallLevel;
    std::string leagueTier;
    unsigned short trophies;
    unsigned short donations;
    unsigned short donationsReceived;
    long long updatedAt;
};

struct ClanWar {
    std::string clanTag;
    std::string date;  // YYYY-MM-DD
    unsigned short teamSize;
    unsigned short attacks;
    unsigned short stars;
    std::string result;  // "win", "lose", "tie"
    unsigned short expEarned;
    unsigned short destructionPercentage;
    long long createdAt;
};

struct PlayerWarStats {
    std::string playerTag;
    unsigned short warId;
    unsigned short attacksCount;
    unsigned short starsCount;
    unsigned short mapPosition;
    std::string rules;
    long long createdAt;
};

struct CapitalRaid {
    std::string clanTag;
    std::string date;
    unsigned short totalLoot;
    unsigned short totalAttacks;
    unsigned short offensiveReward;
    unsigned short defensiveReward;
    unsigned short capitalRank;
    long long createdAt;
};

struct PlayerRaidStats {
    std::string playerTag;
    unsigned short raidId;
    unsigned short attacksCount;
    unsigned short totalLoot;
    long long createdAt;
};
