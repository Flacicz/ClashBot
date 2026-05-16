#pragma once

#include "../../models/models.h"

#include <vector>

class Database;

class ClansRepo {
private:
	Database* db;
public:
	ClansRepo(Database* db);

	bool insertOrUpdateClanInfo(const ClanInfo& clanInfo) const;
	bool insertOrUpdatePlayersInfo(const std::vector<Player>& players) const;
	bool removeExitedPlayers(const std::string& clanTag, long long updated_time) const;
};