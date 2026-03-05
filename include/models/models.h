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

    bool isEmpty() const { return clanTag == ""; };
};

struct PlayerWarStats {
    std::string playerTag;
    unsigned short attacksCount;
    unsigned short starsCount;
    unsigned short mapPosition;
    std::string rules;
};

struct CapitalRaid {
    std::string clanTag;
    std::string date;
    unsigned int totalLoot;
    unsigned short raidsCompleted;
    unsigned short totalAttacks;
    unsigned short enemyDistrictsDestroyed;
    unsigned short offensiveReward;
    unsigned short defensiveReward;

    bool isEmpty() const { return clanTag == ""; };
};

struct PlayerRaidStats {
    std::string playerTag;
    std::string name;
    unsigned short attacksCount;
    unsigned short totalLoot;
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
