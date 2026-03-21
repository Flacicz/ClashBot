#pragma once

#include "../../models/models.h"

#include <map>
#include <vector>

class Database;

class RaidRepo {
private:
	Database* db;
public:
	RaidRepo(Database* db);

	long long getRaidIdByDate(const std::string& clanTag, const std::string& date);
	long long getLastRaidId(const std::string& clanTag);

	bool insertOrUpdateSingleRaidInfo(const CapitalRaid& raid);
	bool insertOrUpdateSinglePlayersRaidInfo(long long raidId, const std::vector<PlayerRaidStats>& members);

	std::vector<PlayerRaidStats> checkSlackers(long long raidId);
};
