#pragma once

#include "../../models/models.h"

#include <vector>
#include <map>
#include <string>

class Database;

class ClanwarRepo {
private:
	Database* db;
public:
	ClanwarRepo(Database* db);

	bool insertSingleClanwarInfo(const ClanWar& raid);
	bool insertSinglePlayersClanwarInfo(const std::map<std::string, std::vector<PlayerWarStats>>& players);
};