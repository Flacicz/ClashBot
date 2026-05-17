#pragma once

#include <sqlite3.h>

#include "../../models/models.h"

#include <vector>
#include <string>

class LeagueClanwarRepo {
	sqlite3* db;
public:
	LeagueClanwarRepo(sqlite3* db);

	bool insertOrUpdateSingleCWLSeasonInfo(const ClanwarwarsLeagueSeason& info) const;
	bool insertOrUpdateSingleCWLRoundsInfo(const std::vector<ClanwarsLeagueRound>& rounds) const;
	bool insertOrUpdateSingleCWLAttacksInfo(const std::vector<ClanwarsLeagueAttacks>& attacks) const;
	bool insertOrUpdateSingleCWLMembersInfo(const std::vector<ClanwarsLeagueMembers>& members) const;

	bool isNotified(const std::string& warTag, const std::string& clanTag) const;
	void markAsNotified(const std::string& warTag, const std::string& clanTag) const;
};
