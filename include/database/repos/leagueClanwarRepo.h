#pragma once

#include "../models/models.h"

#include <vector>

class Database;

class LeagueClanwarRepo {
private:
	Database* db;
public:
	LeagueClanwarRepo(Database* db);

	bool insertOrUpdateSingleCWLSeasonInfo(const LeagueClanwarSeason& info);
	bool insertOrUpdateSingleCWLRoundsInfo(const std::vector<LeagueClanwarRound>& rounds);
	bool insertOrUpdateSingleCWLAttacksInfo(const std::vector<LeagueClanwarAttack>& attacks);
	bool insertOrUpdateSingleCWLMembersInfo(const std::vector<LeagueClanwarMember>& members);

	void updateCWLData();
};
