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

	bool insertSingleClanwarSeasonInfo(const ClanwarSeason& season) const;
	bool insertSingleClanwarInfo(const ClanWar& clanwar) const;
	bool insertSingleClanwarAttacksInfo(const std::string& warId, const std::vector<ClanwarAttack>& attacks) const;

	std::string getClanwarIdByDate(const std::string& clanTag, const std::string& date) const;
	std::string getLastId(const std::string& clanTag) const;
	std::vector<ClanwarAttack> getClanwarAttacks(const std::string& warId) const;

	bool isNotified(const std::string& warId) const;
	void markAsNotified(const std::string& warId) const;
};
