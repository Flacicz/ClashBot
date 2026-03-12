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

	bool insertSingleClanwarSeasonInfo(const ClanwarSeason& season);
	bool insertSingleClanwarInfo(const ClanWar& clanwar);
	bool insertSingleClanwarAttacksInfo(std::string warId, std::vector<ClanwarAttack> attacks);

	std::string getClanwarIdByDate(const std::string& clanTag, const std::string& date);
};