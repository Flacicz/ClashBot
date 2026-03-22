#pragma once

#include "../../models/models.h"

#include <vector>

class Database;

class ClanInfoRepo {
private:
	Database* db;
public:
	ClanInfoRepo(Database* db);

	bool insertOrUpdateClanInfo(const ClanInfo& clanInfo);
	bool insertOrUpdatePlayersInfo(const std::vector<Player>& players);
	bool removeExitedPlayers(const std::string& clanTag, long long updated_time);
};