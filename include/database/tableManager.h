#pragma once

#include <string>
#include <vector>

class Database;

class TableManager {
private:
	Database* db;
public:
	TableManager(Database* db);

	bool initClanTable();
	bool initPlayersInfoTable();

	bool initRaidSummary();
	bool initRaidDetails();

	bool initClanwarSeason();
	bool initClanwarSummary();
	bool initClanwarAttacks();

	bool initClanwarLeagueSeason();
	bool initClanwarLeagueRounds();
	bool initClanwarLeagueAttacks();
	bool initClanwarMembers();

	bool initAllTables();

	bool dropAllTables();

	std::vector<std::vector<std::string>> getAllTableNames();
};
