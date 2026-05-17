#pragma once

#include "../../models/models.h"

#include <map>
#include <sqlite3.h>
#include <vector>

class RaidRepo {
	sqlite3* db;
public:
	explicit RaidRepo(sqlite3* db);

	long long insertOrUpdateSingleRaid(const ClanRaid& clanRaid) const;
	bool insertOrUpdatePlayersSnapshots(long long raidId, const std::vector<PlayerRaidSnapshot>& members) const;
};
