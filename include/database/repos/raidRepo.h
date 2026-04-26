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

	long long getRaidIdByDate(const std::string& clanTag, const std::string& date) const;
	long long getLastRaidId(const std::string& clanTag) const;

	bool insertOrUpdateSingleRaidInfo(const CapitalRaid& raid) const;
	bool insertOrUpdateSinglePlayersRaidInfo(long long raidId, const std::vector<PlayerRaidStats>& members) const;

	bool isNotified(long long raidId) const;
	void markAsNotifies(long long raidId) const;

	std::vector<PlayerRaidStats> checkSlackers(long long raidId) const;
};
