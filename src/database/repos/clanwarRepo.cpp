#include "../database/repos/clanwarRepo.h"

#include "../database/database.h"

#include <iostream>
#include <vector>
#include <map>
#include <string>

ClanwarRepo::ClanwarRepo(Database* db) : db(db) {}

bool ClanwarRepo::insertSingleClanwarInfo(const ClanWar& cw) {
	if (cw.isEmpty()) return 0;


}

bool ClanwarRepo::insertSinglePlayersClanwarInfo(const std::map<std::string, std::vector<PlayerWarStats>>& players) {
	return 0;
}