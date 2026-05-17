#pragma once

#include <sqlite3.h>

#include "../../models/models.h"

#include <vector>

class ClansRepo {
	sqlite3* db;
public:
	explicit ClansRepo(sqlite3* db);

	bool insertOrUpdateClanInfo(const Clan& clan) const;
	bool insertOrUpdateClanSnapshot(const ClanSnapshot& clanSnapshot) const;
	bool insertOrUpdatePlayersInfo(const std::vector<Player>& players) const;
	bool insertOrUpdatePlayersSnapshots(const std::vector<PlayerSnapshot>& playerSnapshots) const;
};