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

	bool insertOrUpdateSingleRaidInfo(const CapitalRaid& raid);
	bool insertOrUpdateSinglePlayersRaidInfo(long long raidId, const std::vector<PlayerRaidStats>& members);
};
