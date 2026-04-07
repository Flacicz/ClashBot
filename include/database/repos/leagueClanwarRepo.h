#pragma once

#include "../models/models.h"

#include <vector>

class Database;

class LeagueClanwarRepo {
private:
	Database* db;
public:
	LeagueClanwarRepo(Database* db);

	bool insertOrUpdateSingleCWLSeasonInfo(const ClanwarwarsLeagueSeason& info);
	bool insertOrUpdateSingleCWLRoundsInfo(const std::vector<ClanwarsLeagueRound>& rounds);
	bool insertOrUpdateSingleCWLAttacksInfo(const std::vector<ClanwarsLeagueAttacks>& attacks);
	bool insertOrUpdateSingleCWLMembersInfo(const std::vector<ClanwarsLeagueMembers>& members);
};
