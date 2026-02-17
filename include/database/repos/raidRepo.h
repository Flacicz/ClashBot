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

	bool insertSingleRaidInfo(const CapitalRaid& raid);
	bool insertSinglePlayersRaidInfo(const std::map<std::string, std::vector<PlayerRaidStats>>& players);
};
