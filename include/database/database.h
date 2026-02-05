#pragma once

#include <string>
#include <vector>
#include <sqlite3.h>

#include "../models/models.h"

class Database {
private:
	sqlite3* db;
	std::string pathToDb;

	
public:
	struct QueryResult {
		std::vector<std::string> columns;
		std::vector<std::vector<std::string>> rows;
	};

	Database(const std::string& path);
	~Database();

	sqlite3* getDBInstance() const { return db; };

	void initDatabase();

	void execute(const std::string& sql);
	bool executePrepeared(sqlite3_stmt* stmt) const;
	QueryResult query(const std::string& sql);

	bool insertOrUpdateClanInfo(const ClanInfo& clanInfo);
	bool insertOrUpdatePlayersInfo(const std::vector<Player>& players);
};