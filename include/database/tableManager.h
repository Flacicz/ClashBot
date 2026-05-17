#pragma once

#include <sqlite3.h>
#include <string>
#include <vector>

class TableManager {
private:
	sqlite3* db;
public:
	explicit TableManager(sqlite3* db);

	bool initClanTable() const;
	bool initPlayersInfoTable() const;

	bool initRaidSummary() const;
	bool initRaidDetails() const;

	bool initClanwarSeason() const;
	bool initClanwarSummary() const;
	bool initClanwarAttacks() const;

	bool initClanwarLeagueSeason() const;
	bool initClanwarLeagueRounds() const;
	bool initClanwarLeagueAttacks() const;
	bool initClanwarMembers() const;

	bool initNotifications() const;

	bool initAllTables() const;

	bool dropAllTables() const;

	std::vector<std::vector<std::string>> getAllTableNames() const;
};
